import { getSupabaseClient } from "./supabase";

import { getSupabasePublicClient } from "./supabase";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import {
  canAccessCommerceItem,
  normalizeAvailabilityStatus,
  normalizePaymentConfig,
  normalizePlanPriceEntries,
  normalizePlanVisibilityEntries,
  normalizeSellerSnapshot,
  resolvePlanScopedPrice,
  resolvePlanScopedPriceInfo,
} from "./commerceCatalog";
import {
  fetchMiniVendorProfileById,
  resolveMiniVendorPaymentConfig,
} from "./miniVendorService";
import { incrementUserStats } from "./supabaseData";
type CacheEntry<T> = { cachedAt: number; value: T };
type Row = Record<string, unknown>;
type DateLike = { toDate: () => Date };

const TTL_MS = 120_000;
const MAX_PRODUCTS = 240;
const MAX_ORDERS = 1200;
const MAX_REVIEWS = 600;
const MAX_CATEGORIES = 300;
const USER_REVIEW_EXISTS_LIMIT = 1;
const STORE_PRODUCT_SELECT_COLUMNS =
  "id,tenant_id,nome,preco,precoAntigo,img,descricao,likes,categoria,estoque,lote,tagLabel,tagColor,tagEffect,cores,variantes,caracteristicas,active,aprovado,status,plan_prices,plan_visibility,payment_config,seller_type,seller_id,seller_name,seller_logo_url,vendidos,cliques,createdAt,updatedAt";
const STORE_CATEGORY_SELECT_COLUMNS =
  "id,tenant_id,nome,cover_img,button_color,logo_url,seller_type,seller_id,display_order,visible";
const STORE_REVIEW_SELECT_COLUMNS =
  "id,productId,userId,userName,userAvatar,rating,comment,createdAt,updatedAt";
const STORE_ORDER_SELECT_COLUMNS =
  "id,tenant_id,userId,userName,productId,productName,price,total,quantidade,itens,data,status,payment_config,seller_type,seller_id,seller_name,seller_logo_url,createdAt,updatedAt";

const productsFeedCache = new Map<string, CacheEntry<Row[]>>();
const productsPageCache = new Map<string, CacheEntry<StoreProductsPageResult>>();
const sellerProductsCache = new Map<string, CacheEntry<Row[]>>();
const categoriesCache = new Map<string, CacheEntry<Row[]>>();
const productDetailCache = new Map<string, CacheEntry<StoreProductDetailBundle>>();
const productReviewsPageCache = new Map<string, CacheEntry<StoreProductReviewsPageResult>>();
const productUserReviewCountCache = new Map<string, CacheEntry<number>>();

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const asNum = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;
const asInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return null;
};
const resolveStoreTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

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

const invalidateStoreCaches = (productId?: string): void => {
  productsFeedCache.clear();
  productsPageCache.clear();
  sellerProductsCache.clear();
  categoriesCache.clear();
  if (!productId) {
    productDetailCache.clear();
    productReviewsPageCache.clear();
    productUserReviewCountCache.clear();
    return;
  }
  productDetailCache.forEach((_, key) => {
    if (key.startsWith(`${productId}:`)) productDetailCache.delete(key);
  });
  productReviewsPageCache.forEach((_, key) => {
    if (key.startsWith(`${productId}:`)) productReviewsPageCache.delete(key);
  });
  productUserReviewCountCache.forEach((_, key) => {
    if (key.startsWith(`${productId}:`)) productUserReviewCountCache.delete(key);
  });
};

export const clearStorePublicCaches = (productId?: string): void => {
  invalidateStoreCaches(productId);
};

const throwSupabaseError = (error: { message: string; code?: string | null; name?: string | null }): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
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

const extractNonDefaultLockedColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown };
  const message = [raw.message, raw.details]
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .filter((entry) => entry.length > 0)
    .join(" | ");
  if (!message) return null;

  const match =
    message.match(/non-DEFAULT value into column\s+"([a-z0-9_]+)"/i) ??
    message.match(/non-default value into column\s+'([a-z0-9_]+)'/i);
  return match?.[1] ?? null;
};

const isMissingTenantIdColumn = (error: unknown): boolean =>
  extractMissingSchemaColumn(error)?.trim().toLowerCase() === "tenant_id";

const toDateLike = (value: unknown): DateLike | null => {
  if (!value) return null;
  if (typeof value === "object" && value !== null && "toDate" in (value as Record<string, unknown>)) {
    const fn = (value as { toDate?: unknown }).toDate;
    if (typeof fn === "function") {
      return { toDate: () => (fn as () => Date)() };
    }
  }
  if (typeof value === "string" || value instanceof Date || typeof value === "number") {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return { toDate: () => date };
    }
  }
  return null;
};

