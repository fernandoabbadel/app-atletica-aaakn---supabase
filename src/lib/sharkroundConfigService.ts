import { httpsCallable } from "@/lib/supa/functions";
import { doc, getDoc, setDoc, serverTimestamp } from "@/lib/supabaseHelpers";

import { db, functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 30_000;

const SHARKROUND_CONFIG_PATH = ["app_config", "sharkround"] as const;
const SHARKROUND_CONFIG_GET_CALLABLE = "sharkroundGetConfig";
const SHARKROUND_CONFIG_SAVE_CALLABLE = "sharkroundAdminSaveConfig";

const configCache = new Map<string, CacheEntry<SharkroundAppConfig>>();
let inflightConfig: Promise<SharkroundAppConfig> | null = null;

export interface SharkroundAppConfig {
  dailyRollsLimit: number;
  startingCoins: number;
  bailCost: number;
  heartTarget: number;
  heartHelpReward: number;
  cycleBaseReward: number;
  rules: string[];
}

const DEFAULT_SHARKROUND_CONFIG: SharkroundAppConfig = {
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

const clampInt = (value: number, min: number, max: number): number => {
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
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

const normalizeConfig = (raw: unknown): SharkroundAppConfig => {
  const data = asObject(raw) ?? {};
  return {
    dailyRollsLimit: clampInt(
      asNumber(data.dailyRollsLimit, DEFAULT_SHARKROUND_CONFIG.dailyRollsLimit),
      1,
      20
    ),
    startingCoins: clampInt(
      asNumber(data.startingCoins, DEFAULT_SHARKROUND_CONFIG.startingCoins),
      0,
      10000
    ),
    bailCost: clampInt(
      asNumber(data.bailCost, DEFAULT_SHARKROUND_CONFIG.bailCost),
      0,
      10000
    ),
    heartTarget: clampInt(
      asNumber(data.heartTarget, DEFAULT_SHARKROUND_CONFIG.heartTarget),
      1,
      20
    ),
    heartHelpReward: clampInt(
      asNumber(data.heartHelpReward, DEFAULT_SHARKROUND_CONFIG.heartHelpReward),
      0,
      500
    ),
    cycleBaseReward: clampInt(
      asNumber(data.cycleBaseReward, DEFAULT_SHARKROUND_CONFIG.cycleBaseReward),
      0,
      5000
    ),
    rules: normalizeRules(data.rules),
  };
};

const getCached = (): SharkroundAppConfig | null => {
  const key = "default";
  const cached = configCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > READ_CACHE_TTL_MS) {
    configCache.delete(key);
    return null;
  }
  return cached.value;
};

const setCached = (value: SharkroundAppConfig): void => {
  configCache.set("default", { cachedAt: Date.now(), value });
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

export async function fetchSharkroundAppConfig(options?: {
  forceRefresh?: boolean;
}): Promise<SharkroundAppConfig> {
  const forceRefresh = options?.forceRefresh ?? false;
  if (forceRefresh) {
    clearSharkroundAppConfigCache();
  } else {
    const cached = getCached();
    if (cached) return cached;
    if (inflightConfig) return inflightConfig;
  }

  const request = callCallableWithFallback<
    { forceRefresh: boolean },
    { config?: unknown }
  >(
    SHARKROUND_CONFIG_GET_CALLABLE,
    { forceRefresh },
    async () => {
      const snap = await getDoc(doc(db, SHARKROUND_CONFIG_PATH[0], SHARKROUND_CONFIG_PATH[1]));
      return { config: snap.exists() ? snap.data() : DEFAULT_SHARKROUND_CONFIG };
    }
  )
    .then((response) => {
      const normalized = normalizeConfig(response.config);
      setCached(normalized);
      return normalized;
    })
    .finally(() => {
      inflightConfig = null;
    });

  inflightConfig = request;
  return request;
}

export async function saveSharkroundAppConfig(
  payload: SharkroundAppConfig
): Promise<void> {
  const normalized = normalizeConfig(payload);

  await callCallableWithFallback<
    { config: SharkroundAppConfig },
    { ok: boolean }
  >(
    SHARKROUND_CONFIG_SAVE_CALLABLE,
    { config: normalized },
    async () => {
      await setDoc(
        doc(db, SHARKROUND_CONFIG_PATH[0], SHARKROUND_CONFIG_PATH[1]),
        {
          ...normalized,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      return { ok: true };
    }
  );

  setCached(normalized);
}

export function getDefaultSharkroundAppConfig(): SharkroundAppConfig {
  return { ...DEFAULT_SHARKROUND_CONFIG, rules: [...DEFAULT_SHARKROUND_CONFIG.rules] };
}

export function clearSharkroundAppConfigCache(): void {
  configCache.clear();
  inflightConfig = null;
}


