import { getSupabaseClient } from "./supabase";
import { isEventExpiredByGrace } from "./eventDateUtils";
import { hydrateEventViewerState } from "./hotPathRelations";
import { toggleEventLike as toggleEventLikeNative } from "./eventsNativeService";
import { fetchTreinoSettings } from "./treinosNativeService";

type CacheEntry<T> = { cachedAt: number; value: T };

type Row = Record<string, unknown>;

const READ_CACHE_TTL_MS = 300_000;
const DASHBOARD_EVENTS_LIMIT = 5;
const DASHBOARD_EVENTS_FETCH_LIMIT = 12;
const DASHBOARD_PRODUCTS_POOL_LIMIT = 18;
const DASHBOARD_TENANT_PRODUCTS_PRIORITY_COUNT = 2;
const DASHBOARD_MINI_VENDOR_PRODUCTS_MAX = 2;
const DASHBOARD_POSTS_LIMIT = 2;
const DASHBOARD_TREINOS_LIMIT = 4;
const DASHBOARD_TREINOS_FETCH_LIMIT = 24;
const DASHBOARD_PARTNERS_LIMIT = 50;
const DASHBOARD_MINI_VENDORS_LIMIT = 200;
const DASHBOARD_LIGAS_DASHBOARD_LIMIT = 2;
const DASHBOARD_LIGAS_QUERY_WINDOW = 6;
const DASHBOARD_LIKES_SAMPLE_PER_PRODUCT = 10;
const DASHBOARD_USERS_IN_CHUNK = 10;
const DASHBOARD_TOTAL_CACA_RPC = "dashboard_total_caca_calouros";
const DASHBOARD_HOME_BUNDLE_RPC = "dashboard_public_home_bundle";
const DASHBOARD_EVENT_GRACE_MS = 24 * 60 * 60 * 1000;
const DASHBOARD_RPC_BREAKER_TTL_MS = 10 * 60 * 1000;
const DASHBOARD_DEGRADED_POSTS_LIMIT = 2;

const DASHBOARD_EVENTS_SELECT =
  "id,titulo,data,hora,local,imagem,tipo,status,stats,imagePositionY,tenant_id";
const DASHBOARD_PRODUCTS_SELECT =
  "id,nome,preco,img,likes,active,aprovado,tenant_id,seller_type,seller_id,createdAt";
const DASHBOARD_MINI_VENDORS_SELECT = "id,status,category_visible,products_visible";
const DASHBOARD_PARTNERS_SELECT =
  "id,nome,imgLogo,imgCapa,categoria,tier,status";
const DASHBOARD_LIGAS_SELECT =
  "id,nome,sigla,foto,logoUrl,logo,descricao,bizu,ativa,visivel,status,likes,createdAt,updatedAt,category";
const DASHBOARD_POSTS_SELECT =
  "id,userId,userName,avatar,createdAt,texto,likes,tenant_id";
const DASHBOARD_TREINOS_SELECT = "id,modalidade,imagem,dia,horario,createdAt,status,tenant_id";

const dashboardCache = new Map<string, CacheEntry<DashboardBundle>>();
let dashboardHomeBundleRpcUnavailableUntil = 0;
let dashboardTotalCacaRpcUnavailableUntil = 0;
const DASHBOARD_INVALIDATION_STORAGE_KEY = "aaakn:dashboard-public:invalidate";

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
const asString = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const asNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const asBoolean = (value: unknown, fallback = false) =>
  typeof value === "boolean" ? value : fallback;
const asInteger = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return fallback;
};
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const normalizeIdList = (value: unknown): string[] =>
  Array.from(
    new Set(
      asStringArray(value)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  );

const isRpcCircuitOpen = (unavailableUntil: number): boolean =>
  unavailableUntil > Date.now();

const openRpcCircuit = (): number => Date.now() + DASHBOARD_RPC_BREAKER_TTL_MS;

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

const toLocalDateKey = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const toDashboardModalidadeKey = (value: unknown): string =>
  asString(value).trim().replace(/\s+/g, " ").slice(0, 40).toLowerCase();

const isActiveDashboardTreino = (row: Row): boolean => {
  const status = asString(row.status, "ativo").toLowerCase().trim();
  return status !== "cancelado" && status !== "encerrado" && status !== "inativo";
};

const compareDashboardTreinoRows = (left: Row, right: Row): number => {
  const dateDiff = asString(left.dia).localeCompare(asString(right.dia));
  if (dateDiff !== 0) return dateDiff;

  const timeDiff = asString(left.horario).localeCompare(asString(right.horario));
  if (timeDiff !== 0) return timeDiff;

  return toMillis(left.createdAt) - toMillis(right.createdAt);
};

const resolveFollowedLeagueIdsFromUserExtra = (
  extra: unknown,
  tenantId?: string
): string[] => {
  const extraData = asObject(extra) ?? {};
  const byTenant = asObject(extraData.followedLeagueIdsByTenant);
  const cleanTenantId = asString(tenantId).trim();

  if (cleanTenantId && byTenant) {
    return normalizeIdList(byTenant[cleanTenantId]);
  }

  return normalizeIdList(extraData.followedLeagueIds);
};

const buildStableSeed = (value: string): number => {
  let seed = 0;
  for (let index = 0; index < value.length; index += 1) {
    seed = (seed * 31 + value.charCodeAt(index)) >>> 0;
  }
  return seed || 1;
};

const seededShuffle = <T>(rows: T[], seedInput: string): T[] => {
  const next = [...rows];
  let seed = buildStableSeed(seedInput);

  for (let index = next.length - 1; index > 0; index -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const swapIndex = seed % (index + 1);
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
};

const normalizeDashboardSellerType = (value: unknown): "tenant" | "mini_vendor" =>
  asString(value).trim().toLowerCase() === "mini_vendor" ? "mini_vendor" : "tenant";

const buildDashboardProductSeed = (tenantId?: string, userId?: string, scope = "products"): string =>
  `${tenantId || "default"}:${userId || "anon"}:${new Date().toISOString().slice(0, 10)}:${scope}`;

const isDashboardMiniVendorReceivingOrders = (row: Row | null): boolean => {
  if (!row) return false;
  const status = asString(row.status, "approved").trim().toLowerCase();
  if (status !== "approved") return false;
  return asBoolean(row.category_visible, true) && asBoolean(row.products_visible, true);
};

const writeDashboardInvalidationMarker = (): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DASHBOARD_INVALIDATION_STORAGE_KEY, String(Date.now()));
  } catch {
    // Ignore storage failures and keep the in-memory invalidation.
  }
};

