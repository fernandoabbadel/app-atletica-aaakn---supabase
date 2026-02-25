import { httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";

import { db, functions } from "./firebase";
import { getFirebaseErrorCode } from "./firebaseErrors";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 30_000;
const MAX_LEAGUE_RESULTS = 160;
const SHARKROUND_LEAGUES_COLLECTION = "ligas_config";

const SHARKROUND_TOGGLE_CALLABLE = "sharkroundAdminToggleLeague";

const leaguesCache = new Map<string, CacheEntry<SharkroundLeagueRecord[]>>();

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

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

export interface SharkroundQuestionRecord {
  id: string;
  pergunta: string;
  respostas: string[];
  correta: number;
}

export interface SharkroundLeagueRecord {
  id: string;
  nome: string;
  senha: string;
  ativa: boolean;
  perguntas: SharkroundQuestionRecord[];
  foto?: string;
  sigla?: string;
}

const normalizeLeague = (
  id: string,
  raw: unknown
): SharkroundLeagueRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  const perguntas = Array.isArray(data.perguntas)
    ? data.perguntas
        .map((entry) => {
          const question = asObject(entry);
          if (!question) return null;
          const respostas = Array.isArray(question.respostas)
            ? question.respostas.filter((item): item is string => typeof item === "string")
            : [];

          return {
            id: asString(question.id),
            pergunta: asString(question.pergunta),
            respostas: respostas.slice(0, 10),
            correta:
              typeof question.correta === "number" && Number.isFinite(question.correta)
                ? question.correta
                : 0,
          } satisfies SharkroundQuestionRecord;
        })
        .filter((entry): entry is SharkroundQuestionRecord => entry !== null)
    : [];

  const foto = asString(data.foto) || undefined;
  const sigla = asString(data.sigla) || undefined;

  return {
    id,
    nome: asString(data.nome, "Liga"),
    senha: asString(data.senha),
    ativa: asBoolean(data.ativa, false),
    perguntas,
    ...(foto ? { foto } : {}),
    ...(sigla ? { sigla } : {}),
  };
};

export async function fetchSharkroundLeagues(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<SharkroundLeagueRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 120, MAX_LEAGUE_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCachedValue(leaguesCache, cacheKey);
    if (cached) return cached;
  }

  const q = query(
    collection(db, SHARKROUND_LEAGUES_COLLECTION),
    orderBy("nome", "asc"),
    limit(maxResults)
  );
  const snap = await getDocs(q);
  const leagues = snap.docs
    .map((row) => normalizeLeague(row.id, row.data()))
    .filter((row): row is SharkroundLeagueRecord => row !== null);

  setCachedValue(leaguesCache, cacheKey, leagues);
  return leagues;
}

export async function setSharkroundLeagueActive(payload: {
  leagueId: string;
  ativa: boolean;
}): Promise<void> {
  const leagueId = payload.leagueId.trim();
  if (!leagueId) return;

  const requestPayload = { leagueId, ativa: payload.ativa };
  await callWithFallback<typeof requestPayload, { ok: boolean }>(
      SHARKROUND_TOGGLE_CALLABLE,
    requestPayload,
    async () => {
      await updateDoc(
        doc(db, SHARKROUND_LEAGUES_COLLECTION, leagueId),
        { ativa: payload.ativa }
      );
      return { ok: true };
    }
  );

  leaguesCache.clear();
}

export function clearSharkroundCache(): void {
  leaguesCache.clear();
}
