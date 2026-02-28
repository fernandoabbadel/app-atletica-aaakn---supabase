import { getSupabaseClient } from "./supabase";

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

async function queryRows(options: {
  tableName: string;
  selectColumns: string;
  maxResults: number;
  eq?: { field: string; value: string | number | boolean };
  orderField?: string;
}): Promise<RawRow[]> {
  const supabase = getSupabaseClient();
  let lastError: unknown = null;

  // Tentativa principal: query enxuta com filtro/ordem.
  let primaryQuery = supabase
    .from(options.tableName)
    .select(options.selectColumns)
    .limit(options.maxResults);
  if (options.eq) {
    primaryQuery = primaryQuery.eq(options.eq.field, options.eq.value);
  }
  if (options.orderField) {
    primaryQuery = primaryQuery.order(options.orderField, { ascending: false });
  }

  const { data: primaryData, error: primaryError } = await primaryQuery;
  if (!primaryError && Array.isArray(primaryData)) {
    return primaryData as unknown as RawRow[];
  }
  lastError = primaryError;

  // Fallback sem order para tolerar schema/indice ainda em migracao.
  let fallbackQuery = supabase
    .from(options.tableName)
    .select(options.selectColumns)
    .limit(options.maxResults);
  if (options.eq) {
    fallbackQuery = fallbackQuery.eq(options.eq.field, options.eq.value);
  }

  const { data: fallbackData, error: fallbackError } = await fallbackQuery;
  if (fallbackError) {
    throw fallbackError ?? lastError;
  }

  return Array.isArray(fallbackData) ? (fallbackData as unknown as RawRow[]) : [];
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

  const rows = await queryRows({
    tableName: "ligas_config",
    selectColumns: "id,nome,sigla,logoBase64,ativa,perguntas",
    eq: { field: "ativa", value: true },
    maxResults,
  });
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

  const rows = await queryRows({
    tableName: "users",
    selectColumns: "id,uid,nome,foto,xp",
    orderField: "xp",
    maxResults,
  });
  const players = rows.map((row) => ({
    id: asString(row.id) || asString(row.uid),
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

  const rows = await queryRows({
    tableName: "users",
    selectColumns: "id,uid,nome,foto,tubas",
    orderField: "tubas",
    maxResults,
  });
  const ranking = rows
    .map((row) => ({
      id: asString(row.id) || asString(row.uid),
      nome: asString(row.nome, "Atleta"),
      foto: asString(row.foto, "https://github.com/shadcn.png"),
      tubas: Math.max(0, asNumber(row.tubas, 0)),
    }))
    .sort((left, right) => right.tubas - left.tubas)
    .slice(0, maxResults);

  setCache(rankingCache, cacheKey, ranking);
  return ranking;
}

export function clearSharkroundGameCaches(): void {
  leaguesCache.clear();
  playersCache.clear();
  rankingCache.clear();
}