export const hasPendingDashboardInvalidation = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.localStorage.getItem(DASHBOARD_INVALIDATION_STORAGE_KEY));
  } catch {
    return false;
  }
};

export const acknowledgeDashboardInvalidation = (): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DASHBOARD_INVALIDATION_STORAGE_KEY);
  } catch {
    // Ignore storage failures and allow a later refresh to try again.
  }
};

const getCachedValue = <T>(cache: Map<string, CacheEntry<T>>, key: string): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > READ_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setCachedValue = <T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const isMissingRpcError = (error: { code?: string | null; message?: string | null }): boolean => {
  const code = typeof error.code === "string" ? error.code.toUpperCase() : "";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return (
    code === "PGRST202" ||
    code === "42883" ||
    message.includes("could not find the function") ||
    message.includes("schema cache") ||
    (message.includes("function") && message.includes("does not exist"))
  );
};

const chunkArray = <T>(rows: T[], chunkSize: number): T[][] => {
  if (chunkSize < 1) return [rows];
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += chunkSize) chunks.push(rows.slice(i, i + chunkSize));
  return chunks;
};

const throwSupabaseError = (error: { message: string; code?: string | null; name?: string | null }): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const splitSelectColumns = (selectColumns: string): string[] =>
  selectColumns
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

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

async function fetchRowsWithFallback(
  table: string,
  selectColumns: string,
  attempts: Array<{
    orderBy?: { column: string; ascending: boolean };
    limit: number;
    eq?: Record<string, string | boolean>;
  }>
): Promise<Row[]> {
  const supabase = getSupabaseClient();
  let lastError: unknown = null;

  for (const attempt of attempts) {
    try {
      let mutableColumns = splitSelectColumns(selectColumns);
      let mutableOrderBy = attempt.orderBy;

      while (mutableColumns.length > 0) {
        let q = supabase.from(table).select(mutableColumns.join(","));
        if (attempt.eq) {
          for (const [key, value] of Object.entries(attempt.eq)) {
            q = q.eq(key, value);
          }
        }
        if (mutableOrderBy) {
          q = q.order(mutableOrderBy.column, { ascending: mutableOrderBy.ascending });
        }
        q = q.limit(attempt.limit);
        const { data, error } = await q;
        if (!error) return (data ?? []) as unknown as Row[];

      const missingColumn = extractMissingSchemaColumn(error);
      if (!missingColumn) throw error;
      const safeMissingColumn = missingColumn as string;

      if (
        mutableOrderBy &&
        mutableOrderBy.column.toLowerCase() === safeMissingColumn.toLowerCase()
      ) {
        mutableOrderBy = undefined;
        continue;
      }

      const nextColumns = removeMissingColumn(mutableColumns, safeMissingColumn);
      if (!nextColumns || nextColumns.length === 0) throw error;
      const safeNextColumns = nextColumns as string[];
      mutableColumns = [...safeNextColumns];
      }
    } catch (error: unknown) {
      lastError = error;
    }
  }

  if (lastError && typeof lastError === "object" && lastError !== null && "message" in lastError) {
    throwSupabaseError(lastError as { message: string; code?: string | null; name?: string | null });
  }
  return [];
}

async function fetchDashboardLeaguePreviewRows(tenantId?: string): Promise<Row[]> {
  const cleanTenantId = asString(tenantId).trim();
  const tenantFilter: Record<string, string | boolean> = {};
  if (cleanTenantId) {
    tenantFilter.tenant_id = cleanTenantId;
  }

  return fetchRowsWithFallback("ligas_config", DASHBOARD_LIGAS_SELECT, [
    {
      orderBy: { column: "likes", ascending: false },
      limit: DASHBOARD_LIGAS_QUERY_WINDOW,
      eq: {
        ...tenantFilter,
        visivel: true,
      },
    },
    {
      orderBy: { column: "updatedAt", ascending: false },
      limit: DASHBOARD_LIGAS_QUERY_WINDOW,
      eq: {
        ...tenantFilter,
        visivel: true,
      },
    },
    {
      limit: DASHBOARD_LIGAS_QUERY_WINDOW,
      eq: tenantFilter,
    },
  ]);
}

async function filterDashboardVisibleProductRows(
  rows: Row[],
  tenantId?: string
): Promise<Row[]> {
  const hasMiniVendorRows = rows.some(
    (row) => normalizeDashboardSellerType(row.seller_type) === "mini_vendor"
  );
  if (!hasMiniVendorRows) return rows;

  const cleanTenantId = asString(tenantId).trim();
  if (!cleanTenantId) {
    return rows.filter((row) => normalizeDashboardSellerType(row.seller_type) !== "mini_vendor");
  }

  const miniVendorRows = await fetchRowsWithFallback("mini_vendors", DASHBOARD_MINI_VENDORS_SELECT, [
    {
      limit: DASHBOARD_MINI_VENDORS_LIMIT,
      eq: {
        tenant_id: cleanTenantId,
      },
    },
  ]);
  const miniVendorMap = new Map(
    miniVendorRows
      .map((row) => {
        const id = asString(row.id).trim();
        return id ? ([id, row] as const) : null;
      })
      .filter((entry): entry is readonly [string, Row] => entry !== null)
  );

  return rows.filter((row) => {
    if (normalizeDashboardSellerType(row.seller_type) !== "mini_vendor") {
      return true;
    }

    const sellerId = asString(row.seller_id).trim();
    if (!sellerId) return false;
    return isDashboardMiniVendorReceivingOrders(miniVendorMap.get(sellerId) ?? null);
  });
}

