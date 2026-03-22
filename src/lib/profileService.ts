import { httpsCallable } from "@/lib/supa/functions";
import { getSupabaseClient } from "@/lib/supabase";

import { functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { isTreinoDayExpired } from "./eventDateUtils";
import { incrementUserStats } from "./supabaseData";
import { uploadImage } from "./upload";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 120_000;
const SESSION_CACHE_TTL_MS = 600_000;
const SESSION_CACHE_PREFIX = "profileService:v1";

const MAX_POST_RESULTS = 8;
const MAX_EVENT_RESULTS = 8;
const MAX_TREINO_RESULTS = 8;
const MAX_LIGA_RESULTS = 8;
const MAX_FOLLOW_RESULTS = 260;

const PROFILE_TOGGLE_FOLLOW_CALLABLE = "profileToggleFollow";
const PROFILE_ADMIN_RECOUNT_FOLLOWS_CALLABLE = "profileAdminRecountFollowStats";
const PROFILE_USER_SELECT_COLUMNS =
  "uid,nome,foto,turma,bio,instagram,telefone,cidadeOrigem,dataNascimento,role,status,pets,statusRelacionamento,esportes,whatsappPublico,idadePublica,relacionamentoPublico,stats";
const PROFILE_POST_SELECT_COLUMNS = "id,texto,imagem,createdAt,likes,comentarios,userId";
const PROFILE_EVENT_SELECT_COLUMNS = "id,titulo,data,local,imagem,imagePositionY";
const PROFILE_TREINO_SELECT_COLUMNS = "id,modalidade,dia,horario,imagem,local,confirmados";
const PROFILE_LIGA_SELECT_COLUMNS = "id,nome,sigla,foto,logo,logoBase64,membrosIds";
const PROFILE_FOLLOW_SELECT_COLUMNS = "id,uid,nome,foto,turma,followedAt";

const profileCache = new Map<string, CacheEntry<ProfileUserRecord | null>>();
const ownBundleCache = new Map<string, CacheEntry<OwnProfileBundle | null>>();
const publicBundleCache = new Map<string, CacheEntry<PublicProfileBundle | null>>();
const followListCache = new Map<string, CacheEntry<FollowListItem[]>>();
const followCountsCache = new Map<string, CacheEntry<FollowCounts>>();
const inflightProfileCache = new Map<string, Promise<ProfileUserRecord | null>>();
const inflightOwnBundleCache = new Map<string, Promise<OwnProfileBundle | null>>();
const inflightPublicBundleCache = new Map<string, Promise<PublicProfileBundle | null>>();
const inflightFollowListCache = new Map<string, Promise<FollowListItem[]>>();
const inflightFollowCountsCache = new Map<string, Promise<FollowCounts>>();

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
};

const nowIso = (): string => new Date().toISOString();

const throwSupabaseError = (error: {
  message: string;
  code?: string | null;
  name?: string | null;
}): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const boundedLimit = (requested: number, maxAllowed: number): number => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

const getCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string
): T | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > READ_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
};

const setCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T
): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const runWithInflight = async <T>(
  inflight: Map<string, Promise<T>>,
  key: string,
  fn: () => Promise<T>
): Promise<T> => {
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = fn();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
};

type SessionCacheEnvelope<T> = {
  cachedAt: number;
  value: T;
};

const buildSessionKey = (key: string): string => `${SESSION_CACHE_PREFIX}:${key}`;

const readSessionCache = <T>(key: string): T | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(buildSessionKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionCacheEnvelope<T>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.cachedAt !== "number"
    ) {
      window.sessionStorage.removeItem(buildSessionKey(key));
      return null;
    }
    if (Date.now() - parsed.cachedAt > SESSION_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(buildSessionKey(key));
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
};

const writeSessionCache = <T>(key: string, value: T): void => {
  if (typeof window === "undefined") return;
  try {
    const payload: SessionCacheEnvelope<T> = { cachedAt: Date.now(), value };
    window.sessionStorage.setItem(buildSessionKey(key), JSON.stringify(payload));
  } catch {
    // ignora erro de quota
  }
};