const normalizeRowTimestamps = (row: Row): Row => {
  const next: Row = { ...row };
  for (const key of ["createdAt", "updatedAt", "timestamp", "dataSolicitacao"]) {
    if (key in next) {
      next[key] = toDateLike(next[key]);
    }
  }
  return next;
};

const collectUserPlanEntries = (
  value?: Array<string | null | undefined>
): string[] =>
  (value ?? [])
    .map((entry) => asString(entry).trim())
    .filter((entry) => entry.length > 0);

const normalizeProductRow = (
  row: Row,
  options?: {
    userPlanNames?: Array<string | null | undefined>;
    userPlanIds?: Array<string | null | undefined>;
  }
): Row | null => {
  const userPlanNames = collectUserPlanEntries(options?.userPlanNames);
  const userPlanIds = collectUserPlanEntries(options?.userPlanIds);
  const planVisibility = normalizePlanVisibilityEntries(row.plan_visibility);

  if (
    !canAccessCommerceItem({
      entries: planVisibility,
      userPlanIds,
      userPlanNames,
    })
  ) {
    return null;
  }

  return {
    ...normalizeRowTimestamps(row),
    preco_base: asNum(row.preco, 0),
    preco: resolvePlanScopedPriceInfo({
      basePrice: asNum(row.preco, 0),
      entries: normalizePlanPriceEntries(row.plan_prices),
      userPlanIds,
      userPlanNames,
    }).finalPrice,
    status: normalizeAvailabilityStatus(row.status, row.active === false ? "esgotado" : "ativo"),
    plan_prices: normalizePlanPriceEntries(row.plan_prices),
    plan_visibility: planVisibility,
    payment_config: normalizePaymentConfig(row.payment_config),
    seller: normalizeSellerSnapshot({
      type: row.seller_type,
      id: row.seller_id,
      name: row.seller_name,
      logoUrl: row.seller_logo_url,
    }),
  };
};

const normalizeCategoryRow = (row: Row): Row => ({
  ...normalizeRowTimestamps(row),
  cover_img: asString(row.cover_img),
  button_color: asString(row.button_color),
  logo_url: asString(row.logo_url),
  display_order: asInt(row.display_order),
  visible: typeof row.visible === "boolean" ? row.visible : true,
  is_receiving_orders: asBoolean(row.is_receiving_orders),
  seller: normalizeSellerSnapshot({
    type: row.seller_type,
    id: row.seller_id,
    name: row.nome,
    logoUrl: row.logo_url,
  }),
});

const normalizeOrderRow = (row: Row): Row => ({
  ...normalizeRowTimestamps(row),
  payment_config: normalizePaymentConfig(row.payment_config),
  seller: normalizeSellerSnapshot({
    type: row.seller_type,
    id: row.seller_id,
    name: row.seller_name,
    logoUrl: row.seller_logo_url,
  }),
});

const resolveMiniVendorProductPaymentConfig = async (options: {
  tenantId: string;
  seller: { type: "tenant" | "mini_vendor"; id: string } | null;
}): Promise<Row | null> => {
  if (!options.tenantId || options.seller?.type !== "mini_vendor" || !options.seller.id) {
    return null;
  }

  const profile = await fetchMiniVendorProfileById({
    tenantId: options.tenantId,
    miniVendorId: options.seller.id,
    forceRefresh: false,
  });
  return resolveMiniVendorPaymentConfig(profile);
};

const sortStoreCategoryRows = <T extends Row>(rows: T[]): T[] =>
  [...rows].sort((left, right) => {
    const leftMiniVendor = asString(left.seller_type).trim().toLowerCase() === "mini_vendor";
    const rightMiniVendor = asString(right.seller_type).trim().toLowerCase() === "mini_vendor";
    if (leftMiniVendor !== rightMiniVendor) {
      return leftMiniVendor ? 1 : -1;
    }

    const leftOrder = asInt(left.display_order);
    const rightOrder = asInt(right.display_order);
    if (leftOrder !== null || rightOrder !== null) {
      if (leftOrder === null) return 1;
      if (rightOrder === null) return -1;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    }

    return asString(left.nome).localeCompare(asString(right.nome), "pt-BR", {
      sensitivity: "base",
    });
  });

