import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import {
  syncUserAchievementState,
} from "./achievementsService";
import { isTreinoDayExpired } from "./eventDateUtils";
import { hydrateEventViewerState } from "./hotPathRelations";
import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = { cachedAt: number; value: T };
const TTL_MS = 120_000;
const MAX_POST_RESULTS = 8;
const MAX_EVENT_RESULTS = 8;
const MAX_TREINO_RESULTS = 8;
const MAX_LIGA_RESULTS = 8;
const MAX_FOLLOW_RESULTS = 260;
const MAX_FOLLOW_SCAN_RESULTS = 720;
const FOLLOW_LIST_TENANT_FALLBACK_MULTIPLIER = 6;
const PROFILE_PUBLIC_FALLBACK_POST_LIMIT = 6;
const PROFILE_PUBLIC_FALLBACK_EVENT_LIMIT = 3;
const PROFILE_PUBLIC_FALLBACK_TREINO_LIMIT = 3;
const PROFILE_PUBLIC_FALLBACK_LIGA_LIMIT = 3;
const PROFILE_RPC_BREAKER_TTL_MS = 10 * 60 * 1000;
const PROFILE_PUBLIC_BUNDLE_RPC = "profile_public_bundle";
const PROFILE_FOLLOW_LIST_PAGE_RPC = "profile_follow_list_page";
const PROFILE_TOGGLE_FOLLOW_RPC = "profile_toggle_follow";
const PROFILE_USER_SELECT_COLUMNS =
  "uid,nome,apelido,foto,turma,bio,instagram,telefone,cidadeOrigem,dataNascimento,role,tenant_id,tenant_role,status,whatsappPublico,idadePublica,relacionamentoPublico,esportes,pets,statusRelacionamento,plano,plano_cor,plano_icon,patente,patente_icon,patente_cor,tier,level,xp,stats";

const publicBundleCache = new Map<string, CacheEntry<PublicProfileBundle | null>>();
const followListCache = new Map<string, CacheEntry<FollowListItem[]>>();
const followCountsCache = new Map<string, CacheEntry<FollowCounts>>();
let profilePublicBundleRpcAvailable: boolean | null = null;
let profileFollowListPageRpcAvailable: boolean | null = null;
let profilePublicBundleRpcUnavailableUntil = 0;
let profileFollowListPageRpcUnavailableUntil = 0;

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
const asString = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asStoredCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;

const toMillis = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  const obj = asObject(value);
  const toDate = obj?.toDate;
  if (typeof toDate === "function") {
    const parsed = toDate.call(value) as Date;
    if (parsed instanceof Date) return parsed.getTime();
  }
  return 0;
};

const boundedLimit = (requested: number, maxAllowed: number): number => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

const getCache = <T>(cache: Map<string, CacheEntry<T>>, key: string): T | null => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
};

const setCache = <T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const isRpcCircuitOpen = (available: boolean | null, unavailableUntil: number): boolean =>
  available === false && unavailableUntil > Date.now();

const openRpcCircuit = (): number => Date.now() + PROFILE_RPC_BREAKER_TTL_MS;

const throwSupabaseError = (error: { message: string; code?: string | null; name?: string | null }): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const isMissingRpcError = (error: { code?: string | null; message?: string | null }): boolean => {
  const code = typeof error.code === "string" ? error.code.toUpperCase() : "";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return (
    code === "PGRST202" ||
    code === "42883" ||
    message.includes("could not find the function") ||
    message.includes("schema cache") ||
    (message.includes("function") && message.includes("does not exist"))
  );
};

const isMissingRelationError = (error: { code?: string | null; message?: string | null }): boolean => {
  const code = typeof error.code === "string" ? error.code.toUpperCase() : "";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("relation") && message.includes("does not exist"))
  );
};

