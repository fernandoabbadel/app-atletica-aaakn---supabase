import { httpsCallable } from "@/lib/supa/functions";
import { functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { clearDashboardCaches as clearAuthenticatedDashboardCaches } from "./dashboardService";
import { clearDashboardCaches as clearPublicDashboardCaches } from "./dashboardPublicService";
import { getSupabaseClient } from "./supabase";
import { incrementUserStats } from "./supabaseData";
import { uploadImage } from "./upload";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 120_000;

const MAX_LEAGUE_RESULTS = 80;
const MAX_USER_RESULTS = 200;
const MAX_POLL_RESULTS = 60;

const LEAGUE_SAVE_CALLABLE = "leagueAdminSaveConfig";
const LEAGUE_DELETE_CALLABLE = "leagueAdminDeleteConfig";
const LEAGUE_VISIBILITY_CALLABLE = "leagueAdminToggleVisibility";
const LEAGUE_LIKE_CALLABLE = "leagueToggleLike";
const LEAGUE_POLL_CREATE_CALLABLE = "leaguePollCreate";
const LEAGUE_POLL_DELETE_CALLABLE = "leaguePollDelete";
const LEAGUE_POLL_UPDATE_CALLABLE = "leaguePollUpdateOptions";
const LEAGUE_QUIZ_CALLABLE = "leagueRegisterQuizResult";

const leaguesCache = new Map<string, CacheEntry<LeagueRecord[]>>();
const leagueSummariesCache = new Map<string, CacheEntry<LeagueRecord[]>>();
const usersCache = new Map<string, CacheEntry<LeagueUserRecord[]>>();
const leagueByIdCache = new Map<string, CacheEntry<LeagueRecord | null>>();
const pollsCache = new Map<string, CacheEntry<LeaguePollRecord[]>>();
const resolveLeagueTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(typeof tenantId === "string" ? tenantId.trim() : "");

const LEAGUES_SELECT_COLUMNS = [
  "id",
  "nome",
  "sigla",
  "presidente",
  "descricao",
  "senha",
  "foto",
  "logoUrl",
  "logoBase64",
  "visivel",
  "ativa",
  "membros",
  "eventos",
  "perguntas",
  "bizu",
  "likes",
  "membrosIds",
  "status",
  "createdAt",
  "updatedAt",
] as const;

const LEAGUE_SUMMARY_SELECT_COLUMNS = [
  "id",
  "nome",
  "sigla",
  "descricao",
  "foto",
  "logoUrl",
  "logo",
  "visivel",
  "ativa",
  "bizu",
  "likes",
  "status",
  "createdAt",
  "updatedAt",
] as const;

const LEAGUE_USERS_SELECT_COLUMNS = ["uid", "nome", "foto", "turma"] as const;

const EVENT_POLLS_SELECT_COLUMNS = [
  "id",
  "eventoId",
  "question",
  "options",
  "allowUserOptions",
  "voters",
  "userVotes",
  "creatorId",
  "isOfficial",
  "createdAt",
  "updatedAt",
] as const;

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

const rowIdFromUnknown = (row: unknown, fallback = ""): string => {
  const obj = asObject(row);
  if (!obj) return fallback;
  return asString(obj.id, asString(obj.uid, fallback));
};

const boundedLimit = (requested: number, maxAllowed: number): number => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

const getCacheValue = <T>(
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

const setCacheValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T
): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const clearLeagueCaches = (): void => {
  leaguesCache.clear();
  leagueSummariesCache.clear();
  leagueByIdCache.clear();
  pollsCache.clear();
};

const clearLeagueDependentCaches = (): void => {
  clearLeagueCaches();
  clearAuthenticatedDashboardCaches();
  clearPublicDashboardCaches();
};

const clearUsersCache = (): void => {
  usersCache.clear();
};

const throwSupabaseError = (error: { message: string; code?: string | null; name?: string | null }): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
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

const removeMissingColumnFromSelection = (
  columns: readonly string[] | string[],
  missingColumn: string
): string[] | null => {
  const next = [...columns].filter((column) => column.toLowerCase() !== missingColumn.toLowerCase());
  if (next.length === columns.length) return null;
  return next;
};

const removeMissingColumnFromPayload = (
  payload: Record<string, unknown>,
  missingColumn: string
): Record<string, unknown> | null => {
  const normalizedMissing = missingColumn.trim().toLowerCase();
  if (!normalizedMissing) return null;

  const nextEntries = Object.entries(payload).filter(
    ([key]) => key.toLowerCase() !== normalizedMissing
  );
  if (nextEntries.length === Object.keys(payload).length) return null;
  return Object.fromEntries(nextEntries);
};

const nowIso = (): string => new Date().toISOString();

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

export interface LeagueQuestionRecord {
  id: string;
  texto: string;
  imageUrl?: string;
  // Compatibilidade temporaria com dados legados enquanto as telas migram.
  imagemBase64?: string;
  alternativas: string[];
  correta: number;
}

export interface LeagueMemberRecord {
  id: string;
  nome: string;
  cargo: string;
  foto: string;
  linkPerfil?: string;
}

export interface LeagueLoteRecord {
  id: number;
  nome: string;
  preco: string;
  status: "ativo" | "encerrado" | "agendado";
}

export interface LeagueEventRecord {
  id: string;
  titulo: string;
  data: string;
  hora: string;
  local: string;
  tipo: string;
  destaque: string;
  imagem: string;
  imagePositionY: number;
  lotes: LeagueLoteRecord[];
  descricao: string;
  linkEvento?: string;
  globalEventId?: string;
  pollQuestion?: string;
}

export interface LeagueRecord {
  id: string;
  nome: string;
  sigla: string;
  presidente: string;
  descricao: string;
  senha: string;
  foto: string;
  logoUrl?: string;
  // Compatibilidade temporaria com dados legados enquanto as telas migram.
  logoBase64?: string;
  visivel?: boolean;
  ativa?: boolean;
  membros: LeagueMemberRecord[];
  eventos: LeagueEventRecord[];
  perguntas: LeagueQuestionRecord[];
  bizu: string;
  likes: number;
  membrosIds?: string[];
}

export interface LeagueUserRecord {
  id: string;
  nome?: string;
  foto?: string;
  turma?: string;
}

export interface LeaguePollOptionRecord {
  text: string;
  votes: number;
  creator?: string;
  creatorName?: string;
  creatorAvatar?: string;
}

export interface LeaguePollRecord {
  id: string;
  question: string;
  options: LeaguePollOptionRecord[];
  allowUserOptions: boolean;
  voters: string[];
}

export type LeagueStorageImageKind = "logo" | "member" | "event" | "question";

const normalizeLeague = (id: string, raw: unknown): LeagueRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  const membros = Array.isArray(data.membros)
    ? data.membros
        .map((row) => {
          const member = asObject(row);
          if (!member) return null;
          const linkPerfil = asString(member.linkPerfil) || undefined;
          return {
            id: asString(member.id),
            nome: asString(member.nome, "Sem nome"),
            cargo: asString(member.cargo, "Membro"),
            foto: asString(member.foto),
            ...(linkPerfil ? { linkPerfil } : {}),
          } as LeagueMemberRecord;
        })
        .filter((row): row is LeagueMemberRecord => row !== null)
    : [];

  const perguntas = Array.isArray(data.perguntas)
    ? data.perguntas
        .map((row) => {
          const question = asObject(row);
          if (!question) return null;
          const alternatives = Array.isArray(question.alternativas)
            ? question.alternativas.filter(
                (item): item is string => typeof item === "string"
              )
            : [];
          const imageUrl =
            asString(question.imageUrl) || asString(question.imagemBase64) || undefined;
          return {
            id: asString(question.id),
            texto: asString(question.texto),
            ...(imageUrl ? { imageUrl, imagemBase64: imageUrl } : {}),
            alternativas: alternatives.slice(0, 4),
            correta: Math.max(0, Math.min(3, asNumber(question.correta, 0))),
          } as LeagueQuestionRecord;
        })
        .filter((row): row is LeagueQuestionRecord => row !== null)
    : [];

  const eventos = Array.isArray(data.eventos)
    ? data.eventos
        .map((row) => {
          const event = asObject(row);
          if (!event) return null;
          const lotes = Array.isArray(event.lotes)
            ? event.lotes
                .map((entry) => {
                  const lote = asObject(entry);
                  if (!lote) return null;
                  const statusRaw = asString(lote.status, "ativo");
                  const status: "ativo" | "encerrado" | "agendado" =
                    statusRaw === "encerrado" || statusRaw === "agendado"
                      ? statusRaw
                      : "ativo";
                  return {
                    id: asNumber(lote.id, Date.now()),
                    nome: asString(lote.nome),
                    preco: asString(lote.preco),
                    status,
                  } satisfies LeagueLoteRecord;
                })
                .filter((entry): entry is LeagueLoteRecord => entry !== null)
            : [];

          const linkEvento = asString(event.linkEvento) || undefined;
          const globalEventId = asString(event.globalEventId) || undefined;
          const pollQuestion = asString(event.pollQuestion) || undefined;

          return {
            id: asString(event.id),
            titulo: asString(event.titulo),
            data: asString(event.data),
            hora: asString(event.hora),
            local: asString(event.local),
            tipo: asString(event.tipo),
            destaque: asString(event.destaque),
            imagem: asString(event.imagem),
            imagePositionY: asNumber(event.imagePositionY, 50),
            lotes,
            descricao: asString(event.descricao),
            ...(linkEvento ? { linkEvento } : {}),
            ...(globalEventId ? { globalEventId } : {}),
            ...(pollQuestion ? { pollQuestion } : {}),
          } as LeagueEventRecord;
        })
        .filter((row): row is LeagueEventRecord => row !== null)
    : [];

  const membrosIds = Array.isArray(data.membrosIds)
    ? data.membrosIds.filter((item): item is string => typeof item === "string")
    : undefined;

  const logoUrl = asString(data.logoUrl) || asString(data.logoBase64) || undefined;

  return {
    id,
    nome: asString(data.nome, "Liga"),
    sigla: asString(data.sigla),
    presidente: asString(data.presidente),
    descricao: asString(data.descricao),
    senha: asString(data.senha),
    foto: asString(data.foto),
    ...(logoUrl ? { logoUrl, logoBase64: logoUrl } : {}),
    visivel: asBoolean(data.visivel, false),
    ativa: asBoolean(data.ativa, false),
    membros,
    eventos,
    perguntas,
    bizu: asString(data.bizu),
    likes: Math.max(0, asNumber(data.likes, 0)),
    membrosIds,
  };
};