async function fetchDashboardProductRows(options?: {
  tenantId?: string;
}): Promise<Row[]> {
  const cleanTenantId = asString(options?.tenantId).trim();
  const tenantFilter = cleanTenantId ? { tenant_id: cleanTenantId } : null;
  const rows = await fetchRowsWithFallback("produtos", DASHBOARD_PRODUCTS_SELECT, [
    {
      orderBy: { column: "createdAt", ascending: false },
      limit: DASHBOARD_PRODUCTS_POOL_LIMIT,
      eq: {
        active: true,
        aprovado: true,
        ...(tenantFilter ?? {}),
      },
    },
    {
      limit: DASHBOARD_PRODUCTS_POOL_LIMIT,
      eq: {
        active: true,
        aprovado: true,
        ...(tenantFilter ?? {}),
      },
    },
  ]);

  return filterDashboardVisibleProductRows(rows, cleanTenantId || undefined);
}

function selectDashboardProductRows(
  rows: Row[],
  options?: {
    tenantId?: string;
    userId?: string;
  }
): Row[] {
  if (rows.length === 0) return [];

  const seedBase = buildDashboardProductSeed(
    asString(options?.tenantId).trim() || undefined,
    asString(options?.userId).trim() || undefined
  );
  const tenantRows = seededShuffle(
    rows.filter((row) => normalizeDashboardSellerType(row.seller_type) !== "mini_vendor"),
    `${seedBase}:tenant`
  );
  const selectedTenantRows = tenantRows.slice(0, DASHBOARD_TENANT_PRODUCTS_PRIORITY_COUNT);

  const miniVendorProductMap = new Map<string, Row[]>();
  rows.forEach((row) => {
    if (normalizeDashboardSellerType(row.seller_type) !== "mini_vendor") return;
    const sellerId = asString(row.seller_id).trim();
    if (!sellerId) return;
    const currentRows = miniVendorProductMap.get(sellerId) ?? [];
    currentRows.push(row);
    miniVendorProductMap.set(sellerId, currentRows);
  });

  const shuffledMiniVendorIds = seededShuffle(
    Array.from(miniVendorProductMap.keys()),
    `${seedBase}:mini-vendors`
  );
  const miniVendorCount =
    shuffledMiniVendorIds.length <= 1
      ? shuffledMiniVendorIds.length
      : 1 + (buildStableSeed(`${seedBase}:mini-count`) % DASHBOARD_MINI_VENDOR_PRODUCTS_MAX);

  const selectedMiniVendorRows = shuffledMiniVendorIds
    .slice(0, miniVendorCount)
    .map((sellerId) => {
      const sellerRows = miniVendorProductMap.get(sellerId) ?? [];
      return seededShuffle(sellerRows, `${seedBase}:mini-product:${sellerId}`)[0] ?? null;
    })
    .filter((row): row is Row => row !== null);

  const curatedRows = [...selectedTenantRows, ...selectedMiniVendorRows];
  if (curatedRows.length > 0) {
    return curatedRows;
  }

  return seededShuffle(rows, `${seedBase}:fallback`).slice(
    0,
    DASHBOARD_TENANT_PRODUCTS_PRIORITY_COUNT + DASHBOARD_MINI_VENDOR_PRODUCTS_MAX
  );
}

async function resolveDashboardProducts(options?: {
  tenantId?: string;
  userId?: string;
}): Promise<{
  productRows: Row[];
  produtos: DashboardProduct[];
  productTurmaStats: Record<string, DashboardTurmaStat[]>;
}> {
  const productRows = selectDashboardProductRows(
    await fetchDashboardProductRows({ tenantId: options?.tenantId }),
    options
  );
  const produtos = productRows
    .map((row) => normalizeProduto(asString(row.id), row, asString(options?.userId).trim() || undefined))
    .filter((row): row is DashboardProduct => row !== null);
  const productTurmaStats = await buildProductTurmaStats(
    productRows,
    asString(options?.tenantId).trim() || undefined
  );

  return {
    productRows,
    produtos,
    productTurmaStats,
  };
}

async function fetchDashboardEventRows(tenantId?: string, userId?: string): Promise<Row[]> {
  const supabase = getSupabaseClient();
  const scopedTenantId = asString(tenantId).trim();
  const attempts: Array<{ orderBy?: { column: string; ascending: boolean } }> = [
    { orderBy: { column: "data", ascending: true } },
    { orderBy: { column: "createdAt", ascending: false } },
    {},
  ];

  for (const attempt of attempts) {
    let mutableColumns = splitSelectColumns(DASHBOARD_EVENTS_SELECT);
    let mutableOrderBy = attempt.orderBy;

    while (mutableColumns.length > 0) {
      let query = supabase
        .from("eventos")
        .select(mutableColumns.join(","))
        .or("status.is.null,status.not.in.(encerrado,cancelado,inativo)")
        .limit(DASHBOARD_EVENTS_FETCH_LIMIT);

      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }

      if (mutableOrderBy) {
        query = query.order(mutableOrderBy.column, { ascending: mutableOrderBy.ascending });
      }

      const { data, error } = await query;
      if (!error) {
        return hydrateEventViewerState((data ?? []) as unknown as Row[], {
          userId: userId || null,
          tenantId: scopedTenantId || undefined,
        });
      }

      const missingColumn = extractMissingSchemaColumn(error);
      if (typeof missingColumn !== "string" || missingColumn.length === 0) {
        throwSupabaseError(error as { message: string; code?: string | null; name?: string | null });
      }
      const safeMissingColumn = missingColumn as string;

      if (
        mutableOrderBy &&
        mutableOrderBy.column.toLowerCase() === safeMissingColumn.toLowerCase()
      ) {
        mutableOrderBy = undefined;
        continue;
      }

      const nextColumns = removeMissingColumn(mutableColumns, safeMissingColumn);
      if (!nextColumns || nextColumns.length === 0) {
        throwSupabaseError(error as { message: string; code?: string | null; name?: string | null });
      }
      const safeNextColumns = nextColumns as string[];
      mutableColumns = [...safeNextColumns];
    }
  }

  return [];
}

async function safeDashboardUserBaseTotal(
  tenantId?: string,
  userId?: string
): Promise<number> {
  const cleanUserId = asString(userId).trim();
  if (!cleanUserId) return 0;

  const supabase = getSupabaseClient();
  const scopedTenantId = asString(tenantId).trim();
  let query = supabase.from("users").select("uid").eq("uid", cleanUserId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) return 0;
  return data ? 1 : 0;
}

