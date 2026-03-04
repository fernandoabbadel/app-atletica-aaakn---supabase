import { httpsCallable } from "@/lib/supa/functions";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from "@/lib/supabaseHelpers";

import { db, functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 40_000;

const MAX_REWARDS_RESULTS = 140;
const MAX_TOP_USERS_RESULTS = 25;
const MAX_HISTORY_RESULTS = 60;
const MAX_RULE_LINES = 80;

const SAVE_CONFIG_CALLABLE = "fidelityAdminSaveConfig";
const CREATE_REWARD_CALLABLE = "fidelityAdminCreateReward";
const DELETE_REWARD_CALLABLE = "fidelityAdminDeleteReward";
const REDEEM_REWARD_CALLABLE = "fidelityRequestRedemption";

const rewardsCache = new Map<string, CacheEntry<FidelityReward[]>>();
const topUsersCache = new Map<string, CacheEntry<FidelityTopUser[]>>();
const historyCache = new Map<string, CacheEntry<FidelityHistoryItem[]>>();
let configCache: CacheEntry<FidelityConfig> | null = null;

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

const boundedLimit = (requested: number, maxAllowed: number): number => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
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
    const dateValue = toDate.call(value) as Date;
    if (dateValue instanceof Date) return dateValue.getTime();
  }

  return 0;
};

const toDate = (value: unknown): Date => {
  const ms = toMillis(value);
  if (!ms) return new Date();
  return new Date(ms);
};

const getCacheValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string
): T | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > READ_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
};

const setCacheValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T
): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const clearReadCaches = (): void => {
  rewardsCache.clear();
  topUsersCache.clear();
  historyCache.clear();
  configCache = null;
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

export interface FidelityReward {
  id: string;
  title: string;
  cost: number;
  stock: number;
  image?: string;
  active: boolean;
}

export interface FidelityTopUser {
  id: string;
  nome: string;
  xp: number;
  foto: string;
  turma: string;
}

export interface FidelityConfig {
  xpPerStamp: number;
  rules: string[];
}

export interface FidelityHistoryItem {
  id: string;
  acao: string;
  rawDate: Date;
  dataDisplay: string;
  xp: number;
  tipo: string;
}

const normalizeReward = (id: string, raw: unknown): FidelityReward | null => {
  const data = asObject(raw);
  if (!data) return null;

  return {
    id,
    title: asString(data.title, "Premio").trim().slice(0, 120),
    cost: Math.max(0, asNumber(data.cost, 0)),
    stock: Math.max(0, asNumber(data.stock, 0)),
    image: asString(data.image).trim().slice(0, 400) || undefined,
    active: asBoolean(data.active, true),
  };
};

const normalizeTopUser = (id: string, raw: unknown): FidelityTopUser | null => {
  const data = asObject(raw);
  if (!data) return null;

  return {
    id,
    nome: asString(data.nome, "Sem nome"),
    xp: Math.max(0, asNumber(data.xp, 0)),
    foto: asString(data.foto),
    turma: asString(data.turma),
  };
};

const normalizeRules = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 260))
    .filter((item) => item.length > 0)
    .slice(0, MAX_RULE_LINES);
};

const normalizeHistory = (id: string, raw: unknown): FidelityHistoryItem | null => {
  const data = asObject(raw);
  if (!data) return null;

  const dateObj = toDate(data.timestamp);
  return {
    id,
    acao: asString(data.achievementTitle, "Atividade"),
    rawDate: dateObj,
    dataDisplay: dateObj.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
    xp: Math.max(0, asNumber(data.xp, 0)),
    tipo: asString(data.tipo, "conquista"),
  };
};

export async function fetchFidelityConfig(options?: {
  forceRefresh?: boolean;
}): Promise<FidelityConfig> {
  const forceRefresh = options?.forceRefresh ?? false;
  if (!forceRefresh && configCache && Date.now() - configCache.cachedAt <= READ_CACHE_TTL_MS) {
    return configCache.value;
  }

  const snap = await getDoc(doc(db, "app_config", "fidelity"));
  const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
  const config = {
    xpPerStamp: Math.max(1, asNumber(data.xpPerStamp, 100)),
    rules: normalizeRules(data.rules),
  } satisfies FidelityConfig;

  configCache = { cachedAt: Date.now(), value: config };
  return config;
}