async function queryRows(table: string, options?: {
  selectColumns?: string;
  eq?: Record<string, string | number | boolean>;
  orderBy?: { column: string; ascending: boolean };
  limit?: number;
  tenantId?: string | null;
  client?: ReturnType<typeof getSupabaseClient>;
}): Promise<Row[]> {
  const supabase = options?.client ?? getSupabaseClient();
  let selectColumns = (options?.selectColumns ?? "id")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const scopedTenantId = resolveStoreTenantId(options?.tenantId);
  let canFilterByTenant = scopedTenantId.length > 0;
  let canOrderBy = Boolean(options?.orderBy?.column);

  while (selectColumns.length > 0) {
    let query = supabase.from(table).select(selectColumns.join(","));

    if (options?.eq) {
      for (const [column, value] of Object.entries(options.eq)) {
        query = query.eq(column, value);
      }
    }
    if (canFilterByTenant) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    if (canOrderBy && options?.orderBy) {
      query = query.order(options.orderBy.column, { ascending: options.orderBy.ascending });
    }
    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (!error) {
      const rows = (data ?? []) as unknown as Row[];
      return rows.map((row) => normalizeRowTimestamps(row));
    }

    const missingColumn = extractMissingSchemaColumn(error)?.trim().toLowerCase() || "";
    if (missingColumn) {
      if (canFilterByTenant && missingColumn === "tenant_id") {
        canFilterByTenant = false;
        continue;
      }
      if (
        canOrderBy &&
        options?.orderBy?.column &&
        missingColumn === options.orderBy.column.trim().toLowerCase()
      ) {
        canOrderBy = false;
        continue;
      }

      const nextColumns = selectColumns.filter((column) => {
        const normalizedColumn = column.trim().toLowerCase();
        return (
          normalizedColumn.length > 0 &&
          normalizedColumn !== missingColumn &&
          !normalizedColumn.endsWith(`.${missingColumn}`)
        );
      });
      if (nextColumns.length > 0 && nextColumns.length < selectColumns.length) {
        selectColumns = nextColumns;
        continue;
      }
    }

    if (scopedTenantId && isMissingTenantIdColumn(error)) {
      return [];
    }
    throwSupabaseError(error);
  }

  return [];
}

export interface StoreProductDetailBundle {
  produto: Row | null;
  reviews: Row[];
  userOrders: Row[];
}

export interface StoreProductReviewsPageResult {
  reviews: Row[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  totalCount: number | null;
}

export interface StoreProductsPageResult {
  products: Row[];
  hasMore: boolean;
  page: number;
  pageSize: number;
  category: string | null;
}

export async function fetchStoreCategories(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<Row[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 80, MAX_CATEGORIES);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveStoreTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "all"}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(categoriesCache, cacheKey);
    if (cached) return cached;
  }

  const publicSupabase = getSupabasePublicClient();
  let rows: Row[] = [];
  try {
    rows = await queryRows("categorias", {
      selectColumns: STORE_CATEGORY_SELECT_COLUMNS,
      orderBy: { column: "display_order", ascending: true },
      limit: maxResults,
      tenantId: scopedTenantId,
      client: publicSupabase,
    });
  } catch {
    rows = await queryRows("categorias", {
      selectColumns: STORE_CATEGORY_SELECT_COLUMNS,
      limit: maxResults,
      tenantId: scopedTenantId,
      client: publicSupabase,
    });
  }

  const categoryMap = new Map<string, Row>();

  rows.forEach((row) => {
    const normalized = normalizeCategoryRow(row);
    const key = `${asString(normalized.seller_type).trim().toLowerCase()}:${asString(
      normalized.seller_id
    ).trim() || "_"}:${asString(normalized.nome).trim().toLowerCase()}`;
    categoryMap.set(key, normalized);
  });

  const normalizedRows = sortStoreCategoryRows(Array.from(categoryMap.values()));
  setCache(categoriesCache, cacheKey, normalizedRows);
  return normalizedRows;
}