async function safeDashboardTotalCacaFallback(
  tenantId?: string,
  userId?: string
): Promise<number> {
  const cleanUserId = asString(userId).trim();
  if (!cleanUserId) return 0;

  const supabase = getSupabaseClient();
  const scopedTenantId = asString(tenantId).trim();
  const baseTotal = await safeDashboardUserBaseTotal(tenantId, userId);

  let capturesQuery = supabase
    .from("album_captures")
    .select("targetUserId")
    .eq("collectorUserId", cleanUserId);
  if (scopedTenantId) {
    capturesQuery = capturesQuery.eq("tenant_id", scopedTenantId);
  }

  const { data: captureRows, error: captureError } = await capturesQuery;
  if (!captureError) {
    const targetIds = Array.from(
      new Set(
        ((captureRows ?? []) as Row[])
          .map((row) => asString(row.targetUserId).trim())
          .filter((entry) => entry.length > 0)
      )
    );

    if (targetIds.length === 0) {
      return baseTotal;
    }

    let validTargetsQuery = supabase.from("users").select("uid").in("uid", targetIds);
    if (scopedTenantId) {
      validTargetsQuery = validTargetsQuery.eq("tenant_id", scopedTenantId);
    }

    const { data: validTargets, error: validTargetsError } = await validTargetsQuery.limit(
      targetIds.length
    );
    if (!validTargetsError) {
      return Math.max(baseTotal, (validTargets ?? []).length);
    }
  }

  let summaryQuery = supabase
    .from("album_summary")
    .select("totalCollected")
    .eq("userId", cleanUserId);
  if (scopedTenantId) {
    summaryQuery = summaryQuery.eq("tenant_id", scopedTenantId);
  }

  const { data: summaryData, error: summaryError } = await summaryQuery.maybeSingle();
  if (!summaryError && summaryData) {
    return Math.max(
      baseTotal,
      asInteger((summaryData as Record<string, unknown>).totalCollected, 0)
    );
  }

  return baseTotal;
}

async function fetchDashboardTotalCaca(
  tenantId?: string,
  userId?: string
): Promise<number> {
  const cleanUserId = asString(userId).trim();
  if (!cleanUserId) {
    return 0;
  }

  if (isRpcCircuitOpen(dashboardTotalCacaRpcUnavailableUntil)) {
    return safeDashboardTotalCacaFallback(tenantId, cleanUserId);
  }

  const supabase = getSupabaseClient();
  const scopedTenantId = asString(tenantId).trim();
  const { data, error } = await supabase.rpc(DASHBOARD_TOTAL_CACA_RPC, {
    p_tenant_id: scopedTenantId || null,
    p_user_id: cleanUserId,
  });
  if (!error) {
    dashboardTotalCacaRpcUnavailableUntil = 0;
    return Math.max(0, asInteger(data, 0));
  }

  if (isMissingRpcError(error)) {
    dashboardTotalCacaRpcUnavailableUntil = openRpcCircuit();
    return safeDashboardTotalCacaFallback(tenantId, cleanUserId);
  }

  return safeDashboardTotalCacaFallback(tenantId, cleanUserId);
}

async function safeUsersCount(tenantId?: string): Promise<number> {
  const supabase = getSupabaseClient();
  const scopedTenantId = asString(tenantId).trim();
  const countModes: Array<"planned" | "estimated"> = ["planned", "estimated"];

  for (const countMode of countModes) {
    let query = supabase.from("users").select("uid", { count: countMode, head: true });
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { count, error } = await query;
    if (!error && typeof count === "number") {
      return Math.max(0, count);
    }
  }

  return 0;
}

async function fetchUserExtra(userId?: string): Promise<Row | null> {
  const cleanUserId = asString(userId).trim();
  if (!cleanUserId) return null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("extra")
    .eq("uid", cleanUserId)
    .maybeSingle();
  if (error) throwSupabaseError(error);

  return asObject(asObject(data)?.extra);
}

async function fetchDashboardLeagueRows(options: {
  tenantId?: string;
  userId?: string;
}): Promise<Row[]> {
  const cleanTenantId = asString(options.tenantId).trim();
  const cleanUserId = asString(options.userId).trim();
  if (!cleanUserId) {
    return fetchDashboardLeaguePreviewRows(cleanTenantId || undefined);
  }

  const userExtra = await fetchUserExtra(cleanUserId);
  const followedLeagueIds = resolveFollowedLeagueIdsFromUserExtra(
    userExtra,
    cleanTenantId || undefined
  );
  if (!followedLeagueIds.length) {
    return fetchDashboardLeaguePreviewRows(cleanTenantId || undefined);
  }
  const queryLeagueIds =
    followedLeagueIds.length > DASHBOARD_LIGAS_QUERY_WINDOW
      ? seededShuffle(
          followedLeagueIds,
          `${cleanUserId || "anon"}:${cleanTenantId || "default"}:${new Date().toISOString().slice(0, 10)}`
        ).slice(0, DASHBOARD_LIGAS_QUERY_WINDOW)
      : followedLeagueIds;

  const supabase = getSupabaseClient();
  let query = supabase
    .from("ligas_config")
    .select(DASHBOARD_LIGAS_SELECT)
    .in("id", queryLeagueIds)
    .limit(queryLeagueIds.length);
  if (cleanTenantId) {
    query = query.eq("tenant_id", cleanTenantId);
  }

  const { data, error } = await query;
  if (error) throwSupabaseError(error);
  return (data ?? []) as unknown as Row[];
}