export async function fetchFidelityRewards(options?: {
  activeOnly?: boolean;
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<FidelityReward[]> {
  const activeOnly = options?.activeOnly ?? false;
  const maxResults = boundedLimit(options?.maxResults ?? 80, MAX_REWARDS_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${activeOnly ? "active" : "all"}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCacheValue(rewardsCache, cacheKey);
    if (cached) return cached;
  }

  const constraints = [
    collection(db, "store_rewards"),
  ];
  const baseQuery = activeOnly
    ? query(
        constraints[0],
        where("active", "==", true),
        limit(maxResults)
      )
    : query(constraints[0], limit(maxResults));

  const snap = await getDocs(baseQuery);
  const rewards = snap.docs
    .map((row) => normalizeReward(row.id, row.data()))
    .filter((row): row is FidelityReward => row !== null)
    .sort((left, right) => left.cost - right.cost);

  setCacheValue(rewardsCache, cacheKey, rewards);
  return rewards;
}

export async function fetchFidelityTopUsers(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<FidelityTopUser[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 5, MAX_TOP_USERS_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCacheValue(topUsersCache, cacheKey);
    if (cached) return cached;
  }

  const q = query(
    collection(db, "users"),
    orderBy("xp", "desc"),
    limit(maxResults)
  );
  const snap = await getDocs(q);
  const users = snap.docs
    .map((row) => normalizeTopUser(row.id, row.data()))
    .filter((row): row is FidelityTopUser => row !== null);

  setCacheValue(topUsersCache, cacheKey, users);
  return users;
}

export async function fetchFidelityHistory(
  userId: string,
  options?: { maxResults?: number; forceRefresh?: boolean }
): Promise<FidelityHistoryItem[]> {
  const cleanUserId = userId.trim();
  if (!cleanUserId) return [];

  const maxResults = boundedLimit(options?.maxResults ?? 20, MAX_HISTORY_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${cleanUserId}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCacheValue(historyCache, cacheKey);
    if (cached) return cached;
  }

  let rows: FidelityHistoryItem[] = [];
  try {
    const q = query(
      collection(db, "achievements_logs"),
      where("userId", "==", cleanUserId),
      orderBy("timestamp", "desc"),
      limit(maxResults)
    );
    const snap = await getDocs(q);
    rows = snap.docs
      .map((row) => normalizeHistory(row.id, row.data()))
      .filter((row): row is FidelityHistoryItem => row !== null)
      .sort((left, right) => right.rawDate.getTime() - left.rawDate.getTime());
  } catch (error: unknown) {
    if (!isIndexRequiredError(error)) {
      throw error;
    }

    const fallbackQuery = query(
      collection(db, "achievements_logs"),
      where("userId", "==", cleanUserId),
      limit(maxResults)
    );
    const snap = await getDocs(fallbackQuery);
    rows = snap.docs
      .map((row) => normalizeHistory(row.id, row.data()))
      .filter((row): row is FidelityHistoryItem => row !== null)
      .sort((left, right) => right.rawDate.getTime() - left.rawDate.getTime());
  }

  setCacheValue(historyCache, cacheKey, rows);
  return rows;
}

export async function saveFidelityConfig(config: FidelityConfig): Promise<void> {
  const payload = {
    xpPerStamp: Math.max(1, Number.isFinite(config.xpPerStamp) ? config.xpPerStamp : 100),
    rules: normalizeRules(config.rules),
  };

  await callWithFallback<typeof payload, { ok: boolean }>(
    SAVE_CONFIG_CALLABLE,
    payload,
    async () => {
      await setDoc(
        doc(db, "app_config", "fidelity"),
        { ...payload, updatedAt: serverTimestamp() },
        { merge: true }
      );
      return { ok: true };
    }
  );

  clearReadCaches();
}

export async function createFidelityReward(payload: {
  title: string;
  cost: number;
  stock: number;
  image?: string;
}): Promise<{ id: string }> {
  const safePayload = {
    title: payload.title.trim().slice(0, 120) || "Premio",
    cost: Math.max(0, Number.isFinite(payload.cost) ? payload.cost : 0),
    stock: Math.max(0, Number.isFinite(payload.stock) ? payload.stock : 0),
    image:
      payload.image?.trim().slice(0, 400) ||
      "https://placehold.co/400x400/000/FFF?text=Premio",
    active: true,
  };

  const result = await callWithFallback<typeof safePayload, { id: string }>(
    CREATE_REWARD_CALLABLE,
    safePayload,
    async () => {
      const ref = await addDoc(collection(db, "store_rewards"), {
        ...safePayload,
        createdAt: serverTimestamp(),
      });
      return { id: ref.id };
    }
  );

  clearReadCaches();
  return result;
}

export async function deleteFidelityReward(id: string): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) return;

  await callWithFallback<{ id: string }, { ok: boolean }>(
    DELETE_REWARD_CALLABLE,
    { id: cleanId },
    async () => {
      await deleteDoc(doc(db, "store_rewards", cleanId));
      return { ok: true };
    }
  );

  clearReadCaches();
}

export async function requestFidelityRedemption(payload: {
  userId: string;
  userName: string;
  reward: FidelityReward;
}): Promise<void> {
  const userId = payload.userId.trim();
  if (!userId) {
    throw new Error("Usuario invalido para resgate.");
  }

  const rewardId = payload.reward.id.trim();
  if (!rewardId) {
    throw new Error("Premio invalido para resgate.");
  }

  const requestPayload = {
    userId,
    userName: payload.userName.trim().slice(0, 120) || "Atleta",
    rewardId,
    rewardTitle: payload.reward.title.trim().slice(0, 120),
    cost: Math.max(0, payload.reward.cost),
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    REDEEM_REWARD_CALLABLE,
    requestPayload,
    async () => {
      await runTransaction(db, async (transaction) => {
        const rewardRef = doc(db, "store_rewards", rewardId);
        const rewardSnap = await transaction.get(rewardRef);

        if (!rewardSnap.exists()) {
          throw new Error("Premio nao encontrado.");
        }

        const rewardData = rewardSnap.data() as Record<string, unknown>;
        const stock = Math.max(0, asNumber(rewardData.stock, 0));
        if (stock <= 0) {
          throw new Error("Estoque esgotado.");
        }

        transaction.update(rewardRef, { stock: increment(-1) });

        const redemptionRef = doc(collection(db, "store_redemptions"));
        transaction.set(redemptionRef, {
          userId,
          userName: requestPayload.userName,
          rewardId,
          rewardTitle: requestPayload.rewardTitle,
          cost: requestPayload.cost,
          status: "pendente",
          createdAt: serverTimestamp(),
        });

        const notificationRef = doc(collection(db, "notifications"));
        transaction.set(notificationRef, {
          userId,
          title: "Resgate registrado",
          message: `Seu pedido de ${requestPayload.rewardTitle} foi enviado para a atlética.`,
          link: "/fidelidade",
          read: false,
          type: "fidelity_redemption",
          createdAt: serverTimestamp(),
        });
      });

      return { ok: true };
    }
  );

  clearReadCaches();
}


