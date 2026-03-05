import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = { cachedAt: number; value: T };
type Row = Record<string, unknown>;
type DateLike = { toDate: () => Date };

const TTL_MS = 120_000;
const MAX_PRODUCTS = 240;
const MAX_ORDERS = 1200;
const MAX_REVIEWS = 600;
const MAX_CATEGORIES = 300;
const STORE_PRODUCT_SELECT_COLUMNS =
  "id,nome,preco,precoAntigo,img,descricao,likes,categoria,estoque,cores,variantes,caracteristicas,active,aprovado,createdAt,updatedAt";
const STORE_CATEGORY_SELECT_COLUMNS = "id,nome";
const STORE_REVIEW_SELECT_COLUMNS =
  "id,productId,userId,userName,userAvatar,rating,comment,createdAt,updatedAt";
const STORE_ORDER_SELECT_COLUMNS =
  "id,userId,userName,productId,productName,price,total,quantidade,itens,data,status,createdAt,updatedAt";

const productsFeedCache = new Map<string, CacheEntry<Row[]>>();
const productsPageCache = new Map<string, CacheEntry<StoreProductsPageResult>>();
const categoriesCache = new Map<string, CacheEntry<Row[]>>();
const productDetailCache = new Map<string, CacheEntry<StoreProductDetailBundle>>();

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const asNum = (value: unknown, fallback = 0): number =>
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

const invalidateStoreCaches = (productId?: string): void => {
  productsFeedCache.clear();
  productsPageCache.clear();
  categoriesCache.clear();
  if (!productId) {
    productDetailCache.clear();
    return;
  }
  productDetailCache.forEach((_, key) => {
    if (key.startsWith(`${productId}:`)) productDetailCache.delete(key);
  });
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

async function queryRows(table: string, options?: {
  selectColumns?: string;
  eq?: Record<string, string | number | boolean>;
  orderBy?: { column: string; ascending: boolean };
  limit?: number;
}): Promise<Row[]> {
  const supabase = getSupabaseClient();
  const selectColumns = options?.selectColumns ?? "id";
  let query = supabase.from(table).select(selectColumns);

  if (options?.eq) {
    for (const [column, value] of Object.entries(options.eq)) {
      query = query.eq(column, value);
    }
  }
  if (options?.orderBy) {
    query = query.order(options.orderBy.column, { ascending: options.orderBy.ascending });
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) throwSupabaseError(error);
  const rows = (data ?? []) as unknown as Row[];
  return rows.map((row) => normalizeRowTimestamps(row));
}

export interface StoreProductDetailBundle {
  produto: Row | null;
  reviews: Row[];
  userOrders: Row[];
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
}): Promise<Row[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 80, MAX_CATEGORIES);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(categoriesCache, cacheKey);
    if (cached) return cached;
  }

  let rows: Row[] = [];
  try {
    rows = await queryRows("categorias", {
      selectColumns: STORE_CATEGORY_SELECT_COLUMNS,
      orderBy: { column: "nome", ascending: true },
      limit: maxResults,
    });
  } catch {
    rows = await queryRows("categorias", {
      selectColumns: STORE_CATEGORY_SELECT_COLUMNS,
      limit: maxResults,
    });
  }

  setCache(categoriesCache, cacheKey, rows);
  return rows;
}