const dropSessionCacheIf = (predicate: (cacheKey: string) => boolean): void => {
  if (typeof window === "undefined") return;
  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const storageKey = window.sessionStorage.key(index);
      if (!storageKey || !storageKey.startsWith(`${SESSION_CACHE_PREFIX}:`)) continue;
      const cacheKey = storageKey.slice(`${SESSION_CACHE_PREFIX}:`.length);
      if (predicate(cacheKey)) {
        keysToRemove.push(storageKey);
      }
    }
    keysToRemove.forEach((storageKey) => window.sessionStorage.removeItem(storageKey));
  } catch {
    // ignora erro de storage
  }
};

const shouldFallbackToClientWrites = (error: unknown): boolean => {
  const code = getBackendErrorCode(error)?.toLowerCase();
  if (!code) return true;

  return (
    code.includes("functions/not-found") ||
    code.includes("functions/unavailable") ||
    code.includes("functions/internal") ||
    code.includes("functions/deadline-exceeded") ||
    code.includes("functions/cancelled") ||
    code.includes("functions/unknown")
  );
};

const isIndexRequiredError = (error: unknown): boolean => {
  const code = getBackendErrorCode(error)?.toLowerCase();
  if (code?.includes("failed-precondition")) return true;

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("index") && message.includes("query");
  }
  return false;
};

const extractMissingColumnFromSchemaError = (error: unknown): string | null => {
  if (!(error instanceof Error)) return null;
  const message = error.message || "";
  const normalized = message.toLowerCase();
  const isMissingColumn =
    (normalized.includes("column") && normalized.includes("does not exist")) ||
    normalized.includes("could not find the");
  if (!isMissingColumn) return null;

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

async function callWithFallback<TReq, TRes>(
  callableName: string,
  payload: TReq,
  fallbackFn: () => Promise<TRes>,
  options?: { allowClientFallback?: boolean }
): Promise<TRes> {
  try {
    const callable = httpsCallable<TReq, TRes>(functions, callableName);
    const response = await callable(payload);
    return response.data;
  } catch (error: unknown) {
    const allowClientFallback = options?.allowClientFallback ?? true;
    if (allowClientFallback && shouldFallbackToClientWrites(error)) {
      return fallbackFn();
    }
    throw error;
  }
}

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
    const result = toDate.call(value) as Date;
    if (result instanceof Date) return result.getTime();
  }
  return 0;
};

const clearProfileCachesForUser = (uid: string): void => {
  profileCache.delete(uid);
  ownBundleCache.delete(uid);
  followCountsCache.delete(uid);
  for (const key of publicBundleCache.keys()) {
    if (key.startsWith(`${uid}:`) || key.endsWith(`:${uid}`)) {
      publicBundleCache.delete(key);
    }
  }
  for (const key of followListCache.keys()) {
    if (key.startsWith(`${uid}:`)) {
      followListCache.delete(key);
    }
  }

  dropSessionCacheIf((cacheKey) => {
    if (cacheKey === `profile:${uid}`) return true;
    if (cacheKey === `own:${uid}`) return true;
    if (cacheKey === `counts:${uid}`) return true;
    if (cacheKey.startsWith(`follow:${uid}:`)) return true;
    if (cacheKey.startsWith(`public:${uid}:`)) return true;
    if (cacheKey.endsWith(`:${uid}`) && cacheKey.startsWith("public:")) return true;
    return false;
  });
};

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

const normalizeUserProfile = (
  id: string,
  raw: unknown
): ProfileUserRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

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
    uid: id,
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

const normalizePost = (id: string, raw: unknown): ProfilePostRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  const imagem = asString(data.imagem) || undefined;
  return {
    id,
    texto: asString(data.texto),
    ...(imagem ? { imagem } : {}),
    createdAt: data.createdAt,
    likes: asStringArray(data.likes),
    comentarios: asNumber(data.comentarios, 0),
    userId: asString(data.userId),
  };
};