const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown; hint?: unknown };
  const message = [raw.message, raw.details, raw.hint]
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .filter((entry) => entry.length > 0)
    .join(" | ");
  if (!message) return null;

  const patterns = [
    /column\s+[a-z0-9_]+\.(["']?)([a-z0-9_]+)\1\s+does not exist/i,
    /column\s+(["']?)([a-z0-9_]+)\1\s+does not exist/i,
    /could not find the ['"]?([a-z0-9_]+)['"]? column/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match) continue;
    const extracted = match[2] ?? match[1];
    if (extracted) return extracted;
  }

  return null;
};

const isMissingTenantIdColumn = (error: unknown): boolean =>
  extractMissingSchemaColumn(error)?.trim().toLowerCase() === "tenant_id";

const resolveProfileTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(tenantId);

const buildProfileTenantCacheSuffix = (tenantId?: string | null): string =>
  resolveProfileTenantId(tenantId) || "global";

const clearProfilePublicCachesForUser = (uid: string, tenantId?: string | null): void => {
  const cleanUid = uid.trim();
  if (!cleanUid) return;

  const tenantSuffix = buildProfileTenantCacheSuffix(tenantId);
  for (const key of publicBundleCache.keys()) {
    const [targetUid, viewerUid, cachedTenantSuffix] = key.split(":");
    const sameTenant = !tenantId || cachedTenantSuffix === tenantSuffix;
    if (sameTenant && (targetUid === cleanUid || viewerUid === cleanUid)) {
      publicBundleCache.delete(key);
    }
  }

  for (const key of followListCache.keys()) {
    const [ownerUid, , , cachedTenantSuffix] = key.split(":");
    const sameTenant = !tenantId || cachedTenantSuffix === tenantSuffix;
    if (sameTenant && ownerUid === cleanUid) {
      followListCache.delete(key);
    }
  }

  for (const key of followCountsCache.keys()) {
    const [ownerUid, cachedTenantSuffix] = key.split(":");
    const sameTenant = !tenantId || cachedTenantSuffix === tenantSuffix;
    if (sameTenant && ownerUid === cleanUid) {
      followCountsCache.delete(key);
    }
  }
};

const findCachedPublicBundleCounts = (
  targetUid: string,
  tenantId?: string | null
): FollowCounts | null => {
  const cleanTargetUid = targetUid.trim();
  if (!cleanTargetUid) return null;

  const tenantSuffix = buildProfileTenantCacheSuffix(tenantId);
  for (const key of publicBundleCache.keys()) {
    const [cachedTargetUid, , cachedTenantSuffix] = key.split(":");
    if (cachedTargetUid !== cleanTargetUid || cachedTenantSuffix !== tenantSuffix) {
      continue;
    }

    const cached = getCache(publicBundleCache, key);
    if (!cached) continue;
    return {
      followersCount: Math.max(0, cached.followersCount),
      followingCount: Math.max(0, cached.followingCount),
    };
  }

  return null;
};

const toUniqueUserIds = (values: string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));

async function fetchTenantUserIdSet(userIds: string[], tenantId?: string | null): Promise<Set<string>> {
  const cleanUserIds = toUniqueUserIds(userIds);
  if (!cleanUserIds.length) return new Set<string>();

  const scopedTenantId = resolveProfileTenantId(tenantId);
  if (!scopedTenantId) {
    return new Set(cleanUserIds);
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("uid")
    .eq("tenant_id", scopedTenantId)
    .in("uid", cleanUserIds);
  if (error) throwSupabaseError(error);

  return new Set(
    (data ?? [])
      .map((row) => asString(asObject(row)?.uid).trim())
      .filter((value) => value.length > 0)
  );
}

async function ensureUsersBelongToTenant(userIds: string[], tenantId?: string | null): Promise<boolean> {
  const cleanUserIds = toUniqueUserIds(userIds);
  if (!cleanUserIds.length) return false;

  const scopedTenantId = resolveProfileTenantId(tenantId);
  if (!scopedTenantId) return true;

  const tenantUserIds = await fetchTenantUserIdSet(cleanUserIds, scopedTenantId);
  return cleanUserIds.every((userId) => tenantUserIds.has(userId));
}

export interface ProfileUserRecord {
  uid: string;
  nome: string;
  foto?: string;
  turma?: string;
  bio?: string;
  instagram?: string;
  telefone?: string;
  cidadeOrigem?: string;
  dataNascimento?: string;
  role?: string;
  tenant_id?: string;
  status?: string;
  whatsappPublico?: boolean;
  idadePublica?: boolean;
  relacionamentoPublico?: boolean;
  esportes?: string[];
  pets?: string;
  statusRelacionamento?: string;
  stats?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ProfilePostRecord {
  id: string;
  texto: string;
  imagem?: string;
  createdAt?: unknown;
  likesCount: number;
  viewerHasLiked: boolean;
  comentarios: number;
  userId: string;
}

export interface ProfileEventRecord {
  id: string;
  titulo: string;
  data?: string;
  local?: string;
  imagem?: string;
  imagePositionY?: number;
  likesCount?: number;
  interessadosCount?: number;
  viewerHasLiked?: boolean;
}

export interface ProfileTreinoRecord {
  id: string;
  modalidade: string;
  dia?: string;
  horario?: string;
  imagem?: string;
  local?: string;
  confirmadosCount?: number;
}

export interface ProfileLigaRecord {
  id: string;
  nome?: string;
  sigla?: string;
  foto?: string;
  logo?: string;
  membrosCount?: number;
}

export interface FollowListItem {
  uid: string;
  nome: string;
  foto: string;
  turma: string;
}

export interface FollowCounts {
  followersCount: number;
  followingCount: number;
}

type FollowToggleResult = {
  isFollowing: boolean;
  followersCount: number;
  followingCount: number;
};

export interface OwnProfileBundle {
  profile: ProfileUserRecord;
  followersCount: number;
  followingCount: number;
  posts: ProfilePostRecord[];
  events: ProfileEventRecord[];
  treinos: ProfileTreinoRecord[];
  ligas: ProfileLigaRecord[];
}

export interface PublicProfileBundle extends OwnProfileBundle {
  isFollowing: boolean;
}

const normalizePublicBundlePayload = (
  raw: unknown
): PublicProfileBundle | null | undefined => {
  if (raw === null) {
    return null;
  }

  const payload = asObject(raw);
  if (!payload) {
    return undefined;
  }

  const profile = normalizeUserProfile(payload.profile);
  if (!profile) {
    return null;
  }

  return {
    profile,
    followersCount: Math.max(0, asNumber(payload.followersCount, 0)),
    followingCount: Math.max(0, asNumber(payload.followingCount, 0)),
    posts: asArray(payload.posts)
      .map(normalizePost)
      .filter((entry): entry is ProfilePostRecord => entry !== null),
    events: asArray(payload.events)
      .map(normalizeEvent)
      .filter((entry): entry is ProfileEventRecord => entry !== null),
    treinos: asArray(payload.treinos)
      .map(normalizeTreino)
      .filter((entry): entry is ProfileTreinoRecord => entry !== null),
    ligas: asArray(payload.ligas)
      .map(normalizeLiga)
      .filter((entry): entry is ProfileLigaRecord => entry !== null),
    isFollowing: asBoolean(payload.isFollowing, false),
  };
};

const normalizeUserProfile = (raw: unknown): ProfileUserRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  const uid = asString(data.uid);
  if (!uid) return null;

  const foto = asString(data.foto) || undefined;
  const turma = asString(data.turma) || undefined;
  const bio = asString(data.bio) || undefined;
  const instagram = asString(data.instagram) || undefined;
  const telefone = asString(data.telefone) || undefined;
  const cidadeOrigem = asString(data.cidadeOrigem) || undefined;
  const dataNascimento = asString(data.dataNascimento) || undefined;
  const role = asString(data.role) || undefined;
  const tenantId = asString(data.tenant_id) || undefined;
  const status = asString(data.status) || undefined;
  const pets = asString(data.pets) || undefined;
  const statusRelacionamento = asString(data.statusRelacionamento) || undefined;
  const esportes = asStringArray(data.esportes);
  const statsObj = asObject(data.stats) || undefined;

  return {
    ...(data as Record<string, unknown>),
    uid,
    nome: asString(data.nome, "Sem Nome"),
    ...(foto ? { foto } : {}),
    ...(turma ? { turma } : {}),
    ...(bio ? { bio } : {}),
    ...(instagram ? { instagram } : {}),
    ...(telefone ? { telefone } : {}),
    ...(cidadeOrigem ? { cidadeOrigem } : {}),
    ...(dataNascimento ? { dataNascimento } : {}),
    ...(role ? { role } : {}),
    ...(tenantId ? { tenant_id: tenantId } : {}),
    ...(status ? { status } : {}),
    ...(pets ? { pets } : {}),
    ...(statusRelacionamento ? { statusRelacionamento } : {}),
    ...(esportes.length ? { esportes } : {}),
    whatsappPublico: asBoolean(data.whatsappPublico, false),
    idadePublica: asBoolean(data.idadePublica, true),
    relacionamentoPublico: asBoolean(data.relacionamentoPublico, true),
    ...(statsObj ? { stats: statsObj } : {}),
  };
};

const normalizePost = (raw: unknown): ProfilePostRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  const id = asString(data.id);
  if (!id) return null;
  const likes = asStringArray(data.likes);
  return {
    id,
    texto: asString(data.texto),
    imagem: asString(data.imagem) || undefined,
    createdAt: data.createdAt,
    likesCount: Math.max(0, asNumber(data.likesCount, likes.length)),
    viewerHasLiked: asBoolean(data.viewerHasLiked, false),
    comentarios: asNumber(data.comentarios ?? data.commentsCount, 0),
    userId: asString(data.userId),
  };
};

const normalizeEvent = (raw: unknown): ProfileEventRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  const id = asString(data.id);
  const titulo = asString(data.titulo);
  if (!id || !titulo) return null;
  const stats = asObject(data.stats);
  return {
    id,
    titulo,
    data: asString(data.data) || undefined,
    local: asString(data.local) || undefined,
    imagem: asString(data.imagem) || undefined,
    imagePositionY: asNumber(data.imagePositionY, 50),
    likesCount: asNumber(data.likesCount, asNumber(stats?.likes, 0)),
    interessadosCount: asNumber(
      data.interessadosCount,
      asNumber(stats?.confirmados, 0) + asNumber(stats?.talvez, 0)
    ),
    viewerHasLiked: asBoolean(data.viewerHasLiked, false),
  };
};

const normalizeTreino = (raw: unknown): ProfileTreinoRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  const id = asString(data.id);
  const modalidade = asString(data.modalidade);
  if (!id || !modalidade) return null;
  return {
    id,
    modalidade,
    dia: asString(data.dia) || undefined,
    horario: asString(data.horario) || undefined,
    imagem: asString(data.imagem) || undefined,
    local: asString(data.local) || undefined,
    confirmadosCount: asNumber(data.confirmadosCount, asNumber(data.confirmedCount, 0)),
  };
};

const normalizeLiga = (raw: unknown): ProfileLigaRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  const id = asString(data.id);
  if (!id) return null;
  const logoUrl = asString(data.logoUrl) || undefined;
  const logo = asString(data.logo) || logoUrl;
  const extraData = asObject(data.data);
  const membrosCount = Math.max(
    0,
    asNumber(
      data.membrosCount,
      asNumber(
        data.membersCount,
        asNumber(
          extraData?.membersCount,
          Math.max(asStringArray(data.membrosIds).length, asArray(data.membros).length)
        )
      )
    )
  );
  return {
    id,
    nome: asString(data.nome) || undefined,
    sigla: asString(data.sigla) || undefined,
    foto: asString(data.foto) || undefined,
    logo,
    membrosCount,
  };
};

