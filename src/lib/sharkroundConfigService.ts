import { httpsCallable } from "@/lib/supa/functions";

import { functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { throwSupabaseError } from "./supabaseData";
import { getSupabaseClient } from "./supabase";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 30_000;

const SHARKROUND_CONFIG_PATH = ["app_config", "sharkround"] as const;
const SHARKROUND_CONFIG_GET_CALLABLE = "sharkroundGetConfig";
const SHARKROUND_CONFIG_SAVE_CALLABLE = "sharkroundAdminSaveConfig";
const nowIso = (): string => new Date().toISOString();
const SHARKROUND_CONFIG_SELECT_COLUMNS = [
  "id",
  "data",
  "displayName",
  "dailyRollsLimit",
  "startingCoins",
  "bailCost",
  "heartTarget",
  "heartHelpReward",
  "cycleBaseReward",
  "rules",
  "display_name",
  "daily_rolls_limit",
  "starting_coins",
  "bail_cost",
  "heart_target",
  "heart_help_reward",
  "cycle_base_reward",
];

const configCache = new Map<string, CacheEntry<SharkroundAppConfig>>();
const inflightConfig = new Map<string, Promise<SharkroundAppConfig>>();

export interface SharkroundAppConfig {
  displayName: string;
  dailyRollsLimit: number;
  startingCoins: number;
  bailCost: number;
  heartTarget: number;
  heartHelpReward: number;
  cycleBaseReward: number;
  rules: string[];
}

const DEFAULT_SHARKROUND_CONFIG: SharkroundAppConfig = {
  displayName: "BoardRound",
  dailyRollsLimit: 5,
  startingCoins: 100,
  bailCost: 50,
  heartTarget: 5,
  heartHelpReward: 5,
  cycleBaseReward: 50,
  rules: [
    "Objetivo: dominar as ligas e acumular moedas.",
    "Evolucao: Terreno -> Clinica -> Hospital -> Ministerio.",
    "Cada jogador pode rolar o dado ate 5 vezes por dia.",
    "Ao completar uma volta no tabuleiro, recebe bonus de moedas.",
    "Na DP de Anatomia, saia pagando fianca ou com ajuda de amigos.",
    "Acertou pergunta: conquista/evolui casa. Errou: perde rodada.",
  ],
};

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asNumber = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const clampInt = (value: number, min: number, max: number): number => {
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
};

const normalizeDisplayName = (value: unknown): string => {
  const cleanValue = asString(value).trim().replace(/\s+/g, " ").slice(0, 40);
  return cleanValue || DEFAULT_SHARKROUND_CONFIG.displayName;
};

const normalizeRules = (value: unknown): string[] => {
  if (!Array.isArray(value)) return DEFAULT_SHARKROUND_CONFIG.rules;
  const rules = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 16);
  return rules.length > 0 ? rules : DEFAULT_SHARKROUND_CONFIG.rules;
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

const removeMissingColumnFromSelection = (
  columns: string[],
  missingColumn: string
): string[] | null => {
  const next = columns.filter(
    (column) => column.toLowerCase() !== missingColumn.toLowerCase()
  );
  if (next.length === columns.length) return null;
  return next;
};

const pickUnknown = (
  sources: Array<Record<string, unknown>>,
  keys: string[]
): unknown => {
  for (const source of sources) {
    for (const key of keys) {
      if (key in source) return source[key];
    }
  }
  return undefined;
};

const pickNumber = (
  sources: Array<Record<string, unknown>>,
  keys: string[],
  fallback: number
): number => {
  const value = pickUnknown(sources, keys);
  return asNumber(value, fallback);
};

const normalizeConfig = (raw: unknown): SharkroundAppConfig => {
  const data = asObject(raw) ?? {};
  const nestedData = asObject(data.data) ?? {};
  const sources = [data, nestedData];

  return {
    displayName: normalizeDisplayName(
      pickUnknown(sources, ["displayName", "display_name"])
    ),
    dailyRollsLimit: clampInt(
      pickNumber(
        sources,
        ["dailyRollsLimit", "daily_rolls_limit"],
        DEFAULT_SHARKROUND_CONFIG.dailyRollsLimit
      ),
      1,
      20
    ),
    startingCoins: clampInt(
      pickNumber(
        sources,
        ["startingCoins", "starting_coins"],
        DEFAULT_SHARKROUND_CONFIG.startingCoins
      ),
      0,
      10000
    ),
    bailCost: clampInt(
      pickNumber(
        sources,
        ["bailCost", "bail_cost"],
        DEFAULT_SHARKROUND_CONFIG.bailCost
      ),
      0,
      10000
    ),
    heartTarget: clampInt(
      pickNumber(
        sources,
        ["heartTarget", "heart_target"],
        DEFAULT_SHARKROUND_CONFIG.heartTarget
      ),
      1,
      20
    ),
    heartHelpReward: clampInt(
      pickNumber(
        sources,
        ["heartHelpReward", "heart_help_reward"],
        DEFAULT_SHARKROUND_CONFIG.heartHelpReward
      ),
      0,
      500
    ),
    cycleBaseReward: clampInt(
      pickNumber(
        sources,
        ["cycleBaseReward", "cycle_base_reward"],
        DEFAULT_SHARKROUND_CONFIG.cycleBaseReward
      ),
      0,
      5000
    ),
    rules: normalizeRules(pickUnknown(sources, ["rules"])),
  };
};

const resolveSharkroundTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

const getCacheKey = (tenantId?: string | null): string =>
  resolveSharkroundTenantId(tenantId) || "default";

const resolveSharkroundDocIds = (tenantId?: string | null): string[] => {
  const scopedTenantId = resolveSharkroundTenantId(tenantId);
  if (!scopedTenantId) return [SHARKROUND_CONFIG_PATH[1]];
  return [buildTenantScopedRowId(scopedTenantId, SHARKROUND_CONFIG_PATH[1])];
};

const pickConfigRow = (
  rows: Array<Record<string, unknown>>,
  tenantId?: string | null
): Record<string, unknown> | null => {
  const candidates = resolveSharkroundDocIds(tenantId);
  for (const candidateId of candidates) {
    const match = rows.find((row) => asString(row.id).trim() === candidateId);
    if (match) return match;
  }
  return null;
};

const getCached = (tenantId?: string | null): SharkroundAppConfig | null => {
  const key = getCacheKey(tenantId);
  const cached = configCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > READ_CACHE_TTL_MS) {
    configCache.delete(key);
    return null;
  }
  return cached.value;
};