export async function fetchStoreProductsPage(options?: {
  page?: number;
  pageSize?: number;
  category?: string | null;
  forceRefresh?: boolean;
}): Promise<StoreProductsPageResult> {
  const supabase = getSupabaseClient();
  const page = Math.max(1, Math.floor(options?.page ?? 1));
  const pageSize = boundedLimit(options?.pageSize ?? 20, 60);
  const categoryRaw = asString(options?.category).trim();
  const category = categoryRaw && categoryRaw !== "Todos" ? categoryRaw : null;
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${category || "all"}:${page}:${pageSize}`;

  if (!forceRefresh) {
    const cached = getCache(productsPageCache, cacheKey);
    if (cached) return cached;
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize; // inclui +1 item para detectar hasMore (range e inclusivo)

  const runQuery = async (withOrder: boolean): Promise<Row[]> => {
    let query = supabase.from("produtos").select(STORE_PRODUCT_SELECT_COLUMNS);
    query = query.eq("active", true).eq("aprovado", true);
    if (category) query = query.eq("categoria", category);
    if (withOrder) {
      query = query.order("nome", { ascending: true });
    }
    query = query.range(from, to);

    const { data, error } = await query;
    if (error) throwSupabaseError(error);
    return (data ?? []).map((row) => normalizeRowTimestamps(row as Row));
  };

  let rows: Row[] = [];
  try {
    rows = await runQuery(true);
  } catch {
    rows = await runQuery(false);
  }

  const result: StoreProductsPageResult = {
    products: rows.slice(0, pageSize),
    hasMore: rows.length > pageSize,
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
}): Promise<Row[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 80, MAX_PRODUCTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(productsFeedCache, cacheKey);
    if (cached) return cached;
  }

  const runQuery = async (withOrder: boolean): Promise<Row[]> => {
    return queryRows("produtos", withOrder
      ? {
          selectColumns: STORE_PRODUCT_SELECT_COLUMNS,
          eq: { active: true, aprovado: true },
          orderBy: { column: "nome", ascending: true },
          limit: maxResults,
        }
      : {
          selectColumns: STORE_PRODUCT_SELECT_COLUMNS,
          eq: { active: true, aprovado: true },
          limit: maxResults,
        });
  };

  let rows: Row[] = [];
  try {
    rows = await runQuery(true);
  } catch {
    rows = await runQuery(false);
  }

  setCache(productsFeedCache, cacheKey, rows);
  return rows;
}

export async function fetchStoreProductDetail(options: {
  productId: string;
  userId?: string | null;
  reviewsLimit?: number;
  ordersLimit?: number;
  forceRefresh?: boolean;
}): Promise<StoreProductDetailBundle> {
  const supabase = getSupabaseClient();
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
  const cacheKey = `${productId}:${userId}:${reviewsLimit}:${ordersLimit}`;

  if (!forceRefresh) {
    const cached = getCache(productDetailCache, cacheKey);
    if (cached) return cached;
  }

  const productQuery = await supabase
    .from("produtos")
    .select(STORE_PRODUCT_SELECT_COLUMNS)
    .eq("id", productId)
    .maybeSingle();
  if (productQuery.error) throwSupabaseError(productQuery.error);
  const produtoCandidate = productQuery.data ? normalizeRowTimestamps(productQuery.data as Row) : null;
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
    }).catch(() =>
      queryRows("reviews", {
        selectColumns: STORE_REVIEW_SELECT_COLUMNS,
        eq: { productId },
        limit: reviewsLimit,
      })
    )
    : Promise.resolve([] as Row[]);

  const ordersPromise = userId
    ? queryRows("orders", {
        selectColumns: STORE_ORDER_SELECT_COLUMNS,
        eq: { userId, productId },
        orderBy: { column: "createdAt", ascending: false },
        limit: ordersLimit,
      }).catch(() =>
        queryRows("orders", {
          selectColumns: STORE_ORDER_SELECT_COLUMNS,
          eq: { userId, productId },
          limit: ordersLimit,
        })
      )
    : Promise.resolve([] as Row[]);

  const [reviews, userOrders] = await Promise.all([reviewsPromise, ordersPromise]);
  const bundle = { produto, reviews, userOrders };
  setCache(productDetailCache, cacheKey, bundle);
  return bundle;
}

export async function toggleStoreProductLike(payload: {
  productId: string;
  userId: string;
  currentlyLiked: boolean;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const productId = payload.productId.trim();
  const userId = payload.userId.trim();
  if (!productId || !userId) return;

  const { data, error } = await supabase.from("produtos").select("likes").eq("id", productId).maybeSingle();
  if (error) throwSupabaseError(error);

  const currentLikes = asArray(asObject(data)?.likes).filter((v): v is string => typeof v === "string");
  const nextLikes = payload.currentlyLiked
    ? currentLikes.filter((entry) => entry !== userId)
    : Array.from(new Set([...currentLikes, userId]));

  const { error: updateError } = await supabase
    .from("produtos")
    .update({ likes: nextLikes, updatedAt: new Date().toISOString() })
    .eq("id", productId);
  if (updateError) throwSupabaseError(updateError);

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
}): Promise<{ id: string }> {
  const supabase = getSupabaseClient();
  const quantity = Math.max(1, Math.floor(Number(payload.quantity ?? 1) || 1));
  const unitPrice = Math.max(0, asNum(payload.price, 0));
  const totalPrice = Number((unitPrice * quantity).toFixed(2));
  const requestPayload = {
    userId: payload.userId.trim(),
    userName: payload.userName.trim() || "Aluno",
    productId: payload.productId.trim(),
    productName: payload.productName.trim() || "Produto",
    price: totalPrice,
    quantidade: quantity,
    total: totalPrice,
    data: payload.color?.trim()
      ? { corSelecionada: payload.color.trim() }
      : undefined,
  };

  const baseInsertPayload: Record<string, unknown> = {
    ...requestPayload,
    status: "pendente",
    createdAt: new Date().toISOString(),
  };
  if (baseInsertPayload.data === undefined) {
    delete baseInsertPayload.data;
  }

  const nonRemovableColumns = new Set([
    "userId",
    "userName",
    "productId",
    "productName",
    "price",
    "status",
  ]);

  let mutableInsertPayload = { ...baseInsertPayload };
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

  invalidateStoreCaches(requestPayload.productId);
  return { id: createdOrderId };
}

export async function cancelStoreOrderRequest(orderIdRaw: string): Promise<void> {
  const supabase = getSupabaseClient();
  const orderId = orderIdRaw.trim();
  if (!orderId) return;

  const { error } = await supabase.from("orders").delete().eq("id", orderId);
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
}): Promise<{ id: string }> {
  const supabase = getSupabaseClient();
  const requestPayload = {
    productId: payload.productId.trim(),
    userId: payload.userId.trim(),
    userName: payload.userName.trim() || "Aluno",
    userAvatar: payload.userAvatar?.trim() || "",
    rating: Math.min(5, Math.max(1, Math.floor(payload.rating))),
    comment: payload.comment.trim(),
  };

  const { data, error } = await supabase
    .from("reviews")
    .insert({
      ...requestPayload,
      createdAt: new Date().toISOString(),
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throwSupabaseError(error);

  invalidateStoreCaches(requestPayload.productId);
  return { id: asString(asObject(data)?.id) };
}