async function fetchStoredFollowCounts(
  uid: string,
  tenantId?: string | null
): Promise<{ followersCount: number | null; followingCount: number | null } | null> {
  const scopedTenantId = resolveProfileTenantId(tenantId);
  const supabase = getSupabaseClient();
  let query = supabase
    .from("users")
    .select("stats")
    .eq("uid", uid);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throwSupabaseError(error);
  if (!data) return null;

  const stats = asObject(data.stats);
  return {
    followersCount: asStoredCount(stats?.followersCount),
    followingCount: asStoredCount(stats?.followingCount),
  };
}

const normalizeFollowListItem = (raw: unknown): FollowListItem | null => {
  const data = asObject(raw);
  if (!data) return null;
  return {
    uid: asString(data.uid).trim(),
    nome: asString(data.nome, "Atleta"),
    foto: asString(data.foto, ""),
    turma: asString(data.turma, "Geral"),
  };
};

async function filterFollowRowsByTenant<T extends FollowListItem>(
  rows: T[],
  tenantId?: string | null
): Promise<T[]> {
  const scopedTenantId = resolveProfileTenantId(tenantId);
  if (!scopedTenantId) return rows;

  const tenantUserIds = await fetchTenantUserIdSet(
    rows.map((row) => row.uid),
    scopedTenantId
  );
  return rows.filter((row) => tenantUserIds.has(row.uid));
}

async function fetchProfileById(
  uid: string,
  tenantId?: string | null
): Promise<ProfileUserRecord | null> {
  const supabase = getSupabaseClient();
  let request = supabase
    .from("users")
    .select(PROFILE_USER_SELECT_COLUMNS)
    .eq("uid", uid);
  if (tenantId?.trim()) {
    request = request.eq("tenant_id", tenantId.trim());
  }
  const { data, error } = await request.maybeSingle();
  if (error) throwSupabaseError(error);
  if (!data) return null;
  return normalizeUserProfile(data);
}

