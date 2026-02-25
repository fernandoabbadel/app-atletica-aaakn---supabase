import {
  fetchLandingConfig,
  type LandingConfig,
} from "./adminLandingService";
import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 30_000;
const USERS_COUNT_FALLBACK_LIMIT = 2_000;

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

async function fetchUsersCount(): Promise<number> {
  const supabase = getSupabaseClient();
  let lastError: unknown = null;

  // No plano free, tentamos contagem de metadata antes de usar exact count.
  for (const mode of ["planned", "estimated", "exact"] as const) {
    const { count, error } = await supabase
      .from("users")
      .select("*", { count: mode, head: true });

    if (!error && typeof count === "number") {
      return count;
    }

    lastError = error;
  }

  // Fallback final com leitura limitada caso count esteja indisponivel.
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .limit(USERS_COUNT_FALLBACK_LIMIT);

  if (error) {
    throw error ?? lastError;
  }

  return Array.isArray(data) ? data.length : 0;
}

export interface PublicLandingData {
  config: LandingConfig;
  usersCount: number;
}

export async function fetchPublicLandingData(options?: {
  forceRefresh?: boolean;
  fallbackConfig?: LandingConfig;
}): Promise<PublicLandingData> {
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = "default";

  if (!forceRefresh) {
    const cached = getCachedValue(publicLandingCache, cacheKey);
    if (cached) return cached;
  }

  const [config, usersCount] = await Promise.all([
    fetchLandingConfig({
      forceRefresh,
      fallbackConfig: options?.fallbackConfig,
    }),
    fetchUsersCount(),
  ]);

  const data: PublicLandingData = {
    config,
    usersCount,
  };

  setCachedValue(publicLandingCache, cacheKey, data);
  return data;
}

export function clearPublicLandingCaches(): void {
  publicLandingCache.clear();
}
