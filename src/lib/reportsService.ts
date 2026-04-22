import { httpsCallable } from "@/lib/supa/functions";

import { functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { getSupabaseClient } from "./supabase";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const ADMIN_REPORT_CACHE_TTL_MS = 45_000;
const USER_SUPPORT_CACHE_TTL_MS = 30_000;

const MAX_ADMIN_REPORT_RESULTS = 240;
const MAX_USER_SUPPORT_RESULTS = 80;
const REPORT_TABLE_SELECT_COLUMNS: Record<string, string[]> = {
  banned_appeals: [
    "id",
    "userName",
    "userId",
    "message",
    "status",
    "response",
    "createdAt",
    "createdAtMs",
    "updatedAt",
  ],
  support_requests: [
    "id",
    "userId",
    "userName",
    "category",
    "subject",
    "message",
    "module",
    "status",
    "response",
    "createdAt",
    "createdAtMs",
    "updatedAt",
  ],
  denuncias: [
    "id",
    "reporterId",
    "reporterName",
    "targetId",
    "targetType",
    "reason",
    "content",
    "status",
    "timestamp",
  ],
};

const SUBMIT_SUPPORT_CALLABLE = "supportSubmitRequest";
const RESOLVE_BANNED_CALLABLE = "adminResolveBannedAppeal";
const RESOLVE_SUPPORT_CALLABLE = "adminResolveSupportRequest";
const DELETE_BANNED_CALLABLE = "adminDeleteBannedAppeal";
const DELETE_SUPPORT_CALLABLE = "adminDeleteSupportRequest";
const FETCH_BANNED_REPORTS_CALLABLE = "adminGetBannedAppeals";
const FETCH_SUPPORT_REPORTS_CALLABLE = "adminGetSupportReports";
const FETCH_USER_SUPPORT_CALLABLE = "supportGetMyRequests";

type ReportStatus = "pendente" | "resolvida";

export type AdminReportOrigin = "banned_appeals" | "support_requests";

export interface AdminReportRecord {
  id: string;
  autor: string;
  registeredName?: string;
  registeredTenantId?: string;
  registeredTenantName?: string;
  registeredTenantSlug?: string;
  registeredTenantSigla?: string;
  alvo?: string;
  categoria: "banidos" | "suporte";
  motivo: string;
  descricao: string;
  data: string;
  createdAtMs: number;
  status: ReportStatus;
  respostaAdmin?: string;
  originCollection: AdminReportOrigin;
  reporterId?: string;
}

export type AdminModerationCategory = "comunidade" | "gym";

export interface AdminModerationRecord {
  id: string;
  categoria: AdminModerationCategory;
  autor: string;
  mensagem: string;
  status: "pendente" | "resolvida";
  data: string;
  createdAtMs: number;
  reporterId?: string;
  targetId?: string;
  targetType?: string;
  motivo?: string;
}

export type SupportCategory =
  | "geral"
  | "financeiro"
  | "conta"
  | "bug"
  | "denuncia"
  | "sugestorias"
  | "outro";

export interface SupportTicketRecord {
  id: string;
  category: SupportCategory;
  subject: string;
  message: string;
  status: "pending" | "resolved";
  response?: string;
  createdAtMs: number;
  createdAtLabel: string;
}

const adminReportsCache = new Map<string, CacheEntry<AdminReportRecord[]>>();
const userSupportCache = new Map<string, CacheEntry<SupportTicketRecord[]>>();
const inFlightRequests = new Map<string, Promise<unknown>>();

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

const getCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  ttlMs: number
): T | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > ttlMs) {
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

const clearReportsCache = (): void => {
  adminReportsCache.clear();
  userSupportCache.clear();
};

const withInFlight = async <T>(
  key: string,
  runner: () => Promise<T>
): Promise<T> => {
  const existing = inFlightRequests.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const request = runner().finally(() => {
    inFlightRequests.delete(key);
  });
  inFlightRequests.set(key, request);
  return request;
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

const getReportSelectColumns = (tableName: string): string[] =>
  [...(REPORT_TABLE_SELECT_COLUMNS[tableName] ?? ["id", "createdAt"])];

const isMissingTableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const raw = error as { code?: unknown; message?: unknown };
  if (typeof raw.code === "string" && raw.code === "42P01") return true;
  const message = asString(raw.message).toLowerCase();
  return message.includes("relation") && message.includes("does not exist");
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

const fetchRowsWithFallback = async (payload: {
  table: string;
  maxResults: number;
  orderField?: string;
  filters?: Array<{ field: string; value: unknown }>;
  ignoreMissingTable?: boolean;
}): Promise<Array<Record<string, unknown>>> => {
  const supabase = getSupabaseClient();
  let selectColumns = getReportSelectColumns(payload.table);
  let canOrder = Boolean(payload.orderField);

  while (selectColumns.length > 0) {
    let request = supabase
      .from(payload.table)
      .select(selectColumns.join(","))
      .limit(payload.maxResults);

    (payload.filters ?? []).forEach((filter) => {
      request = request.eq(filter.field, filter.value);
    });

    if (canOrder && payload.orderField) {
      request = request.order(payload.orderField, { ascending: false });
    }

    const { data, error } = await request;
    if (!error) {
      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
      return rows.map((row) => ({ ...row }));
    }

    if (payload.ignoreMissingTable && isMissingTableError(error)) {
      return [];
    }

    const missingColumn = asString(extractMissingSchemaColumn(error)).trim();
    if (missingColumn) {
      if (
        canOrder &&
        payload.orderField &&
        missingColumn.toLowerCase() === payload.orderField.toLowerCase()
      ) {
        canOrder = false;
        continue;
      }

      const nextColumns = selectColumns.filter(
        (column) => column.toLowerCase() !== missingColumn.toLowerCase()
      );
      if (nextColumns.length > 0 && nextColumns.length < selectColumns.length) {
        selectColumns = nextColumns;
        continue;
      }
    }

    if (canOrder && payload.orderField) {
      canOrder = false;
      continue;
    }

    throwSupabaseError(error);
  }

  return [];
};

const fetchRowsByIdsWithFallback = async (payload: {
  table: string;
  idField: string;
  ids: string[];
  selectColumns: string[];
}): Promise<Array<Record<string, unknown>>> => {
  const ids = Array.from(
    new Set(payload.ids.map((entry) => entry.trim()).filter((entry) => entry.length > 0))
  );
  if (ids.length === 0) return [];

  const supabase = getSupabaseClient();
  let selectColumns = [...payload.selectColumns];

  while (selectColumns.length > 0) {
    const { data, error } = await supabase
      .from(payload.table)
      .select(selectColumns.join(","))
      .in(payload.idField, ids);
    if (!error) {
      return (data ?? []) as unknown as Array<Record<string, unknown>>;
    }

    if (isMissingTableError(error)) return [];

    const missingColumn = asString(extractMissingSchemaColumn(error)).trim();
    if (!missingColumn || missingColumn.toLowerCase() === payload.idField.toLowerCase()) {
      throwSupabaseError(error);
    }

    const nextColumns = selectColumns.filter(
      (column) => column.toLowerCase() !== missingColumn.toLowerCase()
    );
    if (nextColumns.length === 0 || nextColumns.length === selectColumns.length) {
      throwSupabaseError(error);
    }
    selectColumns = nextColumns;
  }

  return [];
};

const toMillis = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === "object" && value !== null) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === "function") {
      const date = toDate.call(value) as Date;
      if (date instanceof Date) return date.getTime();
    }
  }
  return 0;
};

