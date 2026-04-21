import { getSupabaseClient } from "./supabase";
import {
  asObject,
  asString,
  asStringArray,
  boundedLimit,
  incrementUserStats,
  normalizeRowTimestamps,
  throwSupabaseError,
  toggleArrayValue,
  type DateLike,
  type Row,
} from "./supabaseData";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import {
  normalizeAvailabilityStatus,
  normalizePaymentConfig,
  normalizePlanPriceEntries,
} from "./commerceCatalog";
import { ensureEventTicketEntries } from "./eventTickets";
import { fetchCanonicalUserVisuals } from "./userVisualsService";
import {
  hydrateEventPollRows,
  hydrateEventViewerState,
  isMissingRelationError,
} from "./hotPathRelations";

type CacheEntry<T> = { cachedAt: number; value: T };

const TTL_MS = 90_000;
const MAX_EVENTS = 80;
const MAX_RSVPS = 2000;
const MAX_POLLS = 200;
const MAX_COMMENTS = 300;
const MAX_TICKETS = 2000;
const DEFAULT_EVENT_DETAILS_RSVPS_LIMIT = 200;
const DEFAULT_EVENT_DETAILS_COMMENTS_LIMIT = 100;
const DEFAULT_EVENT_DETAILS_POLLS_LIMIT = 20;
const DEFAULT_EVENT_DETAILS_PEDIDOS_LIMIT = 20;
export const EVENT_POLL_QUESTION_MAX_CHARS = 280;
export const EVENT_POLL_OPTION_MAX_CHARS = 60;
export const EVENT_POLL_OPTION_MAX_COUNT = 20;
const EVENTOS_FEED_SELECT_COLUMNS =
  "id,titulo,data,hora,local,imagem,imagePositionY,tipo,categoria,destaque,status,sale_status,isLowStock,stats,lotes,tenant_id,createdAt,updatedAt";
const EVENTOS_SELECT_COLUMNS =
  "id,titulo,descricao,data,hora,local,imagem,imagePositionY,tipo,categoria,destaque,mapsUrl,status,sale_status,payment_config,pixChave,pixBanco,pixTitular,contatoComprovante,isLowStock,stats,lotes,tenant_id,createdAt,updatedAt";
const EVENTOS_RSVPS_SELECT_COLUMNS =
  "id,eventoId,userId,status,userName,userAvatar,userTurma,timestamp";
const EVENTOS_COMENTARIOS_SELECT_COLUMNS =
  "id,eventoId,userId,userName,userAvatar,userTurma,role,userPlanoCor,userPlanoIcon,userPatente,text,likes,reports,hidden,createdAt,updatedAt";
const EVENTOS_ENQUETES_SELECT_COLUMNS =
  "id,eventoId,question,allowUserOptions,options,createdAt,updatedAt";
const PATENTES_SELECT_COLUMNS = "id,titulo,minXp,cor,iconName,bg,border,text";
const SOLICITACOES_INGRESSOS_SELECT_COLUMNS =
  "id,eventoId,eventoNome,userId,userName,userTurma,status,loteId,loteNome,quantidade,valorUnitario,valorTotal,payment_config,dataSolicitacao,dataAprovacao,aprovadoPor";
const FINANCEIRO_CONFIG_SELECT_COLUMNS =
  "id,data,chave,banco,titular,whatsapp,updatedAt,createdAt";
const EVENTOS_WRITABLE_COLUMNS = new Set([
  "titulo",
  "data",
  "hora",
  "local",
  "tipo",
  "categoria",
  "destaque",
  "mapsUrl",
  "imagem",
  "imagePositionY",
  "descricao",
  "lotes",
  "status",
  "sale_status",
  "payment_config",
  "isLowStock",
  "stats",
  "vendasTotais",
  "pixChave",
  "pixBanco",
  "pixTitular",
  "contatoComprovante",
  "data_extra",
  "tenant_id",
  "createdAt",
  "updatedAt",
]);
const MONTHS_PT_BR: Record<string, number> = {
  JAN: 0,
  FEV: 1,
  MAR: 2,
  ABR: 3,
  MAI: 4,
  JUN: 5,
  JUL: 6,
  AGO: 7,
  SET: 8,
  OUT: 9,
  NOV: 10,
  DEZ: 11,
};

const feedCache = new Map<string, CacheEntry<Row[]>>();
const detailsCache = new Map<string, CacheEntry<EventDetailsBundle>>();
const adminParticipantsCache = new Map<string, CacheEntry<{ rsvps: Row[]; vendas: Row[] }>>();
const adminRsvpsPageCache = new Map<string, CacheEntry<AdminEventParticipantsPage>>();
const adminSalesPageCache = new Map<string, CacheEntry<AdminEventParticipantsPage>>();
const adminPresencePageCache = new Map<string, CacheEntry<AdminEventParticipantsPage>>();
const adminPollsCache = new Map<string, CacheEntry<Row[]>>();
const financeiroCache = new Map<string, CacheEntry<Row | null>>();

const nowIso = (): string => new Date().toISOString();
const resolveEventsTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

const pickWritableEventoPayload = (payload: Row): Row =>
  Object.entries(payload).reduce<Row>((accumulator, [key, value]) => {
    if (EVENTOS_WRITABLE_COLUMNS.has(key)) {
      accumulator[key] = value;
    }
    return accumulator;
  }, {});

const asNum = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

type EventPollOptionRecord = {
  text: string;
  votes: number;
  creatorId?: string;
  creatorName?: string;
  creatorAvatar?: string;
  votesByTurma?: Record<string, number>;
};

const normalizeEventPollOptionRecord = (value: unknown): EventPollOptionRecord | null => {
  const raw = asObject(value);
  if (!raw) return null;

  const text = asString(raw.text).trim().slice(0, EVENT_POLL_OPTION_MAX_CHARS);
  if (!text) return null;

  const creatorId = asString(raw.creatorId || raw.creator).trim();
  const creatorName = asString(raw.creatorName).trim();
  const creatorAvatar = asString(raw.creatorAvatar).trim();
  const votesByTurmaSource = asObject(raw.votesByTurma) ?? {};
  const votesByTurma = Object.entries(votesByTurmaSource).reduce<Record<string, number>>(
    (accumulator, [key, entryValue]) => {
      const turma = asString(key).trim();
      const count = Math.max(0, Math.floor(asNum(entryValue, 0)));
      if (turma && count > 0) {
        accumulator[turma] = count;
      }
      return accumulator;
    },
    {}
  );

  return {
    text,
    votes: Math.max(0, Math.floor(asNum(raw.votes, 0))),
    ...(creatorId ? { creatorId } : {}),
    ...(creatorName ? { creatorName } : {}),
    ...(creatorAvatar ? { creatorAvatar } : {}),
    ...(Object.keys(votesByTurma).length > 0 ? { votesByTurma } : {}),
  };
};

const normalizeEventPollOptions = (value: unknown): EventPollOptionRecord[] => {
  if (!Array.isArray(value)) return [];

  const seenTexts = new Set<string>();
  const options: EventPollOptionRecord[] = [];
  for (const entry of value) {
    const normalized = normalizeEventPollOptionRecord(entry);
    if (!normalized) continue;
    const dedupeKey = normalized.text.trim().toLowerCase();
    if (!dedupeKey || seenTexts.has(dedupeKey)) continue;
    seenTexts.add(dedupeKey);
    options.push(normalized);
    if (options.length >= EVENT_POLL_OPTION_MAX_COUNT) break;
  }

  return options;
};

const splitSelectColumns = (selectColumns: string): string[] =>
  selectColumns
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown; hint?: unknown };
  const message = [raw.message, raw.details, raw.hint]
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .filter((entry) => entry.length > 0)
    .join(" | ");
  if (!message) return null;

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

