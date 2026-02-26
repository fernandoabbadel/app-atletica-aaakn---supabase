import { httpsCallable } from "@/lib/supa/functions";
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
  type QueryConstraint,
} from "@/lib/supa/firestore";

import { db, functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 30_000;

const DASHBOARD_EVENTS_LIMIT = 5;
const DASHBOARD_PRODUCTS_LIMIT = 8;
const DASHBOARD_POSTS_LIMIT = 2;
const DASHBOARD_TREINOS_LIMIT = 4;
const DASHBOARD_PARTNERS_LIMIT = 50;
const DASHBOARD_LIGAS_LIMIT = 60;
const DASHBOARD_ALBUM_LIMIT = 350;
const DASHBOARD_LIKES_SAMPLE_PER_PRODUCT = 10;
const DASHBOARD_USERS_IN_CHUNK = 10;
const DASHBOARD_USERS_COUNT_FALLBACK_LIMIT = 2_000;

const DASHBOARD_EVENT_LIKE_CALLABLE = "dashboardToggleEventLike";
const DASHBOARD_PRODUCT_LIKE_CALLABLE = "dashboardToggleProductLike";
const DASHBOARD_POST_LIKE_CALLABLE = "dashboardTogglePostLike";

const dashboardCache = new Map<string, CacheEntry<DashboardBundle>>();

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
};

const getCachedValue = <T>(
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

const setCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T
): void => {
  cache.set(key, { cachedAt: Date.now(), value });
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

const shouldUseCallable = (): boolean => {
  if (typeof window === "undefined") return true;
  if (process.env.NEXT_PUBLIC_FORCE_CALLABLES === "true") return true;

  const host = window.location.hostname.toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1";
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
    if (shouldFallbackToClientWrites(error)) {
      return fallbackFn();
    }
    throw error;
  }
}

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

const chunkArray = <T>(rows: T[], chunkSize: number): T[][] => {
  if (chunkSize < 1) return [rows];
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize));
  }
  return chunks;
};

async function fetchRowsWithFallback(
  collectionName: string,
  attempts: QueryConstraint[][]
): Promise<Record<string, unknown>[]> {
  const normalizedAttempts = attempts.filter((entry) => entry.length > 0);
  if (!normalizedAttempts.length) return [];

  let lastError: unknown = null;
  for (let i = 0; i < normalizedAttempts.length; i += 1) {
    try {
      const snap = await getDocs(
        query(collection(db, collectionName), ...normalizedAttempts[i])
      );
      return snap.docs.map((row) => ({
        id: row.id,
        ...(row.data() as Record<string, unknown>),
      }));
    } catch (error: unknown) {
      lastError = error;
      const isLast = i === normalizedAttempts.length - 1;
      if (!isIndexRequiredError(error) || isLast) {
        throw error;
      }
    }
  }

  if (lastError) throw lastError;
  return [];
}

async function safeUsersCount(): Promise<number> {
  try {
    const snap = await getCountFromServer(collection(db, "users"));
    return snap.data().count;
  } catch {
    const fallbackSnap = await getDocs(
      query(collection(db, "users"), limit(DASHBOARD_USERS_COUNT_FALLBACK_LIMIT))
    );
    return fallbackSnap.size;
  }
}

const normalizeEvento = (id: string, raw: unknown): DashboardEvent | null => {
  const data = asObject(raw);
  if (!data) return null;

  return {
    id,
    titulo: asString(data.titulo, "Evento"),
    data: asString(data.data),
    local: asString(data.local),
    imagem: asString(data.imagem),
    tipo: asString(data.tipo),
    likesList: asStringArray(data.likesList),
    participantes: asStringArray(data.participantes),
    imagePositionY: asNumber(data.imagePositionY, 50),
  };
};

const normalizeProduto = (id: string, raw: unknown): DashboardProduct | null => {
  const data = asObject(raw);
  if (!data) return null;

  const precoRaw = data.preco;
  const preco: string | number =
    typeof precoRaw === "string" || typeof precoRaw === "number" ? precoRaw : 0;

  return {
    id,
    nome: asString(data.nome, "Produto"),
    preco,
    img: asString(data.img),
    likes: asStringArray(data.likes),
  };
};

const normalizeParceiro = (
  id: string,
  raw: unknown
): DashboardPartner | null => {
  const data = asObject(raw);
  if (!data) return null;

  return {
    id,
    nome: asString(data.nome, "Parceiro"),
    imgLogo: asString(data.imgLogo),
    imgCapa: asString(data.imgCapa) || undefined,
    categoria: asString(data.categoria) || undefined,
    plano: asString(data.plano) || undefined,
    status: asString(data.status) || undefined,
  };
};

