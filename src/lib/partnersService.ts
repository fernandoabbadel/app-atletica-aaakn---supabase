import { httpsCallable } from "@/lib/supa/functions";
import { getSupabaseClient } from "./supabase";

import { functions } from "./backend";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { getBackendErrorCode } from "./backendErrors";
import { uploadImage } from "./upload";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

export type PartnerTier = "ouro" | "prata" | "standard";
export type PartnerStatus = "active" | "pending" | "disabled";

export interface PartnerCoupon {
  id: string;
  titulo: string;
  regra: string;
  valor: string;
  imagem?: string;
}

export interface PartnerRecord {
  id: string;
  nome: string;
  categoria: string;
  tier: PartnerTier;
  status: PartnerStatus;
  cnpj: string;
  responsavel: string;
  email: string;
  telefone: string;
  descricao: string;
  endereco: string;
  horario: string;
  insta: string;
  site: string;
  whats: string;
  imgCapa: string;
  imgLogo: string;
  mensalidade: number;
  vendasTotal: number;
  totalScans: number;
  cupons: PartnerCoupon[];
  senha?: string;
  createdAt?: unknown;
}

export interface PartnerScanRecord {
  id: string;
  empresaId: string;
  empresa: string;
  usuario: string;
  userId: string;
  cupom: string;
  valorEconomizado: string;
  data: string;
  hora: string;
  timestamp?: unknown;
}

export interface PartnerLoginResult {
  id: string;
  nome: string;
  status: PartnerStatus | string;
  passwordValid: boolean;
}

export interface AdminPartnersPageResult {
  partners: PartnerRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AdminPartnerScansPageResult {
  scans: PartnerScanRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AdminPartnersTierCounts {
  total: number;
  ativos: number;
  pendentes: number;
  desativados: number;
  ouro: number;
  prata: number;
  standard: number;
}

export type PartnerStorageImageKind = "logo" | "capa";

const READ_CACHE_TTL_MS = 30_000;
const MAX_PARTNERS_RESULTS = 600;
const MAX_SCANS_RESULTS = 1_200;
const MAX_SCANNER_SAMPLE_DOCS = 80;
const PARCEIROS_SELECT_COLUMNS: string =
  "id,nome,categoria,tier,status,cnpj,responsavel,email,telefone,descricao,endereco,horario,insta,site,whats,imgCapa,imgLogo,mensalidade,vendasTotal,totalScans,cupons,senha,createdAt";
const SCANS_SELECT_COLUMNS: string =
  "id,empresaId,empresa,usuario,userId,cupom,valorEconomizado,data,hora,timestamp";
const SCANNER_FALLBACK_COLUMNS_BY_TABLE: Record<string, string[]> = {
  users: [
    "uid",
    "nome",
    "email",
    "role",
    "status",
    "turma",
    "plano",
    "patente",
    "createdAt",
    "updatedAt",
  ],
  produtos: [
    "id",
    "nome",
    "categoria",
    "descricao",
    "img",
    "preco",
    "estoque",
    "active",
    "aprovado",
    "vendidos",
    "createdAt",
    "updatedAt",
  ],
  eventos: [
    "id",
    "titulo",
    "data",
    "hora",
    "local",
    "status",
    "categoria",
    "createdAt",
    "updatedAt",
  ],
  orders: [
    "id",
    "userId",
    "productId",
    "productName",
    "status",
    "total",
    "createdAt",
    "updatedAt",
  ],
  parceiros: [
    "id",
    "nome",
    "categoria",
    "tier",
    "status",
    "imgLogo",
    "imgCapa",
    "totalScans",
    "createdAt",
  ],
};

const PARTNERS_CREATE_LEAD_CALLABLE = "partnersCreateLead";
const PARTNERS_LOGIN_CALLABLE = "partnersLogin";
const PARTNERS_ADMIN_UPSERT_CALLABLE = "partnersAdminUpsert";
const PARTNERS_ADMIN_STATUS_CALLABLE = "partnersAdminSetStatus";
const PARTNERS_ADMIN_DELETE_CALLABLE = "partnersAdminDelete";
const PARTNERS_UPDATE_PROFILE_CALLABLE = "partnersUpdateProfile";
const PARTNERS_CREATE_SCAN_CALLABLE = "partnersCreateScan";

const adminBundleCache = new Map<
  string,
  CacheEntry<{ partners: PartnerRecord[]; scans: PartnerScanRecord[] }>
>();
const adminPartnersPageCache = new Map<
  string,
  CacheEntry<{
    partners: PartnerRecord[];
    nextCursor: string | null;
    hasMore: boolean;
  }>
>();
const adminScansPageCache = new Map<
  string,
  CacheEntry<{
    scans: PartnerScanRecord[];
    nextCursor: string | null;
    hasMore: boolean;
  }>
>();
const adminTierCountsCache = new Map<string, CacheEntry<AdminPartnersTierCounts>>();
const publicPartnersCache = new Map<string, CacheEntry<PartnerRecord[]>>();
const partnerByIdCache = new Map<string, CacheEntry<PartnerRecord | null>>();
const partnerScansCache = new Map<string, CacheEntry<PartnerScanRecord[]>>();
const scannerFieldsCache = new Map<string, CacheEntry<Record<string, string[]>>>();
const partnersPageInflight = new Map<
  string,
  Promise<{
    partners: PartnerRecord[];
    nextCursor: string | null;
    hasMore: boolean;
  }>
>();
const scansPageInflight = new Map<
  string,
  Promise<{
    scans: PartnerScanRecord[];
    nextCursor: string | null;
    hasMore: boolean;
  }>
>();
const tierCountsInflight = new Map<string, Promise<AdminPartnersTierCounts>>();

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const resolvePartnersTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

const requirePartnersTenantId = (tenantId?: string | null): string => {
  const scopedTenantId = resolvePartnersTenantId(tenantId);
  if (!scopedTenantId) {
    throw new Error("Tenant ativo nao identificado para parceiros.");
  }
  return scopedTenantId;
};

const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown; hint?: unknown };
  const message = [raw.message, raw.details, raw.hint]
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .filter((entry) => entry.length > 0)
    .join(" | ");
  if (!message) return null;

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

const isMissingTenantIdColumn = (error: unknown): boolean =>
  extractMissingSchemaColumn(error)?.trim().toLowerCase() === "tenant_id";

const throwSupabaseError = (error: {
  message: string;
  code?: string | null;
  name?: string | null;
}): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const boundedLimit = (requested: number, maxAllowed: number): number => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

const normalizeTier = (value: unknown): PartnerTier => {
  const tier = asString(value).toLowerCase();
  if (tier === "ouro" || tier === "prata") return tier;
  return "standard";
};

const normalizeStatus = (value: unknown): PartnerStatus => {
  const status = asString(value).toLowerCase();
  if (status === "pending" || status === "disabled") return status;
  return "active";
};

const normalizeStatusFilter = (
  value: unknown
): PartnerStatus | "all" => {
  const status = asString(value).toLowerCase();
  if (status === "active" || status === "pending" || status === "disabled") {
    return status;
  }
  return "all";
};

const normalizeCoupon = (raw: unknown): PartnerCoupon | null => {
  const data = asObject(raw);
  if (!data) return null;

  const titulo = asString(data.titulo).trim();
  if (!titulo) return null;

  const id = asString(data.id).trim() || crypto.randomUUID();
  const regra = asString(data.regra).trim();
  const valor = asString(data.valor).trim();
  const imagem = asString(data.imagem).trim();

  return {
    id,
    titulo,
    regra,
    valor,
    ...(imagem ? { imagem } : {}),
  };
};

const normalizePartner = (id: string, raw: unknown): PartnerRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  const nome = asString(data.nome).trim();
  if (!nome) return null;