const removeMissingColumn = (columns: string[], missingColumn: string): string[] | null => {
  const normalizedMissing = missingColumn.trim().toLowerCase();
  if (!normalizedMissing) return null;

  const next = columns.filter((column) => {
    const normalizedColumn = column.trim().toLowerCase();
    if (!normalizedColumn) return false;
    if (normalizedColumn === normalizedMissing) return false;
    return !normalizedColumn.endsWith(`.${normalizedMissing}`);
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

const normalizeRows = (rows: Row[]): Row[] => rows.map((row) => normalizeRowTimestamps(row));
const normalizeEventRow = (row: Row): Row => ({
  ...normalizeRowTimestamps(row),
  sale_status: normalizeAvailabilityStatus(row.sale_status, "ativo"),
  payment_config: normalizePaymentConfig(row.payment_config),
  lotes: Array.isArray(row.lotes)
    ? row.lotes.map((entry) => {
        const lote = asObject(entry) ?? {};
        return {
          ...lote,
          status: normalizeAvailabilityStatus(lote.status, "ativo"),
          planPrices: normalizePlanPriceEntries(lote.planPrices ?? lote.plan_prices),
        };
      })
    : [],
});
const normalizeCommentRows = (rows: Row[]): Row[] =>
  normalizeRows(rows).map((row) => {
    const text = asString(row.text);
    const texto = asString(row.texto);
    if (text || !texto) return row;
    return { ...row, text: texto };
  });

const applyEventCommentAuthorVisuals = async (rows: Row[]): Promise<Row[]> => {
  if (rows.length === 0) return rows;

  const userIds = rows
    .map((row) => asString(row.userId).trim())
    .filter((value): value is string => value.length > 0);

  if (userIds.length === 0) return rows;

  const visuals = await fetchCanonicalUserVisuals(userIds);
  if (visuals.size === 0) return rows;

  return rows.map((row) => {
    const userId = asString(row.userId).trim();
    if (!userId) return row;

    const visual = visuals.get(userId);
    if (!visual) return row;

    const next: Row = { ...row };
    next.userName = visual.nome || asString(row.userName).trim();
    next.userAvatar = visual.foto || asString(row.userAvatar).trim();
    next.userTurma = visual.turma || asString(row.userTurma).trim();
    next.role = visual.role || asString(row.role).trim();
    next.userPlanoCor = visual.plano_cor;
    next.userPlanoIcon = visual.plano_icon;
    next.userPatente = visual.patente;
    next.userPatenteIcon = visual.patente_icon;
    next.userPatenteCor = visual.patente_cor;

    return next;
  });
};

const invalidateEventCaches = (eventId?: string): void => {
  feedCache.clear();
  financeiroCache.clear();

  if (!eventId) {
    detailsCache.clear();
    adminParticipantsCache.clear();
    adminRsvpsPageCache.clear();
    adminSalesPageCache.clear();
    adminPresencePageCache.clear();
    adminPollsCache.clear();
    return;
  }

  for (const cache of [detailsCache, adminParticipantsCache, adminRsvpsPageCache, adminSalesPageCache, adminPresencePageCache, adminPollsCache]) {
    cache.forEach((_, key) => {
      if (key.startsWith(`${eventId}:`)) cache.delete(key);
    });
  }
};

async function selectRows(
  table: string,
  options?: {
    selectColumns?: string;
    eq?: Record<string, string>;
    orderBy?: { column: string; ascending?: boolean };
    limit?: number;
    offset?: number;
    tenantId?: string | null;
  }
): Promise<Row[]> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveEventsTenantId(options?.tenantId);
  const defaultSelectColumns =
    options?.selectColumns ??
    (table === "eventos"
      ? EVENTOS_SELECT_COLUMNS
      : table === "eventos_rsvps"
      ? EVENTOS_RSVPS_SELECT_COLUMNS
      : table === "eventos_comentarios"
      ? EVENTOS_COMENTARIOS_SELECT_COLUMNS
      : table === "eventos_enquetes"
      ? EVENTOS_ENQUETES_SELECT_COLUMNS
      : table === "solicitacoes_ingressos"
      ? SOLICITACOES_INGRESSOS_SELECT_COLUMNS
      : table === "patentes_config"
      ? PATENTES_SELECT_COLUMNS
      : "id");
  let mutableColumns = splitSelectColumns(defaultSelectColumns);
  let mutableOrderBy = options?.orderBy;

  while (mutableColumns.length > 0) {
    let query = supabase.from(table).select(mutableColumns.join(","));

    if (options?.eq) {
      for (const [column, value] of Object.entries(options.eq)) {
        query = query.eq(column, value);
      }
    }
    if (
      scopedTenantId &&
      table !== "patentes_config"
    ) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    if (mutableOrderBy) {
      query = query.order(mutableOrderBy.column, { ascending: mutableOrderBy.ascending ?? true });
    }
    if (typeof options?.offset === "number" && typeof options?.limit === "number") {
      query = query.range(options.offset, options.offset + options.limit - 1);
    } else if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (!error) return (data ?? []) as unknown as Row[];

    const missingColumn = extractMissingSchemaColumn(error);
    if (typeof missingColumn !== "string" || missingColumn.length === 0) {
      throwSupabaseError(error);
    }
    const safeMissingColumn = missingColumn as string;

    if (mutableOrderBy && mutableOrderBy.column.toLowerCase() === safeMissingColumn.toLowerCase()) {
      mutableOrderBy = undefined;
      continue;
    }

    const nextColumns = removeMissingColumn(mutableColumns, safeMissingColumn);
    if (!nextColumns || nextColumns.length === 0) {
      throwSupabaseError(error);
    }
    mutableColumns = nextColumns as string[];
  }

  return [];
}

async function selectEventById(eventId: string, tenantId?: string): Promise<Row | null> {
  const rows = await selectRows("eventos", {
    eq: { id: eventId },
    limit: 1,
    tenantId,
  });
  if (rows.length === 0) return null;
  return normalizeEventRow(rows[0] as Row);
}

async function resolveEventInteractionScope(options: {
  eventId: string;
  tenantId?: string | null;
}): Promise<{ eventRow: Row | null; tenantId: string }> {
  const preferredTenantId = resolveEventsTenantId(options.tenantId);
  const eventFromPreferredTenant = await selectEventById(
    options.eventId,
    preferredTenantId || undefined
  );
  const fallbackEvent =
    eventFromPreferredTenant || !preferredTenantId
      ? null
      : await selectEventById(options.eventId);
  const eventRow = eventFromPreferredTenant ?? fallbackEvent;
  const eventTenantId = asString(eventRow?.tenant_id).trim();

  return {
    eventRow,
    tenantId: eventTenantId || preferredTenantId,
  };
}

async function updateEventRow(eventId: string, patch: Row, tenantId?: string): Promise<void> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveEventsTenantId(tenantId);
  let query = supabase
    .from("eventos")
    .update({ ...patch, updatedAt: nowIso() })
    .eq("id", eventId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { error } = await query;
  if (error) throwSupabaseError(error);
}

async function updateEventStatsAndLists(payload: {
  eventId: string;
  tenantId?: string | null;
  mutate: (current: {
    stats: Row;
    interessados: string[];
    likesList: string[];
  }) => { stats?: Row; interessados?: string[]; likesList?: string[] };
}): Promise<void> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveEventsTenantId(payload.tenantId);
  let selectQuery = supabase
    .from("eventos")
    .select("stats, interessados, \"likesList\"")
    .eq("id", payload.eventId);
  if (scopedTenantId) {
    selectQuery = selectQuery.eq("tenant_id", scopedTenantId);
  }
  const { data: row, error: selectError } = await selectQuery.maybeSingle();

  if (selectError) throwSupabaseError(selectError);
  if (!row) return;

  const current = {
    stats: asObject(row.stats) ?? {},
    interessados: asStringArray(row.interessados),
    likesList: asStringArray((row as Row).likesList),
  };

  const next = payload.mutate(current);
  const updatePayload: Row = { updatedAt: nowIso() };
  if (next.stats) updatePayload.stats = next.stats;
  if (next.interessados) updatePayload.interessados = next.interessados;
  if (next.likesList) updatePayload.likesList = next.likesList;

  let updateQuery = supabase
    .from("eventos")
    .update(updatePayload)
    .eq("id", payload.eventId);
  if (scopedTenantId) {
    updateQuery = updateQuery.eq("tenant_id", scopedTenantId);
  }
  const { error: updateError } = await updateQuery;
  if (updateError) throwSupabaseError(updateError);
}

async function countTableRowsExact(
  table: "eventos_likes" | "eventos_rsvps",
  filters: Record<string, string>,
  tenantId?: string | null
): Promise<number> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveEventsTenantId(tenantId);
  let query = supabase.from(table).select("id", { count: "exact", head: true });

  Object.entries(filters).forEach(([column, value]) => {
    query = query.eq(column, value);
  });

  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }

  const { count, error } = await query;
  if (error) throw error;
  return Math.max(0, count ?? 0);
}

async function refreshEventStatsFromRelations(eventId: string, tenantId?: string | null): Promise<void> {
  const [likes, confirmados, talvez] = await Promise.all([
    countTableRowsExact("eventos_likes", { eventoId: eventId }, tenantId),
    countTableRowsExact("eventos_rsvps", { eventoId: eventId, status: "going" }, tenantId),
    countTableRowsExact("eventos_rsvps", { eventoId: eventId, status: "maybe" }, tenantId),
  ]);

  await updateEventRow(
    eventId,
    {
      stats: {
        likes,
        confirmados,
        talvez,
      },
    },
    resolveEventsTenantId(tenantId) || undefined
  );
}