const setCached = (value: SharkroundAppConfig, tenantId?: string | null): void => {
  configCache.set(getCacheKey(tenantId), { cachedAt: Date.now(), value });
};

const shouldUseCallable = (): boolean => {
  if (typeof window === "undefined") return true;
  if (process.env.NEXT_PUBLIC_FORCE_CALLABLES === "true") return true;

  const host = window.location.hostname.toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1";
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

async function callCallableWithFallback<TReq, TRes>(
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

async function fetchConfigFromClient(tenantId?: string | null): Promise<{ config?: unknown }> {
  const supabase = getSupabaseClient();
  let mutableColumns = [...SHARKROUND_CONFIG_SELECT_COLUMNS];
  const docIds = resolveSharkroundDocIds(tenantId);

  while (mutableColumns.length > 0) {
    const { data, error } = await supabase
      .from(SHARKROUND_CONFIG_PATH[0])
      .select(mutableColumns.join(","))
      .in("id", docIds);

    if (!error) {
      const rows = (Array.isArray(data) ? data : [])
        .map((entry) => asObject(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null)
        .map((entry) => ({ ...entry }));
      return { config: pickConfigRow(rows, tenantId) ?? DEFAULT_SHARKROUND_CONFIG };
    }

    const missingColumn = asString(extractMissingSchemaColumn(error)).trim();
    if (!missingColumn) throwSupabaseError(error);

    const nextColumns = removeMissingColumnFromSelection(mutableColumns, missingColumn) ?? [];
    if (nextColumns.length === 0) throwSupabaseError(error);
    mutableColumns = nextColumns;
  }

  return { config: DEFAULT_SHARKROUND_CONFIG };
}

async function saveConfigWithClient(
  normalized: SharkroundAppConfig,
  tenantId?: string | null
): Promise<{ ok: boolean }> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveSharkroundTenantId(tenantId);
  const dataPayload = {
    displayName: normalized.displayName,
    dailyRollsLimit: normalized.dailyRollsLimit,
    startingCoins: normalized.startingCoins,
    bailCost: normalized.bailCost,
    heartTarget: normalized.heartTarget,
    heartHelpReward: normalized.heartHelpReward,
    cycleBaseReward: normalized.cycleBaseReward,
    rules: [...normalized.rules],
  };

  const mutablePayload: Record<string, unknown> = {
    id: buildTenantScopedRowId(scopedTenantId, SHARKROUND_CONFIG_PATH[1]) || SHARKROUND_CONFIG_PATH[1],
    ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
    data: dataPayload,
    ...normalized,
    display_name: normalized.displayName,
    daily_rolls_limit: normalized.dailyRollsLimit,
    starting_coins: normalized.startingCoins,
    bail_cost: normalized.bailCost,
    heart_target: normalized.heartTarget,
    heart_help_reward: normalized.heartHelpReward,
    cycle_base_reward: normalized.cycleBaseReward,
    updatedAt: nowIso(),
  };

  while (Object.keys(mutablePayload).length > 0) {
    const { error } = await supabase
      .from(SHARKROUND_CONFIG_PATH[0])
      .upsert(mutablePayload, { onConflict: "id" });

    if (!error) return { ok: true };

    const missingColumn = asString(extractMissingSchemaColumn(error)).trim();
    if (!missingColumn) throwSupabaseError(error);

    const removableKey = Object.keys(mutablePayload).find(
      (key) => key.toLowerCase() === missingColumn.toLowerCase()
    );
    const safeRemovableKey = typeof removableKey === "string" ? removableKey : "";
    if (!safeRemovableKey || safeRemovableKey === "id") {
      throwSupabaseError(error);
    }
    delete mutablePayload[safeRemovableKey];
  }

  throw new Error("Falha ao salvar configuracao do BoardRound.");
}

export async function fetchSharkroundAppConfig(options?: {
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<SharkroundAppConfig> {
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveSharkroundTenantId(options?.tenantId);
  const cacheKey = getCacheKey(scopedTenantId);
  if (forceRefresh) {
    clearSharkroundAppConfigCache();
  } else {
    const cached = getCached(scopedTenantId);
    if (cached) return cached;
    const pending = inflightConfig.get(cacheKey);
    if (pending) return pending;
  }

  const requestSource = scopedTenantId
    ? fetchConfigFromClient(scopedTenantId)
    : callCallableWithFallback<
        { forceRefresh: boolean; tenantId?: string },
        { config?: unknown }
      >(
        SHARKROUND_CONFIG_GET_CALLABLE,
        { forceRefresh, tenantId: scopedTenantId || undefined },
        async () => fetchConfigFromClient(scopedTenantId)
      );

  const request = requestSource
    .then((response) => {
      const normalized = normalizeConfig(response.config);
      setCached(normalized, scopedTenantId);
      return normalized;
    })
    .finally(() => {
      inflightConfig.delete(cacheKey);
    });

  inflightConfig.set(cacheKey, request);
  return request;
}

export async function saveSharkroundAppConfig(
  payload: SharkroundAppConfig,
  options?: { tenantId?: string | null }
): Promise<void> {
  const normalized = normalizeConfig(payload);
  const scopedTenantId = resolveSharkroundTenantId(options?.tenantId);

  if (scopedTenantId) {
    await saveConfigWithClient(normalized, scopedTenantId);
  } else {
    await callCallableWithFallback<
      { config: SharkroundAppConfig; tenantId?: string },
      { ok: boolean }
    >(
      SHARKROUND_CONFIG_SAVE_CALLABLE,
      { config: normalized, tenantId: scopedTenantId || undefined },
      async () => saveConfigWithClient(normalized, scopedTenantId)
    );
  }

  setCached(normalized, scopedTenantId);
}

export function getDefaultSharkroundAppConfig(): SharkroundAppConfig {
  return { ...DEFAULT_SHARKROUND_CONFIG, rules: [...DEFAULT_SHARKROUND_CONFIG.rules] };
}

export const getSharkroundDisplayName = (
  config?: Pick<SharkroundAppConfig, "displayName"> | null
): string => normalizeDisplayName(config?.displayName);

export function clearSharkroundAppConfigCache(): void {
  configCache.clear();
  inflightConfig.clear();
}