const normalizeLeagueUser = (id: string, raw: unknown): LeagueUserRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  return {
    id,
    nome: asString(data.nome) || undefined,
    foto: asString(data.foto) || undefined,
    turma: asString(data.turma) || undefined,
  };
};

const normalizePoll = (id: string, raw: unknown): LeaguePollRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  const options = Array.isArray(data.options)
    ? data.options
        .map((row) => {
          const option = asObject(row);
          if (!option) return null;
          const creator = asString(option.creator) || undefined;
          const creatorName = asString(option.creatorName) || undefined;
          const creatorAvatar = asString(option.creatorAvatar) || undefined;
          return {
            text: asString(option.text, "Opcao"),
            votes: Math.max(0, asNumber(option.votes, 0)),
            ...(creator ? { creator } : {}),
            ...(creatorName ? { creatorName } : {}),
            ...(creatorAvatar ? { creatorAvatar } : {}),
          } as LeaguePollOptionRecord;
        })
        .filter((row): row is LeaguePollOptionRecord => row !== null)
    : [];

  return {
    id,
    question: asString(data.question, "Enquete"),
    options,
    allowUserOptions: asBoolean(data.allowUserOptions, true),
    voters: Array.isArray(data.voters)
      ? data.voters.filter((item): item is string => typeof item === "string")
      : [],
  };
};