const toDateLabel = (value: unknown): string => {
  const ms = toMillis(value);
  if (!ms) return "Data desconhecida";
  return new Date(ms).toLocaleString("pt-BR");
};

const toReportStatus = (value: unknown): ReportStatus => {
  const status = asString(value).toLowerCase();
  if (status === "resolved" || status === "resolvida") return "resolvida";
  return "pendente";
};

const normalizeSupportCategory = (value: unknown): SupportCategory => {
  const category = asString(value).toLowerCase();
  if (
    category === "geral" ||
    category === "financeiro" ||
    category === "conta" ||
    category === "bug" ||
    category === "denuncia" ||
    category === "sugestorias" ||
    category === "outro"
  ) {
    return category;
  }
  return "geral";
};

const supportCategoryLabel = (category: SupportCategory): string => {
  switch (category) {
    case "financeiro":
      return "Financeiro";
    case "conta":
      return "Conta";
    case "bug":
      return "Bug";
    case "denuncia":
      return "Denúncia";
    case "sugestorias":
      return "Sugestões";
    case "outro":
      return "Outro";
    default:
      return "Geral";
  }
};

const buildBannedAppealRecord = (
  id: string,
  raw: unknown
): AdminReportRecord | null => {
  const obj = asObject(raw);
  if (!obj) return null;

  const createdAtMs = asNumber(obj.createdAtMs, toMillis(obj.createdAt));

  return {
    id,
    autor: asString(obj.userName, "Usuário Desconhecido"),
    alvo: "Administracao",
    categoria: "banidos",
    motivo: "Solicitação de Desbloqueio",
    descricao: asString(obj.message).slice(0, 5_000),
    data: createdAtMs ? new Date(createdAtMs).toLocaleString("pt-BR") : toDateLabel(obj.createdAt),
    createdAtMs,
    status: toReportStatus(obj.status),
    respostaAdmin: asString(obj.response) || undefined,
    originCollection: "banned_appeals",
    reporterId: asString(obj.userId) || undefined,
  };
};

