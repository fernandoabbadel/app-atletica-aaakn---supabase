import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { isTreinoDayExpired } from "./eventDateUtils";
import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = { cachedAt: number; value: T };
const TTL_MS = 120_000;
const MAX_POST_RESULTS = 8;
const MAX_EVENT_RESULTS = 8;
const MAX_TREINO_RESULTS = 8;
const MAX_LIGA_RESULTS = 8;
const MAX_FOLLOW_RESULTS = 260;
const MAX_FOLLOW_SCAN_RESULTS = 5000;
const PROFILE_USER_SELECT_COLUMNS =
  "uid,nome,apelido,foto,turma,bio,instagram,telefone,cidadeOrigem,dataNascimento,role,tenant_role,status,whatsappPublico,idadePublica,relacionamentoPublico,esportes,pets,statusRelacionamento,plano,plano_cor,plano_icon,patente,patente_icon,patente_cor,tier,level,xp,stats";

const publicBundleCache = new Map<string, CacheEntry<PublicProfileBundle | null>>();
const followListCache = new Map<string, CacheEntry<FollowListItem[]>>();
const followCountsCache = new Map<string, CacheEntry<FollowCounts>>();

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
const asString = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

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

const throwSupabaseError = (error: { message: string; code?: string | null; name?: string | null }): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

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
  likes: string[];
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
}

export interface ProfileTreinoRecord {
  id: string;
  modalidade: string;
  dia?: string;
  horario?: string;
  imagem?: string;
  local?: string;
  confirmados?: string[];
}

export interface ProfileLigaRecord {
  id: string;
  nome?: string;
  sigla?: string;
  foto?: string;
  logo?: string;
  logoBase64?: string;
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
  return {
    id,
    texto: asString(data.texto),
    imagem: asString(data.imagem) || undefined,
    createdAt: data.createdAt,
    likes: asStringArray(data.likes),
    comentarios: asNumber(data.comentarios, 0),
    userId: asString(data.userId),
  };
};

const normalizeEvent = (raw: unknown): ProfileEventRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  const id = asString(data.id);
  const titulo = asString(data.titulo);
  if (!id || !titulo) return null;
  return {
    id,
    titulo,
    data: asString(data.data) || undefined,
    local: asString(data.local) || undefined,
    imagem: asString(data.imagem) || undefined,
    imagePositionY: asNumber(data.imagePositionY, 50),
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
    confirmados: asStringArray(data.confirmados),
  };
};

const normalizeLiga = (raw: unknown): ProfileLigaRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  const id = asString(data.id);
  if (!id) return null;
  return {
    id,
    nome: asString(data.nome) || undefined,
    sigla: asString(data.sigla) || undefined,
    foto: asString(data.foto) || undefined,
    logo: asString(data.logo) || undefined,
    logoBase64: asString(data.logoBase64) || undefined,
  };
};

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
  tenantId?: string | null
): Promise<ProfilePostRecord[]> {
  const supabase = getSupabaseClient();
  let request = supabase
    .from("posts")
    .select("id,texto,imagem,likes,comentarios,userId,createdAt")
    .eq("userId", uid);
  if (tenantId?.trim()) {
    request = request.eq("tenant_id", tenantId.trim());
  }
  const { data, error } = await request
    .order("createdAt", { ascending: false })
    .limit(MAX_POST_RESULTS);
  if (error) throwSupabaseError(error);
  return (data ?? []).map(normalizePost).filter((row): row is ProfilePostRecord => row !== null);
}

async function fetchProfileEvents(
  uid: string,
  tenantId?: string | null
): Promise<ProfileEventRecord[]> {
  const supabase = getSupabaseClient();
  let request = supabase
    .from("eventos")
    .select("id,titulo,data,local,imagem,imagePositionY,interessados")
    .contains("interessados", [uid]);
  if (tenantId?.trim()) {
    request = request.eq("tenant_id", tenantId.trim());
  }
  const { data, error } = await request.limit(MAX_EVENT_RESULTS);
  if (error) throwSupabaseError(error);
  return (data ?? [])
    .map(normalizeEvent)
    .filter((row): row is ProfileEventRecord => row !== null)
    .sort((left, right) => toMillis(left.data) - toMillis(right.data));
}