async function fetchProfilePosts(
  uid: string,
  tenantId?: string | null,
  limit = MAX_POST_RESULTS
): Promise<ProfilePostRecord[]> {
  const supabase = getSupabaseClient();
  const safeLimit = boundedLimit(limit, MAX_POST_RESULTS);
  let request = supabase
    .from("posts")
    .select("id,texto,imagem,likes,comentarios,userId,createdAt")
    .eq("userId", uid);
  if (tenantId?.trim()) {
    request = request.eq("tenant_id", tenantId.trim());
  }
  const { data, error } = await request
    .order("createdAt", { ascending: false })
    .limit(safeLimit);
  if (error) throwSupabaseError(error);
  return (data ?? []).map(normalizePost).filter((row): row is ProfilePostRecord => row !== null);
}

async function fetchProfileEvents(
  uid: string,
  tenantId?: string | null,
  viewerUid?: string | null,
  limit = MAX_EVENT_RESULTS
): Promise<ProfileEventRecord[]> {
  const supabase = getSupabaseClient();
  const safeLimit = boundedLimit(limit, MAX_EVENT_RESULTS);
  let rsvpQuery = supabase
    .from("eventos_rsvps")
    .select("eventoId")
    .eq("userId", uid);
  if (tenantId?.trim()) {
    rsvpQuery = rsvpQuery.eq("tenant_id", tenantId.trim());
  }
  const { data: rsvpData, error: rsvpError } = await rsvpQuery.limit(safeLimit * 4);
  if (rsvpError) throwSupabaseError(rsvpError);

  const eventIds = Array.from(
    new Set(
      ((rsvpData ?? []) as Record<string, unknown>[])
        .map((row) => asString(row.eventoId).trim())
        .filter((value) => value.length > 0)
    )
  );
  if (!eventIds.length) return [];

  let request = supabase
    .from("eventos")
    .select("id,titulo,data,local,imagem,imagePositionY,stats")
    .in("id", eventIds);
  if (tenantId?.trim()) {
    request = request.eq("tenant_id", tenantId.trim());
  }
  const { data, error } = await request.limit(safeLimit);
  if (error) throwSupabaseError(error);

  const hydratedRows = await hydrateEventViewerState((data ?? []) as Record<string, unknown>[], {
    userId: viewerUid || null,
    tenantId,
  });

  return hydratedRows
    .map(normalizeEvent)
    .filter((row): row is ProfileEventRecord => row !== null)
    .sort((left, right) => toMillis(left.data) - toMillis(right.data));
}

async function fetchProfileTreinos(
  uid: string,
  tenantId?: string | null,
  limit = MAX_TREINO_RESULTS
): Promise<ProfileTreinoRecord[]> {
  const supabase = getSupabaseClient();
  const safeLimit = boundedLimit(limit, MAX_TREINO_RESULTS);
  let rsvpQuery = supabase
    .from("treinos_rsvps")
    .select("treinoId")
    .eq("userId", uid)
    .eq("status", "going");
  if (tenantId?.trim()) {
    rsvpQuery = rsvpQuery.eq("tenant_id", tenantId.trim());
  }
  const { data: rsvpData, error: rsvpError } = await rsvpQuery.limit(safeLimit * 4);
  if (rsvpError) throwSupabaseError(rsvpError);

  const treinoIds = Array.from(
    new Set(
      ((rsvpData ?? []) as Record<string, unknown>[])
        .map((row) => asString(row.treinoId).trim())
        .filter((value) => value.length > 0)
    )
  );
  if (!treinoIds.length) return [];

  let request = supabase
    .from("treinos")
    .select("id,modalidade,dia,horario,imagem,local,confirmedCount")
    .in("id", treinoIds);
  if (tenantId?.trim()) {
    request = request.eq("tenant_id", tenantId.trim());
  }
  const { data, error } = await request.limit(safeLimit);
  if (error) throwSupabaseError(error);
  return (data ?? [])
    .map(normalizeTreino)
    .filter((row): row is ProfileTreinoRecord => row !== null)
    .filter((row) => !isTreinoDayExpired(row.dia))
    .sort((left, right) => toMillis(right.dia) - toMillis(left.dia));
}

async function fetchProfileLigas(
  uid: string,
  tenantId?: string | null,
  limit = MAX_LIGA_RESULTS
): Promise<ProfileLigaRecord[]> {
  const supabase = getSupabaseClient();
  const safeLimit = boundedLimit(limit, MAX_LIGA_RESULTS);
  let membershipQuery = supabase
    .from("ligas_membros")
    .select("ligaId")
    .eq("userId", uid);
  if (tenantId?.trim()) {
    membershipQuery = membershipQuery.eq("tenant_id", tenantId.trim());
  }
  const { data: membershipData, error: membershipError } = await membershipQuery.limit(safeLimit * 4);
  if (membershipError) throwSupabaseError(membershipError);

  const leagueIds = Array.from(
    new Set(
      ((membershipData ?? []) as Record<string, unknown>[])
        .map((row) => asString(row.ligaId).trim())
        .filter((value) => value.length > 0)
    )
  );
  if (!leagueIds.length) return [];

  let query = supabase
    .from("ligas_config")
    .select("id,nome,sigla,foto,logo,logoUrl,membros,membrosIds,data")
    .in("id", leagueIds);
  if (tenantId?.trim()) {
    query = query.eq("tenant_id", tenantId.trim());
  }
  const { data, error } = await query.limit(safeLimit);
  if (error) throwSupabaseError(error);
  return (data ?? []).map(normalizeLiga).filter((row): row is ProfileLigaRecord => row !== null);
}

const resolveFollowCountFallback = (
  table: "users_followers" | "users_following",
  uid: string,
  tenantId?: string | null,
  fallbackCount?: number | null
): number => {
  if (typeof fallbackCount === "number" && Number.isFinite(fallbackCount)) {
    return Math.max(0, Math.floor(fallbackCount));
  }

  const cachedCounts = findCachedPublicBundleCounts(uid, tenantId);
  if (cachedCounts) {
    return table === "users_followers"
      ? Math.max(0, cachedCounts.followersCount)
      : Math.max(0, cachedCounts.followingCount);
  }

  return 0;
};