export async function fetchStoreProductsPage(options?: {
  page?: number;
  pageSize?: number;
  category?: string | null;
  forceRefresh?: boolean;
  tenantId?: string | null;
  userPlanNames?: Array<string | null | undefined>;
  userPlanIds?: Array<string | null | undefined>;
}): Promise<StoreProductsPageResult> {
  const supabase = getSupabasePublicClient();
  const scopedTenantId = resolveStoreTenantId(options?.tenantId);
  const page = Math.max(1, Math.floor(options?.page ?? 1));
  const pageSize = boundedLimit(options?.pageSize ?? 20, 60);
  const categoryRaw = asString(options?.category).trim();
  const category = categoryRaw && categoryRaw !== "Todos" ? categoryRaw : null;
  const forceRefresh = options?.forceRefresh ?? false;
  const planNameKey = collectUserPlanEntries(options?.userPlanNames).join("|");
  const planIdKey = collectUserPlanEntries(options?.userPlanIds).join("|");
  const cacheKey = `${scopedTenantId || "all"}:${category || "all"}:${page}:${pageSize}:${planNameKey}:${planIdKey}`;

  if (!forceRefresh) {
    const cached = getCache(productsPageCache, cacheKey);
    if (cached) return cached;
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize; // inclui +1 item para detectar hasMore (range e inclusivo)

  const runQuery = async (withOrder: boolean): Promise<Row[]> => {
    let query = supabase.from("produtos").select(STORE_PRODUCT_SELECT_COLUMNS);
    query = query.eq("active", true).eq("aprovado", true);
    if (scopedTenantId) query = query.eq("tenant_id", scopedTenantId);
    if (category) query = query.eq("categoria", category);
    if (withOrder) {
      query = query.order("nome", { ascending: true });
    }
    query = query.range(from, to);

    const { data, error } = await query;
    if (error) {
      if (scopedTenantId && isMissingTenantIdColumn(error)) {
        return [];
      }
      throwSupabaseError(error);
    }
    return (data ?? []).map((row) => normalizeRowTimestamps(row as Row));
  };

  let rows: Row[] = [];
  try {
    rows = await runQuery(true);
  } catch {
    rows = await runQuery(false);
  }

  const visibleRows = rows
    .map((row) =>
      normalizeProductRow(row, {
        userPlanNames: options?.userPlanNames,
        userPlanIds: options?.userPlanIds,
      })
    )
    .filter((row): row is Row => row !== null);

  const result: StoreProductsPageResult = {
    products: visibleRows.slice(0, pageSize),
    hasMore: visibleRows.length > pageSize,
    page,
    pageSize,
    category,
  };

  setCache(productsPageCache, cacheKey, result);
  return result;
}

export async function fetchStoreProducts(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
  userPlanNames?: Array<string | null | undefined>;
  userPlanIds?: Array<string | null | undefined>;
}): Promise<Row[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 80, MAX_PRODUCTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveStoreTenantId(options?.tenantId);
  const planNameKey = collectUserPlanEntries(options?.userPlanNames).join("|");
  const planIdKey = collectUserPlanEntries(options?.userPlanIds).join("|");
  const cacheKey = `${scopedTenantId || "all"}:${maxResults}:${planNameKey}:${planIdKey}`;

  if (!forceRefresh) {
    const cached = getCache(productsFeedCache, cacheKey);
    if (cached) return cached;
  }

  const publicSupabase = getSupabasePublicClient();
  const runQuery = async (withOrder: boolean): Promise<Row[]> => {
    return queryRows("produtos", withOrder
      ? {
          selectColumns: STORE_PRODUCT_SELECT_COLUMNS,
          eq: { active: true, aprovado: true },
          orderBy: { column: "nome", ascending: true },
          limit: maxResults,
          tenantId: scopedTenantId,
          client: publicSupabase,
        }
      : {
          selectColumns: STORE_PRODUCT_SELECT_COLUMNS,
          eq: { active: true, aprovado: true },
          limit: maxResults,
          tenantId: scopedTenantId,
          client: publicSupabase,
        });
  };

  let rows: Row[] = [];
  try {
    rows = await runQuery(true);
  } catch {
    rows = await runQuery(false);
  }

  const normalizedRows = rows
    .map((row) =>
      normalizeProductRow(row, {
        userPlanNames: options?.userPlanNames,
        userPlanIds: options?.userPlanIds,
      })
    )
    .filter((row): row is Row => row !== null);

  setCache(productsFeedCache, cacheKey, normalizedRows);
  return normalizedRows;
}