const buildSupportRecord = (id: string, raw: unknown): AdminReportRecord | null => {
  const obj = asObject(raw);
  if (!obj) return null;

  const category = normalizeSupportCategory(obj.category);
  const subject = asString(obj.subject, "Suporte").trim();
  const createdAtMs = asNumber(obj.createdAtMs, toMillis(obj.createdAt));

  return {
    id,
    autor: asString(obj.userName, "Usuário"),
    alvo: "Suporte do app",
    categoria: "suporte",
    motivo: subject || `Chamado (${supportCategoryLabel(category)})`,
    descricao: asString(obj.message).slice(0, 5_000),
    data: createdAtMs ? new Date(createdAtMs).toLocaleString("pt-BR") : toDateLabel(obj.createdAt),
    createdAtMs,
    status: toReportStatus(obj.status),
    respostaAdmin: asString(obj.response) || undefined,
    originCollection: "support_requests",
    reporterId: asString(obj.userId) || undefined,
  };
};

const enrichReportsWithRegistration = async (
  reports: AdminReportRecord[]
): Promise<AdminReportRecord[]> => {
  const reporterIds = Array.from(
    new Set(
      reports
        .map((report) => report.reporterId?.trim() || "")
        .filter((entry) => entry.length > 0)
    )
  );
  if (reporterIds.length === 0) return reports;

  const userRows = await fetchRowsByIdsWithFallback({
    table: "users",
    idField: "uid",
    ids: reporterIds,
    selectColumns: ["uid", "nome", "tenant_id"],
  });
  const usersById = new Map<string, Record<string, unknown>>();
  const tenantIds = new Set<string>();

  userRows.forEach((row) => {
    const uid = asString(row.uid).trim();
    if (!uid) return;
    usersById.set(uid, row);
    const tenantId = asString(row.tenant_id).trim();
    if (tenantId) tenantIds.add(tenantId);
  });

  const tenantRows = await fetchRowsByIdsWithFallback({
    table: "tenants",
    idField: "id",
    ids: Array.from(tenantIds),
    selectColumns: ["id", "nome", "sigla", "slug"],
  });
  const tenantsById = new Map<string, Record<string, unknown>>();
  tenantRows.forEach((row) => {
    const id = asString(row.id).trim();
    if (id) tenantsById.set(id, row);
  });

  return reports.map((report) => {
    const userRow = report.reporterId ? usersById.get(report.reporterId.trim()) : null;
    if (!userRow) return report;

    const tenantId = asString(userRow.tenant_id).trim();
    const tenantRow = tenantId ? tenantsById.get(tenantId) : null;
    const tenantName = asString(tenantRow?.nome).trim();
    const tenantSigla = asString(tenantRow?.sigla).trim();
    const tenantSlug = asString(tenantRow?.slug).trim();
    const registeredName = asString(userRow.nome).trim();

    return {
      ...report,
      ...(registeredName ? { registeredName } : {}),
      ...(tenantId ? { registeredTenantId: tenantId } : {}),
      ...(tenantName || tenantSigla ? { registeredTenantName: tenantName || tenantSigla } : {}),
      ...(tenantSlug ? { registeredTenantSlug: tenantSlug } : {}),
      ...(tenantSigla ? { registeredTenantSigla: tenantSigla } : {}),
    };
  });
};