async function countFollowRows(
  table: "users_followers" | "users_following",
  uid: string,
  tenantId?: string | null,
  fallbackCount?: number | null
): Promise<number> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveProfileTenantId(tenantId);
  if (!scopedTenantId) {
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("userId", uid);
    if (error) {
      if (isMissingRelationError(error)) {
        return resolveFollowCountFallback(table, uid, tenantId, fallbackCount);
      }
      throwSupabaseError(error);
    }
    return count ?? 0;
  }

  const scopedResult = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("userId", uid)
    .eq("tenant_id", scopedTenantId);
  if (!scopedResult.error) {
    return scopedResult.count ?? 0;
  }
  if (!isMissingTenantIdColumn(scopedResult.error)) {
    if (isMissingRelationError(scopedResult.error)) {
      return resolveFollowCountFallback(table, uid, tenantId, fallbackCount);
    }
    throwSupabaseError(scopedResult.error);
  }

  return resolveFollowCountFallback(table, uid, tenantId, fallbackCount);
}

async function checkIsFollowing(
  targetUid: string,
  viewerUid: string,
  tenantId?: string | null
): Promise<boolean> {
  const scopedTenantId = resolveProfileTenantId(tenantId);
  if (scopedTenantId) {
    const usersBelongToTenant = await ensureUsersBelongToTenant([targetUid, viewerUid], scopedTenantId);
    if (!usersBelongToTenant) return false;
  }

  const supabase = getSupabaseClient();
  let scopedQuery = supabase
    .from("users_followers")
    .select("id")
    .eq("userId", targetUid)
    .eq("uid", viewerUid);
  if (scopedTenantId) {
    scopedQuery = scopedQuery.eq("tenant_id", scopedTenantId);
  }

  const scopedResult = await scopedQuery.maybeSingle();
  if (!scopedResult.error) {
    return Boolean(scopedResult.data);
  }
  if (isMissingRelationError(scopedResult.error)) {
    return false;
  }
  if (!scopedTenantId || !isMissingTenantIdColumn(scopedResult.error)) {
    throwSupabaseError(scopedResult.error);
  }

  const { data, error } = await supabase
    .from("users_followers")
    .select("id")
    .eq("userId", targetUid)
    .eq("uid", viewerUid)
    .maybeSingle();
  if (error) {
    if (isMissingRelationError(error)) {
      return false;
    }
    throwSupabaseError(error);
  }
  return Boolean(data);
}

async function fetchPublicProfileBundleViaRpc(
  targetUid: string,
  viewerUid: string,
  tenantId?: string | null
): Promise<PublicProfileBundle | null | undefined> {
  if (isRpcCircuitOpen(profilePublicBundleRpcAvailable, profilePublicBundleRpcUnavailableUntil)) {
    return undefined;
  }

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveProfileTenantId(tenantId);
  const { data, error } = await supabase.rpc(PROFILE_PUBLIC_BUNDLE_RPC, {
    p_tenant_id: scopedTenantId || null,
    p_target_user_id: targetUid,
    p_viewer_user_id: viewerUid || null,
    p_posts_limit: MAX_POST_RESULTS,
    p_events_limit: MAX_EVENT_RESULTS,
    p_treinos_limit: MAX_TREINO_RESULTS,
    p_ligas_limit: MAX_LIGA_RESULTS,
  });

  if (error) {
    if (isMissingRpcError(error)) {
      profilePublicBundleRpcAvailable = false;
      profilePublicBundleRpcUnavailableUntil = openRpcCircuit();
      return undefined;
    }
    throwSupabaseError(error);
  }

  profilePublicBundleRpcAvailable = true;
  profilePublicBundleRpcUnavailableUntil = 0;

  if (data === null) {
    return null;
  }

  return normalizePublicBundlePayload(data);
}