async function fetchProfileTreinos(
  uid: string,
  tenantId?: string | null
): Promise<ProfileTreinoRecord[]> {
  const supabase = getSupabaseClient();
  let request = supabase
    .from("treinos")
    .select("id,modalidade,dia,horario,imagem,local,confirmados")
    .contains("confirmados", [uid]);
  if (tenantId?.trim()) {
    request = request.eq("tenant_id", tenantId.trim());
  }
  const { data, error } = await request.limit(MAX_TREINO_RESULTS);
  if (error) throwSupabaseError(error);
  return (data ?? [])
    .map(normalizeTreino)
    .filter((row): row is ProfileTreinoRecord => row !== null)
    .filter((row) => !isTreinoDayExpired(row.dia))
    .sort((left, right) => toMillis(right.dia) - toMillis(left.dia));
}

async function fetchProfileLigas(uid: string): Promise<ProfileLigaRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("ligas_config")
    .select("id,nome,sigla,foto,logo,logoBase64,membrosIds")
    .contains("membrosIds", [uid])
    .limit(MAX_LIGA_RESULTS);
  if (error) throwSupabaseError(error);
  return (data ?? []).map(normalizeLiga).filter((row): row is ProfileLigaRecord => row !== null);
}

async function countFollowRows(
  table: "users_followers" | "users_following",
  uid: string,
  tenantId?: string | null
): Promise<number> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveProfileTenantId(tenantId);
  if (!scopedTenantId) {
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("userId", uid);
    if (error) throwSupabaseError(error);
    return count ?? 0;
  }

  const { data, error } = await supabase
    .from(table)
    .select("uid")
    .eq("userId", uid)
    .range(0, MAX_FOLLOW_SCAN_RESULTS - 1);
  if (error) throwSupabaseError(error);

  const tenantUserIds = await fetchTenantUserIdSet(
    (data ?? [])
      .map((row) => asString(asObject(row)?.uid).trim())
      .filter((value) => value.length > 0),
    scopedTenantId
  );
  return tenantUserIds.size;
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
  const { data, error } = await supabase
    .from("users_followers")
    .select("id")
    .eq("userId", targetUid)
    .eq("uid", viewerUid)
    .maybeSingle();
  if (error) throwSupabaseError(error);
  return Boolean(data);
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

  const profile = await fetchProfileById(targetUid, tenantId);
  if (!profile) {
    setCache(publicBundleCache, cacheKey, null);
    return null;
  }

  const statsObj = tenantId ? null : asObject(profile.stats);
  const followersCountRaw = statsObj?.followersCount;
  const followingCountRaw = statsObj?.followingCount;

  const [followersCount, followingCount, posts, events, treinos, ligas, isFollowing] = await Promise.all([
    typeof followersCountRaw === "number"
      ? Math.max(0, Math.floor(followersCountRaw))
      : countFollowRows("users_followers", targetUid, tenantId),
    typeof followingCountRaw === "number"
      ? Math.max(0, Math.floor(followingCountRaw))
      : countFollowRows("users_following", targetUid, tenantId),
    fetchProfilePosts(targetUid, tenantId),
    fetchProfileEvents(targetUid, tenantId),
    fetchProfileTreinos(targetUid, tenantId),
    fetchProfileLigas(targetUid),
    viewerUid ? checkIsFollowing(targetUid, viewerUid, tenantId) : Promise.resolve(false),
  ]);

  const bundle: PublicProfileBundle = {
    profile,
    followersCount,
    followingCount,
    posts,
    events,
    treinos,
    ligas,
    isFollowing,
  };

  setCache(publicBundleCache, cacheKey, bundle);
  return bundle;
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

  const table = type === "followers" ? "users_followers" : "users_following";
  let request = supabase
    .from(table)
    .select("uid,nome,foto,turma,followedAt")
    .eq("userId", uid)
    .order("followedAt", { ascending: false });

  request = tenantId
    ? request.range(0, MAX_FOLLOW_SCAN_RESULTS - 1)
    : request.limit(maxResults);

  const { data, error } = await request;
  if (error) throwSupabaseError(error);

  const rows = await filterFollowRowsByTenant(
    (data ?? [])
      .map(normalizeFollowListItem)
      .filter((row): row is FollowListItem => row !== null),
    tenantId
  );

  const scopedRows = rows.slice(0, maxResults);
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
  if (!forceRefresh) {
    const cached = getCache(followCountsCache, cacheKey);
    if (cached) return cached;
  }

  const [followersCount, followingCount] = await Promise.all([
    countFollowRows("users_followers", uid, tenantId),
    countFollowRows("users_following", uid, tenantId),
  ]);

  const counts = { followersCount, followingCount };
  setCache(followCountsCache, cacheKey, counts);
  return counts;
}