const normalizeModerationStatus = (value: unknown): "pendente" | "resolvida" => {
  const status = asString(value).toLowerCase();
  if (status === "resolved" || status === "resolvida") return "resolvida";
  return "pendente";
};

const buildCommunityModerationRecord = (
  id: string,
  raw: unknown
): AdminModerationRecord | null => {
  const obj = asObject(raw);
  if (!obj) return null;

  const createdAtMs = toMillis(obj.timestamp ?? obj.createdAt);
  const motivo = asString(obj.reason).trim();
  const conteudo = asString(obj.content).trim();
  const mensagem = [motivo, conteudo].filter(Boolean).join(" - ").slice(0, 5_000);

  return {
    id,
    categoria: "comunidade",
    autor: asString(obj.reporterName, "Usuário"),
    mensagem: mensagem || "Conteúdo denunciado na comunidade.",
    status: normalizeModerationStatus(obj.status),
    data: createdAtMs ? new Date(createdAtMs).toLocaleString("pt-BR") : "Data desconhecida",
    createdAtMs,
    reporterId: asString(obj.reporterId) || undefined,
    targetId: asString(obj.targetId) || undefined,
    targetType: asString(obj.targetType) || undefined,
    motivo: motivo || undefined,
  };
};

const isGymRelatedSupport = (raw: Record<string, unknown>): boolean => {
  const category = normalizeSupportCategory(raw.category);
  if (category !== "denuncia") return false;

  const moduleHint = asString(raw.module).toLowerCase();
  if (moduleHint.includes("gym") || moduleHint.includes("treino")) return true;

  const joined = `${asString(raw.subject)} ${asString(raw.message)}`.toLowerCase();
  return (
    joined.includes("gym") ||
    joined.includes("academia") ||
    joined.includes("treino") ||
    joined.includes("checkin") ||
    joined.includes("check-in") ||
    joined.includes("qr")
  );
};

const buildGymModerationRecord = (
  id: string,
  raw: unknown
): AdminModerationRecord | null => {
  const obj = asObject(raw);
  if (!obj) return null;
  if (!isGymRelatedSupport(obj)) return null;

  const createdAtMs = asNumber(obj.createdAtMs, toMillis(obj.createdAt));
  const subject = asString(obj.subject, "Denúncia Gym").trim();
  const message = asString(obj.message).trim();

  return {
    id,
    categoria: "gym",
    autor: asString(obj.userName, "Usuário"),
    mensagem: `${subject}${message ? ` - ${message}` : ""}`.slice(0, 5_000),
    status: normalizeModerationStatus(obj.status),
    data: createdAtMs ? new Date(createdAtMs).toLocaleString("pt-BR") : "Data desconhecida",
    createdAtMs,
    reporterId: asString(obj.userId) || undefined,
    motivo: subject || undefined,
  };
};

export async function fetchBannedAppeals(
  maxResults = 200,
  options?: { tenantId?: string | null }
): Promise<AdminReportRecord[]> {
  const safeLimit = boundedLimit(maxResults, MAX_ADMIN_REPORT_RESULTS);
  const tenantId = resolveStoredTenantScopeId(asString(options?.tenantId).trim());
  const cacheKey = `banned:${safeLimit}:${tenantId || "all"}`;
  const cached = getCachedValue(adminReportsCache, cacheKey, ADMIN_REPORT_CACHE_TTL_MS);
  if (cached) return cached;

  return withInFlight(cacheKey, async () => {
    const response = await callWithFallback<
      { maxResults: number },
      { reports: Array<Record<string, unknown>> }
    >(
      FETCH_BANNED_REPORTS_CALLABLE,
      { maxResults: safeLimit },
      async () => {
        const reports = await fetchRowsWithFallback({
          table: "banned_appeals",
          maxResults: safeLimit,
          orderField: "createdAt",
          ...(tenantId ? { filters: [{ field: "tenant_id", value: tenantId }] } : {}),
          ignoreMissingTable: true,
        });
        return { reports };
      }
    );

    const reports = response.reports
      .map((row) => buildBannedAppealRecord(asString(row.id), row))
      .filter((item): item is AdminReportRecord => item !== null);

    setCachedValue(adminReportsCache, cacheKey, reports);
    return reports;
  });
}