  return {
    id,
    nome,
    categoria: asString(data.categoria, "Parceiro"),
    tier: normalizeTier(data.tier),
    status: normalizeStatus(data.status),
    cnpj: asString(data.cnpj),
    responsavel: asString(data.responsavel),
    email: asString(data.email),
    telefone: asString(data.telefone),
    descricao: asString(data.descricao),
    endereco: asString(data.endereco),
    horario: asString(data.horario),
    insta: asString(data.insta),
    site: asString(data.site),
    whats: asString(data.whats),
    imgCapa: asString(data.imgCapa),
    imgLogo: asString(data.imgLogo),
    mensalidade: asNumber(data.mensalidade, 0),
    vendasTotal: asNumber(data.vendasTotal, 0),
    totalScans: asNumber(data.totalScans, 0),
    cupons: asArray(data.cupons)
      .map((entry) => normalizeCoupon(entry))
      .filter((entry): entry is PartnerCoupon => entry !== null),
    ...(asString(data.senha).trim() ? { senha: asString(data.senha) } : {}),
    ...(data.createdAt !== undefined ? { createdAt: data.createdAt } : {}),
  };
};

const normalizeScan = (id: string, raw: unknown): PartnerScanRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  const empresaId = asString(data.empresaId).trim();
  const usuario = asString(data.usuario).trim();
  if (!empresaId || !usuario) return null;

  return {
    id,
    empresaId,
    empresa: asString(data.empresa, "Empresa"),
    usuario,
    userId: asString(data.userId),
    cupom: asString(data.cupom, "Cupom"),
    valorEconomizado: asString(data.valorEconomizado, "R$ 0,00"),
    data: asString(data.data),
    hora: asString(data.hora),
    ...(data.timestamp !== undefined ? { timestamp: data.timestamp } : {}),
  };
};

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
    const parsed = toDate.call(value) as Date;
    if (parsed instanceof Date) return parsed.getTime();
  }

  return 0;
};

const getMapCacheValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string
): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > READ_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setMapCacheValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T
): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const clearAdminPartnersCaches = (): void => {
  adminBundleCache.clear();
  adminPartnersPageCache.clear();
  adminScansPageCache.clear();
  adminTierCountsCache.clear();
  partnersPageInflight.clear();
  scansPageInflight.clear();
  tierCountsInflight.clear();
};

const isIndexRequiredError = (error: unknown): boolean => {
  const code = getBackendErrorCode(error)?.toLowerCase();
  if (code?.includes("failed-precondition")) return true;

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("index") && message.includes("query");
  }
  return false;
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

type RowsFetchAttempt = {
  limit: number;
  eq?: Record<string, string>;
  orderBy?: { column: string; ascending: boolean };
};

async function fetchRowsWithFallback(
  tableName: "parceiros" | "scans",
  attempts: RowsFetchAttempt[],
  options?: { tenantId?: string | null }
): Promise<Record<string, unknown>[]> {
  const safeAttempts = attempts.filter((entry) => entry.limit > 0);
  if (!safeAttempts.length) return [];

  const supabase = getSupabaseClient();
  const scopedTenantId = resolvePartnersTenantId(options?.tenantId);
  if (!scopedTenantId) return [];
  const selectColumns =
    tableName === "parceiros" ? PARCEIROS_SELECT_COLUMNS : SCANS_SELECT_COLUMNS;
  let lastError: unknown = null;

  for (let index = 0; index < safeAttempts.length; index += 1) {
    const attempt = safeAttempts[index];
    try {
      let q = supabase
        .from(tableName)
        .select(selectColumns)
        .eq("tenant_id", scopedTenantId)
        .limit(attempt.limit);

      if (attempt.eq) {
        for (const [column, value] of Object.entries(attempt.eq)) {
          q = q.eq(column, value);
        }
      }
      if (attempt.orderBy) {
        q = q.order(attempt.orderBy.column, { ascending: attempt.orderBy.ascending });
      }

      const { data, error } = await q;
      if (error) throw error;
      return ((data as unknown as Record<string, unknown>[] | null) ?? []);
    } catch (error: unknown) {
      if (isMissingTenantIdColumn(error)) {
        return [];
      }
      lastError = error;
      const isLastAttempt = index === safeAttempts.length - 1;
      if (!isIndexRequiredError(error) || isLastAttempt) {
        if (
          typeof (error as { message?: unknown })?.message === "string"
        ) {
          throwSupabaseError(error as { message: string; code?: string | null; name?: string | null });
        }
        throw error;
      }
    }
  }

  if (
    lastError &&
    typeof (lastError as { message?: unknown })?.message === "string"
  ) {
    throwSupabaseError(lastError as { message: string; code?: string | null; name?: string | null });
  }
  return [];
}