async function fetchDashboardTreinoRows(options: {
  tenantId?: string;
  userId?: string;
}): Promise<Row[]> {
  const cleanTenantId = asString(options.tenantId).trim();
  const supabase = getSupabaseClient();
  const today = toLocalDateKey();

  try {
    let query = supabase
      .from("treinos")
      .select(DASHBOARD_TREINOS_SELECT)
      .gte("dia", today)
      .order("dia", { ascending: true })
      .order("horario", { ascending: true })
      .limit(DASHBOARD_TREINOS_FETCH_LIMIT);
    if (cleanTenantId) {
      query = query.eq("tenant_id", cleanTenantId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = ((data ?? []) as Row[])
      .filter(isActiveDashboardTreino)
      .sort(compareDashboardTreinoRows)
      .slice(0, DASHBOARD_TREINOS_LIMIT);

    if (rows.length > 0) return rows;
  } catch (error: unknown) {
    console.warn("[dashboard] Falha ao buscar proximos treinos otimizados; usando fallback.", error);
  }

  const fallbackRows = await fetchRowsWithFallback("treinos", DASHBOARD_TREINOS_SELECT, [
    {
      orderBy: { column: "dia", ascending: true },
      limit: DASHBOARD_TREINOS_FETCH_LIMIT,
      ...(cleanTenantId ? { eq: { tenant_id: cleanTenantId } } : {}),
    },
    { limit: DASHBOARD_TREINOS_FETCH_LIMIT, ...(cleanTenantId ? { eq: { tenant_id: cleanTenantId } } : {}) },
  ]);
  return fallbackRows
    .filter((row) => asString(row.dia) >= today)
    .filter(isActiveDashboardTreino)
    .sort(compareDashboardTreinoRows)
    .slice(0, DASHBOARD_TREINOS_LIMIT);
}

async function resolveDashboardTreinoImages(rows: Row[], tenantId?: string): Promise<string[]> {
  if (rows.length === 0) return [];

  let modalidadeImagens: Record<string, string> = {};
  try {
    const settings = await fetchTreinoSettings({ tenantId });
    modalidadeImagens = settings.modalidadeImagens;
  } catch (error: unknown) {
    console.warn("[dashboard] Falha ao carregar imagens das modalidades de treino.", error);
  }

  return rows
    .map((row) => {
      const modalidadeImage = modalidadeImagens[toDashboardModalidadeKey(row.modalidade)];
      return asString(modalidadeImage).trim() || asString(row.imagem).trim();
    })
    .filter((entry) => entry.length > 0)
    .slice(0, DASHBOARD_TREINOS_LIMIT);
}

async function fetchDashboardTreinoPreviewImages(options: {
  tenantId?: string;
  userId?: string;
}): Promise<string[]> {
  try {
    const rows = await fetchDashboardTreinoRows(options);
    return resolveDashboardTreinoImages(rows, options.tenantId);
  } catch (error: unknown) {
    console.warn("[dashboard] Falha ao montar preview de treinos.", error);
    return [];
  }
}

const normalizeEvento = (id: string, raw: unknown): DashboardEvent | null => {
  const data = asObject(raw);
  if (!data) return null;
  const stats = asObject(data.stats);
  const viewerHasLiked =
    typeof data.viewerHasLiked === "boolean"
      ? data.viewerHasLiked
      : false;
  const viewerIsInterested =
    typeof data.viewerIsInterested === "boolean"
      ? data.viewerIsInterested
      : false;

  return {
    id,
    titulo: asString(data.titulo, "Evento"),
    data: asString(data.data),
    hora: asString(data.hora),
    local: asString(data.local),
    imagem: asString(data.imagem),
    tipo: asString(data.tipo),
    status: asString(data.status, "ativo"),
    likesCount: Math.max(0, asInteger(data.likesCount, asInteger(stats?.likes, 0))),
    viewerHasLiked,
    interessadosCount: Math.max(
      0,
      asInteger(
        data.interessadosCount,
        asInteger(stats?.confirmados, 0) + asInteger(stats?.talvez, 0)
      )
    ),
    viewerIsInterested,
    imagePositionY: asNumber(data.imagePositionY, 50),
  };
};

const normalizeProduto = (
  id: string,
  raw: unknown,
  viewerId?: string
): DashboardProduct | null => {
  const data = asObject(raw);
  if (!data) return null;
  const precoRaw = data.preco;
  const preco: string | number = typeof precoRaw === "string" || typeof precoRaw === "number" ? precoRaw : 0;
  const likes = asStringArray(data.likes);
  const viewerHasLiked =
    typeof data.viewerHasLiked === "boolean"
      ? data.viewerHasLiked
      : Boolean(viewerId && likes.includes(viewerId));

  return {
    id,
    nome: asString(data.nome, "Produto"),
    preco,
    img: asString(data.img),
    likesCount: Math.max(0, asInteger(data.likesCount, likes.length)),
    viewerHasLiked,
  };
};

const normalizeParceiro = (id: string, raw: unknown): DashboardPartner | null => {
  const data = asObject(raw);
  if (!data) return null;
  return {
    id,
    nome: asString(data.nome, "Parceiro"),
    imgLogo: asString(data.imgLogo),
    imgCapa: asString(data.imgCapa) || undefined,
    categoria: asString(data.categoria) || undefined,
    plano: asString(data.plano) || asString(data.tier) || undefined,
    status: asString(data.status) || undefined,
  };
};

const normalizeLiga = (id: string, raw: unknown): DashboardLiga | null => {
  const data = asObject(raw);
  if (!data) return null;
  const logoUrl = asString(data.logoUrl) || undefined;
  const logoLegacy = asString(data.logo) || undefined;
  return {
    id,
    nome: asString(data.nome, "Liga"),
    sigla: asString(data.sigla),
    foto: asString(data.foto) || undefined,
    logoUrl,
    logo: logoLegacy || logoUrl,
    descricao: asString(data.descricao) || undefined,
    bizu: asString(data.bizu) || undefined,
    ativa: asBoolean(data.ativa, false),
    visivel: asBoolean(data.visivel, false),
    status: asString(data.status) || undefined,
    category: asString(data.category || data.categoria || data.tipo) || undefined,
    likes: asNumber(data.likes, 0),
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
};

const isDashboardPrimaryLeague = (liga: DashboardLiga): boolean =>
  (liga.category || "liga").trim().toLowerCase() === "liga";

const normalizePost = (
  id: string,
  raw: unknown,
  viewerId?: string
): DashboardPost | null => {
  const data = asObject(raw);
  if (!data) return null;
  const likes = asStringArray(data.likes);
  const viewerHasLiked =
    typeof data.viewerHasLiked === "boolean"
      ? data.viewerHasLiked
      : Boolean(viewerId && likes.includes(viewerId));
  return {
    id,
    userId: asString(data.userId),
    userName: asString(data.userName, "Usuário"),
    avatar: asString(data.avatar),
    createdAt: data.createdAt ?? null,
    texto: asString(data.texto) || asString(data.text),
    likesCount: Math.max(0, asInteger(data.likesCount, likes.length)),
    viewerHasLiked,
  };
};

async function fetchDashboardBundleViaRpc(options: {
  tenantId?: string;
  userId?: string;
}): Promise<DashboardBundle | undefined> {
  if (isRpcCircuitOpen(dashboardHomeBundleRpcUnavailableUntil)) {
    return undefined;
  }

  const supabase = getSupabaseClient();
  const cleanTenantId = asString(options.tenantId).trim();
  const cleanUserId = asString(options.userId).trim();
  const { data, error } = await supabase.rpc(DASHBOARD_HOME_BUNDLE_RPC, {
    p_tenant_id: cleanTenantId || null,
    p_user_id: cleanUserId || null,
  });

  if (error) {
    dashboardHomeBundleRpcUnavailableUntil = openRpcCircuit();
    console.warn("[dashboard] RPC indisponivel, usando fallback degradado.", error);
    if (isMissingRpcError(error)) {
      return undefined;
    }
    return undefined;
  }

  dashboardHomeBundleRpcUnavailableUntil = 0;

  const payload = asObject(data);
  if (!payload) {
    return undefined;
  }

  const events = asArray(payload.events)
    .map((entry) => normalizeEvento(asString(asObject(entry)?.id), entry))
    .filter((entry): entry is DashboardEvent => entry !== null)
    .filter((event) => {
      const normalizedStatus = asString(event.status, "ativo").toLowerCase().trim();
      if (
        normalizedStatus === "encerrado" ||
        normalizedStatus === "cancelado" ||
        normalizedStatus === "inativo"
      ) {
        return false;
      }
      return !isEventExpiredByGrace(event.data, event.hora, DASHBOARD_EVENT_GRACE_MS);
    })
    .slice(0, DASHBOARD_EVENTS_LIMIT);

  const parceiros = asArray(payload.parceiros)
    .map((entry) => normalizeParceiro(asString(asObject(entry)?.id), entry))
    .filter((entry): entry is DashboardPartner => entry !== null)
    .filter((partner) => (partner.status || "active") === "active");

  let ligasBase = asArray(payload.ligas)
    .map((entry) => normalizeLiga(asString(asObject(entry)?.id), entry))
    .filter((entry): entry is DashboardLiga => entry !== null)
    .filter((liga) => isDashboardPrimaryLeague(liga))
    .filter((liga) => liga.visivel === true)
    .sort((left, right) => (right.likes || 0) - (left.likes || 0));
  if (!ligasBase.length && !cleanUserId) {
    ligasBase = (await fetchDashboardLeaguePreviewRows(cleanTenantId || undefined))
      .map((entry) => normalizeLiga(asString(asObject(entry)?.id), entry))
      .filter((entry): entry is DashboardLiga => entry !== null)
      .filter((liga) => isDashboardPrimaryLeague(liga))
      .filter((liga) => liga.visivel === true)
      .sort((left, right) => (right.likes || 0) - (left.likes || 0));
  }
  const ligas =
    ligasBase.length > DASHBOARD_LIGAS_DASHBOARD_LIMIT
      ? seededShuffle(
          ligasBase,
          `${cleanUserId || "anon"}:${cleanTenantId || "default"}:${new Date().toISOString().slice(0, 10)}`
        )
          .slice(0, DASHBOARD_LIGAS_DASHBOARD_LIMIT)
          .sort((left, right) => (right.likes || 0) - (left.likes || 0))
      : ligasBase;

  const mensagens = asArray(payload.mensagens)
    .sort((left, right) => toMillis(asObject(right)?.createdAt) - toMillis(asObject(left)?.createdAt))
    .map((entry) => normalizePost(asString(asObject(entry)?.id), entry, cleanUserId || undefined))
    .filter((entry): entry is DashboardPost => entry !== null);

  const [dashboardProducts, resolvedTotalCaca, treinos] = await Promise.all([
    resolveDashboardProducts({
      tenantId: cleanTenantId || undefined,
      userId: cleanUserId || undefined,
    }),
    cleanUserId ? fetchDashboardTotalCaca(cleanTenantId || undefined, cleanUserId) : Promise.resolve(0),
    fetchDashboardTreinoPreviewImages({
      tenantId: cleanTenantId || undefined,
      userId: cleanUserId || undefined,
    }),
  ]);

  return {
    events,
    produtos: dashboardProducts.produtos,
    parceiros,
    ligas,
    mensagens,
    treinos,
    totalCaca: resolvedTotalCaca,
    totalAlunos: Math.max(0, asInteger(payload.totalAlunos, 0)),
    productTurmaStats: dashboardProducts.productTurmaStats,
  };
}

async function fetchDashboardDegradedBundle(options: {
  tenantId?: string;
  userId?: string;
}): Promise<DashboardBundle> {
  const tenantId = asString(options.tenantId).trim();
  const userId = asString(options.userId).trim();
  const tenantFilter = tenantId ? { tenant_id: tenantId } : null;

  const [eventRows, dashboardProducts, partnerRows, postRows, totalAlunos, totalCaca, treinos] = await Promise.all([
    fetchDashboardEventRows(tenantId || undefined, userId || undefined),
    resolveDashboardProducts({
      tenantId: tenantId || undefined,
      userId: userId || undefined,
    }),
    fetchRowsWithFallback("parceiros", DASHBOARD_PARTNERS_SELECT, [
      {
        eq: {
          status: "active",
          ...(tenantFilter ?? {}),
        },
        limit: DASHBOARD_PARTNERS_LIMIT,
      },
      { limit: DASHBOARD_PARTNERS_LIMIT, ...(tenantFilter ? { eq: tenantFilter } : {}) },
    ]),
    fetchRowsWithFallback("posts", DASHBOARD_POSTS_SELECT, [
      {
        orderBy: { column: "createdAt", ascending: false },
        limit: DASHBOARD_DEGRADED_POSTS_LIMIT,
        ...(tenantFilter ? { eq: tenantFilter } : {}),
      },
      { limit: DASHBOARD_DEGRADED_POSTS_LIMIT, ...(tenantFilter ? { eq: tenantFilter } : {}) },
    ]),
    safeUsersCount(tenantId || undefined),
    fetchDashboardTotalCaca(tenantId || undefined, userId || undefined),
    fetchDashboardTreinoPreviewImages({
      tenantId: tenantId || undefined,
      userId: userId || undefined,
    }),
  ]);

  const events = eventRows
    .map((row) => normalizeEvento(asString(row.id), row))
    .filter((row): row is DashboardEvent => row !== null)
    .filter((event) => {
      const normalizedStatus = asString(event.status, "ativo").toLowerCase().trim();
      if (
        normalizedStatus === "encerrado" ||
        normalizedStatus === "cancelado" ||
        normalizedStatus === "inativo"
      ) {
        return false;
      }
      return !isEventExpiredByGrace(event.data, event.hora, DASHBOARD_EVENT_GRACE_MS);
    })
    .slice(0, DASHBOARD_EVENTS_LIMIT);
  const parceiros = partnerRows
    .map((row) => normalizeParceiro(asString(row.id), row))
    .filter((row): row is DashboardPartner => row !== null)
    .filter((partner) => (partner.status || "active") === "active");
  const mensagens = [...postRows]
    .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt))
    .map((row) => normalizePost(asString(row.id), row, userId || undefined))
    .filter((row): row is DashboardPost => row !== null);

  return {
    events,
    produtos: dashboardProducts.produtos,
    parceiros,
    ligas: [],
    mensagens,
    treinos,
    totalCaca,
    totalAlunos,
    productTurmaStats: dashboardProducts.productTurmaStats,
  };
}

async function fetchDashboardLegacyFallbackBundle(options: {
  tenantId?: string;
  userId?: string;
}): Promise<DashboardBundle> {
  const tenantId = asString(options.tenantId).trim();
  const userId = asString(options.userId).trim();
  const tenantFilter = tenantId ? { tenant_id: tenantId } : null;

  const [eventRows, dashboardProducts, partnerRows, ligaRows, postRows, treinoRows, totalAlunos, totalCaca] =
    await Promise.all([
      fetchDashboardEventRows(tenantId || undefined, userId || undefined),
      resolveDashboardProducts({
        tenantId: tenantId || undefined,
        userId: userId || undefined,
      }),
      fetchRowsWithFallback("parceiros", DASHBOARD_PARTNERS_SELECT, [
        {
          eq: {
            status: "active",
            ...(tenantFilter ?? {}),
          },
          limit: DASHBOARD_PARTNERS_LIMIT,
        },
        { limit: DASHBOARD_PARTNERS_LIMIT, ...(tenantFilter ? { eq: tenantFilter } : {}) },
      ]),
      fetchDashboardLeagueRows({
        tenantId: tenantId || undefined,
        userId: userId || undefined,
      }),
      fetchRowsWithFallback("posts", DASHBOARD_POSTS_SELECT, [
        {
          orderBy: { column: "createdAt", ascending: false },
          limit: DASHBOARD_POSTS_LIMIT,
          ...(tenantFilter ? { eq: tenantFilter } : {}),
        },
        { limit: DASHBOARD_POSTS_LIMIT, ...(tenantFilter ? { eq: tenantFilter } : {}) },
      ]),
      fetchDashboardTreinoRows({
        tenantId: tenantId || undefined,
        userId: userId || undefined,
      }),
      safeUsersCount(tenantId || undefined),
      fetchDashboardTotalCaca(tenantId || undefined, userId || undefined),
    ]);

  const events = eventRows
    .map((row) => normalizeEvento(asString(row.id), row))
    .filter((row): row is DashboardEvent => row !== null)
    .filter((event) => {
      const normalizedStatus = asString(event.status, "ativo").toLowerCase().trim();
      if (
        normalizedStatus === "encerrado" ||
        normalizedStatus === "cancelado" ||
        normalizedStatus === "inativo"
      ) {
        return false;
      }
      return !isEventExpiredByGrace(event.data, event.hora, DASHBOARD_EVENT_GRACE_MS);
    })
    .slice(0, DASHBOARD_EVENTS_LIMIT);
  const parceiros = partnerRows
    .map((row) => normalizeParceiro(asString(row.id), row))
    .filter((row): row is DashboardPartner => row !== null)
    .filter((partner) => (partner.status || "active") === "active");
  const ligasBase = ligaRows
    .map((row) => normalizeLiga(asString(row.id), row))
    .filter((row): row is DashboardLiga => row !== null)
    .filter((liga) => isDashboardPrimaryLeague(liga))
    .filter((liga) => liga.visivel === true)
    .sort((left, right) => (right.likes || 0) - (left.likes || 0));
  const ligas =
    ligasBase.length > DASHBOARD_LIGAS_DASHBOARD_LIMIT
      ? seededShuffle(
          ligasBase,
          `${userId || "anon"}:${tenantId || "default"}:${new Date().toISOString().slice(0, 10)}`
        )
          .slice(0, DASHBOARD_LIGAS_DASHBOARD_LIMIT)
          .sort((left, right) => (right.likes || 0) - (left.likes || 0))
      : ligasBase;
  const mensagens = [...postRows]
    .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt))
    .map((row) => normalizePost(asString(row.id), row, userId || undefined))
    .filter((row): row is DashboardPost => row !== null);
  const treinos = await resolveDashboardTreinoImages(treinoRows, tenantId || undefined);

  return {
    events,
    produtos: dashboardProducts.produtos,
    parceiros,
    ligas,
    mensagens,
    treinos,
    totalCaca,
    totalAlunos,
    productTurmaStats: dashboardProducts.productTurmaStats,
  };
}

