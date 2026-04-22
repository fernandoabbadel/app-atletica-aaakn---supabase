import { httpsCallable } from "@/lib/supa/functions";

import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import {
  normalizeAvailabilityStatus,
  normalizePaymentConfig,
  normalizePlanPriceEntries,
  normalizePlanVisibilityEntries,
  normalizeSellerSnapshot,
} from "./commerceCatalog";
import { clearDashboardCaches } from "./dashboardPublicService";
import { clearStorePublicCaches } from "./storePublicService";
import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = { cachedAt: number; value: T };
type Row = Record<string, unknown>;
type QueryAttempt = {
  limit: number;
  offset?: number;
  selectColumns?: string[];
  orderByField?: string;
  orderAscending?: boolean;
  filters?: Array<{ field: string; value: unknown }>;
};
type MutationFilter = { field: string; value: unknown };

const TTL_MS = 120_000;
const MAX_PRODUCTS = 240;
const MAX_ORDERS = 1200;
const MAX_REVIEWS = 600;
const MAX_CATEGORIES = 300;
const STORE_PRODUCT_SELECT_COLUMNS =
  "id,tenant_id,nome,categoria,descricao,img,preco,precoAntigo,estoque,lote,tagLabel,tagColor,tagEffect,cores,variantes,caracteristicas,active,aprovado,status,plan_prices,plan_visibility,payment_config,seller_type,seller_id,seller_name,seller_logo_url,vendidos,cliques,likes,createdAt,updatedAt";
const STORE_CATEGORY_SELECT_COLUMNS =
  "id,tenant_id,nome,cover_img,button_color,logo_url,seller_type,seller_id,display_order,visible,createdAt";
const STORE_ORDER_SELECT_COLUMNS =
  "id,tenant_id,userId,userName,productId,productName,price,total,quantidade,itens,data,status,approvedBy,seller_type,seller_id,seller_name,seller_logo_url,payment_config,createdAt,updatedAt";
const STORE_REVIEW_SELECT_COLUMNS =
  "id,productId,userId,userName,userAvatar,rating,comment,status,createdAt,updatedAt";
const STORE_SELECT_COLUMNS_BY_TABLE: Record<string, string[]> = {
  produtos: STORE_PRODUCT_SELECT_COLUMNS.split(","),
  categorias: STORE_CATEGORY_SELECT_COLUMNS.split(","),
  orders: STORE_ORDER_SELECT_COLUMNS.split(","),
  reviews: STORE_REVIEW_SELECT_COLUMNS.split(","),
};

const CALLABLE_TOGGLE_LIKE = "storeToggleLike";
const CALLABLE_CREATE_ORDER = "storeCreateOrder";
const CALLABLE_CANCEL_ORDER = "storeCancelOrder";
const CALLABLE_CREATE_REVIEW = "storeCreateReview";
const CALLABLE_APPROVE_ORDER = "storeApproveOrder";
const CALLABLE_SET_ORDER_STATUS = "storeSetOrderStatus";
const CALLABLE_SET_REVIEW_STATUS = "storeSetReviewStatus";
const CALLABLE_UPSERT_PRODUCT = "storeAdminUpsertProduct";
const CALLABLE_DELETE_PRODUCT = "storeAdminDeleteProduct";
const CALLABLE_CREATE_CATEGORY = "storeAdminCreateCategory";

const adminBundleCache = new Map<string, CacheEntry<StoreAdminBundle>>();
const productsFeedCache = new Map<string, CacheEntry<Row[]>>();
const categoriesFeedCache = new Map<string, CacheEntry<Row[]>>();
const productDetailCache = new Map<string, CacheEntry<StoreProductDetailBundle>>();

const asNum = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const hasOwnField = (row: Row, field: string): boolean =>
  Object.prototype.hasOwnProperty.call(row, field);

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

const throwSupabaseError = (error: { message: string; code?: string | null; name?: string | null }): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown };
  const text = [
    typeof raw.message === "string" ? raw.message : "",
    typeof raw.details === "string" ? raw.details : "",
  ]
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

const getStoreSelectColumns = (tableName: string): string[] =>
  [...(STORE_SELECT_COLUMNS_BY_TABLE[tableName] ?? ["id", "createdAt", "updatedAt"])];

const sortStoreCategoryRows = <T extends Row>(rows: T[]): T[] =>
  [...rows].sort((left, right) => {
    const leftOrder = asInt(left.display_order);
    const rightOrder = asInt(right.display_order);
    if (leftOrder !== null || rightOrder !== null) {
      if (leftOrder === null) return 1;
      if (rightOrder === null) return -1;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    }

    const leftSellerOrder = getStoreSellerSortOrder(left.seller_type);
    const rightSellerOrder = getStoreSellerSortOrder(right.seller_type);
    if (leftSellerOrder !== rightSellerOrder) {
      return leftSellerOrder - rightSellerOrder;
    }

    return asString(left.nome).localeCompare(asString(right.nome), "pt-BR", {
      sensitivity: "base",
    });
  });

const omitRowColumnCaseInsensitive = (row: Row, columnName: string): Row =>
  Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => key.toLowerCase() !== columnName.toLowerCase()
    )
  );