async function fetchPublicProfileBundleViaApi(
  targetUid: string,
  viewerUid: string,
  options?: { forceRefresh?: boolean; tenantId?: string | null }
): Promise<PublicProfileBundle | null | undefined> {
  if (typeof window === "undefined") {
    return undefined;
  }

  const params = new URLSearchParams({
    userId: targetUid,
  });
  if (viewerUid) {
    params.set("viewerUid", viewerUid);
  }
  if (options?.tenantId) {
    params.set("tenantId", options.tenantId);
  }
  if (options?.forceRefresh) {
    params.set("refresh", "1");
  }

  try {
    const response = await fetch(`/api/public/profile?${params.toString()}`, {
      cache: "no-store",
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      return undefined;
    }

    return normalizePublicBundlePayload(await response.json());
  } catch {
    return undefined;
  }
}

async function fetchFollowListViaRpc(
  uid: string,
  type: "followers" | "following",
  options?: { maxResults?: number; tenantId?: string | null }
): Promise<FollowListItem[] | undefined> {
  if (isRpcCircuitOpen(profileFollowListPageRpcAvailable, profileFollowListPageRpcUnavailableUntil)) {
    return undefined;
  }

  const scopedTenantId = resolveProfileTenantId(options?.tenantId);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(PROFILE_FOLLOW_LIST_PAGE_RPC, {
    p_tenant_id: scopedTenantId || null,
    p_target_user_id: uid,
    p_list_type: type,
    p_limit: boundedLimit(options?.maxResults ?? 180, MAX_FOLLOW_RESULTS),
    p_cursor_followed_at: null,
    p_cursor_uid: null,
  });

  if (error) {
    if (isMissingRpcError(error)) {
      profileFollowListPageRpcAvailable = false;
      profileFollowListPageRpcUnavailableUntil = openRpcCircuit();
      return undefined;
    }
    throwSupabaseError(error);
  }

  profileFollowListPageRpcAvailable = true;
  profileFollowListPageRpcUnavailableUntil = 0;

  return asArray(asObject(data)?.rows)
    .map(normalizeFollowListItem)
    .filter((row): row is FollowListItem => row !== null);
}

export async function fetchPublicProfileBundle(
  targetUidRaw: string,
  viewerUidRaw?: string,
  options?: { forceRefresh?: boolean; tenantId?: string | null }
): Promise<PublicProfileBundle | null> {
  const targetUid = targetUidRaw.trim();
  if (!targetUid) return null;

  const viewerUid = viewerUidRaw?.trim() || "";
  const forceRefresh = options?.forceRefresh ?? false;
  const tenantId = resolveProfileTenantId(options?.tenantId);
  const cacheKey = `${targetUid}:${viewerUid || "anon"}:${tenantId || "global"}`;

  if (!forceRefresh) {
    const cached = getCache(publicBundleCache, cacheKey);
    if (cached !== null || publicBundleCache.has(cacheKey)) return cached;
  }

  const apiBundle = await fetchPublicProfileBundleViaApi(targetUid, viewerUid, {
    forceRefresh,
    tenantId,
  });
  const rpcBundle =
    apiBundle !== undefined
      ? apiBundle
      : await fetchPublicProfileBundleViaRpc(targetUid, viewerUid, tenantId);
  const baseBundle =
    rpcBundle !== undefined
      ? rpcBundle
      : await (async (): Promise<PublicProfileBundle | null> => {
          const profile = await fetchProfileById(targetUid, tenantId);
          if (!profile) {
            return null;
          }

          const statsObj = asObject(profile.stats);
          const followersCountRaw = statsObj?.followersCount;
          const followingCountRaw = statsObj?.followingCount;

          const [followersCount, followingCount, posts, events, treinos, ligas, isFollowing] =
            await Promise.all([
              typeof followersCountRaw === "number"
                ? Math.max(0, Math.floor(followersCountRaw))
                : countFollowRows("users_followers", targetUid, tenantId, null),
              typeof followingCountRaw === "number"
                ? Math.max(0, Math.floor(followingCountRaw))
                : countFollowRows("users_following", targetUid, tenantId, null),
              fetchProfilePosts(targetUid, tenantId, PROFILE_PUBLIC_FALLBACK_POST_LIMIT),
              fetchProfileEvents(
                targetUid,
                tenantId,
                viewerUid || null,
                PROFILE_PUBLIC_FALLBACK_EVENT_LIMIT
              ),
              fetchProfileTreinos(targetUid, tenantId, PROFILE_PUBLIC_FALLBACK_TREINO_LIMIT),
              fetchProfileLigas(targetUid, tenantId, PROFILE_PUBLIC_FALLBACK_LIGA_LIMIT),
              viewerUid ? checkIsFollowing(targetUid, viewerUid, tenantId) : Promise.resolve(false),
            ]);

          return {
            profile,
            followersCount,
            followingCount,
            posts,
            events,
            treinos,
            ligas,
            isFollowing,
          };
        })();

  if (!baseBundle) {
    setCache(publicBundleCache, cacheKey, null);
    return null;
  }

  setCache(publicBundleCache, cacheKey, baseBundle);
  return baseBundle;
}

export async function fetchFollowList(
  uidRaw: string,
  type: "followers" | "following",
  options?: { maxResults?: number; forceRefresh?: boolean; tenantId?: string | null }
): Promise<FollowListItem[]> {
  const supabase = getSupabaseClient();
  const uid = uidRaw.trim();
  if (!uid) return [];

  const maxResults = boundedLimit(options?.maxResults ?? 180, MAX_FOLLOW_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const tenantId = resolveProfileTenantId(options?.tenantId);
  const cacheKey = `${uid}:${type}:${maxResults}:${tenantId || "global"}`;

  if (!forceRefresh) {
    const cached = getCache(followListCache, cacheKey);
    if (cached) return cached;
  }

  const rpcRows = await fetchFollowListViaRpc(uid, type, {
    maxResults,
    tenantId,
  });
  if (rpcRows !== undefined) {
    setCache(followListCache, cacheKey, rpcRows);
    return rpcRows;
  }

  const table = type === "followers" ? "users_followers" : "users_following";
  let scopedRows: FollowListItem[] = [];
  let usedTenantScopedQuery = false;

  if (tenantId) {
    const scopedResult = await supabase
      .from(table)
      .select("uid,nome,foto,turma,followedAt")
      .eq("userId", uid)
      .eq("tenant_id", tenantId)
      .order("followedAt", { ascending: false })
      .limit(maxResults);

    if (!scopedResult.error) {
      usedTenantScopedQuery = true;
      scopedRows = (scopedResult.data ?? [])
        .map(normalizeFollowListItem)
        .filter((row): row is FollowListItem => row !== null);
    } else if (!isMissingTenantIdColumn(scopedResult.error)) {
      throwSupabaseError(scopedResult.error);
    }
  }

  if (!usedTenantScopedQuery) {
    const tenantFallbackWindow = tenantId
      ? Math.min(
          MAX_FOLLOW_SCAN_RESULTS,
          Math.max(maxResults, maxResults * FOLLOW_LIST_TENANT_FALLBACK_MULTIPLIER)
        )
      : maxResults;
    let request = supabase
      .from(table)
      .select("uid,nome,foto,turma,followedAt")
      .eq("userId", uid)
      .order("followedAt", { ascending: false });

    request = request.limit(tenantFallbackWindow);

    const { data, error } = await request;
    if (error) throwSupabaseError(error);

    const rows = await filterFollowRowsByTenant(
      (data ?? [])
        .map(normalizeFollowListItem)
        .filter((row): row is FollowListItem => row !== null),
      tenantId
    );

    scopedRows = rows.slice(0, maxResults);
  }

  setCache(followListCache, cacheKey, scopedRows);
  return scopedRows;
}

export async function fetchFollowCounts(
  uidRaw: string,
  options?: { forceRefresh?: boolean; tenantId?: string | null }
): Promise<FollowCounts> {
  const uid = uidRaw.trim();
  if (!uid) return { followersCount: 0, followingCount: 0 };

  const forceRefresh = options?.forceRefresh ?? false;
  const tenantId = resolveProfileTenantId(options?.tenantId);
  const cacheKey = `${uid}:${tenantId || "global"}`;
  const cachedBundleCounts = findCachedPublicBundleCounts(uid, tenantId);
  if (cachedBundleCounts) {
    setCache(followCountsCache, cacheKey, cachedBundleCounts);
    return cachedBundleCounts;
  }

  if (!forceRefresh) {
    const cached = getCache(followCountsCache, cacheKey);
    if (cached) return cached;
  }

  const storedCounts = await fetchStoredFollowCounts(uid, tenantId);
  if (storedCounts) {
    const [followersCount, followingCount] = await Promise.all([
      storedCounts.followersCount === null
        ? countFollowRows("users_followers", uid, tenantId, storedCounts.followersCount)
        : Promise.resolve(storedCounts.followersCount),
      storedCounts.followingCount === null
        ? countFollowRows("users_following", uid, tenantId, storedCounts.followingCount)
        : Promise.resolve(storedCounts.followingCount),
    ]);

    const counts = { followersCount, followingCount };
    setCache(followCountsCache, cacheKey, counts);
    return counts;
  }

  const [followersCount, followingCount] = await Promise.all([
    countFollowRows("users_followers", uid, tenantId, null),
    countFollowRows("users_following", uid, tenantId, null),
  ]);

  const counts = { followersCount, followingCount };
  setCache(followCountsCache, cacheKey, counts);
  return counts;
}

const normalizeFollowToggleResult = (raw: unknown): FollowToggleResult | null => {
  const payload = asObject(raw);
  if (!payload) return null;

  return {
    isFollowing: asBoolean(payload.isFollowing, false),
    followersCount: Math.max(0, asNumber(payload.followersCount, 0)),
    followingCount: Math.max(0, asNumber(payload.followingCount, 0)),
  };
};

async function toggleFollowProfileViaRpc(payload: {
  supabase: ReturnType<typeof getSupabaseClient>;
  viewerUid: string;
  targetUid: string;
  currentlyFollowing: boolean;
  viewerData: FollowListItem;
  targetData: FollowListItem;
  scopedTenantId: string;
}): Promise<FollowToggleResult | undefined> {
  const { data, error } = await payload.supabase.rpc(PROFILE_TOGGLE_FOLLOW_RPC, {
    p_tenant_id: payload.scopedTenantId || null,
    p_viewer_user_id: payload.viewerUid,
    p_target_user_id: payload.targetUid,
    p_currently_following: payload.currentlyFollowing,
    p_viewer_data: payload.viewerData,
    p_target_data: payload.targetData,
  });

  if (error) {
    if (isMissingRpcError(error)) {
      return undefined;
    }
    throwSupabaseError(error);
  }

  const normalized = normalizeFollowToggleResult(data);
  if (!normalized) {
    throw new Error("Resposta invalida do toggle de follow.");
  }
  return normalized;
}

async function toggleFollowProfileViaApi(payload: {
  supabase: ReturnType<typeof getSupabaseClient>;
  viewerUid: string;
  targetUid: string;
  currentlyFollowing: boolean;
  viewerData: FollowListItem;
  targetData: FollowListItem;
  scopedTenantId: string;
}): Promise<FollowToggleResult | undefined> {
  if (typeof window === "undefined") {
    return undefined;
  }

  const { data: sessionData } = await payload.supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    return undefined;
  }

  try {
    const response = await fetch("/api/profile/follow", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tenantId: payload.scopedTenantId || null,
        viewerUid: payload.viewerUid,
        targetUid: payload.targetUid,
        currentlyFollowing: payload.currentlyFollowing,
        viewerData: payload.viewerData,
        targetData: payload.targetData,
      }),
      cache: "no-store",
    });

    if (response.status === 404) {
      return undefined;
    }

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const errorMessage =
        typeof asObject(data)?.error === "string"
          ? String(asObject(data)?.error)
          : "Falha ao seguir perfil.";
      throw new Error(errorMessage);
    }

    const normalized = normalizeFollowToggleResult(data);
    if (!normalized) {
      throw new Error("Resposta invalida do toggle de follow.");
    }
    return normalized;
  } catch (error) {
    if (error instanceof TypeError) {
      return undefined;
    }
    throw error;
  }
}