const sanitizePartnerWritePayload = (
  payload: Partial<PartnerRecord> & { tier?: string; status?: string }
): Record<string, unknown> => {
  const cleanCupons = asArray(payload.cupons)
    .map((entry) => normalizeCoupon(entry))
    .filter((entry): entry is PartnerCoupon => entry !== null);

  const rawPayload: Record<string, unknown> = {
    nome: asString(payload.nome).trim(),
    categoria: asString(payload.categoria).trim(),
    tier: normalizeTier(payload.tier),
    status: normalizeStatus(payload.status),
    cnpj: asString(payload.cnpj).trim(),
    responsavel: asString(payload.responsavel).trim(),
    email: asString(payload.email).trim().toLowerCase(),
    telefone: asString(payload.telefone).trim(),
    descricao: asString(payload.descricao).trim(),
    endereco: asString(payload.endereco).trim(),
    horario: asString(payload.horario).trim(),
    insta: asString(payload.insta).trim(),
    site: asString(payload.site).trim(),
    whats: asString(payload.whats).trim(),
    imgCapa: asString(payload.imgCapa).trim(),
    imgLogo: asString(payload.imgLogo).trim(),
    mensalidade: asNumber(payload.mensalidade, 0),
    vendasTotal: asNumber(payload.vendasTotal, 0),
    totalScans: asNumber(payload.totalScans, 0),
    cupons: cleanCupons,
  };

  const senha = asString(payload.senha).trim();
  if (senha) {
    rawPayload.senha = senha;
  }

  const sanitized: Record<string, unknown> = {};
  Object.entries(rawPayload).forEach(([key, value]) => {
    if (typeof value === "string") {
      sanitized[key] = value;
      return;
    }
    if (Array.isArray(value)) {
      sanitized[key] = value;
      return;
    }
    if (typeof value === "number") {
      sanitized[key] = value;
      return;
    }
  });

  return sanitized;
};

const sanitizeStorageSegment = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "item";

export async function uploadPartnerImageToStorage(options: {
  file: File;
  kind: PartnerStorageImageKind;
  partnerId?: string;
}): Promise<string> {
  const partnerSegment = sanitizeStorageSegment(options.partnerId || "temp");
  const folder = options.kind === "capa" ? "capas" : "logos";
  const objectDir = `parceiros/${partnerSegment}/${folder}`;

  const { url, error } = await uploadImage(options.file, objectDir, {
    scopeKey: `parceiros:${partnerSegment}:${options.kind}`,
    fileName: options.kind,
    upsert: true,
    appendVersionQuery: true,
    maxBytes: options.kind === "capa" ? 3 * 1024 * 1024 : 2 * 1024 * 1024,
    maxWidth: options.kind === "capa" ? 2400 : 1400,
    maxHeight: options.kind === "capa" ? 1800 : 1400,
    maxPixels: options.kind === "capa" ? 3_600_000 : 1_960_000,
    compressionMaxWidth: options.kind === "capa" ? 1800 : 1200,
    compressionMaxHeight: options.kind === "capa" ? 1200 : 1200,
    compressionMaxBytes: 200 * 1024,
    quality: 0.82,
    cacheControl: "86400",
  });
  if (!url || error) {
    throw new Error(error || "Falha ao subir imagem do parceiro.");
  }

  return url;
}