const toTurmaKey = (raw: unknown): string | null => {
  const digits = asString(raw).replace(/\D/g, "");
  return digits ? digits : null;
};

async function fetchUsersTurmaMap(
  uids: string[],
  tenantId?: string
): Promise<Map<string, string>> {
  const supabase = getSupabaseClient();
  const scopedTenantId = asString(tenantId).trim();
  const uniqueIds = [...new Set(uids.filter((entry) => entry.trim().length > 0))];
  const result = new Map<string, string>();
  if (!uniqueIds.length) return result;

  const chunks = chunkArray(uniqueIds, DASHBOARD_USERS_IN_CHUNK);
  for (const chunk of chunks) {
    let query = supabase
      .from("users")
      .select("uid,turma")
      .in("uid", chunk);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { data, error } = await query.limit(chunk.length);
    if (error) throwSupabaseError(error);
    for (const row of data ?? []) {
      const record = row as Record<string, unknown>;
      const uid = asString(record.uid);
      const turma = toTurmaKey(record.turma);
      if (uid && turma) result.set(uid, turma);
    }
  }

  return result;
}

async function buildProductTurmaStats(
  products: Row[],
  tenantId?: string
): Promise<Record<string, DashboardTurmaStat[]>> {
  const likesByProduct = new Map<string, string[]>();
  const sampledUids: string[] = [];

  for (const product of products) {
    const productId = asString(product.id).trim();
    if (!productId) continue;
    const sampled = asStringArray(product.likes).slice(0, DASHBOARD_LIKES_SAMPLE_PER_PRODUCT);
    likesByProduct.set(productId, sampled);
    sampledUids.push(...sampled);
  }

  const turmaByUid = await fetchUsersTurmaMap(sampledUids, tenantId);
  const statsByProduct: Record<string, DashboardTurmaStat[]> = {};

  for (const [productId, likes] of likesByProduct.entries()) {
    const perTurma: Record<string, number> = {};
    for (const uid of likes) {
      const turma = turmaByUid.get(uid);
      if (!turma) continue;
      perTurma[turma] = (perTurma[turma] || 0) + 1;
    }

    statsByProduct[productId] = Object.entries(perTurma)
      .map(([turma, count]) => ({ turma, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 3);
  }

  return statsByProduct;
}

async function toggleArrayMembership(params: {
  table: string;
  id: string;
  column: string;
  userId: string;
  currentlyLiked: boolean;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(params.table)
    .select(`${params.column}`)
    .eq("id", params.id)
    .maybeSingle();
  if (error) throwSupabaseError(error);

  const current = asStringArray(asObject(data)?.[params.column]);
  const next = params.currentlyLiked
    ? current.filter((entry) => entry !== params.userId)
    : Array.from(new Set([...current, params.userId]));

  const { error: updateError } = await supabase
    .from(params.table)
    .update({ [params.column]: next })
    .eq("id", params.id);
  if (updateError) throwSupabaseError(updateError);

  dashboardCache.clear();
}

export interface DashboardTurmaStat {
  turma: string;
  count: number;
}

export interface DashboardEvent {
  id: string;
  titulo: string;
  data: string;
  hora?: string;
  local: string;
  imagem: string;
  tipo: string;
  status?: string;
  likesCount: number;
  viewerHasLiked: boolean;
  interessadosCount: number;
  viewerIsInterested: boolean;
  imagePositionY?: number;
}

export interface DashboardProduct {
  id: string;
  nome: string;
  preco: string | number;
  img: string;
  likesCount: number;
  viewerHasLiked: boolean;
}

export interface DashboardLiga {
  id: string;
  nome: string;
  sigla: string;
  foto?: string;
  logoUrl?: string;
  logo?: string;
  descricao?: string;
  bizu?: string;
  ativa?: boolean;
  visivel?: boolean;
  status?: string;
  category?: string;
  likes: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DashboardPartner {
  id: string;
  nome: string;
  imgLogo: string;
  imgCapa?: string;
  categoria?: string;
  plano?: string;
  status?: string;
}

export interface DashboardPost {
  id: string;
  userId: string;
  userName: string;
  avatar: string;
  createdAt?: unknown;
  texto: string;
  likesCount: number;
  viewerHasLiked: boolean;
}

export interface DashboardBundle {
  events: DashboardEvent[];
  produtos: DashboardProduct[];
  parceiros: DashboardPartner[];
  ligas: DashboardLiga[];
  mensagens: DashboardPost[];
  treinos: string[];
  totalCaca: number;
  totalAlunos: number;
  productTurmaStats: Record<string, DashboardTurmaStat[]>;
}

export async function fetchDashboardBundle(options?: {
  forceRefresh?: boolean;
  tenantId?: string;
  userId?: string;
}): Promise<DashboardBundle> {
  const forceRefresh = options?.forceRefresh ?? false;
  const tenantId = asString(options?.tenantId).trim();
  const userId = asString(options?.userId).trim();
  const cacheKey = `${tenantId || "default"}:${userId || "anon"}`;
  if (!forceRefresh) {
    const cached = getCachedValue(dashboardCache, cacheKey);
    if (cached) return cached;
  }

  const rpcBundle = await fetchDashboardBundleViaRpc({
    tenantId: tenantId || undefined,
    userId: userId || undefined,
  });
  if (rpcBundle) {
    setCachedValue(dashboardCache, cacheKey, rpcBundle);
    return rpcBundle;
  }

  // Mantemos o rebuild legado apenas para refresh explicito/debug.
  // O caminho publico normal degrada de forma barata quando a RPC estrutural nao existe.
  const bundle = forceRefresh
    ? await fetchDashboardLegacyFallbackBundle({
        tenantId: tenantId || undefined,
        userId: userId || undefined,
      })
    : await fetchDashboardDegradedBundle({
        tenantId: tenantId || undefined,
        userId: userId || undefined,
      });

  setCachedValue(dashboardCache, cacheKey, bundle);
  return bundle;
}

export async function toggleDashboardEventLike(payload: { eventId: string; userId: string; currentlyLiked: boolean }): Promise<void> {
  const eventId = payload.eventId.trim();
  const userId = payload.userId.trim();
  if (!eventId || !userId) return;
  await toggleEventLikeNative({
    eventId,
    userId,
    currentlyLiked: payload.currentlyLiked,
  });
}

export async function toggleDashboardProductLike(payload: { productId: string; userId: string; currentlyLiked: boolean }): Promise<void> {
  const productId = payload.productId.trim();
  const userId = payload.userId.trim();
  if (!productId || !userId) return;
  await toggleArrayMembership({ table: "produtos", id: productId, column: "likes", userId, currentlyLiked: payload.currentlyLiked });
}

export async function toggleDashboardPostLike(payload: { postId: string; userId: string; currentlyLiked: boolean }): Promise<void> {
  const postId = payload.postId.trim();
  const userId = payload.userId.trim();
  if (!postId || !userId) return;
  await toggleArrayMembership({ table: "posts", id: postId, column: "likes", userId, currentlyLiked: payload.currentlyLiked });
}

export function clearDashboardCaches(): void {
  dashboardCache.clear();
  writeDashboardInvalidationMarker();
}