const normalizeEvent = (id: string, raw: unknown): ProfileEventRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  const titulo = asString(data.titulo);
  if (!titulo) return null;

  const imagem = asString(data.imagem) || undefined;
  const local = asString(data.local) || undefined;
  const dataValue = asString(data.data) || undefined;
  const imagePositionY = asNumber(data.imagePositionY, 50);

  return {
    id,
    titulo,
    ...(dataValue ? { data: dataValue } : {}),
    ...(local ? { local } : {}),
    ...(imagem ? { imagem } : {}),
    imagePositionY,
  };
};

const normalizeTreino = (id: string, raw: unknown): ProfileTreinoRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  const modalidade = asString(data.modalidade);
  if (!modalidade) return null;

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

const normalizeLiga = (id: string, raw: unknown): ProfileLigaRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  return {
    id,
    nome: asString(data.nome) || undefined,
    sigla: asString(data.sigla) || undefined,
    foto: asString(data.foto) || undefined,
    logo: asString(data.logo) || undefined,
    logoBase64: asString(data.logoBase64) || undefined,
  };
};

const normalizeFollowListItem = (
  raw: unknown,
  fallbackUid: string
): FollowListItem | null => {
  const data = asObject(raw);
  if (!data) return null;

  return {
    uid: asString(data.uid, fallbackUid),
    nome: asString(data.nome, "Atleta"),
    foto: asString(data.foto, ""),
    turma: asString(data.turma, "Geral"),
  };
};

async function fetchProfilePosts(uid: string): Promise<ProfilePostRecord[]> {
  const maxResults = MAX_POST_RESULTS;
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from("posts")
      .select(PROFILE_POST_SELECT_COLUMNS)
      .eq("userId", uid)
      .order("createdAt", { ascending: false })
      .limit(maxResults);
    if (error) throw error;

    return (data ?? [])
      .map((row) => normalizePost(asString((row as Record<string, unknown>).id), row))
      .filter((row): row is ProfilePostRecord => row !== null);
  } catch (error: unknown) {
    const missingColumn = extractMissingColumnFromSchemaError(error);
    const shouldFallback =
      isIndexRequiredError(error) || missingColumn?.toLowerCase() === "createdat";
    if (!shouldFallback) throw error;

    const { data: fallbackData, error: fallbackError } = await supabase
      .from("posts")
      .select(PROFILE_POST_SELECT_COLUMNS)
      .eq("userId", uid)
      .limit(maxResults);
    if (fallbackError) throwSupabaseError(fallbackError);

    return (fallbackData ?? [])
      .map((row) => normalizePost(asString((row as Record<string, unknown>).id), row))
      .filter((row): row is ProfilePostRecord => row !== null)
      .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt));
  }
}

async function fetchProfileEvents(uid: string): Promise<ProfileEventRecord[]> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from("eventos")
      .select(PROFILE_EVENT_SELECT_COLUMNS)
      .contains("interessados", [uid])
      .limit(MAX_EVENT_RESULTS);
    if (error) throw error;

    return (data ?? [])
      .map((row) => normalizeEvent(asString((row as Record<string, unknown>).id), row))
      .filter((row): row is ProfileEventRecord => row !== null)
      .sort((left, right) => toMillis(left.data) - toMillis(right.data));
  } catch (error: unknown) {
    const missingColumn = extractMissingColumnFromSchemaError(error);
    if (missingColumn?.toLowerCase() !== "interessados") {
      if (
        typeof (error as { message?: unknown })?.message === "string"
      ) {
        throwSupabaseError(error as { message: string; code?: string | null; name?: string | null });
      }
      throw error;
    }

    const { data, error: fallbackError } = await supabase
      .from("eventos")
      .select(PROFILE_EVENT_SELECT_COLUMNS)
      .contains("participantes", [uid])
      .limit(MAX_EVENT_RESULTS);
    if (fallbackError) throwSupabaseError(fallbackError);

    return (data ?? [])
      .map((row) => normalizeEvent(asString((row as Record<string, unknown>).id), row))
      .filter((row): row is ProfileEventRecord => row !== null)
      .sort((left, right) => toMillis(left.data) - toMillis(right.data));
  }
}

