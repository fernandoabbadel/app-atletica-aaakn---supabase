import { httpsCallable } from "firebase/functions";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import { db, functions } from "./firebase";
import { getFirebaseErrorCode } from "./firebaseErrors";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 45_000;

const MAX_ACHIEVEMENT_RESULTS = 260;
const MAX_PATENTE_RESULTS = 60;
const MAX_LOG_RESULTS = 150;
const MAX_RANKING_RESULTS = 60;

const UPSERT_ACHIEVEMENT_CALLABLE = "achievementsAdminUpsertConfig";
const DELETE_ACHIEVEMENT_CALLABLE = "achievementsAdminDeleteConfig";
const TOGGLE_ACHIEVEMENT_CALLABLE = "achievementsAdminToggleConfig";
const UPSERT_PATENTE_CALLABLE = "achievementsAdminUpsertPatente";
const DELETE_PATENTE_CALLABLE = "achievementsAdminDeletePatente";
const SEED_PATENTES_CALLABLE = "achievementsAdminSeedPatentes";

const achievementsConfigCache = new Map<string, CacheEntry<AchievementConfigRecord[]>>();
const patentesConfigCache = new Map<string, CacheEntry<PatenteConfigRecord[]>>();
const achievementLogsCache = new Map<string, CacheEntry<AchievementLogRecord[]>>();
const rankingCache = new Map<string, CacheEntry<UserRankingRecord[]>>();

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

const clearReadCaches = (): void => {
  achievementsConfigCache.clear();
  patentesConfigCache.clear();
  achievementLogsCache.clear();
  rankingCache.clear();
};

