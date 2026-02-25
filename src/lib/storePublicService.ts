import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = { cachedAt: number; value: T };
type Row = Record<string, unknown>;
type DateLike = { toDate: () => Date };

const TTL_MS = 120_000;
const MAX_PRODUCTS = 240;
const MAX_ORDERS = 1200;
const MAX_REVIEWS = 600;

const productsFeedCache = new Map<string, CacheEntry<Row[]>>();
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
  eq?: Record<string, string>;
  orderBy?: { column: string; ascending: boolean };
  limit?: number;
}): Promise<Row[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from(table).select("*");

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
  return (data ?? []).map((row) => normalizeRowTimestamps(row as Row));
}

export interface StoreProductDetailBundle {
  produto: Row | null;
  reviews: Row[];
  userOrders: Row[];
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

  let rows: Row[] = [];
  try {
    rows = await queryRows("produtos", {
      orderBy: { column: "nome", ascending: true },
      limit: maxResults,
    });
  } catch {
    rows = await queryRows("produtos", { limit: maxResults });
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

  const reviewsLimit = boundedLimit(options.reviewsLimit ?? 40, MAX_REVIEWS);
  const ordersLimit = boundedLimit(options.ordersLimit ?? 20, MAX_ORDERS);
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `${productId}:${userId}:${reviewsLimit}:${ordersLimit}`;

  if (!forceRefresh) {
    const cached = getCache(productDetailCache, cacheKey);
    if (cached) return cached;
  }

  const productQuery = await supabase.from("produtos").select("*").eq("id", productId).maybeSingle();
  if (productQuery.error) throwSupabaseError(productQuery.error);
  const produto = productQuery.data ? normalizeRowTimestamps(productQuery.data as Row) : null;

  const reviewsPromise = queryRows("reviews", {
    eq: { productId },
    orderBy: { column: "createdAt", ascending: false },
    limit: reviewsLimit,
  }).catch(() => queryRows("reviews", { eq: { productId }, limit: reviewsLimit }));

  const ordersPromise = userId
    ? queryRows("orders", {
        eq: { userId, productId },
        orderBy: { column: "createdAt", ascending: false },
        limit: ordersLimit,
      }).catch(() => queryRows("orders", { eq: { userId, productId }, limit: ordersLimit }))
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
}): Promise<{ id: string }> {
  const supabase = getSupabaseClient();
  const requestPayload = {
    userId: payload.userId.trim(),
    userName: payload.userName.trim() || "Aluno",
    productId: payload.productId.trim(),
    productName: payload.productName.trim() || "Produto",
    price: Math.max(0, asNum(payload.price, 0)),
  };

  const { data, error } = await supabase
    .from("orders")
    .insert({
      ...requestPayload,
      status: "pendente",
      createdAt: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throwSupabaseError(error);

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
  return { id: asString(asObject(data)?.id) };
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