const normalizeLeaguePayload = (
  payload: Partial<LeagueRecord>
): Record<string, unknown> => {
  const logoUrl = asString(payload.logoUrl) || asString(payload.logoBase64) || undefined;
  const perguntas = Array.isArray(payload.perguntas)
    ? payload.perguntas.map((question) => {
        const imageUrl =
          asString(question.imageUrl) || asString(question.imagemBase64) || undefined;
        return {
          ...question,
          ...(imageUrl ? { imageUrl, imagemBase64: imageUrl } : {}),
        };
      })
    : [];

  return {
    nome: asString(payload.nome, "Liga").trim().slice(0, 120),
    sigla: asString(payload.sigla).trim().slice(0, 20),
    presidente: asString(payload.presidente).trim().slice(0, 120),
    descricao: asString(payload.descricao).slice(0, 4_000),
    senha: asString(payload.senha).slice(0, 120),
    foto: asString(payload.foto),
    ...(logoUrl ? { logoUrl, logo: logoUrl } : { logoUrl: undefined, logo: undefined }),
    visivel: Boolean(payload.visivel),
    ativa: Boolean(payload.ativa),
    membros: Array.isArray(payload.membros) ? payload.membros : [],
    eventos: Array.isArray(payload.eventos) ? payload.eventos : [],
    perguntas,
    bizu: asString(payload.bizu).slice(0, 500),
    likes: Math.max(0, asNumber(payload.likes, 0)),
    membrosIds: Array.isArray(payload.membrosIds)
      ? payload.membrosIds.filter((item): item is string => typeof item === "string")
      : undefined,
  };
};