export async function fetchStoreProductsBySeller(options: {
  seller: { type: "tenant" | "mini_vendor"; id: string };
  tenantId?: string | null;
  maxResults?: number;
  forceRefresh?: boolean;
  userPlanNames?: Array<string | null | undefined>;
  userPlanIds?: Array<string | null | undefined>;
}): Promise<Row[]> {
  const scopedTenantId = resolveStoreTenantId(options.tenantId);
  const sellerId = asString(options.seller?.id).trim();
  const sellerType = options.seller?.type === "mini_vendor" ? "mini_vendor" : "tenant";
  if (!sellerId) return [];

  const maxResults = boundedLimit(options.maxResults ?? 24, MAX_PRODUCTS);
  const forceRefresh = options.forceRefresh ?? false;
  const planNameKey = collectUserPlanEntries(options?.userPlanNames).join("|");
  const planIdKey = collectUserPlanEntries(options?.userPlanIds).join("|");
  const cacheKey = `${scopedTenantId || "all"}:${sellerType}:${sellerId}:${maxResults}:${planNameKey}:${planIdKey}`;

  if (!forceRefresh) {
    const cached = getCache(sellerProductsCache, cacheKey);
    if (cached) return cached;
  }

  const publicSupabase = getSupabasePublicClient();
  const runQuery = async (withOrder: boolean): Promise<Row[]> => {
    return queryRows(
      "produtos",
      withOrder
        ? {
            selectColumns: STORE_PRODUCT_SELECT_COLUMNS,
            eq: {
              active: true,
              aprovado: true,
              seller_type: sellerType,
              seller_id: sellerId,
            },
            orderBy: { column: "nome", ascending: true },
            limit: maxResults,
            tenantId: scopedTenantId,
            client: publicSupabase,
          }
        : {
            selectColumns: STORE_PRODUCT_SELECT_COLUMNS,
            eq: {
              active: true,
              aprovado: true,
              seller_type: sellerType,
              seller_id: sellerId,
            },
            limit: maxResults,
            tenantId: scopedTenantId,
            client: publicSupabase,
          }
    );
  };

  let rows: Row[] = [];
  try {
    rows = await runQuery(true);
  } catch {
    rows = await runQuery(false);
  }

  const normalizedRows = rows
    .map((row) =>
      normalizeProductRow(row, {
        userPlanNames: options?.userPlanNames,
        userPlanIds: options?.userPlanIds,
      })
    )
    .filter((row): row is Row => row !== null);

  setCache(sellerProductsCache, cacheKey, normalizedRows);
  return normalizedRows;
}

export async function fetchStoreProductDetail(options: {
  productId: string;
  userId?: string | null;
  reviewsLimit?: number;
  ordersLimit?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
  userPlanNames?: Array<string | null | undefined>;
  userPlanIds?: Array<string | null | undefined>;
}): Promise<StoreProductDetailBundle> {
  const supabase = getSupabasePublicClient();
  const scopedTenantId = resolveStoreTenantId(options.tenantId);
  const productId = options.productId.trim();
  const userId = options.userId?.trim() || "";
  if (!productId) return { produto: null, reviews: [], userOrders: [] };

  const requestedReviewsLimit = Number(options.reviewsLimit ?? 40);
  const shouldFetchReviews = Number.isFinite(requestedReviewsLimit) ? requestedReviewsLimit > 0 : true;
  const reviewsLimit = shouldFetchReviews
    ? boundedLimit(requestedReviewsLimit, MAX_REVIEWS)
    : 0;
  const ordersLimit = boundedLimit(options.ordersLimit ?? 20, MAX_ORDERS);
  const forceRefresh = options.forceRefresh ?? false;
  const planNameKey = collectUserPlanEntries(options?.userPlanNames).join("|");
  const planIdKey = collectUserPlanEntries(options?.userPlanIds).join("|");
  const cacheKey = `${scopedTenantId || "all"}:${productId}:${userId}:${reviewsLimit}:${ordersLimit}:${planNameKey}:${planIdKey}`;

  if (!forceRefresh) {
    const cached = getCache(productDetailCache, cacheKey);
    if (cached) return cached;
  }

  let productQuery = supabase
    .from("produtos")
    .select(STORE_PRODUCT_SELECT_COLUMNS)
    .eq("id", productId);
  if (scopedTenantId) {
    productQuery = productQuery.eq("tenant_id", scopedTenantId);
  }
  const { data: productData, error: productError } = await productQuery.maybeSingle();
  if (productError) {
    if (scopedTenantId && isMissingTenantIdColumn(productError)) {
      return { produto: null, reviews: [], userOrders: [] };
    }
    throwSupabaseError(productError);
  }
  const produtoCandidate = productData
    ? normalizeProductRow(productData as Row, {
        userPlanNames: options.userPlanNames,
        userPlanIds: options.userPlanIds,
      })
    : null;
  const produto =
    produtoCandidate &&
    (produtoCandidate.active === false || produtoCandidate.aprovado === false)
      ? null
      : produtoCandidate;

  const reviewsPromise = shouldFetchReviews
    ? queryRows("reviews", {
      selectColumns: STORE_REVIEW_SELECT_COLUMNS,
      eq: { productId },
      orderBy: { column: "createdAt", ascending: false },
      limit: reviewsLimit,
      tenantId: scopedTenantId,
      client: supabase,
    }).catch(() =>
      queryRows("reviews", {
        selectColumns: STORE_REVIEW_SELECT_COLUMNS,
        eq: { productId },
        limit: reviewsLimit,
        tenantId: scopedTenantId,
        client: supabase,
      })
    )
    : Promise.resolve([] as Row[]);

  const sessionSupabase = getSupabaseClient();
  const ordersPromise = userId
    ? queryRows("orders", {
        selectColumns: STORE_ORDER_SELECT_COLUMNS,
        eq: { userId, productId },
        orderBy: { column: "createdAt", ascending: false },
        limit: ordersLimit,
        tenantId: scopedTenantId,
        client: sessionSupabase,
      }).catch(() =>
        queryRows("orders", {
          selectColumns: STORE_ORDER_SELECT_COLUMNS,
          eq: { userId, productId },
          limit: ordersLimit,
          tenantId: scopedTenantId,
          client: sessionSupabase,
        })
      )
    : Promise.resolve([] as Row[]);

  const [reviews, userOrders] = await Promise.all([reviewsPromise, ordersPromise]);
  const bundle = {
    produto,
    reviews,
    userOrders: userOrders.map((row) => normalizeOrderRow(row)),
  };
  setCache(productDetailCache, cacheKey, bundle);
  return bundle;
}