export async function fetchAdminPartnersBundle(options?: {
  partnersLimit?: number;
  scansLimit?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<{ partners: PartnerRecord[]; scans: PartnerScanRecord[] }> {
  const partnersLimit = boundedLimit(
    options?.partnersLimit ?? 500,
    MAX_PARTNERS_RESULTS
  );
  const scansLimit = boundedLimit(options?.scansLimit ?? 500, MAX_SCANS_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolvePartnersTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "none"}:${partnersLimit}:${scansLimit}`;

  if (!forceRefresh) {
    const cached = getMapCacheValue(adminBundleCache, cacheKey);
    if (cached) return cached;
  }

  if (!scopedTenantId) {
    return { partners: [], scans: [] };
  }

  const [partnersRows, scansRows] = await Promise.all([
    fetchRowsWithFallback("parceiros", [
      { orderBy: { column: "nome", ascending: true }, limit: partnersLimit },
      { limit: partnersLimit },
    ], { tenantId: scopedTenantId }),
    fetchRowsWithFallback("scans", [
      { orderBy: { column: "timestamp", ascending: false }, limit: scansLimit },
      { orderBy: { column: "data", ascending: false }, limit: scansLimit },
      { limit: scansLimit },
    ], { tenantId: scopedTenantId }),
  ]);

  const partners = partnersRows
    .map((row) => normalizePartner(asString(row.id), row))
    .filter((row): row is PartnerRecord => row !== null);

  const scans = scansRows
    .map((row) => normalizeScan(asString(row.id), row))
    .filter((row): row is PartnerScanRecord => row !== null)
    .sort((left, right) => toMillis(right.timestamp) - toMillis(left.timestamp))
    .slice(0, scansLimit);

  const bundle = { partners, scans };
  setMapCacheValue(adminBundleCache, cacheKey, bundle);
  return bundle;
}

export async function fetchAdminPartnersPage(options?: {
  pageSize?: number;
  cursorId?: string | null;
  status?: PartnerStatus | "all";
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<AdminPartnersPageResult> {
  const pageSize = boundedLimit(options?.pageSize ?? 20, MAX_PARTNERS_RESULTS);
  const cursorId = options?.cursorId?.trim() || "";
  const statusFilter = normalizeStatusFilter(options?.status);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolvePartnersTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "none"}:${statusFilter}:${pageSize}:${cursorId || "first"}`;

  if (forceRefresh) {
    clearAdminPartnersCaches();
  } else {
    const cached = getMapCacheValue(adminPartnersPageCache, cacheKey);
    if (cached) return cached;

    const pending = partnersPageInflight.get(cacheKey);
    if (pending) return pending;
  }

  if (!scopedTenantId) {
    return { partners: [], hasMore: false, nextCursor: null };
  }

  const requestPromise = (async () => {
    const supabase = getSupabaseClient();
    const windowLimit = Math.min(MAX_PARTNERS_RESULTS, Math.max(pageSize * 12, 120));

    let q = supabase
      .from("parceiros")
      .select(PARCEIROS_SELECT_COLUMNS)
      .eq("tenant_id", scopedTenantId)
      .order("nome", { ascending: true })
      .limit(windowLimit);
    if (statusFilter !== "all") {
      q = q.eq("status", statusFilter);
    }

    const { data, error } = await q;
    if (error) {
      if (isMissingTenantIdColumn(error)) {
        return { partners: [], hasMore: false, nextCursor: null };
      }
      throwSupabaseError(error);
    }

    const rawRows = (data as unknown as Record<string, unknown>[] | null) ?? [];
    let rows = rawRows
      .map((row) => normalizePartner(asString((row as Record<string, unknown>).id), row))
      .filter((row): row is PartnerRecord => row !== null);

    if (statusFilter !== "all") {
      rows = rows.filter((row) => row.status === statusFilter);
    }

    const cursorIndex = cursorId ? rows.findIndex((row) => row.id === cursorId) : -1;
    const slicedRows = cursorIndex >= 0 ? rows.slice(cursorIndex + 1) : rows;
    const pageRows = slicedRows.slice(0, pageSize);
    const result: AdminPartnersPageResult = {
      partners: pageRows,
      hasMore: slicedRows.length > pageSize,
      nextCursor: pageRows.length ? pageRows[pageRows.length - 1].id : null,
    };
    setMapCacheValue(adminPartnersPageCache, cacheKey, result);
    return result;
  })();

  partnersPageInflight.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    partnersPageInflight.delete(cacheKey);
  }
}

export async function fetchAdminPartnerScansPage(options?: {
  pageSize?: number;
  cursorId?: string | null;
  partnerId?: string;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<AdminPartnerScansPageResult> {
  const pageSize = boundedLimit(options?.pageSize ?? 20, MAX_SCANS_RESULTS);
  const cursorId = options?.cursorId?.trim() || "";
  const partnerId = options?.partnerId?.trim() || "";
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolvePartnersTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "none"}:${partnerId || "all"}:${pageSize}:${cursorId || "first"}`;

  if (forceRefresh) {
    clearAdminPartnersCaches();
  } else {
    const cached = getMapCacheValue(adminScansPageCache, cacheKey);
    if (cached) return cached;

    const pending = scansPageInflight.get(cacheKey);
    if (pending) return pending;
  }

  if (!scopedTenantId) {
    return { scans: [], hasMore: false, nextCursor: null };
  }

  const requestPromise = (async () => {
    const supabase = getSupabaseClient();
    const windowLimit = Math.min(MAX_SCANS_RESULTS, Math.max(pageSize * 12, 120));

    const runQuery = async (orderColumn: "timestamp" | "data" | null) => {
      let q = supabase
        .from("scans")
        .select(SCANS_SELECT_COLUMNS)
        .eq("tenant_id", scopedTenantId)
        .limit(windowLimit);
      if (partnerId) {
        q = q.eq("empresaId", partnerId);
      }
      if (orderColumn) {
        q = q.order(orderColumn, { ascending: false });
      }
      return q;
    };

    let data: Record<string, unknown>[] = [];
    try {
      const { data: orderedRows, error } = await runQuery("timestamp");
      if (error) {
        if (isMissingTenantIdColumn(error)) {
          return { scans: [], hasMore: false, nextCursor: null };
        }
        throw error;
      }
      data = (orderedRows as unknown as Record<string, unknown>[] | null) ?? [];
    } catch (error: unknown) {
      if (isMissingTenantIdColumn(error)) {
        return { scans: [], hasMore: false, nextCursor: null };
      }
      if (!isIndexRequiredError(error)) {
        if (typeof (error as { message?: unknown })?.message === "string") {
          throwSupabaseError(error as { message: string; code?: string | null; name?: string | null });
        }
        throw error;
      }

      const { data: fallbackRows, error: fallbackError } = await runQuery("data");
      if (fallbackError) {
        if (isMissingTenantIdColumn(fallbackError)) {
          return { scans: [], hasMore: false, nextCursor: null };
        }
        const { data: noOrderRows, error: noOrderError } = await runQuery(null);
        if (noOrderError) {
          if (isMissingTenantIdColumn(noOrderError)) {
            return { scans: [], hasMore: false, nextCursor: null };
          }
          throwSupabaseError(noOrderError);
        }
        data = (noOrderRows as unknown as Record<string, unknown>[] | null) ?? [];
      } else {
        data = (fallbackRows as unknown as Record<string, unknown>[] | null) ?? [];
      }
    }

    const rows = data
      .map((row) => normalizeScan(asString((row as Record<string, unknown>).id), row))
      .filter((row): row is PartnerScanRecord => row !== null)
      .sort((left, right) => toMillis(right.timestamp) - toMillis(left.timestamp));

    const cursorIndex = cursorId ? rows.findIndex((row) => row.id === cursorId) : -1;
    const slicedRows = cursorIndex >= 0 ? rows.slice(cursorIndex + 1) : rows;
    const pageRows = slicedRows.slice(0, pageSize);
    const result: AdminPartnerScansPageResult = {
      scans: pageRows,
      hasMore: slicedRows.length > pageSize,
      nextCursor: pageRows.length ? pageRows[pageRows.length - 1].id : null,
    };
    setMapCacheValue(adminScansPageCache, cacheKey, result);
    return result;
  })();

  scansPageInflight.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    scansPageInflight.delete(cacheKey);
  }
}

export async function fetchAdminPartnersTierCounts(options?: {
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<AdminPartnersTierCounts> {
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolvePartnersTenantId(options?.tenantId);
  const cacheKey = scopedTenantId || "none";

  if (!scopedTenantId) {
    return {
      total: 0,
      ativos: 0,
      pendentes: 0,
      desativados: 0,
      ouro: 0,
      prata: 0,
      standard: 0,
    };
  }

  if (forceRefresh) {
    clearAdminPartnersCaches();
  } else {
    const cached = getMapCacheValue(adminTierCountsCache, cacheKey);
    if (cached) return cached;

    const pending = tierCountsInflight.get(cacheKey);
    if (pending) return pending;
  }

  const requestPromise = (async () => {
    try {
      const supabase = getSupabaseClient();
      const [
        totalSnap,
        activeSnap,
        pendingSnap,
        disabledSnap,
        ouroSnap,
        prataSnap,
        standardSnap,
      ] = await Promise.all([
        supabase
          .from("parceiros")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", scopedTenantId),
        supabase
          .from("parceiros")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", scopedTenantId)
          .eq("status", "active"),
        supabase
          .from("parceiros")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", scopedTenantId)
          .eq("status", "pending"),
        supabase
          .from("parceiros")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", scopedTenantId)
          .eq("status", "disabled"),
        supabase
          .from("parceiros")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", scopedTenantId)
          .eq("status", "active")
          .eq("tier", "ouro"),
        supabase
          .from("parceiros")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", scopedTenantId)
          .eq("status", "active")
          .eq("tier", "prata"),
        supabase
          .from("parceiros")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", scopedTenantId)
          .eq("status", "active")
          .eq("tier", "standard"),
      ]);
      if (totalSnap.error) throw totalSnap.error;
      if (activeSnap.error) throw activeSnap.error;
      if (pendingSnap.error) throw pendingSnap.error;
      if (disabledSnap.error) throw disabledSnap.error;
      if (ouroSnap.error) throw ouroSnap.error;
      if (prataSnap.error) throw prataSnap.error;
      if (standardSnap.error) throw standardSnap.error;

      const result: AdminPartnersTierCounts = {
        total: totalSnap.count ?? 0,
        ativos: activeSnap.count ?? 0,
        pendentes: pendingSnap.count ?? 0,
        desativados: disabledSnap.count ?? 0,
        ouro: ouroSnap.count ?? 0,
        prata: prataSnap.count ?? 0,
        standard: standardSnap.count ?? 0,
      };
      setMapCacheValue(adminTierCountsCache, cacheKey, result);
      return result;
    } catch (error: unknown) {
      if (!isIndexRequiredError(error)) {
        throw error;
      }

      if (isMissingTenantIdColumn(error)) {
        return {
          total: 0,
          ativos: 0,
          pendentes: 0,
          desativados: 0,
          ouro: 0,
          prata: 0,
          standard: 0,
        };
      }

      const rows = await fetchRowsWithFallback("parceiros", [{ limit: MAX_PARTNERS_RESULTS }], {
        tenantId: scopedTenantId,
      });
      const normalized = rows
        .map((row) => normalizePartner(asString(row.id), row))
        .filter((row): row is PartnerRecord => row !== null);

      const result: AdminPartnersTierCounts = {
        total: normalized.length,
        ativos: normalized.filter((row) => row.status === "active").length,
        pendentes: normalized.filter((row) => row.status === "pending").length,
        desativados: normalized.filter((row) => row.status === "disabled").length,
        ouro: normalized.filter(
          (row) => row.status === "active" && row.tier === "ouro"
        ).length,
        prata: normalized.filter(
          (row) => row.status === "active" && row.tier === "prata"
        ).length,
        standard: normalized.filter(
          (row) => row.status === "active" && row.tier === "standard"
        ).length,
      };
      setMapCacheValue(adminTierCountsCache, cacheKey, result);
      return result;
    }
  })();

  tierCountsInflight.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    tierCountsInflight.delete(cacheKey);
  }
}

const tierRank = (tier: PartnerTier): number => {
  if (tier === "ouro") return 0;
  if (tier === "prata") return 1;
  return 2;
};

export async function fetchPublicPartners(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<PartnerRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 240, MAX_PARTNERS_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolvePartnersTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "none"}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCacheValue(publicPartnersCache, cacheKey);
    if (cached) return cached;
  }

  if (!scopedTenantId) {
    return [];
  }

  const rows = await fetchRowsWithFallback("parceiros", [
    { eq: { status: "active" }, orderBy: { column: "tier", ascending: true }, limit: maxResults },
    { eq: { status: "active" }, orderBy: { column: "nome", ascending: true }, limit: maxResults },
    { eq: { status: "active" }, limit: maxResults },
    { orderBy: { column: "nome", ascending: true }, limit: maxResults },
  ], { tenantId: scopedTenantId });

  const partners = rows
    .map((row) => normalizePartner(asString(row.id), row))
    .filter((row): row is PartnerRecord => row !== null)
    .filter((row) => row.status === "active")
    .sort((left, right) => {
      const byTier = tierRank(left.tier) - tierRank(right.tier);
      if (byTier !== 0) return byTier;
      return left.nome.localeCompare(right.nome, "pt-BR");
    })
    .slice(0, maxResults);

  setMapCacheValue(publicPartnersCache, cacheKey, partners);
  return partners;
}

export async function fetchPartnerById(
  partnerId: string,
  options?: { forceRefresh?: boolean; tenantId?: string | null }
): Promise<PartnerRecord | null> {
  const cleanPartnerId = partnerId.trim();
  if (!cleanPartnerId) return null;

  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolvePartnersTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "none"}:${cleanPartnerId}`;
  if (!forceRefresh) {
    const cached = getMapCacheValue(partnerByIdCache, cacheKey);
    if (cached !== null) return cached;
  }

  if (!scopedTenantId) {
    return null;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("parceiros")
    .select(PARCEIROS_SELECT_COLUMNS)
    .eq("tenant_id", scopedTenantId)
    .eq("id", cleanPartnerId)
    .maybeSingle();
  if (error) {
    if (isMissingTenantIdColumn(error)) {
      return null;
    }
    throwSupabaseError(error);
  }

  if (!data) {
    setMapCacheValue(partnerByIdCache, cacheKey, null);
    return null;
  }

  const partner = normalizePartner(cleanPartnerId, data);
  setMapCacheValue(partnerByIdCache, cacheKey, partner);
  return partner;
}

export async function fetchPartnerScans(options: {
  partnerId: string;
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<PartnerScanRecord[]> {
  const partnerId = options.partnerId.trim();
  if (!partnerId) return [];

  const maxResults = boundedLimit(options.maxResults ?? 300, MAX_SCANS_RESULTS);
  const forceRefresh = options.forceRefresh ?? false;
  const scopedTenantId = resolvePartnersTenantId(options.tenantId);
  const cacheKey = `${scopedTenantId || "none"}:${partnerId}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCacheValue(partnerScansCache, cacheKey);
    if (cached) return cached;
  }

  if (!scopedTenantId) {
    return [];
  }

  const rows = await fetchRowsWithFallback("scans", [
    { eq: { empresaId: partnerId }, orderBy: { column: "timestamp", ascending: false }, limit: maxResults },
    { eq: { empresaId: partnerId }, orderBy: { column: "data", ascending: false }, limit: maxResults },
    { eq: { empresaId: partnerId }, limit: maxResults },
  ], { tenantId: scopedTenantId });

  const scans = rows
    .map((row) => normalizeScan(asString(row.id), row))
    .filter((row): row is PartnerScanRecord => row !== null)
    .sort((left, right) => toMillis(right.timestamp) - toMillis(left.timestamp))
    .slice(0, maxResults);

  setMapCacheValue(partnerScansCache, cacheKey, scans);
  return scans;
}

export async function loginPartnerByEmail(payload: {
  email: string;
  senha: string;
  tenantId?: string | null;
}): Promise<PartnerLoginResult | null> {
  const email = payload.email.trim().toLowerCase();
  const senha = payload.senha.trim();
  const scopedTenantId = resolvePartnersTenantId(payload.tenantId);
  if (!email || !senha || !scopedTenantId) return null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("parceiros")
    .select(PARCEIROS_SELECT_COLUMNS)
    .eq("tenant_id", scopedTenantId)
    .eq("email", email)
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTenantIdColumn(error)) {
      return null;
    }
    throwSupabaseError(error);
  }
  if (!data) return null;

  const safeData = data as unknown as Record<string, unknown>;
  const row = normalizePartner(asString(safeData.id), safeData);
  if (!row) return null;

  return {
    id: row.id,
    nome: row.nome,
    status: row.status,
    passwordValid: asString(row.senha) === senha,
  };
}

export async function createPartnerLead(payload: {
  nome: string;
  cnpj: string;
  responsavel: string;
  cpf: string;
  categoria: string;
  email: string;
  telefone: string;
  senha: string;
  descricao: string;
  endereco: string;
  horario: string;
  tier: string;
  tenantId?: string | null;
}): Promise<{ id: string }> {
  const scopedTenantId = requirePartnersTenantId(payload.tenantId);
  const leadPayload = {
    nome: payload.nome,
    cnpj: payload.cnpj,
    responsavel: payload.responsavel,
    cpf: payload.cpf,
    categoria: payload.categoria,
    email: payload.email.toLowerCase(),
    telefone: payload.telefone,
    senha: payload.senha,
    descricao: payload.descricao,
    endereco: payload.endereco,
    horario: payload.horario,
    tier: normalizeTier(payload.tier),
    tenantId: scopedTenantId,
  };

  const result = await callWithFallback<typeof leadPayload, { id: string }>(
    PARTNERS_CREATE_LEAD_CALLABLE,
    leadPayload,
    async () => {
      const supabase = getSupabaseClient();
      const sanitized = sanitizePartnerWritePayload({
        ...leadPayload,
        status: "pending",
        vendasTotal: 0,
        totalScans: 0,
        cupons: [],
      });
      const { data, error } = await supabase
        .from("parceiros")
        .insert({
          ...sanitized,
          tenant_id: scopedTenantId,
          createdAt: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throwSupabaseError(error);
      return { id: asString((data as Record<string, unknown> | null)?.id) };
    }
  );

  clearAdminPartnersCaches();
  publicPartnersCache.clear();
  return result;
}

export async function setPartnerStatus(payload: {
  partnerId: string;
  status: PartnerStatus;
  tenantId?: string | null;
}): Promise<void> {
  const partnerId = payload.partnerId.trim();
  if (!partnerId) return;

  const status = normalizeStatus(payload.status);
  const scopedTenantId = requirePartnersTenantId(payload.tenantId);
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("parceiros")
    .update({ status })
    .eq("tenant_id", scopedTenantId)
    .eq("id", partnerId);
  if (error) {
    if (isMissingTenantIdColumn(error)) {
      throw new Error("Schema de parceiros ainda sem tenant_id.");
    }
    throwSupabaseError(error);
  }

  partnerByIdCache.clear();
  partnerScansCache.clear();
  clearAdminPartnersCaches();
  publicPartnersCache.clear();
}

export async function upsertPartner(payload: {
  partnerId?: string;
  data: Partial<PartnerRecord>;
  tenantId?: string | null;
}): Promise<PartnerRecord | null> {
  const partnerId = payload.partnerId?.trim() || "";
  const sanitized = sanitizePartnerWritePayload(payload.data);
  const scopedTenantId = requirePartnersTenantId(payload.tenantId);
  const supabase = getSupabaseClient();

  let response: unknown = null;
  if (partnerId) {
    const { error: updateError } = await supabase
      .from("parceiros")
      .update(sanitized)
      .eq("tenant_id", scopedTenantId)
      .eq("id", partnerId);
    if (updateError) {
      if (isMissingTenantIdColumn(updateError)) {
        throw new Error("Schema de parceiros ainda sem tenant_id.");
      }
      throwSupabaseError(updateError);
    }

    const { data: updatedRow, error: selectError } = await supabase
      .from("parceiros")
      .select(PARCEIROS_SELECT_COLUMNS)
      .eq("tenant_id", scopedTenantId)
      .eq("id", partnerId)
      .maybeSingle();
    if (selectError) {
      if (isMissingTenantIdColumn(selectError)) {
        throw new Error("Schema de parceiros ainda sem tenant_id.");
      }
      throwSupabaseError(selectError);
    }
    response = updatedRow;
  } else {
    const { data: createdRow, error: createError } = await supabase
      .from("parceiros")
      .insert({
        ...sanitized,
        tenant_id: scopedTenantId,
        createdAt: new Date().toISOString(),
      })
      .select(PARCEIROS_SELECT_COLUMNS)
      .single();
    if (createError) {
      if (isMissingTenantIdColumn(createError)) {
        throw new Error("Schema de parceiros ainda sem tenant_id.");
      }
      throwSupabaseError(createError);
    }
    response = createdRow;
  }

  const normalized = normalizePartner(
    asString(asObject(response)?.id || partnerId),
    response
  );

  clearAdminPartnersCaches();
  publicPartnersCache.clear();
  if (normalized) {
    partnerByIdCache.set(normalized.id, {
      cachedAt: Date.now(),
      value: normalized,
    });
  }
  return normalized;
}

export async function deletePartnerById(
  partnerId: string,
  options?: { tenantId?: string | null }
): Promise<void> {
  const cleanPartnerId = partnerId.trim();
  if (!cleanPartnerId) return;
  const scopedTenantId = requirePartnersTenantId(options?.tenantId);
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("parceiros")
    .delete()
    .eq("tenant_id", scopedTenantId)
    .eq("id", cleanPartnerId);
  if (error) {
    if (isMissingTenantIdColumn(error)) {
      throw new Error("Schema de parceiros ainda sem tenant_id.");
    }
    throwSupabaseError(error);
  }

  partnerByIdCache.clear();
  partnerScansCache.clear();
  clearAdminPartnersCaches();
  publicPartnersCache.clear();
}

export async function createPartnerScan(payload: {
  partnerId: string;
  partnerName: string;
  usuario: string;
  userId: string;
  cupom: string;
  valorEconomizado: string;
  data: string;
  hora: string;
  tenantId?: string | null;
}): Promise<{ scan: PartnerScanRecord; totalScans: number }> {
  const partnerId = payload.partnerId.trim();
  if (!partnerId) {
    throw new Error("partnerId obrigatorio");
  }
  const scopedTenantId = requirePartnersTenantId(payload.tenantId);

  const requestPayload = {
    partnerId,
    partnerName: payload.partnerName.trim().slice(0, 120) || "Empresa",
    usuario: payload.usuario.trim().slice(0, 120) || "Aluno",
    userId: payload.userId.trim().slice(0, 120),
    cupom: payload.cupom.trim().slice(0, 120) || "Cupom",
    valorEconomizado: payload.valorEconomizado.trim().slice(0, 60) || "R$ 0,00",
    data: payload.data.trim().slice(0, 30),
    hora: payload.hora.trim().slice(0, 20),
  };

  const supabase = getSupabaseClient();
  const { data: partnerRow, error: partnerError } = await supabase
    .from("parceiros")
    .select("totalScans,scansCount")
    .eq("tenant_id", scopedTenantId)
    .eq("id", partnerId)
    .maybeSingle();
  if (partnerError) {
    if (isMissingTenantIdColumn(partnerError)) {
      throw new Error("Schema de parceiros ainda sem tenant_id.");
    }
    throwSupabaseError(partnerError);
  }

  const partnerData = asObject(partnerRow);
  const currentTotal = asNumber(partnerData?.totalScans, 0);
  const currentScansCount = asNumber(partnerData?.scansCount, currentTotal);
  const nextTotal = currentTotal + 1;
  const nextScansCount = currentScansCount + 1;
  const timestampIso = new Date().toISOString();

  const { data: insertedScan, error: scanInsertError } = await supabase
    .from("scans")
    .insert({
      tenant_id: scopedTenantId,
      empresaId: partnerId,
      empresa: requestPayload.partnerName,
      usuario: requestPayload.usuario,
      userId: requestPayload.userId,
      cupom: requestPayload.cupom,
      valorEconomizado: requestPayload.valorEconomizado,
      data: requestPayload.data,
      hora: requestPayload.hora,
      timestamp: timestampIso,
    })
    .select(SCANS_SELECT_COLUMNS)
    .single();
  if (scanInsertError) {
    if (isMissingTenantIdColumn(scanInsertError)) {
      throw new Error("Schema de scans ainda sem tenant_id.");
    }
    throwSupabaseError(scanInsertError);
  }

  const { error: partnerUpdateError } = await supabase
    .from("parceiros")
    .update({
      totalScans: nextTotal,
      scansCount: nextScansCount,
    })
    .eq("tenant_id", scopedTenantId)
    .eq("id", partnerId);
  if (partnerUpdateError) {
    if (isMissingTenantIdColumn(partnerUpdateError)) {
      throw new Error("Schema de parceiros ainda sem tenant_id.");
    }
    throwSupabaseError(partnerUpdateError);
  }

  const response = {
    scan: {
      ...(asObject(insertedScan) ?? {}),
      id: asString(asObject(insertedScan)?.id || crypto.randomUUID()),
      timestamp: asObject(insertedScan)?.timestamp ?? timestampIso,
    },
    totalScans: nextTotal,
  };

  const responseObj = asObject(response);
  const rawScan = asObject(responseObj?.scan);
  const scanId = asString(rawScan?.id || crypto.randomUUID());
  const scan = normalizeScan(scanId, rawScan) ?? {
    id: scanId,
    empresaId: partnerId,
    empresa: requestPayload.partnerName,
    usuario: requestPayload.usuario,
    userId: requestPayload.userId,
    cupom: requestPayload.cupom,
    valorEconomizado: requestPayload.valorEconomizado,
    data: requestPayload.data,
    hora: requestPayload.hora,
    timestamp: new Date(),
  };

  const totalScans = asNumber(responseObj?.totalScans, NaN);
  const normalizedTotal = Number.isFinite(totalScans) ? totalScans : 0;

  partnerScansCache.clear();
  partnerByIdCache.clear();
  clearAdminPartnersCaches();
  publicPartnersCache.clear();

  return {
    scan,
    totalScans: normalizedTotal,
  };
}

export async function updatePartnerProfile(payload: {
  partnerId: string;
  data: Partial<PartnerRecord>;
  tenantId?: string | null;
}): Promise<void> {
  const partnerId = payload.partnerId.trim();
  if (!partnerId) return;

  const sanitized = sanitizePartnerWritePayload(payload.data);
  const scopedTenantId = requirePartnersTenantId(payload.tenantId);
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("parceiros")
    .update(sanitized)
    .eq("tenant_id", scopedTenantId)
    .eq("id", partnerId);
  if (error) {
    if (isMissingTenantIdColumn(error)) {
      throw new Error("Schema de parceiros ainda sem tenant_id.");
    }
    throwSupabaseError(error);
  }

  partnerByIdCache.clear();
  partnerScansCache.clear();
  clearAdminPartnersCaches();
  publicPartnersCache.clear();
}

export async function scanSupabaseTableFields(options: {
  collections: string[];
  sampleDocsPerCollection?: number;
  forceRefresh?: boolean;
}): Promise<Record<string, string[]>> {
  const collectionNames = options.collections
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (!collectionNames.length) return {};

  const sampleDocsPerCollection = boundedLimit(
    options.sampleDocsPerCollection ?? 40,
    MAX_SCANNER_SAMPLE_DOCS
  );
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `${collectionNames.join("|")}:${sampleDocsPerCollection}`;

  if (!forceRefresh) {
    const cached = getMapCacheValue(scannerFieldsCache, cacheKey);
    if (cached) return cached;
  }

  const report: Record<string, string[]> = {};
  const supabase = getSupabaseClient();

  const schemaLookup = await supabase
    .schema("information_schema")
    .from("columns")
    .select("table_name,column_name")
    .eq("table_schema", "public")
    .in("table_name", collectionNames);

  if (!schemaLookup.error) {
    const grouped = new Map<string, Set<string>>();
    (schemaLookup.data ?? []).forEach((row) => {
      const table = asString((row as Record<string, unknown>).table_name).trim();
      const column = asString((row as Record<string, unknown>).column_name).trim();
      if (!table || !column) return;
      const current = grouped.get(table) ?? new Set<string>();
      current.add(column);
      grouped.set(table, current);
    });

    collectionNames.forEach((tableName) => {
      const fields = grouped.get(tableName);
      if (!fields) {
        report[tableName] = [...(SCANNER_FALLBACK_COLUMNS_BY_TABLE[tableName] ?? [])].sort(
          (left, right) => left.localeCompare(right, "pt-BR")
        );
        return;
      }
      report[tableName] = [...fields].sort((left, right) =>
        left.localeCompare(right, "pt-BR")
      );
    });

    setMapCacheValue(scannerFieldsCache, cacheKey, report);
    return report;
  }

  for (const tableName of collectionNames) {
    const fallbackColumns = SCANNER_FALLBACK_COLUMNS_BY_TABLE[tableName] ?? ["id"];
    const mutableColumns = [...fallbackColumns];

    while (mutableColumns.length > 0) {
      const { error } = await supabase
        .from(tableName)
        .select(mutableColumns.join(","))
        .limit(sampleDocsPerCollection);

      if (!error) {
        report[tableName] = [...mutableColumns].sort((left, right) =>
          left.localeCompare(right, "pt-BR")
        );
        break;
      }

      const errorObj = asObject(error) ?? {};
      const code = asString(errorObj.code).toUpperCase();
      if (code === "42P01" || code === "PGRST205") {
        report[tableName] = [];
        break;
      }

      const message = asString(errorObj.message);
      const match =
        message.match(/column\s+[a-z0-9_]+\.(\w+)\s+does not exist/i) ||
        message.match(/could not find the ['"]?(\w+)['"]? column/i);
      const missingColumn = asString(match?.[1]);
      if (!missingColumn) throwSupabaseError(error);

      const nextColumns = mutableColumns.filter(
        (column) => column.toLowerCase() !== missingColumn.toLowerCase()
      );
      if (nextColumns.length === mutableColumns.length) throwSupabaseError(error);
      mutableColumns.splice(0, mutableColumns.length, ...nextColumns);
    }

    if (!(tableName in report)) {
      report[tableName] = [];
    }
  }

  setMapCacheValue(scannerFieldsCache, cacheKey, report);
  return report;
}

export function clearPartnersCaches(): void {
  clearAdminPartnersCaches();
  publicPartnersCache.clear();
  partnerByIdCache.clear();
  partnerScansCache.clear();
  scannerFieldsCache.clear();
}