const sanitizeStorageSegment = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "item";

const leagueImageFolderByKind: Record<LeagueStorageImageKind, string> = {
  logo: "logos",
  member: "membros",
  event: "eventos",
  question: "perguntas",
};

export async function uploadLeagueImageToStorage(options: {
  file: File;
  kind: LeagueStorageImageKind;
  leagueId?: string;
  entityId?: string;
}): Promise<string> {
  const leagueSegment = sanitizeStorageSegment(options.leagueId || "temp");
  const entitySegment = options.entityId
    ? `/${sanitizeStorageSegment(options.entityId)}`
    : "";
  const folder = leagueImageFolderByKind[options.kind];
  const objectDir = `ligas/${leagueSegment}/${folder}${entitySegment}`;
  const isEventImage = options.kind === "event";
  const isLogoImage = options.kind === "logo";
  const isMemberImage = options.kind === "member";
  const sourceMaxBytes = isEventImage ? 3 * 1024 * 1024 : 2 * 1024 * 1024;
  const sourceMaxWidth = isEventImage ? 4200 : isLogoImage ? 4000 : isMemberImage ? 3200 : 3600;
  const sourceMaxHeight = isEventImage ? 3200 : isLogoImage ? 4000 : isMemberImage ? 3200 : 3600;
  const sourceMaxPixels = isEventImage ? 12_000_000 : isLogoImage ? 16_000_000 : 9_000_000;
  const compressedMaxBytes = isEventImage
    ? 700 * 1024
    : isLogoImage
      ? 1500 * 1024
      : isMemberImage
        ? 450 * 1024
        : 500 * 1024;
  const compressionMaxWidth = isEventImage ? 1800 : isLogoImage ? 900 : 1400;
  const compressionMaxHeight = isEventImage ? 1200 : isLogoImage ? 900 : 1400;
  const fileName =
    options.kind === "logo"
      ? "logo"
      : options.kind === "event"
        ? "evento"
        : options.kind === "member"
          ? "membro"
          : "pergunta";

  const { url, error } = await uploadImage(options.file, objectDir, {
    scopeKey: `ligas:${leagueSegment}:${options.kind}:${options.entityId || "root"}`,
    fileName,
    upsert: true,
    appendVersionQuery: true,
    maxBytes: sourceMaxBytes,
    maxWidth: sourceMaxWidth,
    maxHeight: sourceMaxHeight,
    maxPixels: sourceMaxPixels,
    compressionMaxWidth,
    compressionMaxHeight,
    compressionMaxBytes: compressedMaxBytes,
    allowOriginalOnCompressionFail: true,
    quality: 0.82,
    cacheControl: "86400",
  });
  if (!url || error) {
    throw new Error(error || "Falha ao subir imagem da liga.");
  }

  return url;
}

