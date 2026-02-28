import { httpsCallable } from "@/lib/supa/functions";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type QueryConstraint,
} from "@/lib/supa/firestore";

import { db, functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = { cachedAt: number; value: T };
type Row = Record<string, unknown>;

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

const isIndexRequired = (error: unknown): boolean => {
  const code = getBackendErrorCode(error)?.toLowerCase();
  if (code?.includes("failed-precondition")) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("index") && message.includes("query");
  }
  return false;
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

async function queryRows(path: string, attempts: QueryConstraint[][]): Promise<Row[]> {
  const safeAttempts = attempts.filter((entry) => entry.length > 0);
  if (!safeAttempts.length) return [];

  let lastError: unknown = null;
  for (let i = 0; i < safeAttempts.length; i += 1) {
    try {
      const snap = await getDocs(query(collection(db, path), ...safeAttempts[i]));
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Row) }));
    } catch (error: unknown) {
      lastError = error;
      const isLast = i === safeAttempts.length - 1;
      if (!isIndexRequired(error) || isLast) throw error;
    }
  }

  if (lastError) throw lastError;
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
    queryRows("produtos", [[orderBy("nome", "asc"), limit(productsLimit)], [limit(productsLimit)]]),
    queryRows("categorias", [[orderBy("nome", "asc"), limit(categoriesLimit)], [limit(categoriesLimit)]]),
    queryRows("orders", [[orderBy("createdAt", "desc"), limit(ordersLimit)], [limit(ordersLimit)]]),
    queryRows("reviews", [[orderBy("createdAt", "desc"), limit(reviewsLimit)], [limit(reviewsLimit)]]),
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

  const rows = await queryRows("produtos", [[orderBy("nome", "asc"), limit(maxResults)], [limit(maxResults)]]);
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

  const produtoSnap = await getDoc(doc(db, "produtos", productId));
  const produto = produtoSnap.exists()
    ? ({ id: produtoSnap.id, ...(produtoSnap.data() as Row) } as Row)
    : null;

  const reviewsPromise = queryRows("reviews", [
    [where("productId", "==", productId), orderBy("createdAt", "desc"), limit(reviewsLimit)],
    [where("productId", "==", productId), limit(reviewsLimit)],
  ]);

  const ordersPromise = userId
    ? queryRows("orders", [
        [where("userId", "==", userId), where("productId", "==", productId), orderBy("createdAt", "desc"), limit(ordersLimit)],
        [where("userId", "==", userId), where("productId", "==", productId), limit(ordersLimit)],
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
      await updateDoc(doc(db, "produtos", productId), {
        likes: payload.currentlyLiked ? arrayRemove(userId) : arrayUnion(userId),
        updatedAt: serverTimestamp(),
      });
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
      const orderRef = await addDoc(collection(db, "orders"), {
        ...requestPayload,
        status: "pendente",
        createdAt: serverTimestamp(),
      });

      await addDoc(collection(db, "notifications"), {
        userId: requestPayload.userId,
        title: "Compra em Analise",
        message: `Seu pedido de ${requestPayload.productName} foi enviado para aprovacao.`,
        link: `/loja/${requestPayload.productId}`,
        read: false,
        type: "order",
        createdAt: serverTimestamp(),
      });

      return { id: orderRef.id };
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
      await deleteDoc(doc(db, "orders", orderId));
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
      const reviewRef = await addDoc(collection(db, "reviews"), {
        ...requestPayload,
        createdAt: serverTimestamp(),
        status: "pending",
      });
      return { id: reviewRef.id };
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
      await updateDoc(doc(db, "reviews", reviewId), {
        status: payload.status,
        approved: payload.status === "approved",
      });
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
      if (productId) {
        await updateDoc(doc(db, "produtos", productId), payload.data);
      } else {
        await addDoc(collection(db, "produtos"), {
          ...payload.data,
          createdAt: serverTimestamp(),
          vendidos: 0,
          cliques: 0,
        });
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
      await deleteDoc(doc(db, "produtos", cleanId));
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
      await addDoc(collection(db, "categorias"), { nome: cleanNome, createdAt: serverTimestamp() });
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