export async function toggleFollowProfile(payload: {
  viewerUid: string;
  targetUid: string;
  currentlyFollowing: boolean;
  viewerData: FollowListItem;
  targetData: FollowListItem;
  tenantId?: string | null;
}): Promise<FollowToggleResult> {
  const supabase = getSupabaseClient();
  const viewerUid = payload.viewerUid.trim();
  const targetUid = payload.targetUid.trim();
  const scopedTenantId = resolveProfileTenantId(payload.tenantId);
  if (!viewerUid || !targetUid || viewerUid === targetUid) {
    throw new Error("Relacao de follow invalida.");
  }

  if (scopedTenantId) {
    const usersBelongToTenant = await ensureUsersBelongToTenant(
      [viewerUid, targetUid],
      scopedTenantId
    );
    if (!usersBelongToTenant) {
      throw new Error("Nao e permitido seguir usuarios de outra tenant.");
    }
  }

  const viewerData = {
    uid: viewerUid,
    nome: payload.viewerData.nome.trim().slice(0, 120) || "Atleta",
    foto: payload.viewerData.foto.trim(),
    turma: payload.viewerData.turma.trim().slice(0, 40) || "Geral",
  };
  const targetData = {
    uid: targetUid,
    nome: payload.targetData.nome.trim().slice(0, 120) || "Atleta",
    foto: payload.targetData.foto.trim(),
    turma: payload.targetData.turma.trim().slice(0, 40) || "Geral",
  };

  const apiResult = await toggleFollowProfileViaApi({
    supabase,
    viewerUid,
    targetUid,
    viewerData,
    targetData,
    currentlyFollowing: payload.currentlyFollowing,
    scopedTenantId,
  });
  if (apiResult) {
    clearProfilePublicCachesForUser(targetUid, scopedTenantId);
    clearProfilePublicCachesForUser(viewerUid, scopedTenantId);
    return apiResult;
  }

  const rpcResult = await toggleFollowProfileViaRpc({
    supabase,
    viewerUid,
    targetUid,
    viewerData,
    targetData,
    currentlyFollowing: payload.currentlyFollowing,
    scopedTenantId,
  });
  if (rpcResult) {
    clearProfilePublicCachesForUser(targetUid, scopedTenantId);
    clearProfilePublicCachesForUser(viewerUid, scopedTenantId);
    return rpcResult;
  }

  let existingFollowerQuery = supabase
    .from("users_followers")
    .select("id")
    .eq("userId", targetUid)
    .eq("uid", viewerUid);
  if (scopedTenantId) {
    existingFollowerQuery = existingFollowerQuery.eq("tenant_id", scopedTenantId);
  }
  const { error: existingError } = await existingFollowerQuery.maybeSingle();
  if (existingError) {
    if (!scopedTenantId || !isMissingTenantIdColumn(existingError)) {
      throwSupabaseError(existingError);
    }

    const shouldUnfollow = payload.currentlyFollowing;
    return completeToggleFollowProfile({
      supabase,
      viewerUid,
      targetUid,
      viewerData,
      targetData,
      shouldUnfollow,
      scopedTenantId,
      tenantIdSupported: false,
    });
  }

  const shouldUnfollow = payload.currentlyFollowing;

  return completeToggleFollowProfile({
    supabase,
    viewerUid,
    targetUid,
    viewerData,
    targetData,
    shouldUnfollow,
    scopedTenantId,
    tenantIdSupported: true,
  });
}