export async function fetchLeagues(options?: {
  orderByField?: "nome" | "likes";
  orderDirection?: "asc" | "desc";
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<LeagueRecord[]> {
  const orderByField = options?.orderByField ?? "nome";
  const orderDirection = options?.orderDirection ?? "asc";
  const maxResults = boundedLimit(options?.maxResults ?? 40, MAX_LEAGUE_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveLeagueTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "global"}:${orderByField}:${orderDirection}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCacheValue(leaguesCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let selectColumns: string[] = [...LEAGUES_SELECT_COLUMNS];
  let leagues: LeagueRecord[] = [];

  while (selectColumns.length > 0) {
    let query = supabase
      .from("ligas_config")
      .select(selectColumns.join(","))
      .order(orderByField, { ascending: orderDirection === "asc" })
      .limit(maxResults);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { data, error } = await query;
    if (!error) {
      leagues = (data ?? [])
        .map((row) => normalizeLeague(rowIdFromUnknown(row), row))
        .filter((row): row is LeagueRecord => row !== null);
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error));
    if (!missingColumn) throwSupabaseError(error);
    const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
    if (!nextColumns.length) throwSupabaseError(error);
    selectColumns = nextColumns;
  }

  setCacheValue(leaguesCache, cacheKey, leagues);
  return leagues;
}

export async function fetchLeagueSummaries(options?: {
  orderByField?: "nome" | "likes";
  orderDirection?: "asc" | "desc";
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<LeagueRecord[]> {
  const orderByField = options?.orderByField ?? "nome";
  const orderDirection = options?.orderDirection ?? "asc";
  const maxResults = boundedLimit(options?.maxResults ?? 40, MAX_LEAGUE_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveLeagueTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "global"}:${orderByField}:${orderDirection}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCacheValue(leagueSummariesCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let selectColumns: string[] = [...LEAGUE_SUMMARY_SELECT_COLUMNS];
  let leagues: LeagueRecord[] = [];

  while (selectColumns.length > 0) {
    let query = supabase
      .from("ligas_config")
      .select(selectColumns.join(","))
      .order(orderByField, { ascending: orderDirection === "asc" })
      .limit(maxResults);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }

    const { data, error } = await query;
    if (!error) {
      leagues = (data ?? [])
        .map((row) => normalizeLeague(rowIdFromUnknown(row), row))
        .filter((row): row is LeagueRecord => row !== null);
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error));
    if (!missingColumn) throwSupabaseError(error);
    const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
    if (!nextColumns.length) throwSupabaseError(error);
    selectColumns = nextColumns;
  }

  setCacheValue(leagueSummariesCache, cacheKey, leagues);
  return leagues;
}

export async function fetchLeagueById(
  leagueId: string,
  options?: { forceRefresh?: boolean; tenantId?: string | null }
): Promise<LeagueRecord | null> {
  const cleanId = leagueId.trim();
  if (!cleanId) return null;

  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveLeagueTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "global"}:${cleanId}`;
  if (!forceRefresh) {
    const cached = getCacheValue(leagueByIdCache, cacheKey);
    if (cached !== null) return cached;
  }

  const supabase = getSupabaseClient();
  let selectColumns: string[] = [...LEAGUES_SELECT_COLUMNS];
  let league: LeagueRecord | null = null;

  while (selectColumns.length > 0) {
    let query = supabase
      .from("ligas_config")
      .select(selectColumns.join(","))
      .eq("id", cleanId);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { data, error } = await query.maybeSingle();
    if (!error) {
      if (!data) {
        setCacheValue(leagueByIdCache, cacheKey, null);
        return null;
      }
      league = normalizeLeague(rowIdFromUnknown(data), data);
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error));
    if (!missingColumn) throwSupabaseError(error);
    const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
    if (!nextColumns.length) throwSupabaseError(error);
    selectColumns = nextColumns;
  }

  setCacheValue(leagueByIdCache, cacheKey, league);
  return league;
}

export async function fetchLeagueUsers(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<LeagueUserRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 120, MAX_USER_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveLeagueTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "global"}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCacheValue(usersCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let selectColumns: string[] = [...LEAGUE_USERS_SELECT_COLUMNS];
  let users: LeagueUserRecord[] = [];

  while (selectColumns.length > 0) {
    let query = supabase
      .from("users")
      .select(selectColumns.join(","))
      .limit(maxResults);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { data, error } = await query;
    if (!error) {
      users = (data ?? [])
        .map((row) =>
          normalizeLeagueUser(
            rowIdFromUnknown(row),
            row
          )
        )
        .filter((row): row is LeagueUserRecord => row !== null)
        .sort((left, right) =>
          (left.nome || "").localeCompare(right.nome || "", "pt-BR")
        );
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error));
    if (!missingColumn) throwSupabaseError(error);
    const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
    if (!nextColumns.length) throwSupabaseError(error);
    selectColumns = nextColumns;
  }

  setCacheValue(usersCache, cacheKey, users);
  return users;
}

export async function saveLeagueConfig(payload: {
  id?: string;
  data: Partial<LeagueRecord>;
  tenantId?: string | null;
}): Promise<{ id: string }> {
  const normalizedData = normalizeLeaguePayload(payload.data);
  const id = payload.id?.trim() || "";
  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);
  const requestPayload = {
    id,
    data: normalizedData,
    tenantId: scopedTenantId || undefined,
  };

  const result = await callWithFallback<typeof requestPayload, { id: string }>(
    LEAGUE_SAVE_CALLABLE,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      if (id) {
        let query = supabase
          .from("ligas_config")
          .update({
            ...normalizedData,
            updatedAt: nowIso(),
          })
          .eq("id", id);
        if (scopedTenantId) {
          query = query.eq("tenant_id", scopedTenantId);
        }
        const { error } = await query;
        if (error) throwSupabaseError(error);

        return { id };
      }

      const { data, error } = await supabase
        .from("ligas_config")
        .insert({
          ...normalizedData,
          ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        })
        .select("id")
        .single();
      if (error) throwSupabaseError(error);
      return { id: asString((data as Record<string, unknown> | null)?.id) };
    }
  );

  clearLeagueDependentCaches();
  return result;
}

export async function deleteLeagueConfig(
  id: string,
  options?: { tenantId?: string | null }
): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) return;
  const scopedTenantId = resolveLeagueTenantId(options?.tenantId);

  await callWithFallback<{ id: string; tenantId?: string }, { ok: boolean }>(
    LEAGUE_DELETE_CALLABLE,
    { id: cleanId, tenantId: scopedTenantId || undefined },
    async () => {
      const supabase = getSupabaseClient();
      let query = supabase.from("ligas_config").delete().eq("id", cleanId);
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      const { error } = await query;
      if (error) throwSupabaseError(error);
      return { ok: true };
    }
  );

  clearLeagueDependentCaches();
}

export async function setLeagueVisibility(payload: {
  id: string;
  visivel: boolean;
  tenantId?: string | null;
}): Promise<void> {
  const cleanId = payload.id.trim();
  if (!cleanId) return;
  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);

  const requestPayload = {
    id: cleanId,
    visivel: payload.visivel,
    tenantId: scopedTenantId || undefined,
  };
  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    LEAGUE_VISIBILITY_CALLABLE,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      let query = supabase
        .from("ligas_config")
        .update({
          visivel: payload.visivel,
          updatedAt: nowIso(),
        })
        .eq("id", cleanId);
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      const { error } = await query;
      if (error) throwSupabaseError(error);
      return { ok: true };
    }
  );

  clearLeagueDependentCaches();
}

export async function changeLeagueLikeCount(payload: {
  id: string;
  delta: 1 | -1;
  actorUserId?: string;
  tenantId?: string | null;
}): Promise<void> {
  const cleanId = payload.id.trim();
  if (!cleanId) return;
  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);

  await callWithFallback<typeof payload, { ok: boolean }>(
    LEAGUE_LIKE_CALLABLE,
    payload,
    async () => {
      const supabase = getSupabaseClient();
      let selectQuery = supabase
        .from("ligas_config")
        .select("likes")
        .eq("id", cleanId);
      if (scopedTenantId) {
        selectQuery = selectQuery.eq("tenant_id", scopedTenantId);
      }
      const { data: leagueRow, error: selectError } = await selectQuery.maybeSingle();
      if (selectError) throwSupabaseError(selectError);
      const currentLikes = Math.max(0, asNumber(asObject(leagueRow)?.likes, 0));
      const nextLikes = Math.max(0, currentLikes + payload.delta);

      let updateQuery = supabase
        .from("ligas_config")
        .update({
          likes: nextLikes,
          updatedAt: nowIso(),
        })
        .eq("id", cleanId);
      if (scopedTenantId) {
        updateQuery = updateQuery.eq("tenant_id", scopedTenantId);
      }
      const { error: updateError } = await updateQuery;
      if (updateError) throwSupabaseError(updateError);
      return { ok: true };
    }
  );

  const actorUserId = payload.actorUserId?.trim() || "";
  if (actorUserId) {
    try {
      await incrementUserStats(actorUserId, { leagueLikesGiven: payload.delta });
    } catch (error: unknown) {
      console.warn("Liga: falha ao atualizar stats de curtidas de liga.", error);
    }
  }

  clearLeagueDependentCaches();
}

export async function fetchEventPolls(
  eventId: string,
  options?: { maxResults?: number; forceRefresh?: boolean; tenantId?: string | null }
): Promise<LeaguePollRecord[]> {
  const cleanEventId = eventId.trim();
  if (!cleanEventId) return [];

  const maxResults = boundedLimit(options?.maxResults ?? 80, MAX_POLL_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveLeagueTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "global"}:${cleanEventId}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCacheValue(pollsCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let selectColumns: string[] = [...EVENT_POLLS_SELECT_COLUMNS];
  let polls: LeaguePollRecord[] = [];

  while (selectColumns.length > 0) {
    let query = supabase
      .from("eventos_enquetes")
      .select(selectColumns.join(","))
      .eq("eventoId", cleanEventId)
      .limit(maxResults);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { data, error } = await query;
    if (!error) {
      polls = (data ?? [])
        .map((row) => normalizePoll(rowIdFromUnknown(row), row))
        .filter((row): row is LeaguePollRecord => row !== null);
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error));
    if (!missingColumn) throwSupabaseError(error);
    const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
    if (!nextColumns.length) throwSupabaseError(error);
    selectColumns = nextColumns;
  }

  setCacheValue(pollsCache, cacheKey, polls);
  return polls;
}

export async function createEventPoll(payload: {
  eventId: string;
  question: string;
  allowUserOptions: boolean;
  creatorId?: string;
  tenantId?: string | null;
}): Promise<{ id: string }> {
  const eventId = payload.eventId.trim();
  if (!eventId) throw new Error("Evento inválido.");

  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);

  const requestPayload = {
    eventId,
    question: payload.question.trim().slice(0, 280),
    allowUserOptions: payload.allowUserOptions,
    creatorId: payload.creatorId?.trim() || "",
    tenantId: scopedTenantId || undefined,
  };

  const result = await callWithFallback<typeof requestPayload, { id: string }>(
    LEAGUE_POLL_CREATE_CALLABLE,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      let insertPayload: Record<string, unknown> = {
        eventoId: eventId,
        question: requestPayload.question,
        allowUserOptions: requestPayload.allowUserOptions,
        options: [],
        voters: [],
        userVotes: {},
        creatorId: requestPayload.creatorId || null,
        ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
        isOfficial: true,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      while (Object.keys(insertPayload).length > 0) {
        const { data, error } = await supabase
          .from("eventos_enquetes")
          .insert(insertPayload)
          .select("id")
          .single();
        if (!error) {
          return { id: asString((data as Record<string, unknown> | null)?.id) };
        }

        const missingColumn = asString(extractMissingSchemaColumn(error));
        if (!missingColumn) throwSupabaseError(error);

        const nextPayload = removeMissingColumnFromPayload(insertPayload, missingColumn);
        if (!nextPayload) throwSupabaseError(error);
        insertPayload = nextPayload as Record<string, unknown>;
      }

      throw new Error("Nao foi possivel criar enquete para o evento.");
    }
  );

  pollsCache.clear();
  return result;
}

export async function deleteEventPoll(payload: {
  eventId: string;
  pollId: string;
  tenantId?: string | null;
}): Promise<void> {
  const eventId = payload.eventId.trim();
  const pollId = payload.pollId.trim();
  if (!eventId || !pollId) return;
  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);

  await callWithFallback<typeof payload, { ok: boolean }>(
    LEAGUE_POLL_DELETE_CALLABLE,
    payload,
    async () => {
      const supabase = getSupabaseClient();
      let query = supabase
        .from("eventos_enquetes")
        .delete()
        .eq("id", pollId)
        .eq("eventoId", eventId);
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      const { error } = await query;
      if (error) throwSupabaseError(error);
      return { ok: true };
    }
  );

  pollsCache.clear();
}

export async function updateEventPollOptions(payload: {
  eventId: string;
  pollId: string;
  options: LeaguePollOptionRecord[];
  tenantId?: string | null;
}): Promise<void> {
  const eventId = payload.eventId.trim();
  const pollId = payload.pollId.trim();
  if (!eventId || !pollId) return;
  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);

  const normalizedOptions = payload.options.slice(0, 80).map((option) => ({
    text: option.text.slice(0, 120),
    votes: Math.max(0, option.votes),
    creator: option.creator || undefined,
    creatorName: option.creatorName || undefined,
    creatorAvatar: option.creatorAvatar || undefined,
  }));

  const requestPayload = { ...payload, options: normalizedOptions };
  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    LEAGUE_POLL_UPDATE_CALLABLE,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      let query = supabase
        .from("eventos_enquetes")
        .update({
          options: normalizedOptions,
          updatedAt: nowIso(),
        })
        .eq("id", pollId)
        .eq("eventoId", eventId);
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      const { error } = await query;
      if (error) throwSupabaseError(error);
      return { ok: true };
    }
  );

  pollsCache.clear();
}

export async function addLeagueQuizHistory(payload: {
  userId: string;
  topMatch: string;
  keywords: string[];
}): Promise<void> {
  const userId = payload.userId.trim();
  if (!userId) return;

  const requestPayload = {
    userId,
    topMatch: payload.topMatch.trim().slice(0, 120),
    keywords: payload.keywords
      .filter((item): item is string => typeof item === "string")
      .slice(0, 60),
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    LEAGUE_QUIZ_CALLABLE,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("quiz_history").insert({
        userId,
        date: nowIso(),
        topMatch: requestPayload.topMatch,
        keywords: requestPayload.keywords,
      });
      if (error) {
        if (asString(getBackendErrorCode(error)).toLowerCase() !== "42p01") {
          throwSupabaseError(error);
        }
      }
      return { ok: true };
    }
  );

  try {
    await incrementUserStats(userId, { leagueQuizRuns: 1 });
  } catch (error: unknown) {
    console.warn("Ligas: falha ao atualizar stats de quiz.", error);
  }

  clearUsersCache();
}