export async function fetchStoreProductReviewsPage(options: {
  productId: string;
  page?: number;
  pageSize?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<StoreProductReviewsPageResult> {
  const supabase = getSupabasePublicClient();
  const scopedTenantId = resolveStoreTenantId(options.tenantId);
  const productId = options.productId.trim();
  if (!productId) {
    return { reviews: [], page: 1, pageSize: 20, hasMore: false, totalCount: 0 };
  }

  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = boundedLimit(options.pageSize ?? 20, 60);
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `${scopedTenantId || "all"}:${productId}:${page}:${pageSize}`;

  if (!forceRefresh) {
    const cached = getCache(productReviewsPageCache, cacheKey);
    if (cached) return cached;
  }

  const from = (page - 1) * pageSize;
  const fetchTo = from + pageSize;

  const runQuery = async (withOrder: boolean) => {
    let query = supabase
      .from("reviews")
      .select(STORE_REVIEW_SELECT_COLUMNS)
      .eq("productId", productId)
      .range(from, fetchTo);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    if (withOrder) {
      query = query.order("createdAt", { ascending: false });
    }
    return query;
  };

  let data: unknown[] = [];

  try {
    const { data: rows, error } = await runQuery(true);
    if (error) {
      if (scopedTenantId && isMissingTenantIdColumn(error)) {
        const emptyResult: StoreProductReviewsPageResult = {
          reviews: [],
          page,
          pageSize,
          hasMore: false,
          totalCount: 0,
        };
        setCache(productReviewsPageCache, cacheKey, emptyResult);
        return emptyResult;
      }
      throwSupabaseError(error);
    }
    data = rows ?? [];
  } catch {
    const { data: rows, error } = await runQuery(false);
    if (error) {
      if (scopedTenantId && isMissingTenantIdColumn(error)) {
        const emptyResult: StoreProductReviewsPageResult = {
          reviews: [],
          page,
          pageSize,
          hasMore: false,
          totalCount: 0,
        };
        setCache(productReviewsPageCache, cacheKey, emptyResult);
        return emptyResult;
      }
      throwSupabaseError(error);
    }
    data = rows ?? [];
  }

  const pageRows = (data as Row[]).slice(0, pageSize);
  const reviews = pageRows.map((row) => normalizeRowTimestamps(row));
  const hasMore = (data as Row[]).length > pageSize;
  const totalCount = hasMore ? null : from + reviews.length;

  const result: StoreProductReviewsPageResult = {
    reviews,
    page,
    pageSize,
    hasMore,
    totalCount,
  };
  setCache(productReviewsPageCache, cacheKey, result);
  return result;
}

export async function fetchStoreProductUserReviewCount(options: {
  productId: string;
  userId: string;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<number> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveStoreTenantId(options.tenantId);
  const productId = options.productId.trim();
  const userId = options.userId.trim();
  if (!productId || !userId) return 0;

  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `${scopedTenantId || "all"}:${productId}:${userId}`;
  if (!forceRefresh) {
    const cached = getCache(productUserReviewCountCache, cacheKey);
    if (cached !== null) return cached;
  }

  let query = supabase
    .from("reviews")
    .select("id")
    .eq("productId", productId)
    .eq("userId", userId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.limit(USER_REVIEW_EXISTS_LIMIT);
  if (error) {
    if (scopedTenantId && isMissingTenantIdColumn(error)) {
      setCache(productUserReviewCountCache, cacheKey, 0);
      return 0;
    }
    throwSupabaseError(error);
  }

  const normalized = Array.isArray(data) && data.length > 0 ? 1 : 0;
  setCache(productUserReviewCountCache, cacheKey, normalized);
  return normalized;
}

export async function toggleStoreProductLike(payload: {
  productId: string;
  userId: string;
  currentlyLiked: boolean;
  tenantId?: string | null;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const productId = payload.productId.trim();
  const userId = payload.userId.trim();
  const scopedTenantId = resolveStoreTenantId(payload.tenantId);
  if (!productId || !userId) return;

  let selectQuery = supabase.from("produtos").select("likes").eq("id", productId);
  if (scopedTenantId) {
    selectQuery = selectQuery.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await selectQuery.maybeSingle();
  if (error) throwSupabaseError(error);

  const currentLikes = asArray(asObject(data)?.likes).filter((v): v is string => typeof v === "string");
  const nextLikes = payload.currentlyLiked
    ? currentLikes.filter((entry) => entry !== userId)
    : Array.from(new Set([...currentLikes, userId]));

  let updateQuery = supabase
    .from("produtos")
    .update({ likes: nextLikes, updatedAt: new Date().toISOString() })
    .eq("id", productId);
  if (scopedTenantId) {
    updateQuery = updateQuery.eq("tenant_id", scopedTenantId);
  }
  const { error: updateError } = await updateQuery;
  if (updateError) throwSupabaseError(updateError);

  try {
    await incrementUserStats(
      userId,
      { likesGiven: payload.currentlyLiked ? -1 : 1 },
      { tenantId: scopedTenantId || undefined }
    );
  } catch (statsError: unknown) {
    console.warn("Loja: falha ao sincronizar curtida de produto.", statsError);
  }

  invalidateStoreCaches(productId);
}

export async function createStoreOrder(payload: {
  userId: string;
  userName: string;
  productId: string;
  productName: string;
  price: number;
  quantity?: number;
  color?: string;
  tenantId?: string | null;
  userPlanNames?: Array<string | null | undefined>;
  userPlanIds?: Array<string | null | undefined>;
  paymentConfig?: Record<string, unknown> | null;
}): Promise<{ id: string }> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveStoreTenantId(payload.tenantId);
  const quantity = Math.max(1, Math.floor(Number(payload.quantity ?? 1) || 1));
  const fallbackUnitPrice = Math.max(0, asNum(payload.price, 0));
  const userPlanNames = collectUserPlanEntries(payload.userPlanNames);
  const userPlanIds = collectUserPlanEntries(payload.userPlanIds);
  const requestPayload = {
    userId: payload.userId.trim(),
    userName: payload.userName.trim() || "Aluno",
    productId: payload.productId.trim(),
    productName: payload.productName.trim() || "Produto",
    price: 0,
    quantidade: quantity,
    total: 0,
    data: payload.color?.trim()
      ? { corSelecionada: payload.color.trim() }
      : undefined,
  };

  let productLookup = supabase
    .from("produtos")
    .select("id,preco,plan_prices,payment_config,seller_type,seller_id,seller_name,seller_logo_url")
    .eq("id", requestPayload.productId);
  if (scopedTenantId) {
    productLookup = productLookup.eq("tenant_id", scopedTenantId);
  }
  const { data: productRow, error: productError } = await productLookup.maybeSingle();
  if (productError) throwSupabaseError(productError);
  if (!productRow) {
    throw new Error("Produto fora do tenant ativo.");
  }

  const resolvedUnitPrice = resolvePlanScopedPrice({
    basePrice: asNum(asObject(productRow)?.preco, fallbackUnitPrice),
    entries: normalizePlanPriceEntries(asObject(productRow)?.plan_prices),
    userPlanIds,
    userPlanNames,
  });
  const totalPrice = Number((resolvedUnitPrice * quantity).toFixed(2));
  requestPayload.price = totalPrice;
  requestPayload.total = totalPrice;

  const baseInsertPayload: Record<string, unknown> = {
    ...requestPayload,
    ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
    status: "pendente",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (baseInsertPayload.data === undefined) {
    delete baseInsertPayload.data;
  }

  const seller = normalizeSellerSnapshot({
    type: asObject(productRow)?.seller_type,
    id: asObject(productRow)?.seller_id,
    name: asObject(productRow)?.seller_name,
    logoUrl: asObject(productRow)?.seller_logo_url,
  });
  const effectivePaymentConfig =
    normalizePaymentConfig(payload.paymentConfig) ??
    normalizePaymentConfig(asObject(productRow)?.payment_config) ??
    await resolveMiniVendorProductPaymentConfig({
      tenantId: scopedTenantId,
      seller: seller
        ? {
            type: seller.type,
            id: seller.id,
          }
        : null,
    });

  const nonRemovableColumns = new Set([
    "userId",
    "userName",
    "productId",
    "productName",
    "price",
    "status",
  ]);

  let mutableInsertPayload = { ...baseInsertPayload };
  if (effectivePaymentConfig) {
    mutableInsertPayload.payment_config = effectivePaymentConfig;
  }
  if (seller) {
    mutableInsertPayload.seller_type = seller.type;
    mutableInsertPayload.seller_id = seller.id;
    mutableInsertPayload.seller_name = seller.name;
    mutableInsertPayload.seller_logo_url = seller.logoUrl;
  }
  let createdOrderId = "";

  while (Object.keys(mutableInsertPayload).length > 0) {
    const { data, error } = await supabase
      .from("orders")
      .insert(mutableInsertPayload)
      .select("id")
      .single();

    if (!error) {
      createdOrderId = asString(asObject(data)?.id);
      break;
    }

    const problematicColumn =
      extractMissingSchemaColumn(error) || extractNonDefaultLockedColumn(error);
    const resolvedProblematicColumn = problematicColumn ?? "";

    if (!resolvedProblematicColumn || nonRemovableColumns.has(resolvedProblematicColumn)) {
      throwSupabaseError(error);
    }

    if (!Object.prototype.hasOwnProperty.call(mutableInsertPayload, resolvedProblematicColumn)) {
      throwSupabaseError(error);
    }

    const removableColumn = resolvedProblematicColumn;
    const nextPayload = { ...mutableInsertPayload };
    delete nextPayload[removableColumn];

    if (Object.keys(nextPayload).length === Object.keys(mutableInsertPayload).length) {
      throwSupabaseError(error);
    }
    mutableInsertPayload = nextPayload;
  }

  if (!createdOrderId) {
    throw new Error("Nao foi possivel registrar o pedido.");
  }

  await supabase.from("notifications").insert({
    userId: requestPayload.userId,
    title: "Compra em Analise",
    message: `Seu pedido de ${requestPayload.productName} foi enviado para aprovacao.`,
    link: `/loja/${requestPayload.productId}`,
    read: false,
    type: "order",
    createdAt: new Date().toISOString(),
  });

  try {
    await incrementUserStats(
      requestPayload.userId,
      {
        storeOrders: 1,
        storeItemsCount: 1,
        uniqueProductsBought: 1,
        moneySpent: totalPrice,
        storeSpent: totalPrice,
        ...(seller?.type === "mini_vendor" ? { miniVendorOrders: 1 } : {}),
      },
      { tenantId: scopedTenantId || undefined }
    );
  } catch (statsError: unknown) {
    console.warn("Loja: falha ao sincronizar pedido.", statsError);
  }

  invalidateStoreCaches(requestPayload.productId);
  return { id: createdOrderId };
}

export async function cancelStoreOrderRequest(orderIdRaw: string): Promise<void> {
  const supabase = getSupabaseClient();
  const orderId = orderIdRaw.trim();
  const scopedTenantId = resolveStoreTenantId();
  if (!orderId) return;

  let query = supabase.from("orders").delete().eq("id", orderId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { error } = await query;
  if (error) throwSupabaseError(error);

  invalidateStoreCaches();
}

export async function createStoreReview(payload: {
  productId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  rating: number;
  comment: string;
  tenantId?: string | null;
}): Promise<{ id: string }> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveStoreTenantId(payload.tenantId);
  const requestPayload = {
    productId: payload.productId.trim(),
    userId: payload.userId.trim(),
    userName: payload.userName.trim() || "Aluno",
    userAvatar: payload.userAvatar?.trim() || "",
    rating: Math.min(5, Math.max(1, Math.floor(payload.rating))),
    comment: payload.comment.trim(),
  };

  let productLookup = supabase.from("produtos").select("id").eq("id", requestPayload.productId);
  if (scopedTenantId) {
    productLookup = productLookup.eq("tenant_id", scopedTenantId);
  }
  const { data: productRow, error: productError } = await productLookup.maybeSingle();
  if (productError) throwSupabaseError(productError);
  if (!productRow) {
    throw new Error("Produto fora do tenant ativo.");
  }

  const { data, error } = await supabase
    .from("reviews")
    .insert({
      ...requestPayload,
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      createdAt: new Date().toISOString(),
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throwSupabaseError(error);

  try {
    await incrementUserStats(
      requestPayload.userId,
      { reviewsGiven: 1 },
      { tenantId: scopedTenantId || undefined }
    );
  } catch (statsError: unknown) {
    console.warn("Loja: falha ao sincronizar avaliacao.", statsError);
  }

  invalidateStoreCaches(requestPayload.productId);
  return { id: asString(asObject(data)?.id) };
}