export async function fetchSupportReports(
  maxResults = 200,
  options?: { tenantId?: string | null }
): Promise<AdminReportRecord[]> {
  const safeLimit = boundedLimit(maxResults, MAX_ADMIN_REPORT_RESULTS);
  const tenantId = resolveStoredTenantScopeId(asString(options?.tenantId).trim());
  const cacheKey = `support:${safeLimit}:${tenantId || "all"}`;
  const cached = getCachedValue(adminReportsCache, cacheKey, ADMIN_REPORT_CACHE_TTL_MS);
  if (cached) return cached;

  return withInFlight(cacheKey, async () => {
    const response = await callWithFallback<
      { maxResults: number },
      { reports: Array<Record<string, unknown>> }
    >(
      FETCH_SUPPORT_REPORTS_CALLABLE,
      { maxResults: safeLimit },
      async () => {
        const reports = await fetchRowsWithFallback({
          table: "support_requests",
          maxResults: safeLimit,
          orderField: "createdAt",
          ...(tenantId ? { filters: [{ field: "tenant_id", value: tenantId }] } : {}),
          ignoreMissingTable: true,
        });
        return { reports };
      }
    );

    const reports = response.reports
      .map((row) => buildSupportRecord(asString(row.id), row))
      .filter((item): item is AdminReportRecord => item !== null);
    const enrichedReports = await enrichReportsWithRegistration(reports);

    setCachedValue(adminReportsCache, cacheKey, enrichedReports);
    return enrichedReports;
  });
}

export async function fetchCommunityModerationReports(
  maxResults = 200,
  options?: { tenantId?: string }
): Promise<AdminModerationRecord[]> {
  const safeLimit = boundedLimit(maxResults, MAX_ADMIN_REPORT_RESULTS);
  const tenantId = resolveStoredTenantScopeId(options?.tenantId);
  const cacheKey = `community:${safeLimit}:${tenantId || "all"}`;
  const cached = getCachedValue(adminReportsCache, cacheKey, ADMIN_REPORT_CACHE_TTL_MS);
  if (cached) return cached as unknown as AdminModerationRecord[];

  return withInFlight(cacheKey, async () => {
    const rows = await fetchRowsWithFallback({
      table: "denuncias",
      maxResults: safeLimit,
      orderField: "timestamp",
      ...(tenantId ? { filters: [{ field: "tenant_id", value: tenantId }] } : {}),
      ignoreMissingTable: true,
    });

    const reports = rows
      .map((row) => buildCommunityModerationRecord(asString(row.id), row))
      .filter((item): item is AdminModerationRecord => item !== null)
      .sort((left, right) => right.createdAtMs - left.createdAtMs);

    setCachedValue(
      adminReportsCache,
      cacheKey,
      reports as unknown as AdminReportRecord[]
    );
    return reports;
  });
}

export async function fetchGymModerationReports(
  maxResults = 200,
  options?: { tenantId?: string | null }
): Promise<AdminModerationRecord[]> {
  const safeLimit = boundedLimit(maxResults, MAX_ADMIN_REPORT_RESULTS);
  const tenantId = resolveStoredTenantScopeId(asString(options?.tenantId).trim());
  const cacheKey = `gym:${safeLimit}:${tenantId || "all"}`;
  const cached = getCachedValue(adminReportsCache, cacheKey, ADMIN_REPORT_CACHE_TTL_MS);
  if (cached) return cached as unknown as AdminModerationRecord[];

  return withInFlight(cacheKey, async () => {
    const rows = await fetchRowsWithFallback({
      table: "support_requests",
      maxResults: safeLimit,
      orderField: "createdAt",
      filters: [
        { field: "category", value: "denuncia" },
        ...(tenantId ? [{ field: "tenant_id", value: tenantId }] : []),
      ],
      ignoreMissingTable: true,
    });

    const reports = rows
      .map((row) => buildGymModerationRecord(asString(row.id), row))
      .filter((item): item is AdminModerationRecord => item !== null)
      .sort((left, right) => right.createdAtMs - left.createdAtMs);

    setCachedValue(
      adminReportsCache,
      cacheKey,
      reports as unknown as AdminReportRecord[]
    );
    return reports;
  });
}

