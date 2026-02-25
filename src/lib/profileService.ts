import { httpsCallable } from "@/lib/supa/functions";
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "@/lib/supa/firestore";
import { getSupabaseClient } from "@/lib/supabase";

import { compressImageFile } from "./imageCompression";
import { db, functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { validateImageFile } from "./upload";

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
  try {
    const q = query(
      collection(db, "posts"),
      where("userId", "==", uid),
      orderBy("createdAt", "desc"),
      limit(maxResults)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((row) => normalizePost(row.id, row.data()))
      .filter((row): row is ProfilePostRecord => row !== null);
  } catch (error: unknown) {
    if (!isIndexRequiredError(error)) throw error;
    const fallbackQuery = query(
      collection(db, "posts"),
      where("userId", "==", uid),
      limit(maxResults)
    );
    const fallbackSnap = await getDocs(fallbackQuery);
    return fallbackSnap.docs
      .map((row) => normalizePost(row.id, row.data()))
      .filter((row): row is ProfilePostRecord => row !== null)
      .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt));
  }
}

async function fetchProfileEvents(uid: string): Promise<ProfileEventRecord[]> {
  const q = query(
    collection(db, "eventos"),
    where("interessados", "array-contains", uid),
    limit(MAX_EVENT_RESULTS)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((row) => normalizeEvent(row.id, row.data()))
    .filter((row): row is ProfileEventRecord => row !== null)
    .sort((left, right) => toMillis(left.data) - toMillis(right.data));
}

async function fetchProfileTreinos(uid: string): Promise<ProfileTreinoRecord[]> {
  const q = query(
    collection(db, "treinos"),
    where("confirmados", "array-contains", uid),
    limit(MAX_TREINO_RESULTS)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((row) => normalizeTreino(row.id, row.data()))
    .filter((row): row is ProfileTreinoRecord => row !== null)
    .sort((left, right) => toMillis(right.dia) - toMillis(left.dia));
}

async function fetchProfileLigas(uid: string): Promise<ProfileLigaRecord[]> {
  const q = query(
    collection(db, "ligas_config"),
    where("membrosIds", "array-contains", uid),
    limit(MAX_LIGA_RESULTS)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((row) => normalizeLiga(row.id, row.data()))
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

  try {
    const countSnap = await getCountFromServer(collection(db, "users", uid, type));
    return countSnap.data().count;
  } catch {
    const fallbackSnap = await getDocs(
      query(collection(db, "users", uid, type), limit(MAX_FOLLOW_RESULTS))
    );
    return fallbackSnap.size;
  }
}

async function checkIsFollowing(targetUid: string, viewerUid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "users", targetUid, "followers", viewerUid));
  return snap.exists();
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

    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) {
      setCachedValue(profileCache, uid, null);
      writeSessionCache(`profile:${uid}`, null);
      return null;
    }

    const normalized = normalizeUserProfile(uid, snap.data());
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

    let rows: FollowListItem[] = [];
    try {
      const q = query(
        collection(db, "users", uid, type),
        orderBy("followedAt", "desc"),
        limit(maxResults)
      );
      const snap = await getDocs(q);
      rows = snap.docs
        .map((row) => normalizeFollowListItem(row.data(), row.id))
        .filter((row): row is FollowListItem => row !== null);
    } catch (error: unknown) {
      if (!isIndexRequiredError(error)) throw error;
      const fallbackQ = query(collection(db, "users", uid, type), limit(maxResults));
      const fallbackSnap = await getDocs(fallbackQ);
      rows = fallbackSnap.docs
        .map((row) => normalizeFollowListItem(row.data(), row.id))
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

    const [followersSnap, followingSnap] = await Promise.all([
      getCountFromServer(collection(db, "users", uid, "followers")),
      getCountFromServer(collection(db, "users", uid, "following")),
    ]);

    const counts: FollowCounts = {
      followersCount: followersSnap.data().count,
      followingCount: followingSnap.data().count,
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
  const supabase = getSupabaseClient();

  const { data: row, error: readError } = await supabase
    .from("users")
    .select("stats")
    .eq("uid", uid)
    .maybeSingle();

  if (readError) {
    throw Object.assign(new Error(readError.message), {
      code: readError.code ?? `db/${readError.name ?? "select-failed"}`,
      cause: readError,
    });
  }

  const currentStats =
    typeof row?.stats === "object" && row.stats !== null
      ? (row.stats as Record<string, unknown>)
      : {};

  const { error: updateError } = await supabase
    .from("users")
    .update({
      stats: {
        ...currentStats,
        profileComplete: 1,
      },
      updatedAt: new Date().toISOString(),
    })
    .eq("uid", uid);

  if (updateError) {
    throw Object.assign(new Error(updateError.message), {
      code: updateError.code ?? `db/${updateError.name ?? "update-failed"}`,
      cause: updateError,
    });
  }

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
  const supabase = getSupabaseClient();
  const bucket =
    process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_SUPABASE_BUCKET ||
    "uploads";

  const sourceValidationError = validateImageFile(payload.file);
  if (sourceValidationError) {
    throw new Error(sourceValidationError);
  }

  const compressedFile = await compressImageFile(payload.file, {
    maxWidth: payload.kind === "capa" ? 1800 : 1200,
    maxHeight: payload.kind === "capa" ? 1800 : 1200,
    quality: 0.82,
  });

  const compressedValidationError = validateImageFile(compressedFile);
  if (compressedValidationError) {
    throw new Error(compressedValidationError);
  }

  const baseName = compressedFile.name
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .slice(0, 90);
  const prefix =
    payload.kind === "capa" ? "cover" : payload.kind === "avatar" ? "avatar" : "profile";
  const path = `users/${uid}/${prefix}_${Date.now()}_${baseName}`;
  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, compressedFile, {
    upsert: true,
    contentType: compressedFile.type || "image/jpeg",
  });

  if (uploadError) {
    throw Object.assign(new Error(uploadError.message), {
      code: `storage/${uploadError.name ?? "upload-failed"}`,
      cause: uploadError,
    });
  }

  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(path);
  if (publicData?.publicUrl) {
    return publicData.publicUrl;
  }

  const { data: signedData, error: signedError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60 * 24 * 30);

  if (signedError || !signedData?.signedUrl) {
    throw Object.assign(new Error(signedError?.message || "Falha ao gerar URL do upload."), {
      code: `storage/${signedError?.name ?? "signed-url-failed"}`,
      cause: signedError,
    });
  }

  return signedData.signedUrl;
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
    const targetFollowerRef = doc(db, "users", targetUid, "followers", viewerUid);
    const viewerFollowingRef = doc(db, "users", viewerUid, "following", targetUid);
    const targetUserRef = doc(db, "users", targetUid);
    const viewerUserRef = doc(db, "users", viewerUid);
    const notificationRef = doc(collection(db, "notifications"));

    return runTransaction(db, async (tx) => {
      const [targetUserSnap, viewerUserSnap, followerSnap, followingSnap] =
        await Promise.all([
          tx.get(targetUserRef),
          tx.get(viewerUserRef),
          tx.get(targetFollowerRef),
          tx.get(viewerFollowingRef),
        ]);

      const targetData = asObject(targetUserSnap.data()) || {};
      const viewerData = asObject(viewerUserSnap.data()) || {};
      const targetStats = asObject(targetData.stats) || {};
      const viewerStats = asObject(viewerData.stats) || {};

      let followersCount = Math.max(0, asNumber(targetStats.followersCount, 0));
      let followingCount = Math.max(0, asNumber(viewerStats.followingCount, 0));

      const isFollowingNow = followerSnap.exists() && followingSnap.exists();
      const shouldUnfollow = payload.currentlyFollowing || isFollowingNow;

      if (shouldUnfollow) {
        if (followerSnap.exists()) tx.delete(targetFollowerRef);
        if (followingSnap.exists()) tx.delete(viewerFollowingRef);
        followersCount = Math.max(0, followersCount - 1);
        followingCount = Math.max(0, followingCount - 1);
      } else {
        tx.set(targetFollowerRef, {
          ...requestPayload.viewerData,
          followedAt: serverTimestamp(),
        });
        tx.set(viewerFollowingRef, {
          ...requestPayload.targetData,
          followedAt: serverTimestamp(),
        });
        tx.set(notificationRef, {
          userId: targetUid,
          title: "Novo Seguidor!",
          message: `${requestPayload.viewerData.nome} comecou a te seguir.`,
          link: `/perfil/${viewerUid}`,
          read: false,
          type: "social",
          createdAt: serverTimestamp(),
        });
        followersCount += 1;
        followingCount += 1;
      }

      tx.set(
        targetUserRef,
        {
          stats: { ...targetStats, followersCount },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      tx.set(
        viewerUserRef,
        {
          stats: { ...viewerStats, followingCount },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      return {
        isFollowing: !shouldUnfollow,
        followersCount,
        followingCount,
      };
    });
  },
  {
    allowClientFallback: false,
  });

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