function parseOffsetCursor(cursorId?: string | null): number {
  if (!cursorId) return 0;
  const parsed = Number(cursorId);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function nextOffsetCursor(offset: number, pageSize: number, hasMore: boolean): string | null {
  if (!hasMore) return null;
  return String(offset + pageSize);
}

function toMillis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "object" && value !== null) {
    const candidate = (value as { toDate?: unknown }).toDate;
    if (typeof candidate === "function") {
      const parsed = candidate.call(value);
      if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
        return parsed.getTime();
      }
    }
  }
  return 0;
}

export async function fetchEventsFeed(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  includeInactive?: boolean;
  includePast?: boolean;
  includeFullData?: boolean;
  userId?: string | null;
  tenantId?: string | null;
}): Promise<Row[]> {
  const scopedTenantId = resolveEventsTenantId(options?.tenantId);
  const viewerUserId = asString(options?.userId).trim();
  const maxResults = boundedLimit(options?.maxResults ?? 60, MAX_EVENTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const includeInactive = options?.includeInactive ?? false;
  const includePast = options?.includePast ?? false;
  const includeFullData = options?.includeFullData ?? false;
  const cacheKey = `${scopedTenantId || "all"}:${viewerUserId || "anon"}:${maxResults}:${includeInactive ? "all" : "active"}:${includePast ? "past" : "future"}:${includeFullData ? "full" : "feed"}`;

  if (!forceRefresh) {
    const cached = getCache(feedCache, cacheKey);
    if (cached) return cached;
  }

  const parseEventDateTimeMs = (row: Row): number | null => {
    const dateRaw = asString(row.data).trim();
    if (!dateRaw) return null;

    const timeRaw = asString(row.hora, "00:00").trim();
    const [hoursRaw, minutesRaw] = timeRaw.split(":");
    const hours = Number.isFinite(Number(hoursRaw)) ? Number(hoursRaw) : 0;
    const minutes = Number.isFinite(Number(minutesRaw)) ? Number(minutesRaw) : 0;

    if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      const [year, month, day] = dateRaw.split("-").map((part) => Number(part));
      const parsed = new Date(year, month - 1, day, hours, minutes).getTime();
      return Number.isFinite(parsed) ? parsed : null;
    }

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateRaw)) {
      const [day, month, year] = dateRaw.split("/").map((part) => Number(part));
      const parsed = new Date(year, month - 1, day, hours, minutes).getTime();
      return Number.isFinite(parsed) ? parsed : null;
    }

    const normalized = dateRaw
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[.,-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const parts = normalized.split(" ").filter((part) => part.length > 0);
    if (parts.length >= 2) {
      const day = Number(parts[0]);
      const monthToken = parts[1].slice(0, 3);
      const month = MONTHS_PT_BR[monthToken];
      const year =
        parts.length >= 3 && /^\d{4}$/.test(parts[2]) ? Number(parts[2]) : new Date().getFullYear();
      if (Number.isFinite(day) && month !== undefined && Number.isFinite(year)) {
        const parsed = new Date(year, month, day, hours, minutes).getTime();
        return Number.isFinite(parsed) ? parsed : null;
      }
    }

    const fallback = Date.parse(`${dateRaw} ${timeRaw}`);
    return Number.isFinite(fallback) ? fallback : null;
  };

  const isCancelledOrClosed = (row: Row): boolean => {
    const normalizedStatus = asString(row.status, "ativo").toLowerCase().trim();
    return normalizedStatus === "encerrado" || normalizedStatus === "cancelado" || normalizedStatus === "inativo";
  };

  let rows: Row[] = [];
  const fetchLimit = includePast ? maxResults : Math.min(MAX_EVENTS, Math.max(maxResults * 3, maxResults));
  try {
    rows = await selectRows("eventos", {
      selectColumns: includeFullData ? EVENTOS_SELECT_COLUMNS : EVENTOS_FEED_SELECT_COLUMNS,
      eq: includeInactive ? undefined : { status: "ativo" },
      orderBy: { column: includePast ? "createdAt" : "data", ascending: includePast ? false : true },
      limit: fetchLimit,
      tenantId: scopedTenantId,
    });
  } catch {
    rows = await selectRows("eventos", { limit: fetchLimit, tenantId: scopedTenantId });
  }

  const nowMs = Date.now();
  const normalized = rows.map((row) => normalizeEventRow(row));
  const visibleRows = normalized
    .filter((row) => (includeInactive ? true : !isCancelledOrClosed(row)))
    .filter((row) => {
      if (includePast) return true;
      const eventMs = parseEventDateTimeMs(row);
      // Sem data parseavel, mantemos no feed somente se estiver ativo.
      if (eventMs === null) return !isCancelledOrClosed(row);
      return eventMs >= nowMs;
    })
    .sort((left, right) => {
      if (includePast) {
        const leftCreated = Date.parse(asString(left.createdAt));
        const rightCreated = Date.parse(asString(right.createdAt));
        if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated)) return rightCreated - leftCreated;
      }
      const leftEventMs = parseEventDateTimeMs(left) ?? Number.MAX_SAFE_INTEGER;
      const rightEventMs = parseEventDateTimeMs(right) ?? Number.MAX_SAFE_INTEGER;
      return leftEventMs - rightEventMs;
    })
    .slice(0, maxResults);

  const hydratedRows =
    viewerUserId.length > 0
      ? await hydrateEventViewerState(visibleRows, {
          userId: viewerUserId,
          tenantId: scopedTenantId,
        })
      : visibleRows;

  setCache(feedCache, cacheKey, hydratedRows);
  return hydratedRows;
}

async function fetchFinanceiroConfig(
  forceRefresh = false,
  tenantId?: string | null
): Promise<Row | null> {
  const scopedTenantId = resolveEventsTenantId(tenantId);
  const cacheKey = `financeiro:${scopedTenantId || "all"}`;
  if (!forceRefresh) {
    const cached = getCache(financeiroCache, cacheKey);
    if (cached !== null) return cached;
  }

  const supabase = getSupabaseClient();
  const configIds = scopedTenantId
    ? [buildTenantScopedRowId(scopedTenantId, "financeiro")]
    : ["financeiro"];
  const { data, error } = await supabase
    .from("app_config")
    .select(FINANCEIRO_CONFIG_SELECT_COLUMNS)
    .in("id", configIds);
  if (error) throwSupabaseError(error);

  const rows = Array.isArray(data) ? (data as Row[]) : [];
  const selected = configIds
    .map((id) => rows.find((row) => asString(row.id) === id))
    .find((row) => Boolean(row));
  const row = selected ? (normalizeRowTimestamps(selected as Row) as Row) : null;
  setCache(financeiroCache, cacheKey, row);
  return row;
}

export async function fetchAdminEventParticipants(options: {
  eventId: string;
  rsvpsLimit?: number;
  vendasLimit?: number;
  forceRefresh?: boolean;
}): Promise<{ rsvps: Row[]; vendas: Row[] }> {
  const eventId = options.eventId.trim();
  if (!eventId) return { rsvps: [], vendas: [] };

  const rsvpsLimit = boundedLimit(options.rsvpsLimit ?? 300, MAX_RSVPS);
  const vendasLimit = boundedLimit(options.vendasLimit ?? 300, MAX_TICKETS);
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `${eventId}:${rsvpsLimit}:${vendasLimit}`;

  if (!forceRefresh) {
    const cached = getCache(adminParticipantsCache, cacheKey);
    if (cached) return cached;
  }

  const [rsvpsRaw, vendasRaw] = await Promise.all([
    selectRows("eventos_rsvps", {
      eq: { eventoId: eventId },
      limit: rsvpsLimit,
    }),
    selectRows("solicitacoes_ingressos", {
      eq: { eventoId: eventId },
      orderBy: { column: "dataSolicitacao", ascending: false },
      limit: vendasLimit,
    }),
  ]);

  const result = {
    rsvps: normalizeRows(rsvpsRaw),
    vendas: normalizeRows(vendasRaw),
  };
  setCache(adminParticipantsCache, cacheKey, result);
  return result;
}

export interface AdminEventParticipantsPage {
  rows: Row[];
  nextCursor: string | null;
  hasMore: boolean;
}