export async function toggleFollowProfile(payload: {
  viewerUid: string;
  targetUid: string;
  currentlyFollowing: boolean;
  viewerData: FollowListItem;
  targetData: FollowListItem;
  tenantId?: string | null;
}): Promise<{ isFollowing: boolean; followersCount: number; followingCount: number }> {
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

  const { data: existingFollower, error: existingError } = await supabase
    .from("users_followers")
    .select("id")
    .eq("userId", targetUid)
    .eq("uid", viewerUid)
    .maybeSingle();
  if (existingError) throwSupabaseError(existingError);

  const shouldUnfollow = payload.currentlyFollowing || Boolean(existingFollower);

  if (shouldUnfollow) {
    const [followersDelete, followingDelete] = await Promise.all([
      supabase.from("users_followers").delete().eq("userId", targetUid).eq("uid", viewerUid),
      supabase.from("users_following").delete().eq("userId", viewerUid).eq("uid", targetUid),
    ]);
    if (followersDelete.error) throwSupabaseError(followersDelete.error);
    if (followingDelete.error) throwSupabaseError(followingDelete.error);
  } else {
    const [followersInsert, followingInsert] = await Promise.all([
      supabase.from("users_followers").upsert(
        { userId: targetUid, ...viewerData, followedAt: new Date().toISOString() },
        { onConflict: "userId,uid" }
      ),
      supabase.from("users_following").upsert(
        { userId: viewerUid, ...targetData, followedAt: new Date().toISOString() },
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
    countFollowRows("users_followers", targetUid, scopedTenantId),
    countFollowRows("users_following", viewerUid, scopedTenantId),
    (() => {
      let query = supabase.from("users").select("stats").eq("uid", targetUid);
      if (scopedTenantId) query = query.eq("tenant_id", scopedTenantId);
      return query.maybeSingle();
    })(),
    (() => {
      let query = supabase.from("users").select("stats").eq("uid", viewerUid);
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

  const [targetUpdate, viewerUpdate] = await Promise.all([
    (() => {
      let query = supabase
        .from("users")
        .update({ stats: { ...targetStats, followersCount }, updatedAt: new Date().toISOString() })
        .eq("uid", targetUid);
      if (scopedTenantId) query = query.eq("tenant_id", scopedTenantId);
      return query;
    })(),
    (() => {
      let query = supabase
        .from("users")
        .update({ stats: { ...viewerStats, followingCount }, updatedAt: new Date().toISOString() })
        .eq("uid", viewerUid);
      if (scopedTenantId) query = query.eq("tenant_id", scopedTenantId);
      return query;
    })(),
  ]);

  if (targetUpdate.error) throwSupabaseError(targetUpdate.error);
  if (viewerUpdate.error) throwSupabaseError(viewerUpdate.error);

  clearProfilePublicCachesForUser(targetUid, scopedTenantId);
  clearProfilePublicCachesForUser(viewerUid, scopedTenantId);

  return {
    isFollowing: !shouldUnfollow,
    followersCount,
    followingCount,
  };
}