export async function resolveAdminReport(payload: {
  reportId: string;
  originCollection: AdminReportOrigin;
  response: string;
  reporterId?: string;
  tenantId?: string | null;
}): Promise<void> {
  const reportId = payload.reportId.trim();
  const response = payload.response.trim().slice(0, 2_000);
  if (!reportId || !response) return;
  const tenantId = resolveStoredTenantScopeId(asString(payload.tenantId).trim());

  const callableName =
    payload.originCollection === "banned_appeals"
      ? RESOLVE_BANNED_CALLABLE
      : RESOLVE_SUPPORT_CALLABLE;

  const requestPayload = {
    reportId,
    response,
    reporterId: payload.reporterId?.trim() || "",
    tenantId: tenantId || undefined,
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    callableName,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      const now = new Date().toISOString();
      let reportQuery = supabase
        .from(payload.originCollection)
        .update({
          response,
          status: "resolved",
          readByAdmin: true,
          resolvedAt: now,
          updatedAt: now,
        })
        .eq("id", reportId);
      if (tenantId) {
        reportQuery = reportQuery.eq("tenant_id", tenantId);
      }
      const { error: reportError } = await reportQuery;
      if (reportError) {
        throwSupabaseError(reportError);
      }

      if (payload.reporterId?.trim()) {
        const { error: notificationError } = await supabase.from("notifications").insert({
          userId: payload.reporterId.trim(),
          ...(tenantId ? { tenant_id: tenantId } : {}),
          title:
            payload.originCollection === "banned_appeals"
              ? "Apelação analisada"
              : "Chamado atualizado",
          message:
            payload.originCollection === "banned_appeals"
              ? "Sua apelação de bloqueio recebeu resposta da diretoria."
              : "O suporte respondeu seu chamado.",
          link:
            payload.originCollection === "banned_appeals"
              ? "/banned"
              : "/configuracoes/suporte",
          read: false,
          type:
            payload.originCollection === "banned_appeals"
              ? "appeal_response"
              : "support_response",
          createdAt: now,
        });
        if (notificationError) {
          throwSupabaseError(notificationError);
        }
      }

      return { ok: true };
    }
  );

  clearReportsCache();
}

export async function deleteAdminReport(payload: {
  reportId: string;
  originCollection: AdminReportOrigin;
  tenantId?: string | null;
}): Promise<void> {
  const reportId = payload.reportId.trim();
  if (!reportId) return;
  const tenantId = resolveStoredTenantScopeId(asString(payload.tenantId).trim());

  const callableName =
    payload.originCollection === "banned_appeals"
      ? DELETE_BANNED_CALLABLE
      : DELETE_SUPPORT_CALLABLE;

  await callWithFallback<{ reportId: string; tenantId?: string }, { ok: boolean }>(
    callableName,
    { reportId, tenantId: tenantId || undefined },
    async () => {
      const supabase = getSupabaseClient();
      let query = supabase
        .from(payload.originCollection)
        .delete()
        .eq("id", reportId);
      if (tenantId) {
        query = query.eq("tenant_id", tenantId);
      }
      const { error } = await query;
      if (error) {
        throwSupabaseError(error);
      }
      return { ok: true };
    }
  );

  clearReportsCache();
}

