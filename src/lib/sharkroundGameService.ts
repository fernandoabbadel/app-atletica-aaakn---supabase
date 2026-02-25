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
const MAX_ACTIVE_LEAGUES = 80;
const MAX_PLAYERS = 80;
const MAX_RANKING = 40;

const leaguesCache = new Map<string, CacheEntry<SharkroundGameLeagueRecord[]>>();
const playersCache = new Map<string, CacheEntry<SharkroundPlayerPreview[]>>();
const rankingCache = new Map<string, CacheEntry<SharkroundTubasRankingRecord[]>>();

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

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

export interface SharkroundGameQuestionRecord {
  id: string;
  texto: string;
  alternativas: string[];
  respostaCorreta: number;
  imagemBase64?: string;
}

export interface SharkroundGameLeagueRecord {
  id: string;
  nome: string;
  sigla?: string;
  logoBase64?: string;
  ativa: boolean;
  perguntas: SharkroundGameQuestionRecord[];
}

export interface SharkroundPlayerPreview {
  id: string;
  nome: string;
  avatar: string;
}

export interface SharkroundTubasRankingRecord {
  id: string;
  nome: string;
  foto: string;
  tubas: number;
}

const normalizeLeague = (raw: RawRow): SharkroundGameLeagueRecord => {
  const perguntas = Array.isArray(raw.perguntas)
    ? raw.perguntas
        .map((entry) => {
          const question = asObject(entry);
          if (!question) return null;
          const alternativas = Array.isArray(question.alternativas)
            ? question.alternativas.filter((item): item is string => typeof item === "string")
            : [];
          const imagemBase64 = asString(question.imagemBase64) || undefined;
          const corretaRaw =
            typeof question.respostaCorreta === "number"
              ? question.respostaCorreta
              : asNumber(question.correta, 0);

          return {
            id: asString(question.id),
            texto: asString(question.texto, "Pergunta"),
            alternativas: alternativas.slice(0, 4),
            respostaCorreta: Math.max(0, Math.min(3, Math.floor(corretaRaw))),
            ...(imagemBase64 ? { imagemBase64 } : {}),
          } satisfies SharkroundGameQuestionRecord;
        })
        .filter((entry): entry is SharkroundGameQuestionRecord => entry !== null)
    : [];

  const sigla = asString(raw.sigla) || undefined;
  const logoBase64 = asString(raw.logoBase64) || undefined;

  return {
    id: asString(raw.id),
    nome: asString(raw.nome, "Liga"),
    ...(sigla ? { sigla } : {}),
    ...(logoBase64 ? { logoBase64 } : {}),
    ativa: Boolean(raw.ativa),
    perguntas,
  };
};

export async function fetchActiveSharkroundLeagues(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<SharkroundGameLeagueRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 30, MAX_ACTIVE_LEAGUES);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(leaguesCache, cacheKey);
    if (cached) return cached;
  }

  const rows = await queryRows("ligas_config", [
    [where("ativa", "==", true), limit(maxResults)],
    [limit(maxResults)],
  ]);
  const leagues = rows.map((row) => normalizeLeague(row));
  setCache(leaguesCache, cacheKey, leagues);
  return leagues;
}

export async function fetchSharkroundPlayersPreview(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<SharkroundPlayerPreview[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 20, MAX_PLAYERS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(playersCache, cacheKey);
    if (cached) return cached;
  }

  const rows = await queryRows("users", [
    [orderBy("xp", "desc"), limit(maxResults)],
    [limit(maxResults)],
  ]);
  const players = rows.map((row) => ({
    id: asString(row.id),
    nome: asString(row.nome, "Calouro"),
    avatar: asString(row.foto, "https://github.com/shadcn.png"),
  }));

  setCache(playersCache, cacheKey, players);
  return players;
}

export async function fetchSharkroundTubasRanking(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<SharkroundTubasRankingRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 10, MAX_RANKING);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(rankingCache, cacheKey);
    if (cached) return cached;
  }

  const rows = await queryRows("users", [
    [orderBy("tubas", "desc"), limit(maxResults)],
    [limit(maxResults)],
  ]);
  const ranking = rows.map((row) => ({
    id: asString(row.id),
    nome: asString(row.nome, "Atleta"),
    foto: asString(row.foto, "https://github.com/shadcn.png"),
    tubas: Math.max(0, asNumber(row.tubas, 0)),
  }));

  setCache(rankingCache, cacheKey, ranking);
  return ranking;
}

export function clearSharkroundGameCaches(): void {
  leaguesCache.clear();
  playersCache.clear();
  rankingCache.clear();
}