const shouldFallbackToClientWrites = (error: unknown): boolean => {
  const code = getFirebaseErrorCode(error)?.toLowerCase();
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

async function callWithFallback<TReq, TRes>(
  callableName: string,
  payload: TReq,
  fallbackFn: () => Promise<TRes>
): Promise<TRes> {
  try {
    const callable = httpsCallable<TReq, TRes>(functions, callableName);
    const response = await callable(payload);
    return response.data;
  } catch (error: unknown) {
    if (shouldFallbackToClientWrites(error)) {
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

export interface AchievementConfigRecord {
  id: string;
  titulo: string;
  desc: string;
  xp: number;
  target: number;
  statKey: string;
  cat: string;
  iconName: string;
  active: boolean;
  repeatable: boolean;
}

export interface AchievementLogRecord {
  id: string;
  userName: string;
  achievementTitle: string;
  timestamp: unknown;
}

export interface UserRankingRecord {
  id: string;
  nome: string;
  turma: string;
  xp: number;
  foto: string;
}

export interface PatenteConfigRecord {
  id: string;
  titulo: string;
  minXp: number;
  cor: string;
  iconName: string;
  bg?: string;
  border?: string;
  text?: string;
}

const normalizeAchievementConfig = (
  id: string,
  raw: unknown
): AchievementConfigRecord | null => {
  const obj = asObject(raw);
  if (!obj) return null;

  return {
    id,
    titulo: asString(obj.titulo, "Conquista").trim().slice(0, 90),
    desc: asString(obj.desc).slice(0, 240),
    xp: asNumber(obj.xp, 0),
    target: Math.max(1, asNumber(obj.target, 1)),
    statKey: asString(obj.statKey, "loginCount").trim().slice(0, 80),
    cat: asString(obj.cat, "Social").trim().slice(0, 30),
    iconName: asString(obj.iconName, "Star").trim().slice(0, 40),
    active: asBoolean(obj.active, true),
    repeatable: asBoolean(obj.repeatable, false),
  };
};

const normalizePatenteConfig = (
  id: string,
  raw: unknown
): PatenteConfigRecord | null => {
  const obj = asObject(raw);
  if (!obj) return null;

  return {
    id,
    titulo: asString(obj.titulo, "Patente").trim().slice(0, 60),
    minXp: Math.max(0, asNumber(obj.minXp, 0)),
    cor: asString(obj.cor, "text-zinc-400").trim().slice(0, 40),
    iconName: asString(obj.iconName, "Fish").trim().slice(0, 40),
    bg: asString(obj.bg).trim().slice(0, 60) || undefined,
    border: asString(obj.border).trim().slice(0, 60) || undefined,
    text: asString(obj.text).trim().slice(0, 60) || undefined,
  };
};

const normalizeAchievementPayload = (
  payload: AchievementConfigRecord
): AchievementConfigRecord => ({
  id: payload.id.trim(),
  titulo: payload.titulo.trim().slice(0, 90) || "Conquista",
  desc: payload.desc.slice(0, 240),
  xp: Number.isFinite(payload.xp) ? payload.xp : 0,
  target: Number.isFinite(payload.target) ? Math.max(1, payload.target) : 1,
  statKey: payload.statKey.trim().slice(0, 80) || "loginCount",
  cat: payload.cat.trim().slice(0, 30) || "Social",
  iconName: payload.iconName.trim().slice(0, 40) || "Star",
  active: Boolean(payload.active),
  repeatable: Boolean(payload.repeatable),
});

const normalizePatentePayload = (
  payload: PatenteConfigRecord
): PatenteConfigRecord => ({
  id: payload.id.trim(),
  titulo: payload.titulo.trim().slice(0, 60) || "Patente",
  minXp: Number.isFinite(payload.minXp) ? Math.max(0, payload.minXp) : 0,
  cor: payload.cor.trim().slice(0, 40) || "text-zinc-400",
  iconName: payload.iconName.trim().slice(0, 40) || "Fish",
  bg: payload.bg?.trim().slice(0, 60) || undefined,
  border: payload.border?.trim().slice(0, 60) || undefined,
  text: payload.text?.trim().slice(0, 60) || undefined,
});

export async function fetchAchievementsConfig(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<AchievementConfigRecord[]> {
  const maxResults = boundedLimit(
    options?.maxResults ?? 220,
    MAX_ACHIEVEMENT_RESULTS
  );
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCachedValue(achievementsConfigCache, cacheKey);
    if (cached) return cached;
  }

  const q = query(collection(db, "achievements_config"), limit(maxResults));
  const snap = await getDocs(q);
  const rows = snap.docs
    .map((row) => normalizeAchievementConfig(row.id, row.data()))
    .filter((row): row is AchievementConfigRecord => row !== null)
    .sort(
      (left, right) =>
        left.cat.localeCompare(right.cat, "pt-BR") ||
        left.titulo.localeCompare(right.titulo, "pt-BR")
    );

  setCachedValue(achievementsConfigCache, cacheKey, rows);
  return rows;
}

export async function fetchPatentesConfig(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<PatenteConfigRecord[]> {
  const maxResults = boundedLimit(
    options?.maxResults ?? 40,
    MAX_PATENTE_RESULTS
  );
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCachedValue(patentesConfigCache, cacheKey);
    if (cached) return cached;
  }

  const q = query(
    collection(db, "patentes_config"),
    orderBy("minXp", "asc"),
    limit(maxResults)
  );
  const snap = await getDocs(q);
  const rows = snap.docs
    .map((row) => normalizePatenteConfig(row.id, row.data()))
    .filter((row): row is PatenteConfigRecord => row !== null)
    .sort((left, right) => left.minXp - right.minXp);

  setCachedValue(patentesConfigCache, cacheKey, rows);
  return rows;
}

export async function fetchAchievementsLogs(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<AchievementLogRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 50, MAX_LOG_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCachedValue(achievementLogsCache, cacheKey);
    if (cached) return cached;
  }

  const q = query(
    collection(db, "achievements_logs"),
    orderBy("timestamp", "desc"),
    limit(maxResults)
  );
  const snap = await getDocs(q);
  const rows = snap.docs
    .map((row) => {
      const data = asObject(row.data());
      if (!data) return null;
      return {
        id: row.id,
        userName: asString(data.userName, "Usuario"),
        achievementTitle: asString(data.achievementTitle, "Conquista"),
        timestamp: data.timestamp,
      } satisfies AchievementLogRecord;
    })
    .filter((row): row is AchievementLogRecord => row !== null)
    .sort((left, right) => toMillis(right.timestamp) - toMillis(left.timestamp));

  setCachedValue(achievementLogsCache, cacheKey, rows);
  return rows;
}

export async function fetchXpRanking(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<UserRankingRecord[]> {
  const maxResults = boundedLimit(
    options?.maxResults ?? 10,
    MAX_RANKING_RESULTS
  );
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCachedValue(rankingCache, cacheKey);
    if (cached) return cached;
  }

  const q = query(
    collection(db, "users"),
    orderBy("xp", "desc"),
    limit(maxResults)
  );
  const snap = await getDocs(q);
  const rows = snap.docs
    .map((row) => {
      const data = asObject(row.data());
      if (!data) return null;
      return {
        id: row.id,
        nome: asString(data.nome, "Sem nome"),
        turma: asString(data.turma),
        xp: asNumber(data.xp, 0),
        foto: asString(data.foto),
      } satisfies UserRankingRecord;
    })
    .filter((row): row is UserRankingRecord => row !== null);

  setCachedValue(rankingCache, cacheKey, rows);
  return rows;
}

export async function saveAchievementConfig(
  payload: AchievementConfigRecord
): Promise<void> {
  const safePayload = normalizeAchievementPayload(payload);
  if (!safePayload.id) return;

  await callWithFallback<typeof safePayload, { ok: boolean }>(
    UPSERT_ACHIEVEMENT_CALLABLE,
    safePayload,
    async () => {
      await setDoc(
        doc(db, "achievements_config", safePayload.id),
        { ...safePayload, updatedAt: serverTimestamp() },
        { merge: true }
      );
      return { ok: true };
    }
  );

  clearReadCaches();
}

export async function deleteAchievementConfig(id: string): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) return;

  await callWithFallback<{ id: string }, { ok: boolean }>(
    DELETE_ACHIEVEMENT_CALLABLE,
    { id: cleanId },
    async () => {
      await deleteDoc(doc(db, "achievements_config", cleanId));
      return { ok: true };
    }
  );

  clearReadCaches();
}

export async function toggleAchievementActive(payload: {
  id: string;
  active: boolean;
}): Promise<void> {
  const cleanId = payload.id.trim();
  if (!cleanId) return;

  const safePayload = { id: cleanId, active: payload.active };
  await callWithFallback<typeof safePayload, { ok: boolean }>(
    TOGGLE_ACHIEVEMENT_CALLABLE,
    safePayload,
    async () => {
      await setDoc(
        doc(db, "achievements_config", cleanId),
        { active: payload.active, updatedAt: serverTimestamp() },
        { merge: true }
      );
      return { ok: true };
    }
  );

  clearReadCaches();
}

export async function savePatenteConfig(
  payload: PatenteConfigRecord
): Promise<void> {
  const safePayload = normalizePatentePayload(payload);
  if (!safePayload.id) return;

  await callWithFallback<typeof safePayload, { ok: boolean }>(
    UPSERT_PATENTE_CALLABLE,
    safePayload,
    async () => {
      await setDoc(
        doc(db, "patentes_config", safePayload.id),
        { ...safePayload, updatedAt: serverTimestamp() },
        { merge: true }
      );
      return { ok: true };
    }
  );

  clearReadCaches();
}

export async function deletePatenteConfig(id: string): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) return;

  await callWithFallback<{ id: string }, { ok: boolean }>(
    DELETE_PATENTE_CALLABLE,
    { id: cleanId },
    async () => {
      await deleteDoc(doc(db, "patentes_config", cleanId));
      return { ok: true };
    }
  );

  clearReadCaches();
}

export async function seedPatentesConfig(
  entries: PatenteConfigRecord[]
): Promise<void> {
  const safeEntries = entries
    .slice(0, MAX_PATENTE_RESULTS)
    .map((entry) => normalizePatentePayload(entry))
    .filter((entry) => entry.id.length > 0);

  if (!safeEntries.length) return;

  await callWithFallback<{ patentes: PatenteConfigRecord[] }, { ok: boolean }>(
    SEED_PATENTES_CALLABLE,
    { patentes: safeEntries },
    async () => {
      const batch = writeBatch(db);
      safeEntries.forEach((entry) => {
        batch.set(
          doc(db, "patentes_config", entry.id),
          { ...entry, updatedAt: serverTimestamp() },
          { merge: true }
        );
      });
      await batch.commit();
      return { ok: true };
    }
  );

  clearReadCaches();
}