export async function submitSupportRequest(payload: {
  userId: string;
  userName: string;
  userEmail?: string;
  category: SupportCategory;
  subject: string;
  message: string;
}): Promise<{ id: string }> {
  const userId = payload.userId.trim();
  if (!userId) {
    throw new Error("Usuário inválido para abrir chamado.");
  }

  const requestPayload = {
    userId,
    userName: payload.userName.trim().slice(0, 80) || "Usuário",
    userEmail: payload.userEmail?.trim().slice(0, 120) || "",
    category: normalizeSupportCategory(payload.category),
    subject: payload.subject.trim().slice(0, 50),
    message: payload.message.trim().slice(0, 800),
  };

  if (!requestPayload.subject || !requestPayload.message) {
    throw new Error("Assunto e mensagem são obrigatórios.");
  }

  const result = await callWithFallback<
    typeof requestPayload,
    { id: string }
  >(SUBMIT_SUPPORT_CALLABLE, requestPayload, async () => {
    const supabase = getSupabaseClient();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("support_requests")
      .insert({
        ...requestPayload,
        status: "pending",
        readByAdmin: false,
        createdAt: now,
        updatedAt: now,
      })
      .select("id")
      .single();
    if (error) {
      throwSupabaseError(error);
    }

    const { error: notificationError } = await supabase.from("notifications").insert({
      userId,
      title: "Chamado recebido",
      message: "Seu pedido de suporte foi enviado para análise.",
      link: "/configuracoes/suporte",
      read: false,
      type: "support",
      createdAt: now,
    });
    if (notificationError) {
      throwSupabaseError(notificationError);
    }

    return { id: asString((data as Record<string, unknown> | null)?.id) };
  });

  clearReportsCache();
  return result;
}

export async function fetchUserSupportRequests(
  userId: string,
  maxResults = 25
): Promise<SupportTicketRecord[]> {
  const cleanUserId = userId.trim();
  if (!cleanUserId) return [];

  const safeLimit = boundedLimit(maxResults, MAX_USER_SUPPORT_RESULTS);
  const cacheKey = `${cleanUserId}:${safeLimit}`;
  const cached = getCachedValue(userSupportCache, cacheKey, USER_SUPPORT_CACHE_TTL_MS);
  if (cached) return cached;

  return withInFlight(cacheKey, async () => {
    const response = await callWithFallback<
      { userId: string; maxResults: number },
      {
        tickets: Array<{
          id: string;
          category: SupportCategory;
          subject: string;
          message: string;
          status: "pending" | "resolved";
          response?: string;
          createdAtMs: number;
        }>;
      }
    >(
      FETCH_USER_SUPPORT_CALLABLE,
      { userId: cleanUserId, maxResults: safeLimit },
      async () => {
        const rows = await fetchRowsWithFallback({
          table: "support_requests",
          maxResults: safeLimit,
          orderField: "createdAt",
          filters: [{ field: "userId", value: cleanUserId }],
          ignoreMissingTable: true,
        });

        const tickets = rows
          .map((row) => {
            const createdAtMs = toMillis(row.createdAt);
            return {
              id: asString(row.id),
              category: normalizeSupportCategory(row.category),
              subject: asString(row.subject, "Sem assunto"),
              message: asString(row.message),
              status: (
                asString(row.status).toLowerCase() === "resolved"
                  ? "resolved"
                  : "pending"
              ) as "resolved" | "pending",
              response: asString(row.response) || undefined,
              createdAtMs,
            };
          })
          .sort((left, right) => right.createdAtMs - left.createdAtMs);

        return { tickets };
      }
    );

    const tickets = response.tickets
      .map((ticket) => ({
        id: ticket.id,
        category: normalizeSupportCategory(ticket.category),
        subject: asString(ticket.subject, "Sem assunto"),
        message: asString(ticket.message),
        status: (
          ticket.status === "resolved" ? "resolved" : "pending"
        ) as SupportTicketRecord["status"],
        response: asString(ticket.response) || undefined,
        createdAtMs: asNumber(ticket.createdAtMs, 0),
        createdAtLabel: ticket.createdAtMs
          ? new Date(ticket.createdAtMs).toLocaleString("pt-BR")
          : "Data desconhecida",
      }))
      .sort((left, right) => right.createdAtMs - left.createdAtMs);

    setCachedValue(userSupportCache, cacheKey, tickets);
    return tickets;
  });
}


