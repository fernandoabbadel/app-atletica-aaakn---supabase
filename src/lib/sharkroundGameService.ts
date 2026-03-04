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

const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown };
  const text = [asString(raw.message), asString(raw.details)]
    .filter((entry) => entry.length > 0)
    .join(" | ");
  if (!text) return null;

  const patterns = [
    /column\s+[a-z0-9_]+\.(\w+)\s+does not exist/i,
    /column\s+(\w+)\s+does not exist/i,
    /could not find the ['"]?(\w+)['"]? column/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
};

const parseSelectColumns = (selectColumns: string): string[] =>
  selectColumns
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const removeMissingColumnFromSelection = (
  columns: string[],
  missingColumn: string
): string[] | null => {
  const missingLower = missingColumn.toLowerCase();
  const next = columns.filter((column) => {
    const [aliasPart, sourcePart] = column.split(":");
    const candidateKeys = [column, aliasPart, sourcePart]
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase());
    return !candidateKeys.includes(missingLower);
  });
  if (next.length === columns.length) return null;
  return next;
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
  let mutableColumns = parseSelectColumns(options.selectColumns);
  let mutableOrderField = options.orderField;

  while (mutableColumns.length > 0) {
    let query = supabase
      .from(options.tableName)
      .select(mutableColumns.join(","))
      .limit(options.maxResults);

    if (options.eq) {
      query = query.eq(options.eq.field, options.eq.value);
    }
    if (mutableOrderField) {
      query = query.order(mutableOrderField, { ascending: false });
    }

    const { data, error } = await query;
    if (!error) {
      return Array.isArray(data) ? (data as unknown as RawRow[]) : [];
    }

    const missingColumn = asString(extractMissingSchemaColumn(error)).trim();
    if (!missingColumn) {
      // Fallback final: remove apenas a ordenacao e tenta novamente.
      if (mutableOrderField) {
        mutableOrderField = undefined;
        continue;
      }
      throw error;
    }

    if (
      mutableOrderField &&
      mutableOrderField.toLowerCase() === missingColumn.toLowerCase()
    ) {
      mutableOrderField = undefined;
      continue;
    }

    const nextColumns =
      removeMissingColumnFromSelection(mutableColumns, missingColumn) ?? [];
    if (nextColumns.length === 0) throw error;
    mutableColumns = nextColumns;
  }

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