async function fetchProfileTreinos(uid: string): Promise<ProfileTreinoRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("treinos")
    .select(PROFILE_TREINO_SELECT_COLUMNS)
    .contains("confirmados", [uid])
    .limit(MAX_TREINO_RESULTS);
  if (error) throwSupabaseError(error);

  return (data ?? [])
    .map((row) => normalizeTreino(asString((row as Record<string, unknown>).id), row))
    .filter((row): row is ProfileTreinoRecord => row !== null)
    .filter((row) => !isTreinoDayExpired(row.dia))
    .sort((left, right) => toMillis(right.dia) - toMillis(left.dia));
}

async function fetchProfileLigas(uid: string): Promise<ProfileLigaRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("ligas_config")
    .select(PROFILE_LIGA_SELECT_COLUMNS)
    .contains("membrosIds", [uid])
    .limit(MAX_LIGA_RESULTS);
  if (error) throwSupabaseError(error);

  return (data ?? [])
    .map((row) => normalizeLiga(asString((row as Record<string, unknown>).id), row))
    .filter((row): row is ProfileLigaRecord => row !== null);
}

async function resolveFollowCount(
  uid: string,
  type: "followers" | "following",
  statsValue: unknown
): Promise<number> {
  if (typeof statsValue === "number" && Number.isFinite(statsValue) && statsValue >= 0) {
    return Math.floor(statsValue);
  }

  const tableName = type === "followers" ? "users_followers" : "users_following";
  const supabase = getSupabaseClient();
  try {
    const { count, error } = await supabase
      .from(tableName)
      .select("id", { count: "exact", head: true })
      .eq("userId", uid);
    if (error) throw error;
    return count ?? 0;
  } catch {
    const { data, error } = await supabase
      .from(tableName)
      .select("id")
      .eq("userId", uid)
      .limit(MAX_FOLLOW_RESULTS);
    if (error) throwSupabaseError(error);
    return (data ?? []).length;
  }
}

async function checkIsFollowing(targetUid: string, viewerUid: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users_followers")
    .select("id")
    .eq("userId", targetUid)
    .eq("id", viewerUid)
    .maybeSingle();
  if (error) throwSupabaseError(error);
  return Boolean(data);
}