async function completeToggleFollowProfile(payload: {
  supabase: ReturnType<typeof getSupabaseClient>;
  viewerUid: string;
  targetUid: string;
  viewerData: FollowListItem;
  targetData: FollowListItem;
  shouldUnfollow: boolean;
  scopedTenantId: string;
  tenantIdSupported: boolean;
}): Promise<FollowToggleResult> {
  const {
    supabase,
    viewerUid,
    targetUid,
    viewerData,
    targetData,
    shouldUnfollow,
    scopedTenantId,
    tenantIdSupported,
  } = payload;

  if (shouldUnfollow) {
    const [followersDelete, followingDelete] = await Promise.all([
      (() => {
        let query = supabase
          .from("users_followers")
          .delete()
          .eq("userId", targetUid)
          .eq("uid", viewerUid);
        if (tenantIdSupported && scopedTenantId) {
          query = query.eq("tenant_id", scopedTenantId);
        }
        return query;
      })(),
      (() => {
        let query = supabase
          .from("users_following")
          .delete()
          .eq("userId", viewerUid)
          .eq("uid", targetUid);
        if (tenantIdSupported && scopedTenantId) {
          query = query.eq("tenant_id", scopedTenantId);
        }
        return query;
      })(),
    ]);
    if (followersDelete.error) throwSupabaseError(followersDelete.error);
    if (followingDelete.error) throwSupabaseError(followingDelete.error);
  } else {
    const [followersInsert, followingInsert] = await Promise.all([
      supabase.from("users_followers").upsert(
        {
          userId: targetUid,
          ...viewerData,
          ...(tenantIdSupported && scopedTenantId ? { tenant_id: scopedTenantId } : {}),
          followedAt: new Date().toISOString(),
        },
        { onConflict: "userId,uid" }
      ),
      supabase.from("users_following").upsert(
        {
          userId: viewerUid,
          ...targetData,
          ...(tenantIdSupported && scopedTenantId ? { tenant_id: scopedTenantId } : {}),
          followedAt: new Date().toISOString(),
        },
        { onConflict: "userId,uid" }
      ),
    ]);
    if (followersInsert.error) throwSupabaseError(followersInsert.error);
    if (followingInsert.error) throwSupabaseError(followingInsert.error);

    void supabase.from("notifications").insert({
      userId: targetUid,
      title: "Novo Seguidor!",
      message: `${viewerData.nome} comecou a te seguir.`,
      link: `/perfil/${viewerUid}`,
      read: false,
      type: "social",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  const [followersCount, followingCount, targetUserRes, viewerUserRes] = await Promise.all([
    countFollowRows(
      "users_followers",
      targetUid,
      tenantIdSupported ? scopedTenantId || undefined : undefined,
      null
    ),
    countFollowRows(
      "users_following",
      viewerUid,
      tenantIdSupported ? scopedTenantId || undefined : undefined,
      null
    ),
    (() => {
      let query = supabase
        .from("users")
        .select("uid,nome,tenant_id,stats,xp")
        .eq("uid", targetUid);
      if (scopedTenantId) query = query.eq("tenant_id", scopedTenantId);
      return query.maybeSingle();
    })(),
    (() => {
      let query = supabase
        .from("users")
        .select("uid,nome,tenant_id,stats,xp")
        .eq("uid", viewerUid);
      if (scopedTenantId) query = query.eq("tenant_id", scopedTenantId);
      return query.maybeSingle();
    })(),
  ]);

  if (targetUserRes.error) throwSupabaseError(targetUserRes.error);
  if (viewerUserRes.error) throwSupabaseError(viewerUserRes.error);
  if (scopedTenantId && (!targetUserRes.data || !viewerUserRes.data)) {
    throw new Error("Nao e permitido seguir usuarios de outra tenant.");
  }

  const targetStats = asObject(targetUserRes.data?.stats) ?? {};
  const viewerStats = asObject(viewerUserRes.data?.stats) ?? {};
  await Promise.all([
    syncUserAchievementState({
      userId: targetUid,
      tenantId: scopedTenantId || undefined,
      userRow: asObject(targetUserRes.data),
      nextStats: { ...targetStats, followersCount },
    }),
    syncUserAchievementState({
      userId: viewerUid,
      tenantId: scopedTenantId || undefined,
      userRow: asObject(viewerUserRes.data),
      nextStats: { ...viewerStats, followingCount },
    }),
  ]);

  clearProfilePublicCachesForUser(targetUid, scopedTenantId);
  clearProfilePublicCachesForUser(viewerUid, scopedTenantId);

  return {
    isFollowing: !shouldUnfollow,
    followersCount,
    followingCount,
  };
}
