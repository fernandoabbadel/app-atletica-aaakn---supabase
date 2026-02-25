import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type QueryConstraint,
} from "firebase/firestore";

import { db } from "./firebase";
import { getFirebaseErrorCode } from "./firebaseErrors";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

type RawRow = Record<string, unknown>;

const TTL_MS = 25_000;
const MAX_RANKING_USERS = 250;

const rankingCache = new Map<string, CacheEntry<RankingUserRecord[]>>();

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const boundedLimit = (requested: number, maxAllowed: number): number => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

const getCache = <T>(cache: Map<string, CacheEntry<T>>, key: string): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setCache = <T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const isIndexRequired = (error: unknown): boolean => {
  const code = getFirebaseErrorCode(error)?.toLowerCase();
  if (code?.includes("failed-precondition")) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("index") && message.includes("query");
  }
  return false;
};

async function queryRows(path: string, attempts: QueryConstraint[][]): Promise<RawRow[]> {
  const safeAttempts = attempts.filter((entry) => entry.length > 0);
  if (!safeAttempts.length) return [];

  let lastError: unknown = null;
  for (let i = 0; i < safeAttempts.length; i += 1) {
    try {
      const snap = await getDocs(query(collection(db, path), ...safeAttempts[i]));
      return snap.docs.map((entry) => ({ id: entry.id, ...(entry.data() as RawRow) }));
    } catch (error: unknown) {
      lastError = error;
      const isLast = i === safeAttempts.length - 1;
      if (!isIndexRequired(error) || isLast) throw error;
    }
  }

  if (lastError) throw lastError;
  return [];
}

export interface RankingUserRecord {
  id: string;
  nome: string;
  apelido: string;
  foto: string;
  turma: string;
  xp: number;
}

const normalizeUser = (raw: RawRow): RankingUserRecord => ({
  id: asString(raw.id),
  nome: asString(raw.nome, "Atleta Anonimo"),
  apelido: asString(raw.apelido),
  foto: asString(raw.foto, "https://github.com/shadcn.png"),
  turma: asString(raw.turma, "GERAL"),
  xp: Math.max(0, asNumber(raw.xp, 0)),
});

export async function fetchGlobalRankingUsers(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<RankingUserRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 100, MAX_RANKING_USERS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `global:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(rankingCache, cacheKey);
    if (cached) return cached;
  }

  const rows = await queryRows("users", [
    [orderBy("xp", "desc"), limit(maxResults)],
    [limit(maxResults)],
  ]);
  const users = rows
    .map((row) => normalizeUser(row))
    .sort((left, right) => right.xp - left.xp)
    .slice(0, maxResults);

  setCache(rankingCache, cacheKey, users);
  return users;
}

export async function fetchTurmaRankingUsers(options: {
  turma: string;
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<RankingUserRecord[]> {
  const turma = options.turma.trim();
  if (!turma) return [];

  const maxResults = boundedLimit(options.maxResults ?? 60, MAX_RANKING_USERS);
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `turma:${turma}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(rankingCache, cacheKey);
    if (cached) return cached;
  }

  const rows = await queryRows("users", [
    [where("turma", "==", turma), orderBy("xp", "desc"), limit(maxResults)],
    [where("turma", "==", turma), limit(maxResults)],
  ]);

  const users = rows
    .map((row) => normalizeUser(row))
    .sort((left, right) => right.xp - left.xp)
    .slice(0, maxResults);

  setCache(rankingCache, cacheKey, users);
  return users;
}

export function clearRankingCache(): void {
  rankingCache.clear();
}