export async function fetchProfileById(
  uidRaw: string,
  options?: { forceRefresh?: boolean }
): Promise<ProfileUserRecord | null> {
  const uid = uidRaw.trim();
  if (!uid) return null;

  return runWithInflight(inflightProfileCache, uid, async () => {
    const forceRefresh = options?.forceRefresh ?? false;
    if (!forceRefresh) {
      const cached = getCachedValue(profileCache, uid);
      if (cached) return cached;
      const sessionCached = readSessionCache<ProfileUserRecord | null>(`profile:${uid}`);
      if (sessionCached) {
        setCachedValue(profileCache, uid, sessionCached);
        return sessionCached;
      }
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("users")
      .select(PROFILE_USER_SELECT_COLUMNS)
      .eq("uid", uid)
      .maybeSingle();
    if (error) throwSupabaseError(error);

    if (!data) {
      setCachedValue(profileCache, uid, null);
      writeSessionCache(`profile:${uid}`, null);
      return null;
    }

    const normalized = normalizeUserProfile(uid, data);
    setCachedValue(profileCache, uid, normalized);
    writeSessionCache(`profile:${uid}`, normalized);
    return normalized;
  });
}

export async function fetchOwnProfileBundle(
  uidRaw: string,
  options?: { forceRefresh?: boolean }
): Promise<OwnProfileBundle | null> {
  const uid = uidRaw.trim();
  if (!uid) return null;

  return runWithInflight(inflightOwnBundleCache, uid, async () => {
    const forceRefresh = options?.forceRefresh ?? false;
    if (!forceRefresh) {
      const cached = getCachedValue(ownBundleCache, uid);
      if (cached) return cached;
      const sessionCached = readSessionCache<OwnProfileBundle | null>(`own:${uid}`);
      if (sessionCached) {
        setCachedValue(ownBundleCache, uid, sessionCached);
        return sessionCached;
      }
    }

    const profile = await fetchProfileById(uid, { forceRefresh });
    if (!profile) {
      setCachedValue(ownBundleCache, uid, null);
      writeSessionCache(`own:${uid}`, null);
      return null;
    }

    const statsObj = asObject(profile.stats);
    const followersCountRaw = statsObj?.followersCount;
    const followingCountRaw = statsObj?.followingCount;

    const [followersCount, followingCount, posts, events, treinos, ligas] =
      await Promise.all([
        resolveFollowCount(uid, "followers", followersCountRaw),
        resolveFollowCount(uid, "following", followingCountRaw),
        fetchProfilePosts(uid),
        fetchProfileEvents(uid),
        fetchProfileTreinos(uid),
        fetchProfileLigas(uid),
      ]);

    const bundle: OwnProfileBundle = {
      profile,
      followersCount,
      followingCount,
      posts,
      events,
      treinos,
      ligas,
    };

    setCachedValue(ownBundleCache, uid, bundle);
    writeSessionCache(`own:${uid}`, bundle);
    return bundle;
  });
}

export async function fetchPublicProfileBundle(
  targetUidRaw: string,
  viewerUidRaw?: string,
  options?: { forceRefresh?: boolean }
): Promise<PublicProfileBundle | null> {
  const targetUid = targetUidRaw.trim();
  if (!targetUid) return null;

  const viewerUid = viewerUidRaw?.trim() || "";
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${targetUid}:${viewerUid || "anon"}`;

  return runWithInflight(inflightPublicBundleCache, cacheKey, async () => {
    if (!forceRefresh) {
      const cached = getCachedValue(publicBundleCache, cacheKey);
      if (cached) return cached;
      const sessionCached = readSessionCache<PublicProfileBundle | null>(`public:${cacheKey}`);
      if (sessionCached) {
        setCachedValue(publicBundleCache, cacheKey, sessionCached);
        return sessionCached;
      }
    }

    const ownBundle = await fetchOwnProfileBundle(targetUid, { forceRefresh });
    if (!ownBundle) {
      setCachedValue(publicBundleCache, cacheKey, null);
      writeSessionCache(`public:${cacheKey}`, null);
      return null;
    }

    const isFollowing = viewerUid ? await checkIsFollowing(targetUid, viewerUid) : false;
    const bundle: PublicProfileBundle = { ...ownBundle, isFollowing };
    setCachedValue(publicBundleCache, cacheKey, bundle);
    writeSessionCache(`public:${cacheKey}`, bundle);
    return bundle;
  });
}

export async function fetchFollowList(
  uidRaw: string,
  type: "followers" | "following",
  options?: { maxResults?: number; forceRefresh?: boolean }
): Promise<FollowListItem[]> {
  const uid = uidRaw.trim();
  if (!uid) return [];

  const maxResults = boundedLimit(options?.maxResults ?? 180, MAX_FOLLOW_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${uid}:${type}:${maxResults}`;

  return runWithInflight(inflightFollowListCache, cacheKey, async () => {
    if (!forceRefresh) {
      const cached = getCachedValue(followListCache, cacheKey);
      if (cached) return cached;
      const sessionCached = readSessionCache<FollowListItem[]>(`follow:${cacheKey}`);
      if (sessionCached) {
        setCachedValue(followListCache, cacheKey, sessionCached);
        return sessionCached;
      }
    }

    const tableName = type === "followers" ? "users_followers" : "users_following";
    const supabase = getSupabaseClient();
    let rows: FollowListItem[] = [];
    try {
      const { data, error } = await supabase
        .from(tableName)
        .select(PROFILE_FOLLOW_SELECT_COLUMNS)
        .eq("userId", uid)
        .order("followedAt", { ascending: false })
        .limit(maxResults);
      if (error) throw error;

      rows = (data ?? [])
        .map((row) =>
          normalizeFollowListItem(row, asString((row as Record<string, unknown>).id))
        )
        .filter((row): row is FollowListItem => row !== null);
    } catch (error: unknown) {
      if (!isIndexRequiredError(error)) throw error;

      const { data: fallbackData, error: fallbackError } = await supabase
        .from(tableName)
        .select(PROFILE_FOLLOW_SELECT_COLUMNS)
        .eq("userId", uid)
        .limit(maxResults);
      if (fallbackError) throwSupabaseError(fallbackError);

      rows = (fallbackData ?? [])
        .map((row) =>
          normalizeFollowListItem(row, asString((row as Record<string, unknown>).id))
        )
        .filter((row): row is FollowListItem => row !== null);
    }

    setCachedValue(followListCache, cacheKey, rows);
    writeSessionCache(`follow:${cacheKey}`, rows);
    return rows;
  });
}

export async function fetchFollowCounts(
  uidRaw: string,
  options?: { forceRefresh?: boolean }
): Promise<FollowCounts> {
  const uid = uidRaw.trim();
  if (!uid) return { followersCount: 0, followingCount: 0 };

  return runWithInflight(inflightFollowCountsCache, uid, async () => {
    const forceRefresh = options?.forceRefresh ?? false;
    if (!forceRefresh) {
      const cached = getCachedValue(followCountsCache, uid);
      if (cached) return cached;
      const sessionCached = readSessionCache<FollowCounts>(`counts:${uid}`);
      if (sessionCached) {
        setCachedValue(followCountsCache, uid, sessionCached);
        return sessionCached;
      }
    }

    const supabase = getSupabaseClient();
    const [followersRes, followingRes] = await Promise.all([
      supabase
        .from("users_followers")
        .select("id", { count: "exact", head: true })
        .eq("userId", uid),
      supabase
        .from("users_following")
        .select("id", { count: "exact", head: true })
        .eq("userId", uid),
    ]);
    if (followersRes.error) throwSupabaseError(followersRes.error);
    if (followingRes.error) throwSupabaseError(followingRes.error);

    const counts: FollowCounts = {
      followersCount: followersRes.count ?? 0,
      followingCount: followingRes.count ?? 0,
    };

    setCachedValue(followCountsCache, uid, counts);
    writeSessionCache(`counts:${uid}`, counts);
    return counts;
  });
}

export interface ProfileAdminRecountBatchResult {
  scanned: number;
  updated: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export async function adminRecountFollowStatsBatch(options?: {
  batchSize?: number;
  startAfterUid?: string | null;
}): Promise<ProfileAdminRecountBatchResult> {
  const callable = httpsCallable<
    { batchSize?: number; startAfterUid?: string | null },
    ProfileAdminRecountBatchResult
  >(functions, PROFILE_ADMIN_RECOUNT_FOLLOWS_CALLABLE);

  const response = await callable({
    batchSize: options?.batchSize,
    startAfterUid: options?.startAfterUid || null,
  });

  return response.data;
}

export async function updateProfileFields(payload: {
  uid: string;
  nome: string;
  bio: string;
  instagram: string;
  cidadeOrigem: string;
  statusRelacionamento: string;
  pets: string;
  esportes: string[];
  whatsappPublico: boolean;
  idadePublica: boolean;
  relacionamentoPublico: boolean;
}): Promise<void> {
  const uid = payload.uid.trim();
  if (!uid) return;
  const supabase = getSupabaseClient();

  const requestPayload = {
    uid,
    nome: payload.nome.trim().slice(0, 120),
    bio: payload.bio.trim().slice(0, 480),
    instagram: payload.instagram.trim().slice(0, 120),
    cidadeOrigem: payload.cidadeOrigem.trim().slice(0, 120),
    statusRelacionamento: payload.statusRelacionamento.trim().slice(0, 120),
    pets: payload.pets.trim().slice(0, 40),
    esportes: payload.esportes.slice(0, 8).map((entry) => entry.trim()).filter(Boolean),
    whatsappPublico: Boolean(payload.whatsappPublico),
    idadePublica: Boolean(payload.idadePublica),
    relacionamentoPublico: Boolean(payload.relacionamentoPublico),
  };

  const { error } = await supabase
    .from("users")
    .update({
      ...requestPayload,
      updatedAt: new Date().toISOString(),
    })
    .eq("uid", uid);

  if (error) {
    throw Object.assign(new Error(error.message), {
      code: error.code ?? `db/${error.name ?? "update-failed"}`,
      cause: error,
    });
  }

  clearProfileCachesForUser(uid);
}

export async function markProfileComplete(uidRaw: string): Promise<void> {
  const uid = uidRaw.trim();
  if (!uid) return;
  await incrementUserStats(uid, { profileComplete: 1 });
  clearProfileCachesForUser(uid);
}

export async function uploadProfileImage(payload: {
  uid: string;
  file: File;
  kind: "avatar" | "capa" | "profile";
}): Promise<string> {
  const uid = payload.uid.trim();
  if (!uid) {
    throw new Error("Usuario invalido para upload.");
  }

  const prefix =
    payload.kind === "capa" ? "cover" : payload.kind === "avatar" ? "avatar" : "profile";
  const { url, error } = await uploadImage(payload.file, `users/${uid}`, {
    scopeKey: `profile:${uid}:${payload.kind}`,
    fileName: prefix,
    upsert: true,
    appendVersionQuery: true,
    maxBytes: payload.kind === "capa" ? 3 * 1024 * 1024 : 2 * 1024 * 1024,
    maxWidth: payload.kind === "capa" ? 2400 : 1600,
    maxHeight: payload.kind === "capa" ? 1800 : 1600,
    maxPixels: payload.kind === "capa" ? 3_600_000 : 2_560_000,
    compressionMaxWidth: payload.kind === "capa" ? 1800 : 1200,
    compressionMaxHeight: payload.kind === "capa" ? 1200 : 1200,
    compressionMaxBytes: payload.kind === "capa" ? 200 * 1024 : 120 * 1024,
    quality: 0.82,
    cacheControl: "86400",
    rateLimitMax: 4,
  });

  if (!url || error) {
    throw new Error(error || "Falha ao subir imagem de perfil.");
  }

  return url;
}

export async function saveProfileImageUrl(payload: {
  uid: string;
  field: "foto" | "capa";
  url: string;
}): Promise<void> {
  const uid = payload.uid.trim();
  const url = payload.url.trim();
  if (!uid || !url) return;
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from("users")
    .update({
      [payload.field]: url,
      updatedAt: new Date().toISOString(),
    })
    .eq("uid", uid);

  if (error) {
    throw Object.assign(new Error(error.message), {
      code: error.code ?? `db/${error.name ?? "update-failed"}`,
      cause: error,
    });
  }

  clearProfileCachesForUser(uid);
}

export async function toggleFollowProfile(payload: {
  viewerUid: string;
  targetUid: string;
  currentlyFollowing: boolean;
  viewerData: FollowListItem;
  targetData: FollowListItem;
}): Promise<{ isFollowing: boolean; followersCount: number; followingCount: number }> {
  const viewerUid = payload.viewerUid.trim();
  const targetUid = payload.targetUid.trim();
  if (!viewerUid || !targetUid || viewerUid === targetUid) {
    throw new Error("Relacao de follow invalida.");
  }

  const requestPayload = {
    viewerUid,
    targetUid,
    currentlyFollowing: payload.currentlyFollowing,
    viewerData: {
      uid: viewerUid,
      nome: payload.viewerData.nome.trim().slice(0, 120) || "Atleta",
      foto: payload.viewerData.foto.trim(),
      turma: payload.viewerData.turma.trim().slice(0, 40) || "Geral",
    },
    targetData: {
      uid: targetUid,
      nome: payload.targetData.nome.trim().slice(0, 120) || "Atleta",
      foto: payload.targetData.foto.trim(),
      turma: payload.targetData.turma.trim().slice(0, 40) || "Geral",
    },
  };

  const result = await callWithFallback<
    typeof requestPayload,
    { isFollowing: boolean; followersCount: number; followingCount: number }
  >(
    PROFILE_TOGGLE_FOLLOW_CALLABLE,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      const [targetUserRes, viewerUserRes, followerRes, followingRes] = await Promise.all([
        supabase.from("users").select("stats").eq("uid", targetUid).maybeSingle(),
        supabase.from("users").select("stats").eq("uid", viewerUid).maybeSingle(),
        supabase
          .from("users_followers")
          .select("id")
          .eq("userId", targetUid)
          .eq("id", viewerUid)
          .maybeSingle(),
        supabase
          .from("users_following")
          .select("id")
          .eq("userId", viewerUid)
          .eq("id", targetUid)
          .maybeSingle(),
      ]);

      if (targetUserRes.error) throwSupabaseError(targetUserRes.error);
      if (viewerUserRes.error) throwSupabaseError(viewerUserRes.error);
      if (followerRes.error) throwSupabaseError(followerRes.error);
      if (followingRes.error) throwSupabaseError(followingRes.error);

      const targetStats = asObject(asObject(targetUserRes.data)?.stats) || {};
      const viewerStats = asObject(asObject(viewerUserRes.data)?.stats) || {};

      let followersCount = Math.max(0, asNumber(targetStats.followersCount, 0));
      let followingCount = Math.max(0, asNumber(viewerStats.followingCount, 0));

      const isFollowingNow = Boolean(followerRes.data) && Boolean(followingRes.data);
      const shouldUnfollow = payload.currentlyFollowing || isFollowingNow;

      if (shouldUnfollow) {
        const [{ error: followerDeleteError }, { error: followingDeleteError }] = await Promise.all([
          supabase
            .from("users_followers")
            .delete()
            .eq("userId", targetUid)
            .eq("id", viewerUid),
          supabase
            .from("users_following")
            .delete()
            .eq("userId", viewerUid)
            .eq("id", targetUid),
        ]);
        if (followerDeleteError) throwSupabaseError(followerDeleteError);
        if (followingDeleteError) throwSupabaseError(followingDeleteError);

        followersCount = Math.max(0, followersCount - 1);
        followingCount = Math.max(0, followingCount - 1);
      } else {
        const followedAt = nowIso();
        const [{ error: followerInsertError }, { error: followingInsertError }, { error: notificationError }] =
          await Promise.all([
            supabase.from("users_followers").insert({
              id: viewerUid,
              userId: targetUid,
              ...requestPayload.viewerData,
              followedAt,
            }),
            supabase.from("users_following").insert({
              id: targetUid,
              userId: viewerUid,
              ...requestPayload.targetData,
              followedAt,
            }),
            supabase.from("notifications").insert({
              id: crypto.randomUUID(),
              userId: targetUid,
              title: "Novo Seguidor!",
              message: `${requestPayload.viewerData.nome} comecou a te seguir.`,
              link: `/perfil/${viewerUid}`,
              read: false,
              type: "social",
              createdAt: followedAt,
            }),
          ]);
        if (followerInsertError) throwSupabaseError(followerInsertError);
        if (followingInsertError) throwSupabaseError(followingInsertError);
        if (notificationError) throwSupabaseError(notificationError);

        followersCount += 1;
        followingCount += 1;
      }

      const [{ error: targetUserUpdateError }, { error: viewerUserUpdateError }] = await Promise.all([
        supabase
          .from("users")
          .update({
            stats: { ...targetStats, followersCount },
            updatedAt: nowIso(),
          })
          .eq("uid", targetUid),
        supabase
          .from("users")
          .update({
            stats: { ...viewerStats, followingCount },
            updatedAt: nowIso(),
          })
          .eq("uid", viewerUid),
      ]);
      if (targetUserUpdateError) throwSupabaseError(targetUserUpdateError);
      if (viewerUserUpdateError) throwSupabaseError(viewerUserUpdateError);

      return {
        isFollowing: !shouldUnfollow,
        followersCount,
        followingCount,
      };
    },
    {
      allowClientFallback: false,
    }
  );

  clearProfileCachesForUser(targetUid);
  clearProfileCachesForUser(viewerUid);
  return result;
}

export function clearProfileServiceCaches(): void {
  profileCache.clear();
  ownBundleCache.clear();
  publicBundleCache.clear();
  followListCache.clear();
}


