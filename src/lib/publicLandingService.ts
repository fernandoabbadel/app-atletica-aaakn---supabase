import {
  DEFAULT_LANDING_CONFIG,
  DEFAULT_TENANT_LANDING_CONFIG,
  fetchLandingConfig,
  type LandingConfig,
} from "./adminLandingService";
import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 12 * 60 * 60_000;
const COUNT_FALLBACK_LIMIT = 2_000;
const LIGHTWEIGHT_COUNT_MODES = ["planned", "estimated"] as const;

const publicLandingCache = new Map<string, CacheEntry<PublicLandingData>>();

const getCachedValue = <T>(
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

const setCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T
): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

async function fetchCountFromTable(
  tableName: string,
  countColumn: string
): Promise<number> {
  const supabase = getSupabaseClient();
  let lastError: unknown = null;

  // No plano free, evitamos exact count e priorizamos metadata barata.
  for (const mode of LIGHTWEIGHT_COUNT_MODES) {
    const { count, error } = await supabase
      .from(tableName)
      .select(countColumn, { count: mode, head: true });

    if (!error && typeof count === "number") {
      return count;
    }

    lastError = error;
  }

  // Fallback final com leitura limitada caso count esteja indisponivel.
  const { data, error } = await supabase
    .from(tableName)
    .select(countColumn)
    .limit(COUNT_FALLBACK_LIMIT);

  if (error) {
    throw error ?? lastError;
  }

  return Array.isArray(data) ? data.length : 0;
}

async function fetchCountFromCandidates(
  candidates: Array<{ tableName: string; countColumn: string }>
): Promise<number> {
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      return await fetchCountFromTable(candidate.tableName, candidate.countColumn);
    } catch (error: unknown) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return 0;
}

export interface PublicLandingData {
  config: LandingConfig;
  usersCount: number;
  tenantsCount: number;
  partnersCount: number;
}

export interface PublicLandingBrand {
  sigla: string;
  nome: string;
  subtitle: string;
  logoUrl: string;
}

export interface PublicLandingPayload extends PublicLandingData {
  tenantId?: string;
  brand: PublicLandingBrand;
}

export async function fetchPublicLandingData(options?: {
  forceRefresh?: boolean;
  fallbackConfig?: LandingConfig;
  tenantId?: string | null;
  prefetchedConfig?: LandingConfig;
}): Promise<PublicLandingData> {
  const forceRefresh = options?.forceRefresh ?? false;
  const tenantId = options?.tenantId?.trim() || "";
  const cacheKey = tenantId || "default";
  const fallbackConfig =
    options?.fallbackConfig ??
    (tenantId ? DEFAULT_TENANT_LANDING_CONFIG : DEFAULT_LANDING_CONFIG);
  const prefetchedConfig = options?.prefetchedConfig;

  if (!forceRefresh) {
    const cached = getCachedValue(publicLandingCache, cacheKey);
    if (cached) return cached;
  }

  const [configResult, usersCountResult, tenantsCountResult, partnersCountResult] =
    await Promise.allSettled([
      prefetchedConfig
        ? Promise.resolve(prefetchedConfig)
        : fetchLandingConfig({
            forceRefresh,
            fallbackConfig,
            tenantId,
          }),
      fetchCountFromCandidates([{ tableName: "users", countColumn: "uid" }]),
      fetchCountFromCandidates([{ tableName: "tenants", countColumn: "id" }]),
      fetchCountFromCandidates([
        { tableName: "parceiros", countColumn: "id" },
        { tableName: "partners", countColumn: "id" },
      ]),
    ]);

  const config = configResult.status === "fulfilled"
    ? configResult.value
    : fallbackConfig;

  const usersCount = usersCountResult.status === "fulfilled"
    ? usersCountResult.value
    : 0;
  const tenantsCount = tenantsCountResult.status === "fulfilled"
    ? tenantsCountResult.value
    : 0;
  const partnersCount = partnersCountResult.status === "fulfilled"
    ? partnersCountResult.value
    : 0;

  const data: PublicLandingData = {
    config,
    usersCount,
    tenantsCount,
    partnersCount,
  };

  setCachedValue(publicLandingCache, cacheKey, data);
  return data;
}

export function clearPublicLandingCaches(): void {
  publicLandingCache.clear();
}