const resolvePresencePaymentStatus = (value: unknown): "pago" | "pendente" | "analise" => {
  const normalized = asString(value, "pendente").trim().toLowerCase();
  if (normalized === "aprovado" || normalized === "pago") return "pago";
  if (normalized === "analise") return "analise";
  return "pendente";
};

const buildMergedPresenceRows = async (eventId: string): Promise<Row[]> => {
  const [rsvpsRaw, salesRaw] = await Promise.all([
    selectRows("eventos_rsvps", {
      eq: { eventoId: eventId },
      orderBy: { column: "timestamp", ascending: false },
      limit: 1200,
    }),
    selectRows("solicitacoes_ingressos", {
      eq: { eventoId: eventId },
      orderBy: { column: "dataSolicitacao", ascending: false },
      limit: 1200,
    }),
  ]);

  const latestRsvpByUser = new Map<string, Row>();

  normalizeRows(rsvpsRaw).forEach((row) => {
    const userId = asString(row.userId).trim();
    if (!userId) return;
    if (!latestRsvpByUser.has(userId)) {
      latestRsvpByUser.set(userId, row);
    }
  });

  const rows: Row[] = [];
  const usersWithSales = new Set<string>();

  normalizeRows(salesRaw).forEach((row) => {
    const userId = asString(row.userId).trim();
    const requestId = asString(row.id).trim();
    if (!userId || !requestId) return;
    usersWithSales.add(userId);

    const latestRsvp = latestRsvpByUser.get(userId);
    rows.push({
      id: requestId,
      userId,
      userName: asString(row.userName, asString(latestRsvp?.userName, "Aluno")),
      userAvatar: asString(latestRsvp?.userAvatar),
      userTurma: asString(row.userTurma, asString(latestRsvp?.userTurma, "-")),
      rsvpStatus:
        latestRsvp && asString(latestRsvp.status, "maybe").toLowerCase() === "maybe"
          ? "maybe"
          : "going",
      pagamento: resolvePresencePaymentStatus(row.status),
      lote: asString(row.loteNome, "-"),
      quantidade: Math.max(1, asNum(row.quantidade, 1)),
      valorTotal: asString(row.valorTotal, "-"),
      dataAprovacao: row.dataAprovacao ?? null,
      aprovadoPor: asString(row.aprovadoPor),
      ticketRequestId: requestId,
      sortTimestamp: row.dataSolicitacao ?? latestRsvp?.timestamp ?? null,
    });
  });

  latestRsvpByUser.forEach((row, userId) => {
    if (usersWithSales.has(userId)) return;
    rows.push({
      id: asString(row.id, userId),
      userId,
      userName: asString(row.userName, "Aluno"),
      userAvatar: asString(row.userAvatar),
      userTurma: asString(row.userTurma, "-"),
      rsvpStatus: asString(row.status, "maybe").toLowerCase() === "going" ? "going" : "maybe",
      pagamento: "pendente",
      lote: "-",
      quantidade: 1,
      valorTotal: "-",
      dataAprovacao: null,
      aprovadoPor: "",
      ticketRequestId: null,
      sortTimestamp: row.timestamp ?? null,
    });
  });

  return rows.sort((left, right) => {
    const timeDelta = toMillis(right.sortTimestamp) - toMillis(left.sortTimestamp);
    if (timeDelta !== 0) return timeDelta;
    const userNameDelta = asString(left.userName).localeCompare(asString(right.userName), "pt-BR");
    if (userNameDelta !== 0) return userNameDelta;
    return asString(left.id).localeCompare(asString(right.id), "pt-BR");
  });
};

export async function fetchAdminEventPresencePage(options: {
  eventId: string;
  pageSize?: number;
  cursorId?: string | null;
  forceRefresh?: boolean;
}): Promise<AdminEventParticipantsPage> {
  const eventId = options.eventId.trim();
  if (!eventId) return { rows: [], nextCursor: null, hasMore: false };

  const pageSize = boundedLimit(options.pageSize ?? 10, 200);
  const offset = parseOffsetCursor(options.cursorId);
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `${eventId}:${pageSize}:${offset}`;

  if (!forceRefresh) {
    const cached = getCache(adminPresencePageCache, cacheKey);
    if (cached) return cached;
  }

  const mergedRows = await buildMergedPresenceRows(eventId);
  const rows = mergedRows.slice(offset, offset + pageSize + 1);

  const hasMore = rows.length > pageSize;
  const result: AdminEventParticipantsPage = {
    rows: rows.slice(0, pageSize),
    hasMore,
    nextCursor: nextOffsetCursor(offset, pageSize, hasMore),
  };
  setCache(adminPresencePageCache, cacheKey, result);
  return result;
}

export async function fetchAdminEventRsvpsPage(options: {
  eventId: string;
  pageSize?: number;
  cursorId?: string | null;
  forceRefresh?: boolean;
}): Promise<AdminEventParticipantsPage> {
  const eventId = options.eventId.trim();
  if (!eventId) return { rows: [], nextCursor: null, hasMore: false };

  const pageSize = boundedLimit(options.pageSize ?? 10, MAX_RSVPS);
  const offset = parseOffsetCursor(options.cursorId);
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `${eventId}:${pageSize}:${offset}`;

  if (!forceRefresh) {
    const cached = getCache(adminRsvpsPageCache, cacheKey);
    if (cached) return cached;
  }

  const rowsRaw = await selectRows("eventos_rsvps", {
    eq: { eventoId: eventId },
    orderBy: { column: "timestamp", ascending: false },
    offset,
    limit: pageSize + 1,
  });

  const hasMore = rowsRaw.length > pageSize;
  const pageRows = normalizeRows(rowsRaw.slice(0, pageSize));
  const result: AdminEventParticipantsPage = {
    rows: pageRows,
    hasMore,
    // Cursor por offset: simples e barato no plano free.
    nextCursor: nextOffsetCursor(offset, pageSize, hasMore),
  };
  setCache(adminRsvpsPageCache, cacheKey, result);
  return result;
}

export async function fetchAdminEventSalesPage(options: {
  eventId: string;
  pageSize?: number;
  cursorId?: string | null;
  forceRefresh?: boolean;
}): Promise<AdminEventParticipantsPage> {
  const eventId = options.eventId.trim();
  if (!eventId) return { rows: [], nextCursor: null, hasMore: false };

  const pageSize = boundedLimit(options.pageSize ?? 10, MAX_TICKETS);
  const offset = parseOffsetCursor(options.cursorId);
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `${eventId}:${pageSize}:${offset}`;

  if (!forceRefresh) {
    const cached = getCache(adminSalesPageCache, cacheKey);
    if (cached) return cached;
  }

  const rowsRaw = await selectRows("solicitacoes_ingressos", {
    eq: { eventoId: eventId },
    orderBy: { column: "dataSolicitacao", ascending: false },
    offset,
    limit: pageSize + 1,
  });

  const hasMore = rowsRaw.length > pageSize;
  const pageRows = normalizeRows(rowsRaw.slice(0, pageSize));
  const result: AdminEventParticipantsPage = {
    rows: pageRows,
    hasMore,
    nextCursor: nextOffsetCursor(offset, pageSize, hasMore),
  };
  setCache(adminSalesPageCache, cacheKey, result);
  return result;
}

