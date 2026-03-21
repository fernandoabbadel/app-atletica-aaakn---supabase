import { httpsCallable } from "@/lib/supa/functions";

import { functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { getSupabaseClient } from "./supabase";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import {
  fetchTenantMembershipDirectory,
  resolveTenantScopedXp,
} from "./tenantMembershipDirectory";

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
const configCache = new Map<string, CacheEntry<FidelityConfig>>();

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
  configCache.clear();
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
const resolveFidelityTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

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

type TenantAwareRewardRow = FidelityReward & {
  tenantId: string;
};

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

const normalizeTenantAwareReward = (
  id: string,
  raw: unknown
): TenantAwareRewardRow | null => {
  const normalized = normalizeReward(id, raw);
  if (!normalized) return null;

  const data = asObject(raw);
  return {
    ...normalized,
    tenantId: asString(data?.tenant_id).trim(),
  };
};

const toFidelityReward = (row: TenantAwareRewardRow): FidelityReward => ({
  id: row.id,
  title: row.title,
  cost: row.cost,
  stock: row.stock,
  image: row.image,
  active: row.active,
});

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

const pickTenantAwareRewards = (
  rows: TenantAwareRewardRow[],
  tenantId: string
): FidelityReward[] => {
  const cleanTenantId = tenantId.trim();
  if (!cleanTenantId) {
    return rows
      .filter((row) => !row.tenantId)
      .map((row) => toFidelityReward(row));
  }

  return rows
    .filter((row) => row.tenantId === cleanTenantId)
    .map((row) => toFidelityReward(row));
};

export async function fetchFidelityConfig(options?: {
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<FidelityConfig> {
  const forceRefresh = options?.forceRefresh ?? false;
  const tenantId = resolveFidelityTenantId(options?.tenantId);
  const cacheKey = tenantId || "global";
  const cached = configCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.cachedAt <= READ_CACHE_TTL_MS) {
    return cached.value;
  }

  const supabase = getSupabaseClient();
  let selectColumns = ["id", "xpPerStamp", "rules", "data"];
  let data: Record<string, unknown> | null = null;
  const configIds = tenantId
    ? [buildTenantScopedRowId(tenantId, "fidelity")]
    : ["fidelity"];

  for (const configId of configIds) {
    let currentColumns = [...selectColumns];
    while (currentColumns.length > 0) {
      const response = await supabase
        .from("app_config")
        .select(currentColumns.join(","))
        .eq("id", configId)
        .maybeSingle();
      if (!response.error) {
        data = (response.data as Record<string, unknown> | null) ?? null;
        if (data) {
          selectColumns = currentColumns;
          break;
        }
        break;
      }

      const missingColumn = asString(extractMissingSchemaColumn(response.error));
      if (!missingColumn) throwSupabaseError(response.error);

      const nextColumns = removeMissingColumnFromSelection(currentColumns, missingColumn) ?? [];
      if (!nextColumns.length) throwSupabaseError(response.error);
      currentColumns = nextColumns;
    }
    if (data) break;
  }

  const row = data ?? {};
  const rowData = asObject(row.data) ?? {};
  const config = {
    xpPerStamp: Math.max(1, asNumber(row.xpPerStamp ?? rowData.xpPerStamp, 100)),
    rules: normalizeRules(row.rules ?? rowData.rules),
  } satisfies FidelityConfig;

  configCache.set(cacheKey, { cachedAt: Date.now(), value: config });
  return config;
}

export async function fetchFidelityRewards(options?: {
  activeOnly?: boolean;
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<FidelityReward[]> {
  const activeOnly = options?.activeOnly ?? false;
  const maxResults = boundedLimit(options?.maxResults ?? 80, MAX_REWARDS_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const tenantId = resolveFidelityTenantId(options?.tenantId);
  const cacheKey = `${activeOnly ? "active" : "all"}:${maxResults}:${tenantId || "global"}`;

  if (!forceRefresh) {
    const cached = getCacheValue(rewardsCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let selectColumns = ["id", "title", "cost", "stock", "image", "active", "tenant_id"];
  let rawRows: TenantAwareRewardRow[] = [];

  while (selectColumns.length > 0) {
    let request = supabase
      .from("store_rewards")
      .select(selectColumns.join(","))
      .limit(maxResults);
    if (activeOnly) {
      request = request.eq("active", true);
    }

    const { data, error } = await request;
    if (!error) {
      if (selectColumns.includes("tenant_id")) {
        rawRows = (data ?? [])
          .map((row) =>
            normalizeTenantAwareReward(asString((row as unknown as Record<string, unknown>).id), row)
          )
          .filter((row): row is TenantAwareRewardRow => row !== null);
      } else {
        rawRows = (data ?? [])
          .map((row) => normalizeReward(asString((row as unknown as Record<string, unknown>).id), row))
          .filter((row): row is FidelityReward => row !== null)
          .map((row) => ({ ...row, tenantId: "" }));
      }
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error));
    if (!missingColumn) throwSupabaseError(error);

    const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
    if (!nextColumns.length) throwSupabaseError(error);
    selectColumns = nextColumns;
  }

  const rewards = selectColumns.includes("tenant_id")
    ? pickTenantAwareRewards(rawRows, tenantId)
    : rawRows
        .map((row) => toFidelityReward(row))
        .sort((left, right) => left.cost - right.cost);

  rewards.sort((left, right) => left.cost - right.cost);

  setCacheValue(rewardsCache, cacheKey, rewards);
  return rewards;
}

export async function fetchFidelityTopUsers(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<FidelityTopUser[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 5, MAX_TOP_USERS_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const tenantId = resolveFidelityTenantId(options?.tenantId);
  const cacheKey = `${maxResults}:${tenantId || "global"}`;

  if (!forceRefresh) {
    const cached = getCacheValue(topUsersCache, cacheKey);
    if (cached) return cached;
  }

  if (tenantId) {
    const rows = (
      await fetchTenantMembershipDirectory({
        tenantId,
        statuses: ["approved", "pending", "disabled"],
        limit: Math.min(MAX_TOP_USERS_RESULTS, maxResults * 4),
      })
    )
      .map((entry) => ({
        id: entry.userId,
        nome: entry.nome,
        xp: resolveTenantScopedXp(entry),
        foto: entry.foto,
        turma: entry.turma,
      }))
      .sort(
        (left, right) =>
          right.xp - left.xp ||
          left.nome.localeCompare(right.nome, "pt-BR")
      )
      .slice(0, maxResults);

    setCacheValue(topUsersCache, cacheKey, rows);
    return rows;
  }

  const supabase = getSupabaseClient();
  const request = supabase
    .from("users")
    .select("uid,nome,xp,foto,turma")
    .order("xp", { ascending: false })
    .limit(maxResults);
  const { data, error } = await request;
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
  options?: { maxResults?: number; forceRefresh?: boolean; tenantId?: string | null }
): Promise<FidelityHistoryItem[]> {
  const cleanUserId = userId.trim();
  if (!cleanUserId) return [];

  const maxResults = boundedLimit(options?.maxResults ?? 20, MAX_HISTORY_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const tenantId = resolveFidelityTenantId(options?.tenantId);
  const cacheKey = `${cleanUserId}:${maxResults}:${tenantId || "global"}`;

  if (!forceRefresh) {
    const cached = getCacheValue(historyCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let selectColumns = ["id", "userId", "achievementTitle", "timestamp", "xp", "tipo", "data", "tenant_id"];
  let primaryTenantId = "";

  if (tenantId) {
    const directory = await fetchTenantMembershipDirectory({
      tenantId,
      userIds: [cleanUserId],
      statuses: ["approved", "pending", "disabled"],
      limit: 1,
    });
    if (directory.length === 0) {
      setCacheValue(historyCache, cacheKey, []);
      return [];
    }
    primaryTenantId = directory[0]?.globalTenantId ?? "";
  }

  let rawRows: Record<string, unknown>[] = [];
  while (selectColumns.length > 0) {
    const { data, error } = await supabase
      .from("achievements_logs")
      .select(selectColumns.join(","))
      .eq("userId", cleanUserId)
      .order("timestamp", { ascending: false })
      .limit(tenantId ? Math.min(MAX_HISTORY_RESULTS, maxResults * 8) : maxResults);

    if (!error) {
      rawRows = ((data ?? []) as unknown) as Record<string, unknown>[];
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error));
    if (!missingColumn) throwSupabaseError(error);
    const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
    if (!nextColumns.length) throwSupabaseError(error);
    selectColumns = nextColumns;
  }

  const rows = rawRows
    .map((row) => {
      const dataPayload = asObject(row.data);
      const rowTenantId = asString(row.tenant_id).trim();
      const logTenantId = rowTenantId || asString(dataPayload?.tenantId).trim();

      if (tenantId) {
        const belongsToTenant =
          logTenantId === tenantId || (!logTenantId && primaryTenantId === tenantId);
        if (!belongsToTenant) {
          return null;
        }
      }

      return normalizeHistory(asString(row.id), row);
    })
    .filter((row): row is FidelityHistoryItem => row !== null)
    .sort((left, right) => right.rawDate.getTime() - left.rawDate.getTime())
    .slice(0, maxResults);

  setCacheValue(historyCache, cacheKey, rows);
  return rows;
}

export async function saveFidelityConfig(
  config: FidelityConfig,
  options?: { tenantId?: string | null }
): Promise<void> {
  const tenantId = resolveFidelityTenantId(options?.tenantId);
  const payload = {
    xpPerStamp: Math.max(1, Number.isFinite(config.xpPerStamp) ? config.xpPerStamp : 100),
    rules: normalizeRules(config.rules),
  };

  const saveLocally = async (): Promise<{ ok: boolean }> => {
    const supabase = getSupabaseClient();
    const mutablePayload: Record<string, unknown> = {
      id: buildTenantScopedRowId(tenantId, "fidelity") || "fidelity",
      ...(tenantId ? { tenant_id: tenantId } : {}),
      data: payload,
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
  };

  if (tenantId) {
    await saveLocally();
  } else {
    await callWithFallback<typeof payload & { tenantId?: string }, { ok: boolean }>(
      SAVE_CONFIG_CALLABLE,
      { ...payload, tenantId: tenantId || undefined },
      saveLocally
    );
  }

  clearReadCaches();
}

export async function createFidelityReward(payload: {
  title: string;
  cost: number;
  stock: number;
  image?: string;
}, options?: { tenantId?: string | null }): Promise<{ id: string }> {
  const tenantId = resolveFidelityTenantId(options?.tenantId);
  const safePayload = {
    title: payload.title.trim().slice(0, 120) || "Premio",
    cost: Math.max(0, Number.isFinite(payload.cost) ? payload.cost : 0),
    stock: Math.max(0, Number.isFinite(payload.stock) ? payload.stock : 0),
    image:
      payload.image?.trim().slice(0, 400) ||
      "https://placehold.co/400x400/000/FFF?text=Premio",
    active: true,
  };

  const createLocally = async (): Promise<{ id: string }> => {
    const supabase = getSupabaseClient();
    const mutablePayload: Record<string, unknown> = {
      ...safePayload,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    if (tenantId) {
      mutablePayload.tenant_id = tenantId;
    }

    while (Object.keys(mutablePayload).length > 0) {
      const { data, error } = await supabase
        .from("store_rewards")
        .insert(mutablePayload)
        .select("id")
        .single();
      if (!error) {
        return { id: asString((data as Record<string, unknown> | null)?.id) };
      }

      const missingColumn = asString(extractMissingSchemaColumn(error));
      if (!missingColumn) throwSupabaseError(error);
      const removableKey = Object.keys(mutablePayload).find(
        (key) => key.toLowerCase() === missingColumn.toLowerCase()
      );
      if (!removableKey) throwSupabaseError(error);
      delete mutablePayload[String(removableKey)];
    }

    return { id: "" };
  };

  const result = tenantId
    ? await createLocally()
    : await callWithFallback<typeof safePayload, { id: string }>(
        CREATE_REWARD_CALLABLE,
        safePayload,
        createLocally
      );

  clearReadCaches();
  return result;
}

export async function deleteFidelityReward(
  id: string,
  options?: { tenantId?: string | null }
): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) return;
  const tenantId = resolveFidelityTenantId(options?.tenantId);

  const deleteLocally = async (): Promise<{ ok: boolean }> => {
    const supabase = getSupabaseClient();
    let rewardLookup = await supabase
      .from("store_rewards")
      .select("id,tenant_id")
      .eq("id", cleanId)
      .maybeSingle();
    if (rewardLookup.error && asString(extractMissingSchemaColumn(rewardLookup.error))) {
      rewardLookup = await supabase
        .from("store_rewards")
        .select("id")
        .eq("id", cleanId)
        .maybeSingle();
    }
    if (rewardLookup.error) {
      throwSupabaseError(rewardLookup.error);
    }

    const rewardTenantId = asString(
      ((rewardLookup.data as unknown as Record<string, unknown> | null) ?? {}).tenant_id
    ).trim();
    if (tenantId && rewardTenantId && rewardTenantId !== tenantId) {
      throw new Error("Premio fora do tenant ativo.");
    }

    let request = supabase.from("store_rewards").delete().eq("id", cleanId);
    if (tenantId && rewardTenantId) {
      request = request.eq("tenant_id", tenantId);
    }
    const { error } = await request;
    if (error) throwSupabaseError(error);
    return { ok: true };
  };

  if (tenantId) {
    await deleteLocally();
  } else {
    await callWithFallback<{ id: string }, { ok: boolean }>(
      DELETE_REWARD_CALLABLE,
      { id: cleanId },
      deleteLocally
    );
  }

  clearReadCaches();
}

export async function requestFidelityRedemption(payload: {
  userId: string;
  userName: string;
  reward: FidelityReward;
  tenantId?: string | null;
}): Promise<void> {
  const userId = payload.userId.trim();
  if (!userId) {
    throw new Error("Usuario invalido para resgate.");
  }
  const tenantId = resolveFidelityTenantId(payload.tenantId);

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

  const redeemLocally = async (): Promise<{ ok: boolean }> => {
    const supabase = getSupabaseClient();
    const now = nowIso();

      let rewardResponse = await supabase
        .from("store_rewards")
        .select("id,stock,tenant_id")
        .eq("id", rewardId)
        .maybeSingle();
      if (rewardResponse.error && asString(extractMissingSchemaColumn(rewardResponse.error))) {
        rewardResponse = await supabase
          .from("store_rewards")
          .select("id,stock")
          .eq("id", rewardId)
          .maybeSingle();
      }
      const { data: rewardData, error: rewardError } = rewardResponse;
      if (rewardError) throwSupabaseError(rewardError);
      if (!rewardData) throw new Error("Premio nao encontrado.");

      const rewardTenantId = asString((rewardData as Record<string, unknown>).tenant_id).trim();
      if (tenantId && rewardTenantId && rewardTenantId !== tenantId) {
        throw new Error("Premio fora do tenant ativo.");
      }

      const stock = Math.max(0, asNumber((rewardData as Record<string, unknown>).stock, 0));
      if (stock <= 0) {
        throw new Error("Estoque esgotado.");
      }

      let rewardUpdate = supabase
        .from("store_rewards")
        .update({
          stock: stock - 1,
          updatedAt: now,
        })
        .eq("id", rewardId);
      if (tenantId && rewardTenantId) {
        rewardUpdate = rewardUpdate.eq("tenant_id", tenantId);
      }
      let { error: updateRewardError } = await rewardUpdate;
      if (updateRewardError && asString(extractMissingSchemaColumn(updateRewardError))) {
        const fallbackUpdate = await supabase
          .from("store_rewards")
          .update({
            stock: stock - 1,
            updatedAt: now,
          })
          .eq("id", rewardId);
        updateRewardError = fallbackUpdate.error;
      }
      if (updateRewardError) throwSupabaseError(updateRewardError);

      const redemptionPayload: Record<string, unknown> = {
        userId,
        userName: requestPayload.userName,
        rewardId,
        rewardTitle: requestPayload.rewardTitle,
        cost: requestPayload.cost,
        ...(tenantId ? { tenant_id: tenantId } : {}),
        status: "pendente",
        data: tenantId ? { tenantId } : {},
        createdAt: now,
        updatedAt: now,
      };
      let redemptionError: { message: string; code?: string | null; name?: string | null } | null =
        null;
      while (Object.keys(redemptionPayload).length > 0) {
        const result = await supabase.from("store_redemptions").insert(redemptionPayload);
        if (!result.error) {
          redemptionError = null;
          break;
        }

        const missingColumn = asString(extractMissingSchemaColumn(result.error));
        if (!missingColumn) {
          redemptionError = result.error;
          break;
        }
        const removableKey = Object.keys(redemptionPayload).find(
          (key) => key.toLowerCase() === missingColumn.toLowerCase()
        );
        if (!removableKey) {
          redemptionError = result.error;
          break;
        }
        delete redemptionPayload[String(removableKey)];
      }
      if (redemptionError) throwSupabaseError(redemptionError);

      const notificationPayload: Record<string, unknown> = {
        userId,
        ...(tenantId ? { tenant_id: tenantId } : {}),
        title: "Resgate registrado",
        message: `Seu pedido de ${requestPayload.rewardTitle} foi enviado para a atletica.`,
        link: "/fidelidade",
        read: false,
        type: "fidelity_redemption",
        createdAt: now,
        updatedAt: now,
      };
      let notificationError: { message: string; code?: string | null; name?: string | null } | null =
        null;
      while (Object.keys(notificationPayload).length > 0) {
        const result = await supabase.from("notifications").insert(notificationPayload);
        if (!result.error) {
          notificationError = null;
          break;
        }

        const missingColumn = asString(extractMissingSchemaColumn(result.error));
        if (!missingColumn) {
          notificationError = result.error;
          break;
        }
        const removableKey = Object.keys(notificationPayload).find(
          (key) => key.toLowerCase() === missingColumn.toLowerCase()
        );
        if (!removableKey) {
          notificationError = result.error;
          break;
        }
        delete notificationPayload[String(removableKey)];
      }
      if (notificationError) throwSupabaseError(notificationError);

    return { ok: true };
  };

  if (tenantId) {
    await redeemLocally();
  } else {
    await callWithFallback<typeof requestPayload, { ok: boolean }>(
      REDEEM_REWARD_CALLABLE,
      requestPayload,
      redeemLocally
    );
  }

  clearReadCaches();
}
