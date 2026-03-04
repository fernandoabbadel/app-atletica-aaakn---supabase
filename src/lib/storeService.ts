import { httpsCallable } from "@/lib/supa/functions";

import { functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = { cachedAt: number; value: T };
type Row = Record<string, unknown>;
type QueryAttempt = {
  limit: number;
  orderByField?: string;
  orderAscending?: boolean;
  filters?: Array<{ field: string; value: unknown }>;
};

const TTL_MS = 120_000;
const MAX_PRODUCTS = 240;
const MAX_ORDERS = 1200;
const MAX_REVIEWS = 600;
const MAX_CATEGORIES = 300;

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
const productDetailCache = new Map<string, CacheEntry<StoreProductDetailBundle>>();

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

const nowIso = (): string => new Date().toISOString();

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
  if (typeof window === "undefined") return true;
  if (process.env.NEXT_PUBLIC_FORCE_CALLABLES === "true") return true;

  const host = window.location.hostname.toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1";
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
  if (!safeAttempts.length) return [];

  for (const attempt of safeAttempts) {
    let request = supabase.from(path).select("*").limit(attempt.limit);

    (attempt.filters ?? []).forEach((filter) => {
      request = request.eq(filter.field, filter.value);
    });

    if (attempt.orderByField) {
      request = request.order(attempt.orderByField, {
        ascending: attempt.orderAscending ?? false,
      });
    }

    const { data, error } = await request;
    if (!error) {
      return ((data ?? []) as Row[]).map((row) => ({ ...row }));
    }

    const missingColumn = extractMissingSchemaColumn(error);
    if (!missingColumn) {
      throwSupabaseError(error);
    }
  }

  return [];
}

const invalidateStoreCaches = (productId?: string): void => {
  adminBundleCache.clear();
  productsFeedCache.clear();

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

  const bundle = { produtos, categorias, pedidos, reviews };
  setCache(adminBundleCache, cacheKey, bundle);
  return bundle;
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

  const rows = await queryRows("produtos", [
    { orderByField: "nome", orderAscending: true, limit: maxResults },
    { limit: maxResults },
  ]);
  setCache(productsFeedCache, cacheKey, rows);
  return rows;
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
}): Promise<StoreProductDetailBundle> {
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

  const supabase = getSupabaseClient();
  const { data: produtoData, error: produtoError } = await supabase
    .from("produtos")
    .select("*")
    .eq("id", productId)
    .maybeSingle();
  if (produtoError) {
    throwSupabaseError(produtoError);
  }
  const produto = (produtoData as Row | null) ?? null;

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

  const bundle = { produto, reviews, userOrders };
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
    userName: payload.userName.trim() || "Aluno",
    productId: payload.productId.trim(),
    productName: payload.productName.trim() || "Produto",
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
        message: `Seu pedido de ${requestPayload.productName} foi enviado para aprovacao.`,
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
    userName: payload.userName.trim() || "Aluno",
    userAvatar: payload.userAvatar?.trim() || "",
    rating: Math.min(5, Math.max(1, Math.floor(payload.rating))),
    comment: payload.comment.trim(),
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
          console.warn("Loja: pedido aprovado, mas falhou ao atualizar XP/Selos do usuario.", userError);
        }

        try {
          const { error: notificationError } = await supabase.from("notifications").insert({
            userId: payload.userId,
            title: "Pagamento Aprovado!",
            message: `Sua compra de ${payload.productName} foi confirmada. Voce ganhou ${xpGain} XP!`,
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
}): Promise<void> {
  const productId = payload.productId?.trim() || "";
  const requestPayload = {
    ...(productId ? { productId } : {}),
    data: payload.data,
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    CALLABLE_UPSERT_PRODUCT,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      if (productId) {
        const { error } = await supabase
          .from("produtos")
          .update({
            ...payload.data,
            updatedAt: nowIso(),
          })
          .eq("id", productId);
        if (error) {
          throwSupabaseError(error);
        }
      } else {
        const { error } = await supabase.from("produtos").insert({
          ...payload.data,
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
  if (!cleanId) return;

  await callWithFallback<{ productId: string }, { ok: boolean }>(
    CALLABLE_DELETE_PRODUCT,
    { productId: cleanId },
    async () => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("produtos").delete().eq("id", cleanId);
      if (error) {
        throwSupabaseError(error);
      }
      return { ok: true };
    }
  );

  invalidateStoreCaches(cleanId);
}

export async function createStoreCategory(nome: string): Promise<void> {
  const cleanNome = nome.trim();
  if (!cleanNome) return;

  await callWithFallback<{ nome: string }, { ok: boolean }>(
    CALLABLE_CREATE_CATEGORY,
    { nome: cleanNome },
    async () => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("categorias").insert({
        nome: cleanNome,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      if (error) {
        throwSupabaseError(error);
      }
      return { ok: true };
    }
  );

  invalidateStoreCaches();
}

export function clearStoreCaches(): void {
  adminBundleCache.clear();
  productsFeedCache.clear();
  productDetailCache.clear();
}