const normalizeLiga = (id: string, raw: unknown): DashboardLiga | null => {
  const data = asObject(raw);
  if (!data) return null;

  return {
    id,
    nome: asString(data.nome, "Liga"),
    sigla: asString(data.sigla),
    foto: asString(data.foto) || undefined,
    logoBase64: asString(data.logoBase64) || undefined,
    logo: asString(data.logo) || undefined,
    descricao: asString(data.descricao) || undefined,
    bizu: asString(data.bizu) || undefined,
    ativa: asBoolean(data.ativa, false),
    visivel: asBoolean(data.visivel, false),
    status: asString(data.status) || undefined,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
};

const normalizePost = (id: string, raw: unknown): DashboardPost | null => {
  const data = asObject(raw);
  if (!data) return null;

  return {
    id,
    userId: asString(data.userId),
    userName: asString(data.userName, "Usuario"),
    avatar: asString(data.avatar),
    createdAt: data.createdAt ?? null,
    texto: asString(data.texto),
    likes: asStringArray(data.likes),
  };
};

const toTurmaKey = (raw: unknown): string | null => {
  const digits = asString(raw).replace(/\D/g, "");
  return digits ? digits : null;
};

async function fetchUsersTurmaMap(uids: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(uids.filter((entry) => entry.trim().length > 0))];
  const result = new Map<string, string>();
  if (!uniqueIds.length) return result;

  const chunks = chunkArray(uniqueIds, DASHBOARD_USERS_IN_CHUNK);
  for (const chunk of chunks) {
    const snap = await getDocs(
      query(collection(db, "users"), where("uid", "in", chunk), limit(chunk.length))
    );
    snap.forEach((row) => {
      const data = row.data() as Record<string, unknown>;
      const uid = asString(data.uid, row.id);
      const turma = toTurmaKey(data.turma);
      if (uid && turma) {
        result.set(uid, turma);
      }
    });
  }

  return result;
}

async function buildProductTurmaStats(
  products: DashboardProduct[]
): Promise<Record<string, DashboardTurmaStat[]>> {
  const likesByProduct = new Map<string, string[]>();
  const sampledUids: string[] = [];

  for (const product of products) {
    const sampled = product.likes.slice(0, DASHBOARD_LIKES_SAMPLE_PER_PRODUCT);
    likesByProduct.set(product.id, sampled);
    sampledUids.push(...sampled);
  }

  const turmaByUid = await fetchUsersTurmaMap(sampledUids);
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

export interface DashboardTurmaStat {
  turma: string;
  count: number;
}

export interface DashboardEvent {
  id: string;
  titulo: string;
  data: string;
  local: string;
  imagem: string;
  tipo: string;
  likesList: string[];
  participantes: string[];
  imagePositionY?: number;
}

export interface DashboardProduct {
  id: string;
  nome: string;
  preco: string | number;
  img: string;
  likes: string[];
}

export interface DashboardLiga {
  id: string;
  nome: string;
  sigla: string;
  foto?: string;
  logoBase64?: string;
  logo?: string;
  descricao?: string;
  bizu?: string;
  ativa?: boolean;
  visivel?: boolean;
  status?: string;
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
  likes: string[];
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
}): Promise<DashboardBundle> {
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = "default";

  if (!forceRefresh) {
    const cached = getCachedValue(dashboardCache, cacheKey);
    if (cached) return cached;
  }

  const [
    eventRows,
    productRows,
    partnerRows,
    ligaRows,
    albumRows,
    postRows,
    treinoRows,
    totalAlunos,
  ] = await Promise.all([
    fetchRowsWithFallback("eventos", [
      [orderBy("data", "asc"), limit(DASHBOARD_EVENTS_LIMIT)],
      [orderBy("createdAt", "desc"), limit(DASHBOARD_EVENTS_LIMIT)],
      [limit(DASHBOARD_EVENTS_LIMIT)],
    ]),
    fetchRowsWithFallback("produtos", [[limit(DASHBOARD_PRODUCTS_LIMIT)]]),
    fetchRowsWithFallback("parceiros", [
      [where("status", "==", "active"), limit(DASHBOARD_PARTNERS_LIMIT)],
      [limit(DASHBOARD_PARTNERS_LIMIT)],
    ]),
    fetchRowsWithFallback("ligas_config", [[limit(DASHBOARD_LIGAS_LIMIT)]]),
    fetchRowsWithFallback("album_rankings", [[limit(DASHBOARD_ALBUM_LIMIT)]]),
    fetchRowsWithFallback("posts", [
      [orderBy("createdAt", "desc"), limit(DASHBOARD_POSTS_LIMIT)],
      [limit(DASHBOARD_POSTS_LIMIT)],
    ]),
    fetchRowsWithFallback("treinos", [
      [orderBy("createdAt", "desc"), limit(DASHBOARD_TREINOS_LIMIT)],
      [limit(DASHBOARD_TREINOS_LIMIT)],
    ]),
    safeUsersCount(),
  ]);

  const events = eventRows
    .map((row) => normalizeEvento(asString(row.id), row))
    .filter((row): row is DashboardEvent => row !== null);

  const produtos = productRows
    .map((row) => normalizeProduto(asString(row.id), row))
    .filter((row): row is DashboardProduct => row !== null);

  const parceiros = partnerRows
    .map((row) => normalizeParceiro(asString(row.id), row))
    .filter((row): row is DashboardPartner => row !== null)
    .filter((partner) => (partner.status || "active") === "active");

  const ligas = ligaRows
    .map((row) => normalizeLiga(asString(row.id), row))
    .filter((row): row is DashboardLiga => row !== null);

  const mensagens = [...postRows]
    .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt))
    .map((row) => normalizePost(asString(row.id), row))
    .filter((row): row is DashboardPost => row !== null);

  const treinos = treinoRows
    .map((row) => asString(row.imagem))
    .filter((entry) => entry.length > 0);

  const totalCaca = albumRows.reduce(
    (acc, row) => acc + asNumber(row.totalColetado, 0),
    0
  );

  const productTurmaStats = await buildProductTurmaStats(produtos);

  const bundle: DashboardBundle = {
    events,
    produtos,
    parceiros,
    ligas,
    mensagens,
    treinos,
    totalCaca,
    totalAlunos,
    productTurmaStats,
  };

  setCachedValue(dashboardCache, cacheKey, bundle);
  return bundle;
}

