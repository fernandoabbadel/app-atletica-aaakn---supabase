import { httpsCallable } from "@/lib/supa/functions";

import { functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { getSupabaseClient } from "./supabase";

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

const throwSupabaseError = (error: { message: string; code?: string | null; name?: string | null }): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown };
  const text = [asString(raw.message), asString(raw.details)]
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

const removeMissingColumnFromSelection = (
  columns: string[],
  missingColumn: string
): string[] | null => {
  const next = columns.filter((column) => column.toLowerCase() !== missingColumn.toLowerCase());
  if (next.length === columns.length) return null;
  return next;
};

export async function fetchFidelityConfig(options?: {
  forceRefresh?: boolean;
}): Promise<FidelityConfig> {
  const forceRefresh = options?.forceRefresh ?? false;
  if (!forceRefresh && configCache && Date.now() - configCache.cachedAt <= READ_CACHE_TTL_MS) {
    return configCache.value;
  }

  const supabase = getSupabaseClient();
  let selectColumns = ["id", "xpPerStamp", "rules"];
  let data: Record<string, unknown> | null = null;

  while (selectColumns.length > 0) {
    const response = await supabase
      .from("app_config")
      .select(selectColumns.join(","))
      .eq("id", "fidelity")
      .maybeSingle();
    if (!response.error) {
      data = (response.data as Record<string, unknown> | null) ?? null;
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(response.error));
    if (!missingColumn) throwSupabaseError(response.error);

    const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
    if (!nextColumns.length) throwSupabaseError(response.error);
    selectColumns = nextColumns;
  }

  const row = data ?? {};
  const config = {
    xpPerStamp: Math.max(1, asNumber(row.xpPerStamp, 100)),
    rules: normalizeRules(row.rules),
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

  const supabase = getSupabaseClient();
  let request = supabase
    .from("store_rewards")
    .select("id,title,cost,stock,image,active")
    .limit(maxResults);
  if (activeOnly) {
    request = request.eq("active", true);
  }
  const { data, error } = await request;
  if (error) throwSupabaseError(error);

  const rewards = (data ?? [])
    .map((row) => normalizeReward(asString((row as Record<string, unknown>).id), row))
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

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("uid,nome,xp,foto,turma")
    .order("xp", { ascending: false })
    .limit(maxResults);
  if (error) throwSupabaseError(error);

  const users = (data ?? [])
    .map((row) =>
      normalizeTopUser(
        asString((row as Record<string, unknown>).uid),
        row
      )
    )
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

  const supabase = getSupabaseClient();
  const primary = await supabase
    .from("achievements_logs")
    .select("id,userId,achievementTitle,timestamp,xp,tipo")
    .eq("userId", cleanUserId)
    .order("timestamp", { ascending: false })
    .limit(maxResults);

  let rows: FidelityHistoryItem[] = [];
  if (!primary.error) {
    rows = (primary.data ?? [])
      .map((row) => normalizeHistory(asString((row as Record<string, unknown>).id), row))
      .filter((row): row is FidelityHistoryItem => row !== null)
      .sort((left, right) => right.rawDate.getTime() - left.rawDate.getTime());
  } else if (asString(extractMissingSchemaColumn(primary.error))) {
    const fallback = await supabase
      .from("achievements_logs")
      .select("id,userId,achievementTitle,timestamp,xp,tipo")
      .eq("userId", cleanUserId)
      .limit(maxResults);
    if (fallback.error) throwSupabaseError(fallback.error);
    rows = (fallback.data ?? [])
      .map((row) => normalizeHistory(asString((row as Record<string, unknown>).id), row))
      .filter((row): row is FidelityHistoryItem => row !== null)
      .sort((left, right) => right.rawDate.getTime() - left.rawDate.getTime());
  } else {
    throwSupabaseError(primary.error);
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
      const supabase = getSupabaseClient();
      const mutablePayload: Record<string, unknown> = {
        id: "fidelity",
        ...payload,
        updatedAt: nowIso(),
      };

      while (Object.keys(mutablePayload).length > 1) {
        const { error } = await supabase
          .from("app_config")
          .upsert(mutablePayload, { onConflict: "id" });
        if (!error) return { ok: true };

        const missingColumn = asString(extractMissingSchemaColumn(error));
        if (!missingColumn) throwSupabaseError(error);
        const removableKey = Object.keys(mutablePayload).find(
          (key) => key.toLowerCase() === missingColumn.toLowerCase()
        );
        if (!removableKey || removableKey === "id") throwSupabaseError(error);
        delete mutablePayload[String(removableKey)];
      }

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
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("store_rewards")
        .insert({
          ...safePayload,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        })
        .select("id")
        .single();
      if (error) throwSupabaseError(error);
      return { id: asString((data as Record<string, unknown> | null)?.id) };
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
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("store_rewards").delete().eq("id", cleanId);
      if (error) throwSupabaseError(error);
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
      const supabase = getSupabaseClient();
      const now = nowIso();

      const { data: rewardData, error: rewardError } = await supabase
        .from("store_rewards")
        .select("id,stock")
        .eq("id", rewardId)
        .maybeSingle();
      if (rewardError) throwSupabaseError(rewardError);
      if (!rewardData) throw new Error("Premio nao encontrado.");

      const stock = Math.max(0, asNumber((rewardData as Record<string, unknown>).stock, 0));
      if (stock <= 0) {
        throw new Error("Estoque esgotado.");
      }

      const { error: updateRewardError } = await supabase
        .from("store_rewards")
        .update({
          stock: stock - 1,
          updatedAt: now,
        })
        .eq("id", rewardId);
      if (updateRewardError) throwSupabaseError(updateRewardError);

      const { error: redemptionError } = await supabase.from("store_redemptions").insert({
        userId,
        userName: requestPayload.userName,
        rewardId,
        rewardTitle: requestPayload.rewardTitle,
        cost: requestPayload.cost,
        status: "pendente",
        createdAt: now,
        updatedAt: now,
      });
      if (redemptionError) throwSupabaseError(redemptionError);

      const { error: notificationError } = await supabase.from("notifications").insert({
        userId,
        title: "Resgate registrado",
        message: `Seu pedido de ${requestPayload.rewardTitle} foi enviado para a atletica.`,
        link: "/fidelidade",
        read: false,
        type: "fidelity_redemption",
        createdAt: now,
      });
      if (notificationError) throwSupabaseError(notificationError);

      return { ok: true };
    }
  );

  clearReadCaches();
}
