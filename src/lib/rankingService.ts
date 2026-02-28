import { getSupabaseClient } from "./supabase";

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

export interface RankingUserRecord {
  id: string;
  nome: string;
  apelido: string;
  foto: string;
  turma: string;
  xp: number;
}

const normalizeUser = (raw: RawRow): RankingUserRecord => ({
  // Aceita tanto "id" quanto "uid" para facilitar a migracao de schema.
  id: asString(raw.id) || asString(raw.uid),
  nome: asString(raw.nome, "Atleta Anonimo"),
  apelido: asString(raw.apelido),
  foto: asString(raw.foto, "https://github.com/shadcn.png"),
  turma: asString(raw.turma, "GERAL"),
  xp: Math.max(0, asNumber(raw.xp, 0)),
});

async function fetchRankingRows(options: {
  turma?: string;
  maxResults: number;
}): Promise<RawRow[]> {
  const supabase = getSupabaseClient();

  // Tentativa 1: leitura enxuta (menos banda no Supabase Free).
  let minimalQuery = supabase
    .from("users")
    .select("id, uid, nome, apelido, foto, turma, xp")
    .order("xp", { ascending: false })
    .limit(options.maxResults);

  if (options.turma) {
    minimalQuery = minimalQuery.eq("turma", options.turma);
  }

  const { data: minimalData, error: minimalError } = await minimalQuery;
  if (!minimalError && Array.isArray(minimalData)) {
    return minimalData as RawRow[];
  }

  // Tentativa 2: fallback sem select estrito para tolerar schema ainda em ajuste.
  let fallbackQuery = supabase
    .from("users")
    .select("id,uid,nome,apelido,foto,turma,xp")
    .limit(options.maxResults);
  if (options.turma) {
    fallbackQuery = fallbackQuery.eq("turma", options.turma);
  }

  const { data: fallbackData, error: fallbackError } = await fallbackQuery;
  if (fallbackError) {
    throw fallbackError;
  }

  return Array.isArray(fallbackData) ? (fallbackData as RawRow[]) : [];
}

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

  const rows = await fetchRankingRows({ maxResults });
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

  const rows = await fetchRankingRows({
    turma,
    maxResults,
  });

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