function clearDashboardCache(): void {
  dashboardCache.clear();
}

export async function toggleDashboardEventLike(payload: {
  eventId: string;
  userId: string;
  currentlyLiked: boolean;
}): Promise<void> {
  const eventId = payload.eventId.trim();
  const userId = payload.userId.trim();
  if (!eventId || !userId) return;

  await callWithFallback<
    { eventId: string; userId: string; currentlyLiked: boolean },
    { ok: boolean }
  >(
    DASHBOARD_EVENT_LIKE_CALLABLE,
    { eventId, userId, currentlyLiked: payload.currentlyLiked },
    async () => {
      await updateDoc(doc(db, "eventos", eventId), {
        likesList: payload.currentlyLiked
          ? arrayRemove(userId)
          : arrayUnion(userId),
      });
      return { ok: true };
    }
  );

  clearDashboardCache();
}

export async function toggleDashboardProductLike(payload: {
  productId: string;
  userId: string;
  currentlyLiked: boolean;
}): Promise<void> {
  const productId = payload.productId.trim();
  const userId = payload.userId.trim();
  if (!productId || !userId) return;

  await callWithFallback<
    { productId: string; userId: string; currentlyLiked: boolean },
    { ok: boolean }
  >(
    DASHBOARD_PRODUCT_LIKE_CALLABLE,
    { productId, userId, currentlyLiked: payload.currentlyLiked },
    async () => {
      await updateDoc(doc(db, "produtos", productId), {
        likes: payload.currentlyLiked ? arrayRemove(userId) : arrayUnion(userId),
      });
      return { ok: true };
    }
  );

  clearDashboardCache();
}

export async function toggleDashboardPostLike(payload: {
  postId: string;
  userId: string;
  currentlyLiked: boolean;
}): Promise<void> {
  const postId = payload.postId.trim();
  const userId = payload.userId.trim();
  if (!postId || !userId) return;

  await callWithFallback<
    { postId: string; userId: string; currentlyLiked: boolean },
    { ok: boolean }
  >(
    DASHBOARD_POST_LIKE_CALLABLE,
    { postId, userId, currentlyLiked: payload.currentlyLiked },
    async () => {
      await updateDoc(doc(db, "posts", postId), {
        likes: payload.currentlyLiked ? arrayRemove(userId) : arrayUnion(userId),
      });
      return { ok: true };
    }
  );

  clearDashboardCache();
}

export function clearDashboardCaches(): void {
  clearDashboardCache();
}