const nowIso = (): string => new Date().toISOString();
const resolveStoreTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());
const normalizeStoreSellerType = (value: unknown): "tenant" | "mini_vendor" | "league" => {
  const raw = asString(value).trim().toLowerCase();
  if (raw === "mini_vendor") return "mini_vendor";
  if (raw === "league") return "league";
  return "tenant";
};
const normalizeStoreSellerTypeForWrite = (value: unknown): "tenant" | "mini_vendor" => {
  const sellerType = normalizeStoreSellerType(value);
  return sellerType === "mini_vendor" ? "mini_vendor" : "tenant";
};
const getStoreSellerSortOrder = (value: unknown): number => {
  const sellerType = normalizeStoreSellerType(value);
  if (sellerType === "tenant") return 0;
  if (sellerType === "mini_vendor") return 1;
  return 2;
};

const shouldFallbackToClient = (error: unknown): boolean => {
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

const shouldUseCallable = (): boolean => {
  return process.env.NEXT_PUBLIC_FORCE_CALLABLES === "true";
};

async function callWithFallback<TReq, TRes>(
  callableName: string,
  payload: TReq,
  fallbackFn: () => Promise<TRes>
): Promise<TRes> {
  if (!shouldUseCallable()) {
    return fallbackFn();
  }

  try {
    const callable = httpsCallable<TReq, TRes>(functions, callableName);
    const response = await callable(payload);
    return response.data;
  } catch (error: unknown) {
    if (shouldFallbackToClient(error)) {
      return fallbackFn();
    }
    throw error;
  }
}

async function queryRows(path: string, attempts: QueryAttempt[]): Promise<Row[]> {
  const supabase = getSupabaseClient();
  const safeAttempts = attempts.filter((entry) => entry.limit > 0);
  const scopedTenantId = resolveStoreTenantId();
  if (!safeAttempts.length) return [];

  for (const attempt of safeAttempts) {
    let selectColumns = attempt.selectColumns?.length
      ? [...attempt.selectColumns]
      : getStoreSelectColumns(path);
    let canOrder = Boolean(attempt.orderByField);
    let canFilterByTenant = scopedTenantId.length > 0;

    while (selectColumns.length > 0) {
      let request = supabase
        .from(path)
        .select(selectColumns.join(","));

      if (typeof attempt.offset === "number" && Number.isFinite(attempt.offset)) {
        request = request.range(attempt.offset, attempt.offset + attempt.limit - 1);
      } else {
        request = request.limit(attempt.limit);
      }

      (attempt.filters ?? []).forEach((filter) => {
        request = request.eq(filter.field, filter.value);
      });
      if (canFilterByTenant) {
        request = request.eq("tenant_id", scopedTenantId);
      }

      if (canOrder && attempt.orderByField) {
        request = request.order(attempt.orderByField, {
          ascending: attempt.orderAscending ?? false,
        });
      }

      const { data, error } = await request;
      if (!error) {
        const rows = (data ?? []) as unknown as Row[];
        return rows.map((row) => ({ ...row }));
      }

      const missingColumn = asString(extractMissingSchemaColumn(error)).trim();
      if (missingColumn) {
        if (canFilterByTenant && missingColumn.toLowerCase() === "tenant_id") {
          canFilterByTenant = false;
          continue;
        }
        if (
          canOrder &&
          attempt.orderByField &&
          missingColumn.toLowerCase() === attempt.orderByField.toLowerCase()
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

      if (canOrder && attempt.orderByField) {
        canOrder = false;
        continue;
      }

      throwSupabaseError(error);
    }
  }

  return [];
}

async function mutateStoreTableWithSchemaFallback(options: {
  tableName: string;
  operation: "insert" | "update";
  payload: Row;
  filters?: MutationFilter[];
}): Promise<void> {
  const supabase = getSupabaseClient();
  let mutablePayload = { ...options.payload };
  let activeFilters = [...(options.filters ?? [])];

  while (true) {
    if (options.operation === "update" && Object.keys(mutablePayload).length === 0) {
      return;
    }

    let request =
      options.operation === "insert"
        ? supabase.from(options.tableName).insert(mutablePayload)
        : supabase.from(options.tableName).update(mutablePayload);

    activeFilters.forEach((filter) => {
      request = request.eq(filter.field, filter.value);
    });

    const { error } = await request;
    if (!error) {
      return;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error)).trim();
    if (missingColumn) {
      const nextPayload = omitRowColumnCaseInsensitive(mutablePayload, missingColumn);
      if (Object.keys(nextPayload).length < Object.keys(mutablePayload).length) {
        mutablePayload = nextPayload;
        continue;
      }

      if (
        missingColumn.toLowerCase() === "tenant_id" ||
        missingColumn.toLowerCase() === "seller_type" ||
        missingColumn.toLowerCase() === "seller_id"
      ) {
        const nextFilters = activeFilters.filter(
          (filter) => filter.field.toLowerCase() !== missingColumn.toLowerCase()
        );
        if (nextFilters.length < activeFilters.length) {
          activeFilters = nextFilters;
          continue;
        }
      }
    }

    throwSupabaseError(error);
  }
}

const normalizeAdminStoreRow = (table: string, row: Row): Row => {
  if (table === "produtos") {
    const next: Row = { ...row };
    next.status = normalizeAvailabilityStatus(row.status, row.active === false ? "esgotado" : "ativo");
    next.plan_prices = normalizePlanPriceEntries(row.plan_prices);
    next.plan_visibility = normalizePlanVisibilityEntries(row.plan_visibility);
    next.payment_config = normalizePaymentConfig(row.payment_config);
    next.seller = normalizeSellerSnapshot({
      type: row.seller_type,
      id: row.seller_id,
      name: row.seller_name,
      logoUrl: row.seller_logo_url,
    });
    return next;
  }

  if (table === "categorias") {
    return {
      ...row,
      cover_img: asString(row.cover_img) || asString(row.logo_url),
      button_color: asString(row.button_color),
      logo_url: asString(row.logo_url),
      display_order: asInt(row.display_order),
      visible: typeof row.visible === "boolean" ? row.visible : true,
      seller: normalizeSellerSnapshot({
        type: row.seller_type,
        id: row.seller_id,
        name: row.nome,
        logoUrl: row.logo_url,
      }),
    };
  }

  if (table === "orders") {
    return {
      ...row,
      payment_config: normalizePaymentConfig(row.payment_config),
      seller: normalizeSellerSnapshot({
        type: row.seller_type,
        id: row.seller_id,
        name: row.seller_name,
        logoUrl: row.seller_logo_url,
      }),
    };
  }

  return { ...row };
};

const invalidateStoreCaches = (productId?: string): void => {
  adminBundleCache.clear();
  productsFeedCache.clear();
  clearDashboardCaches();
  clearStorePublicCaches(productId);

  const cleanProductId = productId?.trim() || "";
  if (!cleanProductId) {
    productDetailCache.clear();
    return;
  }

  productDetailCache.forEach((_, key) => {
    if (key.startsWith(`${cleanProductId}:`)) {
      productDetailCache.delete(key);
    }
  });
};

export interface StoreAdminBundle {
  produtos: Row[];
  categorias: Row[];
  pedidos: Row[];
  reviews: Row[];
}

export interface StorePendingOrdersPage {
  rows: Row[];
  hasMore: boolean;
}

export interface StoreOrdersPage {
  rows: Row[];
  hasMore: boolean;
}

export async function fetchAdminStoreBundle(options?: {
  productsLimit?: number;
  categoriesLimit?: number;
  ordersLimit?: number;
  reviewsLimit?: number;
  forceRefresh?: boolean;
}): Promise<StoreAdminBundle> {
  const productsLimit = boundedLimit(options?.productsLimit ?? 120, MAX_PRODUCTS);
  const categoriesLimit = boundedLimit(options?.categoriesLimit ?? 160, MAX_CATEGORIES);
  const ordersLimit = boundedLimit(options?.ordersLimit ?? 200, MAX_ORDERS);
  const reviewsLimit = boundedLimit(options?.reviewsLimit ?? 120, MAX_REVIEWS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${productsLimit}:${categoriesLimit}:${ordersLimit}:${reviewsLimit}`;

  if (!forceRefresh) {
    const cached = getCache(adminBundleCache, cacheKey);
    if (cached) return cached;
  }

  const [produtos, categorias, pedidos, reviews] = await Promise.all([
    queryRows("produtos", [
      { orderByField: "nome", orderAscending: true, limit: productsLimit },
      { limit: productsLimit },
    ]),
    queryRows("categorias", [
      { orderByField: "nome", orderAscending: true, limit: categoriesLimit },
      { limit: categoriesLimit },
    ]),
    queryRows("orders", [
      { orderByField: "createdAt", orderAscending: false, limit: ordersLimit },
      { limit: ordersLimit },
    ]),
    queryRows("reviews", [
      { orderByField: "createdAt", orderAscending: false, limit: reviewsLimit },
      { limit: reviewsLimit },
    ]),
  ]);

  const bundle = {
    produtos: produtos.map((row) => normalizeAdminStoreRow("produtos", row)),
    categorias: sortStoreCategoryRows(
      categorias.map((row) => normalizeAdminStoreRow("categorias", row))
    ),
    pedidos: pedidos.map((row) => normalizeAdminStoreRow("orders", row)),
    reviews,
  };
  setCache(adminBundleCache, cacheKey, bundle);
  return bundle;
}

export async function fetchStoreOrdersPage(options?: {
  page?: number;
  pageSize?: number;
  status?: "pendente" | "approved" | "rejected" | "delivered";
  productIds?: string[];
  tenantId?: string | null;
}): Promise<StoreOrdersPage> {
  const page = Math.max(1, Math.floor(options?.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(options?.pageSize ?? 20)));
  const offset = (page - 1) * pageSize;
  const status = asString(options?.status, "pendente");
  const scopedTenantId = resolveStoreTenantId(options?.tenantId);
  const rawProductIds = Array.isArray(options?.productIds) ? options?.productIds : null;
  const productIds = Array.from(
    new Set(
      (rawProductIds ?? [])
        .map((entry) => asString(entry).trim())
        .filter((entry) => entry.length > 0)
    )
  ).slice(0, MAX_PRODUCTS);

  if (rawProductIds && productIds.length === 0) {
    return { rows: [], hasMore: false };
  }

  const supabase = getSupabaseClient();
  let selectColumns = STORE_ORDER_SELECT_COLUMNS.split(",");
  let canOrder = true;
  let canFilterByTenant = scopedTenantId.length > 0;

  while (selectColumns.length > 0) {
    let request = supabase
      .from("orders")
      .select(selectColumns.join(","))
      .range(offset, offset + pageSize)
      .eq("status", status);

    if (productIds.length > 0) {
      request = request.in("productId", productIds);
    }
    if (canFilterByTenant) {
      request = request.eq("tenant_id", scopedTenantId);
    }
    if (canOrder) {
      request = request.order("createdAt", { ascending: false });
    }

    const { data, error } = await request;
    if (!error) {
      const rows = ((data ?? []) as unknown as Row[]).map((row) =>
        normalizeAdminStoreRow("orders", row)
      );
      return {
        rows: rows.slice(0, pageSize),
        hasMore: rows.length > pageSize,
      };
    }

    const missingColumn = asString(extractMissingSchemaColumn(error)).trim();
    if (missingColumn) {
      if (canFilterByTenant && missingColumn.toLowerCase() === "tenant_id") {
        canFilterByTenant = false;
        continue;
      }
      if (canOrder && missingColumn.toLowerCase() === "createdat") {
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

    if (canOrder) {
      canOrder = false;
      continue;
    }

    throwSupabaseError(error);
  }

  return {
    rows: [],
    hasMore: false,
  };
}

export async function fetchPendingStoreOrdersPage(options?: {
  page?: number;
  pageSize?: number;
  productIds?: string[];
  tenantId?: string | null;
}): Promise<StorePendingOrdersPage> {
  return fetchStoreOrdersPage({
    page: options?.page,
    pageSize: options?.pageSize,
    productIds: options?.productIds,
    tenantId: options?.tenantId,
    status: "pendente",
  });
}

export async function fetchStoreCategories(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<Row[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 120, MAX_CATEGORIES);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveStoreTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "all"}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(categoriesFeedCache, cacheKey);
    if (cached) return cached;
  }

  const rows = await queryRows("categorias", [
    {
      orderByField: "display_order",
      orderAscending: true,
      limit: maxResults,
      selectColumns: STORE_CATEGORY_SELECT_COLUMNS.split(","),
    },
    {
      orderByField: "nome",
      orderAscending: true,
      limit: maxResults,
      selectColumns: STORE_CATEGORY_SELECT_COLUMNS.split(","),
    },
    {
      limit: maxResults,
      selectColumns: STORE_CATEGORY_SELECT_COLUMNS.split(","),
    },
  ]);

  const normalizedRows = sortStoreCategoryRows(
    rows.map((row) => normalizeAdminStoreRow("categorias", row))
  );
  setCache(categoriesFeedCache, cacheKey, normalizedRows);
  return normalizedRows;
}

export async function fetchStoreProducts(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
  category?: string | null;
  active?: boolean | null;
  sellerType?: "tenant" | "mini_vendor" | "league" | null;
}): Promise<Row[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 80, MAX_PRODUCTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveStoreTenantId(options?.tenantId);
  const category = asString(options?.category).trim();
  const sellerType = options?.sellerType ? normalizeStoreSellerType(options.sellerType) : "";
  const productFilters: Array<{ field: string; value: unknown }> = [];
  if (category) {
    productFilters.push({ field: "categoria", value: category });
  }
  if (typeof options?.active === "boolean") {
    productFilters.push({ field: "active", value: options.active });
  }
  if (sellerType) {
    productFilters.push({ field: "seller_type", value: sellerType });
  }
  const cacheKey = `${scopedTenantId || "all"}:${maxResults}:${category || "all"}:${
    typeof options?.active === "boolean" ? String(options.active) : "all"
  }:${sellerType || "all"}`;

  if (!forceRefresh) {
    const cached = getCache(productsFeedCache, cacheKey);
    if (cached) return cached;
  }

  const rows = await queryRows("produtos", [
    {
      orderByField: "nome",
      orderAscending: true,
      limit: maxResults,
      ...(productFilters.length ? { filters: productFilters } : {}),
    },
    {
      limit: maxResults,
      ...(productFilters.length ? { filters: productFilters } : {}),
    },
  ]);
  const normalizedRows = rows.map((row) => normalizeAdminStoreRow("produtos", row));
  setCache(productsFeedCache, cacheKey, normalizedRows);
  return normalizedRows;
}

export interface StoreProductDetailBundle {
  produto: Row | null;
  reviews: Row[];
  userOrders: Row[];
}

export async function fetchStoreProductDetail(options: {
  productId: string;
  userId?: string | null;
  reviewsLimit?: number;
  ordersLimit?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<StoreProductDetailBundle> {
  const productId = options.productId.trim();
  const userId = options.userId?.trim() || "";
  if (!productId) return { produto: null, reviews: [], userOrders: [] };
  const scopedTenantId = resolveStoreTenantId(options.tenantId);

  const reviewsLimit = boundedLimit(options.reviewsLimit ?? 40, MAX_REVIEWS);
  const ordersLimit = boundedLimit(options.ordersLimit ?? 20, MAX_ORDERS);
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `${scopedTenantId || "all"}:${productId}:${userId}:${reviewsLimit}:${ordersLimit}`;

  if (!forceRefresh) {
    const cached = getCache(productDetailCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let productQuery = supabase
    .from("produtos")
    .select(STORE_PRODUCT_SELECT_COLUMNS)
    .eq("id", productId);
  if (scopedTenantId) {
    productQuery = productQuery.eq("tenant_id", scopedTenantId);
  }
  const { data: produtoData, error: produtoError } = await productQuery.maybeSingle();
  if (produtoError) {
    throwSupabaseError(produtoError);
  }
  const produto = produtoData ? normalizeAdminStoreRow("produtos", produtoData as Row) : null;

  const reviewsPromise = queryRows("reviews", [
    {
      filters: [{ field: "productId", value: productId }],
      orderByField: "createdAt",
      orderAscending: false,
      limit: reviewsLimit,
    },
    {
      filters: [{ field: "productId", value: productId }],
      limit: reviewsLimit,
    },
  ]);

  const ordersPromise = userId
    ? queryRows("orders", [
        {
          filters: [
            { field: "userId", value: userId },
            { field: "productId", value: productId },
          ],
          orderByField: "createdAt",
          orderAscending: false,
          limit: ordersLimit,
        },
        {
          filters: [
            { field: "userId", value: userId },
            { field: "productId", value: productId },
          ],
          limit: ordersLimit,
        },
      ])
    : Promise.resolve([]);

  const [reviews, userOrders] = await Promise.all([reviewsPromise, ordersPromise]);

  const bundle = {
    produto,
    reviews,
    userOrders: userOrders.map((row) => normalizeAdminStoreRow("orders", row)),
  };
  setCache(productDetailCache, cacheKey, bundle);
  return bundle;
}

export async function toggleStoreProductLike(payload: {
  productId: string;
  userId: string;
  currentlyLiked: boolean;
}): Promise<void> {
  const productId = payload.productId.trim();
  const userId = payload.userId.trim();
  if (!productId || !userId) return;

  await callWithFallback<typeof payload, { ok: boolean }>(
    CALLABLE_TOGGLE_LIKE,
    payload,
    async () => {
      const supabase = getSupabaseClient();
      const { data: productData, error: productError } = await supabase
        .from("produtos")
        .select("likes")
        .eq("id", productId)
        .maybeSingle();
      if (productError) {
        throwSupabaseError(productError);
      }

      const currentLikes = Array.isArray(productData?.likes)
        ? productData.likes.filter((entry): entry is string => typeof entry === "string")
        : [];
      const likesSet = new Set(currentLikes);
      if (payload.currentlyLiked) {
        likesSet.delete(userId);
      } else {
        likesSet.add(userId);
      }

      const { error: updateError } = await supabase
        .from("produtos")
        .update({
          likes: Array.from(likesSet),
          updatedAt: nowIso(),
        })
        .eq("id", productId);
      if (updateError) {
        throwSupabaseError(updateError);
      }
      return { ok: true };
    }
  );

  invalidateStoreCaches(productId);
}

export async function createStoreOrder(payload: {
  userId: string;
  userName: string;
  productId: string;
  productName: string;
  price: number;
}): Promise<{ id: string }> {
  const requestPayload = {
    userId: payload.userId.trim(),
    userName: payload.userName.trim().slice(0, 120) || "Aluno",
    productId: payload.productId.trim(),
    productName: payload.productName.trim().slice(0, 160) || "Produto",
    price: Math.max(0, asNum(payload.price, 0)),
  };

  const result = await callWithFallback<typeof requestPayload, { id: string }>(
    CALLABLE_CREATE_ORDER,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      const now = nowIso();

      const { data: orderData, error: orderError } = await supabase
        .from("orders")
        .insert({
          ...requestPayload,
          status: "pendente",
          createdAt: now,
          updatedAt: now,
        })
        .select("id")
        .single();
      if (orderError) {
        throwSupabaseError(orderError);
      }

      const { error: notificationError } = await supabase.from("notifications").insert({
        userId: requestPayload.userId,
        title: "Compra em Analise",
        message: `Seu pedido de ${requestPayload.productName} foi enviado para aprovação.`,
        link: `/loja/${requestPayload.productId}`,
        read: false,
        type: "order",
        createdAt: now,
      });
      if (notificationError) {
        throwSupabaseError(notificationError);
      }

      return { id: String((orderData as Row | null)?.id ?? "") };
    }
  );

  invalidateStoreCaches(payload.productId);
  return result;
}

export async function cancelStoreOrderRequest(orderIdRaw: string): Promise<void> {
  const orderId = orderIdRaw.trim();
  if (!orderId) return;

  await callWithFallback<{ orderId: string }, { ok: boolean }>(
    CALLABLE_CANCEL_ORDER,
    { orderId },
    async () => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("orders").delete().eq("id", orderId);
      if (error) {
        throwSupabaseError(error);
      }
      return { ok: true };
    }
  );

  invalidateStoreCaches();
}

export async function createStoreReview(payload: {
  productId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  rating: number;
  comment: string;
}): Promise<{ id: string }> {
  const requestPayload = {
    productId: payload.productId.trim(),
    userId: payload.userId.trim(),
    userName: payload.userName.trim().slice(0, 120) || "Aluno",
    userAvatar: payload.userAvatar?.trim() || "",
    rating: Math.min(5, Math.max(1, Math.floor(payload.rating))),
    comment: payload.comment.trim().slice(0, 280),
  };

  const result = await callWithFallback<typeof requestPayload, { id: string }>(
    CALLABLE_CREATE_REVIEW,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("reviews")
        .insert({
          ...requestPayload,
          createdAt: nowIso(),
          status: "pending",
        })
        .select("id")
        .single();
      if (error) {
        throwSupabaseError(error);
      }
      return { id: String((data as Row | null)?.id ?? "") };
    }
  );

  invalidateStoreCaches(payload.productId);
  return result;
}

export async function approveStoreOrder(payload: {
  orderId: string;
  userId: string;
  userName: string;
  productName: string;
  price: number;
  approvedBy: string;
  productId?: string;
  quantidade?: number;
  itens?: number;
}): Promise<void> {
  const orderId = payload.orderId.trim();
  if (!orderId) return;

  const requestPayload = {
    ...payload,
    orderId,
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    CALLABLE_APPROVE_ORDER,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      const nowIso = new Date().toISOString();

      const { error: orderError } = await supabase
        .from("orders")
        .update({
          status: "approved",
          approvedBy: payload.approvedBy,
          updatedAt: nowIso,
        })
        .eq("id", orderId);
      if (orderError) {
        throwSupabaseError(orderError);
      }

      const xpGain = Math.floor(Math.max(0, payload.price) * 10);
      const quantity = Math.max(
        1,
        Math.floor(
          Number(payload.quantidade ?? payload.itens ?? 1) || 1
        )
      );

      const productId = payload.productId?.trim() || "";
      if (productId) {
        try {
          const { data: productRow, error: productFetchError } = await supabase
            .from("produtos")
            .select("estoque, vendidos")
            .eq("id", productId)
            .maybeSingle();

          if (productFetchError) {
            throw productFetchError;
          }

          if (productRow) {
            const currentStock =
              typeof productRow.estoque === "number" && Number.isFinite(productRow.estoque)
                ? productRow.estoque
                : 0;
            const currentSold =
              typeof productRow.vendidos === "number" && Number.isFinite(productRow.vendidos)
                ? productRow.vendidos
                : 0;

            const { error: productUpdateError } = await supabase
              .from("produtos")
              .update({
                estoque: Math.max(0, currentStock - quantity),
                vendidos: currentSold + quantity,
                updatedAt: nowIso,
              })
              .eq("id", productId);

            if (productUpdateError) {
              throw productUpdateError;
            }
          }
        } catch (productError: unknown) {
          console.warn("Loja: pedido aprovado, mas falhou ao atualizar estoque do produto.", productError);
        }
      }

      if (payload.userId.trim()) {
        try {
          const { data: userRow, error: userFetchError } = await supabase
            .from("users")
            .select("xp, selos")
            .eq("uid", payload.userId)
            .maybeSingle();

          if (userFetchError) {
            throw userFetchError;
          }

          if (userRow) {
            const currentXp =
              typeof userRow.xp === "number" && Number.isFinite(userRow.xp)
                ? userRow.xp
                : 0;
            const currentSelos =
              typeof userRow.selos === "number" && Number.isFinite(userRow.selos)
                ? userRow.selos
                : 0;

            const { error: userUpdateError } = await supabase
              .from("users")
              .update({
                xp: currentXp + xpGain,
                selos: currentSelos + 1,
                updatedAt: nowIso,
              })
              .eq("uid", payload.userId);

            if (userUpdateError) {
              throw userUpdateError;
            }
          }
        } catch (userError: unknown) {
          console.warn("Loja: pedido aprovado, mas falhou ao atualizar XP/Selos do usuário.", userError);
        }

        try {
          const { error: notificationError } = await supabase.from("notifications").insert({
            userId: payload.userId,
            title: "Pagamento Aprovado!",
            message: `Sua compra de ${payload.productName} foi confirmada. Você ganhou ${xpGain} XP!`,
            read: false,
            type: "order_approved",
            createdAt: nowIso,
          });

          if (notificationError) {
            throw notificationError;
          }
        } catch (notificationError: unknown) {
          console.warn("Loja: pedido aprovado, mas falhou ao criar notificacao.", notificationError);
        }
      }

      return { ok: true };
    }
  );

  invalidateStoreCaches();
}

export async function setStoreOrderStatus(payload: {
  orderId: string;
  status: "approved" | "rejected" | "pendente" | "delivered";
  approvedBy?: string;
}): Promise<void> {
  const orderId = payload.orderId.trim();
  if (!orderId) return;

  await callWithFallback<typeof payload, { ok: boolean }>(
    CALLABLE_SET_ORDER_STATUS,
    payload,
    async () => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from("orders")
        .update({
          status: payload.status,
          ...(payload.approvedBy ? { approvedBy: payload.approvedBy } : {}),
          updatedAt: new Date().toISOString(),
        })
        .eq("id", orderId);

      if (error) {
        throwSupabaseError(error);
      }
      return { ok: true };
    }
  );

  invalidateStoreCaches();
}

export async function setStoreReviewStatus(payload: {
  reviewId: string;
  status: "approved" | "rejected" | "pending";
}): Promise<void> {
  const reviewId = payload.reviewId.trim();
  if (!reviewId) return;

  await callWithFallback<typeof payload, { ok: boolean }>(
    CALLABLE_SET_REVIEW_STATUS,
    payload,
    async () => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from("reviews")
        .update({
          status: payload.status,
          approved: payload.status === "approved",
          updatedAt: nowIso(),
        })
        .eq("id", reviewId);
      if (error) {
        throwSupabaseError(error);
      }
      return { ok: true };
    }
  );

  invalidateStoreCaches();
}

export async function upsertStoreProduct(payload: {
  productId?: string;
  data: Row;
  tenantId?: string | null;
}): Promise<void> {
  const productId = payload.productId?.trim() || "";
  const isCreate = !productId;
  const rawData = { ...payload.data };
  const scopedTenantId = resolveStoreTenantId(payload.tenantId);
  const sanitizedData: Row = { ...rawData };

  const sanitizeStringField = (field: string, maxLength: number): void => {
    if (isCreate || hasOwnField(rawData, field)) {
      sanitizedData[field] = asString(rawData[field]).trim().slice(0, maxLength);
    }
  };

  sanitizeStringField("nome", 120);
  sanitizeStringField("categoria", 80);
  sanitizeStringField("descricao", 1200);
  sanitizeStringField("img", 400);
  sanitizeStringField("lote", 80);
  sanitizeStringField("cores", 600);
  sanitizeStringField("tagLabel", 30);

  if (isCreate || hasOwnField(rawData, "status")) {
    sanitizedData.status = normalizeAvailabilityStatus(
      rawData.status,
      rawData.active === false ? "esgotado" : "ativo"
    );
  }

  if (isCreate || hasOwnField(rawData, "plan_prices")) {
    sanitizedData.plan_prices = normalizePlanPriceEntries(rawData.plan_prices);
  }
  if (isCreate || hasOwnField(rawData, "plan_visibility")) {
    sanitizedData.plan_visibility = normalizePlanVisibilityEntries(rawData.plan_visibility);
  }
  if (isCreate || hasOwnField(rawData, "payment_config")) {
    sanitizedData.payment_config = normalizePaymentConfig(rawData.payment_config);
  }

  const hasSellerSnapshot =
    isCreate ||
    hasOwnField(rawData, "seller_type") ||
    hasOwnField(rawData, "seller_id") ||
    hasOwnField(rawData, "seller_name") ||
    hasOwnField(rawData, "seller_logo_url");

  if (hasSellerSnapshot) {
    const seller = normalizeSellerSnapshot({
      type: rawData.seller_type,
      id: rawData.seller_id,
      name: rawData.seller_name,
      logoUrl: rawData.seller_logo_url,
    });

    sanitizedData.seller_type = normalizeStoreSellerTypeForWrite(seller?.type);
    sanitizedData.seller_id = seller?.id ?? "";
    sanitizedData.seller_name = seller?.name ?? "";
    sanitizedData.seller_logo_url = seller?.logoUrl ?? "";
  }

  if (isCreate || hasOwnField(rawData, "caracteristicas")) {
    const caracteristicas = Array.isArray(rawData.caracteristicas)
      ? rawData.caracteristicas
      : [];
    sanitizedData.caracteristicas = caracteristicas
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 24);
  }

  if (isCreate || hasOwnField(rawData, "variantes")) {
    const variantes = Array.isArray(rawData.variantes) ? rawData.variantes : [];
    sanitizedData.variantes = variantes
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        return {
          ...row,
          tamanho: asString(row.tamanho).trim().slice(0, 40),
          cor: asString(row.cor).trim().slice(0, 40),
          status: normalizeAvailabilityStatus(row.status),
          planPrices: normalizePlanPriceEntries(row.planPrices ?? row.plan_prices),
        };
      })
      .slice(0, 30);
  }

  const requestPayload = {
    ...(productId ? { productId } : {}),
    data: sanitizedData,
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    CALLABLE_UPSERT_PRODUCT,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      if (productId) {
        let updateQuery = supabase
          .from("produtos")
          .update({
            ...sanitizedData,
            ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
            updatedAt: nowIso(),
          })
          .eq("id", productId);
        if (scopedTenantId) {
          updateQuery = updateQuery.eq("tenant_id", scopedTenantId);
        }
        const { error } = await updateQuery;
        if (error) {
          throwSupabaseError(error);
        }
      } else {
        const { error } = await supabase.from("produtos").insert({
          ...sanitizedData,
          ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
          createdAt: nowIso(),
          updatedAt: nowIso(),
          vendidos: 0,
          cliques: 0,
        });
        if (error) {
          throwSupabaseError(error);
        }
      }
      return { ok: true };
    }
  );

  invalidateStoreCaches(productId);
}

export async function deleteStoreProduct(productId: string): Promise<void> {
  const cleanId = productId.trim();
  const scopedTenantId = resolveStoreTenantId();
  if (!cleanId) return;

  await callWithFallback<{ productId: string }, { ok: boolean }>(
    CALLABLE_DELETE_PRODUCT,
    { productId: cleanId },
    async () => {
      const supabase = getSupabaseClient();
      let query = supabase.from("produtos").delete().eq("id", cleanId);
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      const { error } = await query;
      if (error) {
        throwSupabaseError(error);
      }
      return { ok: true };
    }
  );

  invalidateStoreCaches(cleanId);
}

export async function createStoreCategory(
  payload:
    | string
    | {
        nome: string;
        coverImg?: string;
        buttonColor?: string;
        logoUrl?: string;
        displayOrder?: number;
        sellerType?: "tenant" | "mini_vendor" | "league";
        sellerId?: string;
        tenantId?: string | null;
      }
): Promise<void> {
  const source = typeof payload === "string" ? { nome: payload } : payload;
  await upsertStoreCategory({ data: source });
}

export async function upsertStoreCategory(payload: {
  categoryId?: string;
  data: {
    nome: string;
    coverImg?: string;
    buttonColor?: string;
    logoUrl?: string;
    displayOrder?: number;
    visible?: boolean;
    sellerType?: "tenant" | "mini_vendor" | "league";
    sellerId?: string;
    tenantId?: string | null;
  };
}): Promise<void> {
  const categoryId = payload.categoryId?.trim() || "";
  const source = payload.data;
  const cleanNome = source.nome.trim().slice(0, 80);
  const coverImg = asString(source.coverImg).trim().slice(0, 400);
  const buttonColor = asString(source.buttonColor).trim().slice(0, 40);
  const logoUrl = asString(source.logoUrl).trim().slice(0, 400);
  const displayOrder = asInt(source.displayOrder);
  const visible = typeof source.visible === "boolean" ? source.visible : true;
  const sellerType = normalizeStoreSellerType(source.sellerType);
  const sellerTypeForWrite = normalizeStoreSellerTypeForWrite(sellerType);
  const sellerId = asString(source.sellerId).trim().slice(0, 120);
  const scopedTenantId = resolveStoreTenantId(source.tenantId);
  if (!cleanNome) return;

  if (categoryId) {
    const updatePayload: Row = {
      nome: cleanNome,
      cover_img: coverImg || null,
      button_color: buttonColor || null,
      logo_url: logoUrl || null,
      seller_type: sellerTypeForWrite,
      seller_id: sellerId || null,
      ...(displayOrder !== null ? { display_order: displayOrder } : {}),
      visible,
    };
    await mutateStoreTableWithSchemaFallback({
      tableName: "categorias",
      operation: "update",
      payload: updatePayload,
      filters: [
        { field: "id", value: categoryId },
        ...(scopedTenantId ? [{ field: "tenant_id", value: scopedTenantId }] : []),
      ],
    });
    invalidateStoreCaches();
    return;
  }

  const nextDisplayOrder =
    displayOrder !== null ? displayOrder : await resolveNextStoreCategoryDisplayOrder(scopedTenantId);
  const insertPayload: Row = {
    nome: cleanNome,
    cover_img: coverImg || null,
    button_color: buttonColor || null,
    logo_url: logoUrl || null,
    seller_type: sellerTypeForWrite,
    seller_id: sellerId || null,
    ...(nextDisplayOrder !== null ? { display_order: nextDisplayOrder } : {}),
    visible,
    ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
    createdAt: nowIso(),
  };

  await callWithFallback<Record<string, unknown>, { ok: boolean }>(
    CALLABLE_CREATE_CATEGORY,
    {
      nome: cleanNome,
      cover_img: coverImg,
      button_color: buttonColor,
      logo_url: logoUrl,
      ...(nextDisplayOrder !== null ? { display_order: nextDisplayOrder } : {}),
      seller_type: sellerTypeForWrite,
      seller_id: sellerId,
      visible,
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
    },
    async () => {
      await mutateStoreTableWithSchemaFallback({
        tableName: "categorias",
        operation: "insert",
        payload: insertPayload,
      });
      return { ok: true };
    }
  );

  invalidateStoreCaches();
}

async function resolveNextStoreCategoryDisplayOrder(
  tenantId?: string | null
): Promise<number | null> {
  const scopedTenantId = resolveStoreTenantId(tenantId);
  if (!scopedTenantId) return null;

  const supabase = getSupabaseClient();
  const query = supabase
    .from("categorias")
    .select("display_order")
    .eq("tenant_id", scopedTenantId)
    .limit(1);

  let data: unknown[] | null = null;
  let error: { message: string; code?: string | null; name?: string | null } | null = null;
  try {
    const ordered = await query.order("display_order", { ascending: false });
    data = ordered.data;
    error = ordered.error;
  } catch {
    const fallback = await query;
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    const missingColumn = asString(extractMissingSchemaColumn(error)).trim().toLowerCase();
    if (missingColumn === "display_order" || missingColumn === "tenant_id") {
      return null;
    }
    throwSupabaseError(error);
  }

  const latestRow =
    Array.isArray(data) && data[0] && typeof data[0] === "object"
      ? (data[0] as Row)
      : null;
  const currentMax = asInt(latestRow?.display_order);
  return currentMax === null ? 0 : currentMax + 1;
}

export async function saveStoreCategoryDisplayOrder(payload: {
  orderedCategoryIds: string[];
  tenantId?: string | null;
}): Promise<void> {
  const orderedCategoryIds = Array.from(
    new Set(
      payload.orderedCategoryIds
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  );
  if (orderedCategoryIds.length === 0) return;

  const scopedTenantId = resolveStoreTenantId(payload.tenantId);
  for (const [index, categoryId] of orderedCategoryIds.entries()) {
    await mutateStoreTableWithSchemaFallback({
      tableName: "categorias",
      operation: "update",
      payload: {
        display_order: index,
      },
      filters: [
        { field: "id", value: categoryId },
        ...(scopedTenantId ? [{ field: "tenant_id", value: scopedTenantId }] : []),
      ],
    });
  }

  invalidateStoreCaches();
}

export async function setStoreCategoryVisibility(payload: {
  categoryId: string;
  visible: boolean;
  tenantId?: string | null;
}): Promise<void> {
  const categoryId = payload.categoryId.trim();
  if (!categoryId) return;

  const scopedTenantId = resolveStoreTenantId(payload.tenantId);
  await mutateStoreTableWithSchemaFallback({
    tableName: "categorias",
    operation: "update",
    payload: {
      visible: payload.visible,
    },
    filters: [
      { field: "id", value: categoryId },
      ...(scopedTenantId ? [{ field: "tenant_id", value: scopedTenantId }] : []),
    ],
  });

  invalidateStoreCaches();
}

export async function renameStoreProductsCategory(payload: {
  previousName: string;
  nextName: string;
  tenantId?: string | null;
  sellerType?: "tenant" | "mini_vendor" | "league";
  sellerId?: string;
}): Promise<void> {
  const previousName = payload.previousName.trim();
  const nextName = payload.nextName.trim().slice(0, 80);
  const scopedTenantId = resolveStoreTenantId(payload.tenantId);
  const sellerType = normalizeStoreSellerType(payload.sellerType);
  const sellerTypeForWrite = normalizeStoreSellerTypeForWrite(sellerType);
  const sellerId = asString(payload.sellerId).trim().slice(0, 120);

  if (!previousName || !nextName || previousName === nextName) {
    return;
  }

  await mutateStoreTableWithSchemaFallback({
    tableName: "produtos",
    operation: "update",
    payload: {
      categoria: nextName,
      updatedAt: nowIso(),
    },
    filters: [
      { field: "categoria", value: previousName },
      ...(scopedTenantId ? [{ field: "tenant_id", value: scopedTenantId }] : []),
      { field: "seller_type", value: sellerTypeForWrite },
      ...(sellerId ? [{ field: "seller_id", value: sellerId }] : []),
    ],
  });

  invalidateStoreCaches();
}

export function clearStoreCaches(): void {
  invalidateStoreCaches();
}