export async function fetchAdminEventPolls(options: {
  eventId: string;
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<Row[]> {
  const eventId = options.eventId.trim();
  if (!eventId) return [];

  const maxResults = boundedLimit(options.maxResults ?? 40, MAX_POLLS);
  const forceRefresh = options.forceRefresh ?? false;
  const scopedTenantId = resolveEventsTenantId(options.tenantId);
  const cacheKey = `${scopedTenantId || "all"}:${eventId}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(adminPollsCache, cacheKey);
    if (cached) return cached;
  }

  const rows = normalizeRows(
    await selectRows("eventos_enquetes", {
      eq: { eventoId: eventId },
      orderBy: { column: "createdAt", ascending: false },
      limit: maxResults,
      tenantId: scopedTenantId,
    })
  );
  const hydratedRows = await hydrateEventPollRows(rows, { tenantId: scopedTenantId });
  setCache(adminPollsCache, cacheKey, hydratedRows);
  return hydratedRows;
}

export interface EventDetailsBundle {
  evento: Row | null;
  rsvps: Row[];
  comentarios: Row[];
  enquetes: Row[];
  patentes: Row[];
  financeiro: Row | null;
  meusPedidos: Row[];
}

export async function fetchEventDetailsBundle(options: {
  eventId: string;
  userId?: string | null;
  rsvpsLimit?: number;
  commentsLimit?: number;
  pollsLimit?: number;
  pedidosLimit?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<EventDetailsBundle> {
  const eventId = options.eventId.trim();
  if (!eventId) {
    return {
      evento: null,
      rsvps: [],
      comentarios: [],
      enquetes: [],
      patentes: [],
      financeiro: null,
      meusPedidos: [],
    };
  }

  const userId = options.userId?.trim() || "";
  const scopedTenantId = resolveEventsTenantId(options.tenantId);
  const rsvpsLimit = boundedLimit(options.rsvpsLimit ?? DEFAULT_EVENT_DETAILS_RSVPS_LIMIT, MAX_RSVPS);
  const commentsLimit = boundedLimit(
    options.commentsLimit ?? DEFAULT_EVENT_DETAILS_COMMENTS_LIMIT,
    MAX_COMMENTS
  );
  const pollsLimit = boundedLimit(options.pollsLimit ?? DEFAULT_EVENT_DETAILS_POLLS_LIMIT, MAX_POLLS);
  const pedidosLimit = boundedLimit(
    options.pedidosLimit ?? DEFAULT_EVENT_DETAILS_PEDIDOS_LIMIT,
    MAX_TICKETS
  );
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `${scopedTenantId || "all"}:${eventId}:${userId}:${rsvpsLimit}:${commentsLimit}:${pollsLimit}:${pedidosLimit}`;

  if (!forceRefresh) {
    const cached = getCache(detailsCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  const [evento, rsvpsRaw, comentariosRaw, enquetesRaw, patentesRaw, financeiro, meusPedidosRaw] =
    await Promise.all([
      selectEventById(eventId, scopedTenantId),
      selectRows("eventos_rsvps", {
        eq: { eventoId: eventId },
        limit: rsvpsLimit,
        tenantId: scopedTenantId,
      }),
      selectRows("eventos_comentarios", {
        eq: { eventoId: eventId },
        orderBy: { column: "createdAt", ascending: false },
        limit: commentsLimit,
        tenantId: scopedTenantId,
      }),
      selectRows("eventos_enquetes", {
        eq: { eventoId: eventId },
        orderBy: { column: "createdAt", ascending: false },
        limit: pollsLimit,
        tenantId: scopedTenantId,
      }),
      selectRows("patentes_config", {
        orderBy: { column: "minXp", ascending: true },
        limit: 25,
      }),
      fetchFinanceiroConfig(forceRefresh, scopedTenantId),
      userId
        ? (async () => {
            let query = supabase
              .from("solicitacoes_ingressos")
              .select(SOLICITACOES_INGRESSOS_SELECT_COLUMNS)
              .eq("userId", userId)
              .eq("eventoId", eventId)
              .order("dataSolicitacao", { ascending: false });
            if (scopedTenantId) {
              query = query.eq("tenant_id", scopedTenantId);
            }
            const { data, error } = await query.limit(pedidosLimit);
            if (error) throwSupabaseError(error);
            return (data ?? []) as Row[];
          })()
        : Promise.resolve([] as Row[]),
    ]);

  const comentariosWithVisuals = await applyEventCommentAuthorVisuals(comentariosRaw);

  const hydratedPolls = await hydrateEventPollRows(normalizeRows(enquetesRaw), {
    viewerUserId: userId || null,
    tenantId: scopedTenantId,
  });

  const bundle: EventDetailsBundle = {
    evento,
    rsvps: normalizeRows(rsvpsRaw),
    comentarios: normalizeCommentRows(comentariosWithVisuals),
    enquetes: hydratedPolls,
    patentes: normalizeRows(patentesRaw),
    financeiro,
    meusPedidos: normalizeRows(meusPedidosRaw),
  };

  setCache(detailsCache, cacheKey, bundle);
  return bundle;
}

export async function cancelEventTicketRequest(
  requestId: string,
  options?: { tenantId?: string | null }
): Promise<void> {
  const cleanId = requestId.trim();
  if (!cleanId) return;

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveEventsTenantId(options?.tenantId);
  let query = supabase.from("solicitacoes_ingressos").delete().eq("id", cleanId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { error } = await query;
  if (error) throwSupabaseError(error);

  detailsCache.clear();
  adminParticipantsCache.clear();
  adminSalesPageCache.clear();
}

export async function upsertAdminEvent(payload: {
  eventId?: string;
  data: Row;
  actorUserId?: string;
  tenantId?: string | null;
}): Promise<Row | null> {
  const eventId = payload.eventId?.trim() || "";
  const actorUserId = payload.actorUserId?.trim() || "";
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveEventsTenantId(payload.tenantId);
  const rawData = { ...payload.data };
  const saleStatus =
    rawData.sale_status !== undefined ? rawData.sale_status : rawData.saleStatus;
  const paymentConfigSource =
    rawData.payment_config !== undefined ? rawData.payment_config : rawData.paymentConfig;
  delete rawData.saleStatus;
  delete rawData.paymentConfig;
  delete rawData.recipientUserId;
  delete rawData.recipientUserName;
  delete rawData.recipientUserTurma;
  delete rawData.recipientUserAvatar;
  delete rawData.recipientUserIds;
  delete rawData.id;

  const lotes = Array.isArray(rawData.lotes)
    ? rawData.lotes.map((entry: unknown) => {
        const lote = asObject(entry) ?? {};
        return {
          ...lote,
          nome: asString(lote.nome).trim(),
          preco: asString(lote.preco).trim(),
          status: normalizeAvailabilityStatus(lote.status, "ativo"),
          planPrices: normalizePlanPriceEntries(lote.planPrices ?? lote.plan_prices),
        };
      })
    : [];
  const paymentConfig = normalizePaymentConfig(paymentConfigSource);
  const normalizedPayload: Row = pickWritableEventoPayload({
    ...rawData,
    lotes,
    sale_status: normalizeAvailabilityStatus(saleStatus, "ativo"),
    payment_config: paymentConfig,
    ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
  });

  if (eventId) {
    let updateQuery = supabase
      .from("eventos")
      .update({
        ...normalizedPayload,
        updatedAt: nowIso(),
      })
      .eq("id", eventId);
    if (scopedTenantId) {
      updateQuery = updateQuery.eq("tenant_id", scopedTenantId);
    }
    const { error: updateError } = await updateQuery;
    if (updateError) throwSupabaseError(updateError);

    const updated = await selectEventById(eventId, scopedTenantId || undefined);
    invalidateEventCaches(eventId);
    return updated;
  }

  const { data, error } = await supabase
    .from("eventos")
    .insert({
      ...normalizedPayload,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    .select("id")
    .single();

  if (error) throwSupabaseError(error);
  const createdId = asString((data as Row | null)?.id).trim();
  const created =
    (createdId
      ? await selectEventById(createdId, scopedTenantId || undefined)
      : null) ?? normalizeEventRow(data as Row);
  if (actorUserId) {
    try {
      await incrementUserStats(
        actorUserId,
        { eventsCreated: 1 },
        { tenantId: scopedTenantId || undefined }
      );
    } catch (statsError: unknown) {
      console.warn("Eventos: falha ao sincronizar criacao de evento.", statsError);
    }
  }
  invalidateEventCaches(String(created.id || ""));
  return created;
}

export async function deleteAdminEventById(eventId: string): Promise<void> {
  const cleanId = eventId.trim();
  if (!cleanId) return;

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("eventos").delete().eq("id", cleanId);
  if (error) throwSupabaseError(error);
  invalidateEventCaches(cleanId);
}

export async function setAdminEventStatus(payload: {
  eventId: string;
  status: string;
  tenantId?: string | null;
}): Promise<void> {
  await updateEventRow(payload.eventId.trim(), { status: payload.status }, payload.tenantId || undefined);
  invalidateEventCaches(payload.eventId.trim());
}

export async function setAdminEventSaleStatus(payload: {
  eventId: string;
  saleStatus: "ativo" | "em_breve" | "esgotado";
  tenantId?: string | null;
}): Promise<void> {
  await updateEventRow(
    payload.eventId.trim(),
    { sale_status: normalizeAvailabilityStatus(payload.saleStatus, "ativo") },
    payload.tenantId || undefined
  );
  invalidateEventCaches(payload.eventId.trim());
}

export async function setAdminEventLowStock(payload: {
  eventId: string;
  isLowStock: boolean;
}): Promise<void> {
  await updateEventRow(payload.eventId.trim(), { isLowStock: payload.isLowStock });
  invalidateEventCaches(payload.eventId.trim());
}

export async function setAdminTicketPayment(payload: {
  ticketRequestId: string;
  isApproving: boolean;
  approvedBy: string;
}): Promise<void> {
  const ticketRequestId = payload.ticketRequestId.trim();
  if (!ticketRequestId) return;

  const supabase = getSupabaseClient();
  const { data: existingRow, error: existingError } = await supabase
    .from("solicitacoes_ingressos")
    .select("id,eventoId,eventoNome,userName,userTurma,loteNome,quantidade,payment_config")
    .eq("id", ticketRequestId)
    .maybeSingle();
  if (existingError) throwSupabaseError(existingError);

  const normalizedExisting = asObject(existingRow) ?? {};
  const updatePayload: Row = {
    status: payload.isApproving ? "aprovado" : "pendente",
    dataAprovacao: payload.isApproving ? nowIso() : null,
    aprovadoPor: payload.isApproving ? payload.approvedBy : null,
  };
  if (payload.isApproving) {
    updatePayload.payment_config = ensureEventTicketEntries({
      paymentConfig: normalizePaymentConfig(normalizedExisting.payment_config),
      orderId: ticketRequestId,
      quantity: Math.max(1, Math.floor(asNum(normalizedExisting.quantidade, 1))),
      eventId: asString(normalizedExisting.eventoId).trim(),
      eventTitle: asString(normalizedExisting.eventoNome).trim(),
      loteName: asString(normalizedExisting.loteNome).trim(),
      holderName: asString(normalizedExisting.userName).trim(),
      holderTurma: asString(normalizedExisting.userTurma).trim(),
    });
  }

  const { error } = await supabase
    .from("solicitacoes_ingressos")
    .update(updatePayload)
    .eq("id", ticketRequestId);
  if (error) throwSupabaseError(error);

  adminParticipantsCache.clear();
  adminSalesPageCache.clear();
  detailsCache.clear();
}

export async function createAdminEventPoll(payload: {
  eventId: string;
  question: string;
  allowUserOptions: boolean;
  options?: unknown[];
  tenantId?: string | null;
}): Promise<{ id: string }> {
  const eventId = payload.eventId.trim();
  if (!eventId) return { id: "" };
  const scopedTenantId = resolveEventsTenantId(payload.tenantId);
  const event = await selectEventById(eventId, scopedTenantId || undefined);
  if (!event) {
    throw new Error("Evento fora da atlética ativa.");
  }

  const supabase = getSupabaseClient();
  const normalizedOptions = normalizeEventPollOptions(payload.options);
  const { data, error } = await supabase
    .from("eventos_enquetes")
    .insert({
      eventoId: eventId,
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      question: payload.question.trim().slice(0, EVENT_POLL_QUESTION_MAX_CHARS),
      allowUserOptions: payload.allowUserOptions,
      options: normalizedOptions,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    .select("id")
    .single();
  if (error) throwSupabaseError(error);

  invalidateEventCaches(eventId);
  return { id: String(data?.id || "") };
}

export async function deleteAdminEventPoll(payload: {
  eventId: string;
  pollId: string;
  tenantId?: string | null;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveEventsTenantId(payload.tenantId);
  let query = supabase
    .from("eventos_enquetes")
    .delete()
    .eq("id", payload.pollId)
    .eq("eventoId", payload.eventId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { error } = await query;
  if (error) throwSupabaseError(error);
  invalidateEventCaches(payload.eventId);
}

export async function updateAdminEventPollOptions(payload: {
  eventId: string;
  pollId: string;
  options: unknown[];
  tenantId?: string | null;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveEventsTenantId(payload.tenantId);
  let query = supabase
    .from("eventos_enquetes")
    .update({
      options: payload.options,
      updatedAt: nowIso(),
    })
    .eq("id", payload.pollId)
    .eq("eventoId", payload.eventId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { error } = await query;
  if (error) throwSupabaseError(error);
  invalidateEventCaches(payload.eventId);
}

export async function fetchEventTitleById(eventId: string): Promise<string | null> {
  const row = await selectEventById(eventId, resolveEventsTenantId());
  if (!row) return null;
  return typeof row.titulo === "string" ? row.titulo : null;
}

export async function toggleEventLike(payload: {
  eventId: string;
  userId: string;
  currentlyLiked: boolean;
  tenantId?: string | null;
}): Promise<void> {
  const eventId = payload.eventId.trim();
  const userId = payload.userId.trim();
  if (!eventId || !userId) return;

  let becameLiked = !payload.currentlyLiked;

  try {
    const supabase = getSupabaseClient();
    const interactionScope = await resolveEventInteractionScope({
      eventId,
      tenantId: payload.tenantId,
    });
    const scopedTenantId = interactionScope.tenantId;
    if (!interactionScope.eventRow) {
      throw new Error("Evento não encontrado.");
    }
    let existingQuery = supabase
      .from("eventos_likes")
      .select("id")
      .eq("eventoId", eventId)
      .eq("userId", userId);
    if (scopedTenantId) {
      existingQuery = existingQuery.eq("tenant_id", scopedTenantId);
    }

    const { data: existingLike, error: existingError } = await existingQuery.maybeSingle();
    if (existingError) throw existingError;

    if (existingLike?.id) {
      becameLiked = false;
      let deleteQuery = supabase
        .from("eventos_likes")
        .delete()
        .eq("eventoId", eventId)
        .eq("userId", userId);
      if (scopedTenantId) {
        deleteQuery = deleteQuery.eq("tenant_id", scopedTenantId);
      }
      const { error: deleteError } = await deleteQuery;
      if (deleteError) throw deleteError;
    } else {
      becameLiked = true;
      const { error: insertError } = await supabase.from("eventos_likes").insert({
        eventoId: eventId,
        userId,
        ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
        createdAt: nowIso(),
      });
      if (insertError) throw insertError;
    }

    await refreshEventStatsFromRelations(eventId, scopedTenantId);
  } catch (error: unknown) {
    if (!isMissingRelationError(error)) {
      throwSupabaseError(error as { message: string; code?: string | null; name?: string | null });
    }

    becameLiked = !payload.currentlyLiked;
    await updateEventStatsAndLists({
      eventId,
      tenantId: payload.tenantId,
      mutate: ({ stats, likesList }) => {
        const nextLikesList = toggleArrayValue(likesList, userId);
        const currentLikes = asNum((stats as Row).likes, 0);
        const nextLikes = Math.max(0, currentLikes + (nextLikesList.includes(userId) ? 1 : -1));
        return {
          likesList: nextLikesList,
          stats: { ...stats, likes: nextLikes },
        };
      },
    });
  }

  try {
    await incrementUserStats(
      userId,
      { likesGiven: becameLiked ? 1 : -1 },
      { tenantId: payload.tenantId || undefined }
    );
  } catch (statsError: unknown) {
    console.warn("Eventos: falha ao sincronizar like.", statsError);
  }

  invalidateEventCaches(eventId);
}

export async function setEventRsvpDetailed(payload: {
  eventId: string;
  userId: string;
  status: "going" | "maybe";
  userName: string;
  userAvatar: string;
  userTurma: string;
  tenantId?: string | null;
}): Promise<void> {
  const eventId = payload.eventId.trim();
  const userId = payload.userId.trim();
  if (!eventId || !userId) return;

  const supabase = getSupabaseClient();
  const interactionScope = await resolveEventInteractionScope({
    eventId,
    tenantId: payload.tenantId,
  });
  const scopedTenantId = interactionScope.tenantId;
  const eventRow = interactionScope.eventRow;
  if (!eventRow) {
    throw new Error("Evento fora do tenant ativo.");
  }
  let existingQuery = supabase
    .from("eventos_rsvps")
    .select("id, status")
    .eq("eventoId", eventId)
    .eq("userId", userId);
  if (scopedTenantId) {
    existingQuery = existingQuery.eq("tenant_id", scopedTenantId);
  }
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();

  if (existingError) throwSupabaseError(existingError);

  const oldStatus =
    existing?.status === "going" || existing?.status === "maybe"
      ? (existing.status as "going" | "maybe")
      : null;
  const isFirstGoingRsvp = !existing?.id && payload.status === "going";

  // Mantemos comportamento antigo: clicar na mesma opcao remove o RSVP.
  if (oldStatus === payload.status) {
    let deleteQuery = supabase
      .from("eventos_rsvps")
      .delete()
      .eq("eventoId", eventId)
      .eq("userId", userId);
    if (scopedTenantId) {
      deleteQuery = deleteQuery.eq("tenant_id", scopedTenantId);
    }
    const { error: deleteError } = await deleteQuery;
    if (deleteError) throwSupabaseError(deleteError);
  } else {
    if (existing?.id) {
      let updateQuery = supabase
        .from("eventos_rsvps")
        .update({
          status: payload.status,
          userName: payload.userName,
          userAvatar: payload.userAvatar,
          userTurma: payload.userTurma,
          timestamp: nowIso(),
        })
        .eq("eventoId", eventId)
        .eq("userId", userId);
      if (scopedTenantId) {
        updateQuery = updateQuery.eq("tenant_id", scopedTenantId);
      }
      const { error: updateError } = await updateQuery;
      if (updateError) throwSupabaseError(updateError);
    } else {
      const { error: insertError } = await supabase.from("eventos_rsvps").insert({
        eventoId: eventId,
        userId,
        status: payload.status,
        userName: payload.userName,
        userAvatar: payload.userAvatar,
        userTurma: payload.userTurma,
        ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
        timestamp: nowIso(),
      });
      if (insertError) throwSupabaseError(insertError);
    }
  }

  await refreshEventStatsFromRelations(eventId, scopedTenantId);

  if (isFirstGoingRsvp) {
    try {
      await incrementUserStats(
        userId,
        { eventEntries: 1 },
        { tenantId: scopedTenantId || undefined }
      );
    } catch (statsError: unknown) {
      console.warn("Eventos: falha ao sincronizar entrada no evento.", statsError);
    }
  }

  invalidateEventCaches(eventId);
}

export async function createEventComment(payload: {
  eventId: string;
  data: Row;
  tenantId?: string | null;
}): Promise<{ id: string }> {
  const eventId = payload.eventId.trim();
  if (!eventId) return { id: "" };

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveEventsTenantId(
    payload.tenantId ?? asString(payload.data.tenantId)
  );
  const eventRow = await selectEventById(eventId, scopedTenantId);
  if (!eventRow) {
    throw new Error("Evento fora do tenant ativo.");
  }
  const userId = asString(payload.data.userId).trim();
  const visuals = userId ? await fetchCanonicalUserVisuals([userId]) : new Map();
  const visual = userId ? visuals.get(userId) : undefined;

  const visualPatch: Row = visual
    ? {
        userName: visual.nome || payload.data.userName,
        userAvatar: visual.foto || payload.data.userAvatar,
        userTurma: visual.turma || payload.data.userTurma,
        role: visual.role || payload.data.role,
        userPlanoCor: visual.plano_cor,
        userPlanoIcon: visual.plano_icon,
        userPatente: visual.patente,
      }
    : {};

  const safePayloadData: Row = { ...payload.data };
  if (
    (safePayloadData.text === undefined || safePayloadData.text === null) &&
    typeof safePayloadData.texto === "string"
  ) {
    safePayloadData.text = safePayloadData.texto;
  }
  delete safePayloadData.texto;
  delete safePayloadData.userPatenteIcon;
  delete safePayloadData.userPatenteCor;
  delete safePayloadData.tenantId;

  const { data, error } = await supabase
    .from("eventos_comentarios")
    .insert({
      eventoId: eventId,
      ...safePayloadData,
      ...visualPatch,
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    .select("id")
    .single();
  if (error) throwSupabaseError(error);

  if (userId) {
    await incrementUserStats(userId, { commentsCount: 1 });
  }

  invalidateEventCaches(eventId);
  return { id: String(data?.id || "") };
}

export async function toggleEventCommentLike(payload: {
  eventId: string;
  commentId: string;
  userId: string;
  tenantId?: string | null;
}): Promise<string[]> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveEventsTenantId(payload.tenantId);
  let selectQuery = supabase
    .from("eventos_comentarios")
    .select("id, likes, userId")
    .eq("id", payload.commentId)
    .eq("eventoId", payload.eventId);
  if (scopedTenantId) {
    selectQuery = selectQuery.eq("tenant_id", scopedTenantId);
  }
  const { data: row, error: selectError } = await selectQuery.maybeSingle();
  if (selectError) throwSupabaseError(selectError);
  if (!row) return [];

  const currentLikes = asStringArray(row.likes);
  const nextLikes = toggleArrayValue(currentLikes, payload.userId);
  const changed = nextLikes.length !== currentLikes.length;
  if (!changed) return currentLikes;

  let updateQuery = supabase
    .from("eventos_comentarios")
    .update({ likes: nextLikes, updatedAt: nowIso() })
    .eq("id", payload.commentId)
    .eq("eventoId", payload.eventId);
  if (scopedTenantId) {
    updateQuery = updateQuery.eq("tenant_id", scopedTenantId);
  }
  const { error: updateError } = await updateQuery;
  if (updateError) throwSupabaseError(updateError);

  const authorId = typeof row.userId === "string" ? row.userId : "";
  const diff = nextLikes.includes(payload.userId) ? 1 : -1;
  if (authorId && authorId !== payload.userId) {
    await incrementUserStats(authorId, { likesReceived: diff });
    await incrementUserStats(payload.userId, { likesGiven: diff });
  }

  invalidateEventCaches(payload.eventId);
  return nextLikes;
}

export async function deleteEventComment(payload: {
  eventId: string;
  commentId: string;
  tenantId?: string | null;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveEventsTenantId(payload.tenantId);
  let query = supabase
    .from("eventos_comentarios")
    .delete()
    .eq("id", payload.commentId)
    .eq("eventoId", payload.eventId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { error } = await query;
  if (error) throwSupabaseError(error);
  invalidateEventCaches(payload.eventId);
}

export async function reportEventComment(payload: {
  eventId: string;
  commentId: string;
  userId: string;
  tenantId?: string | null;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveEventsTenantId(payload.tenantId);
  let selectQuery = supabase
    .from("eventos_comentarios")
    .select("reports")
    .eq("id", payload.commentId)
    .eq("eventoId", payload.eventId);
  if (scopedTenantId) {
    selectQuery = selectQuery.eq("tenant_id", scopedTenantId);
  }
  const { data: row, error: selectError } = await selectQuery.maybeSingle();
  if (selectError) throwSupabaseError(selectError);
  if (!row) return;

  const currentReports = asStringArray(row.reports);
  if (currentReports.includes(payload.userId)) return;

  let updateQuery = supabase
    .from("eventos_comentarios")
    .update({
      reports: [...currentReports, payload.userId],
      updatedAt: nowIso(),
    })
    .eq("id", payload.commentId)
    .eq("eventoId", payload.eventId);
  if (scopedTenantId) {
    updateQuery = updateQuery.eq("tenant_id", scopedTenantId);
  }
  const { error: updateError } = await updateQuery;
  if (updateError) throwSupabaseError(updateError);
  invalidateEventCaches(payload.eventId);
}

export async function setEventCommentHidden(payload: {
  eventId: string;
  commentId: string;
  hidden: boolean;
  tenantId?: string | null;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveEventsTenantId(payload.tenantId);
  let query = supabase
    .from("eventos_comentarios")
    .update({ hidden: payload.hidden, updatedAt: nowIso() })
    .eq("id", payload.commentId)
    .eq("eventoId", payload.eventId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { error } = await query;
  if (error) throwSupabaseError(error);
  invalidateEventCaches(payload.eventId);
}

export async function voteEventPollOption(payload: {
  eventId: string;
  pollId: string;
  userId: string;
  userTurma: string;
  optionIndex: number;
  tenantId?: string | null;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveEventsTenantId(payload.tenantId);
  let selectQuery = supabase
    .from("eventos_enquetes")
    .select("options")
    .eq("id", payload.pollId)
    .eq("eventoId", payload.eventId);
  if (scopedTenantId) {
    selectQuery = selectQuery.eq("tenant_id", scopedTenantId);
  }
  const { data: pollRow, error: selectError } = await selectQuery.maybeSingle();
  if (selectError) throwSupabaseError(selectError);
  if (!pollRow) throw new Error("Enquete não existe");

  const options = Array.isArray(pollRow.options) ? [...pollRow.options] : [];
  const index = payload.optionIndex;
  if (index < 0 || index >= options.length) {
    throw new Error("Opcao invalida");
  }

  let shouldCountPollAnswer = false;

  try {
    let votesQuery = supabase
      .from("eventos_enquete_votos")
      .select("id, optionIndex")
      .eq("enqueteId", payload.pollId)
      .eq("userId", payload.userId);
    if (scopedTenantId) {
      votesQuery = votesQuery.eq("tenant_id", scopedTenantId);
    }

    const { data: currentVotesRows, error: currentVotesError } = await votesQuery;
    if (currentVotesError) throw currentVotesError;

    const currentVotes = ((currentVotesRows ?? []) as Row[])
      .map((entry) => Number(entry.optionIndex))
      .filter((value) => Number.isFinite(value))
      .map((value) => Math.floor(value));

    if (currentVotes.includes(index)) {
      invalidateEventCaches(payload.eventId);
      return;
    }

    const { error: insertError } = await supabase.from("eventos_enquete_votos").insert({
      enqueteId: payload.pollId,
      eventoId: payload.eventId,
      userId: payload.userId,
      optionIndex: index,
      userTurma: (payload.userTurma || "Geral").trim() || "Geral",
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      createdAt: nowIso(),
    });
    if (insertError) {
      const insertCode =
        typeof insertError === "object" && insertError !== null && "code" in insertError
          ? String((insertError as { code?: unknown }).code || "")
          : "";
      if (insertCode === "23505") {
        invalidateEventCaches(payload.eventId);
        return;
      }
      throw insertError;
    }
    shouldCountPollAnswer = currentVotes.length === 0;
  } catch (error: unknown) {
    if (!isMissingRelationError(error)) {
      if (error instanceof Error) throw error;
      throwSupabaseError(error as { message: string; code?: string | null; name?: string | null });
    }

    let legacyPollQuery = supabase
      .from("eventos_enquetes")
      .select("options, userVotes, voters")
      .eq("id", payload.pollId)
      .eq("eventoId", payload.eventId);
    if (scopedTenantId) {
      legacyPollQuery = legacyPollQuery.eq("tenant_id", scopedTenantId);
    }
    const { data: legacyPollRow, error: legacySelectError } = await legacyPollQuery.maybeSingle();
    if (legacySelectError) throwSupabaseError(legacySelectError);
    if (!legacyPollRow) throw new Error("Enquete não existe");

    const legacyOptions = Array.isArray(legacyPollRow.options) ? [...legacyPollRow.options] : [];
    const legacyUserVotesMap = asObject(legacyPollRow.userVotes) ?? {};
    const legacyUserVoteEntry = legacyUserVotesMap[payload.userId];
    const myVotes = Array.isArray(legacyUserVoteEntry)
      ? legacyUserVoteEntry.filter((v): v is number => typeof v === "number")
      : [];

    const optionObj = asObject(legacyOptions[index]) ?? {};
    const votesByTurma = asObject(optionObj.votesByTurma) ?? {};
    const turmaKey = (payload.userTurma || "Geral").trim() || "Geral";

    if (myVotes.includes(index)) {
      invalidateEventCaches(payload.eventId);
      return;
    }

    optionObj.votes = asNum(optionObj.votes, 0) + 1;
    votesByTurma[turmaKey] = asNum(votesByTurma[turmaKey], 0) + 1;
    optionObj.votesByTurma = votesByTurma;
    legacyOptions[index] = optionObj;
    legacyUserVotesMap[payload.userId] = [...myVotes, index];

    const voters = asStringArray(legacyPollRow.voters);
    shouldCountPollAnswer = !voters.includes(payload.userId) && !myVotes.includes(index);
    const nextVoters = voters.includes(payload.userId) ? voters : [...voters, payload.userId];

    let updateQuery = supabase
      .from("eventos_enquetes")
      .update({
        options: legacyOptions,
        userVotes: legacyUserVotesMap,
        voters: nextVoters,
        updatedAt: nowIso(),
      })
      .eq("id", payload.pollId)
      .eq("eventoId", payload.eventId);
    if (scopedTenantId) {
      updateQuery = updateQuery.eq("tenant_id", scopedTenantId);
    }
    const { error: updateError } = await updateQuery;
    if (updateError) throwSupabaseError(updateError);
  }

  if (shouldCountPollAnswer) {
    try {
      await incrementUserStats(
        payload.userId,
        { pollAnswers: 1 },
        { tenantId: scopedTenantId || undefined }
      );
    } catch (statsError: unknown) {
      console.warn("Eventos: falha ao sincronizar resposta de enquete.", statsError);
    }
  }

  invalidateEventCaches(payload.eventId);
}

export async function addEventPollOption(payload: {
  eventId: string;
  pollId: string;
  option: Row;
  autoVoteUserId?: string;
  autoVoteUserTurma?: string;
  tenantId?: string | null;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveEventsTenantId(payload.tenantId);
  let selectQuery = supabase
    .from("eventos_enquetes")
    .select("options, allowUserOptions")
    .eq("id", payload.pollId)
    .eq("eventoId", payload.eventId);
  if (scopedTenantId) {
    selectQuery = selectQuery.eq("tenant_id", scopedTenantId);
  }
  const { data: row, error: selectError } = await selectQuery.maybeSingle();
  if (selectError) throwSupabaseError(selectError);
  if (!row) return;

  const currentOptions = normalizeEventPollOptions(row.options);
  const nextOption = normalizeEventPollOptionRecord(payload.option);
  if (!nextOption) {
    throw new Error("Resposta invalida.");
  }

  const creatorId = asString(nextOption.creatorId).trim();
  const isUserGeneratedOption =
    Boolean(asString(payload.autoVoteUserId).trim()) && creatorId.length > 0;

  if (isUserGeneratedOption && row.allowUserOptions === false) {
    throw new Error("Essa enquete não aceita novas respostas.");
  }
  if (currentOptions.length >= EVENT_POLL_OPTION_MAX_COUNT) {
    throw new Error(`Cada enquete aceita no maximo ${EVENT_POLL_OPTION_MAX_COUNT} respostas.`);
  }
  if (
    currentOptions.some(
      (entry) => entry.text.trim().toLowerCase() === nextOption.text.trim().toLowerCase()
    )
  ) {
    throw new Error("Essa resposta ja existe na enquete.");
  }
  if (
    isUserGeneratedOption &&
    currentOptions.some((entry) => asString(entry.creatorId).trim() === creatorId)
  ) {
    throw new Error("Cada usuário pode sugerir no máximo uma nova resposta por enquete.");
  }

  let updateQuery = supabase
    .from("eventos_enquetes")
    .update({
      options: [...currentOptions, nextOption],
      updatedAt: nowIso(),
    })
    .eq("id", payload.pollId)
    .eq("eventoId", payload.eventId);
  if (scopedTenantId) {
    updateQuery = updateQuery.eq("tenant_id", scopedTenantId);
  }
  const { error: updateError } = await updateQuery;
  if (updateError) throwSupabaseError(updateError);

  const autoVoteUserId = asString(payload.autoVoteUserId).trim();
  if (autoVoteUserId) {
    await voteEventPollOption({
      eventId: payload.eventId,
      pollId: payload.pollId,
      userId: autoVoteUserId,
      userTurma: asString(payload.autoVoteUserTurma, "Geral").trim() || "Geral",
      optionIndex: currentOptions.length,
      tenantId: scopedTenantId,
    });
    return;
  }

  invalidateEventCaches(payload.eventId);
}

export async function incrementEventPurchaseUserStats(payload: {
  userId: string;
  isApproving: boolean;
  valorGasto: number;
  lotName?: string;
  eventType?: string;
  eventTitle?: string;
}): Promise<void> {
  const userId = payload.userId.trim();
  if (!userId || !Number.isFinite(payload.valorGasto)) return;

  const diff = payload.isApproving ? 1 : -1;
  const normalize = (value: string | undefined): string =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const hasAnyToken = (haystack: string, tokens: string[]): boolean =>
    tokens.some((token) => haystack.includes(token));

  const lotText = normalize(payload.lotName);
  const eventText = `${normalize(payload.eventType)} ${normalize(payload.eventTitle)}`.trim();
  const isPromo = hasAnyToken(lotText, ["promo", "promocional", "desconto"]);
  const isAcademic = hasAnyToken(eventText, [
    "academ",
    "liga",
    "palestra",
    "workshop",
    "simposio",
    "congresso",
  ]);
  const isSocial = hasAnyToken(eventText, [
    "acao social",
    "social",
    "benefic",
    "solidar",
    "campanha",
    "volunt",
    "doacao",
  ]);

  const deltas: Record<string, number> = {
    eventsBought: diff,
    totalSpentEvents: payload.isApproving ? payload.valorGasto : -payload.valorGasto,
  };

  if (isPromo) {
    deltas.promoTicketsBought = diff;
  }
  if (isAcademic) {
    deltas.academicEvents = diff;
  }
  if (isSocial) {
    deltas.socialActions = diff;
  }

  await incrementUserStats(userId, deltas);
}

export function clearEventsNativeCaches(): void {
  invalidateEventCaches();
}

export type { DateLike };
