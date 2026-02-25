import { collection, getCountFromServer, getDocs, limit, query } from "firebase/firestore";

import {
  fetchLandingConfig,
  type LandingConfig,
} from "./adminLandingService";
import { db } from "./firebase";

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
  try {
    const snap = await getCountFromServer(collection(db, "users"));
    return snap.data().count;
  } catch {
    const fallbackSnap = await getDocs(
      query(collection(db, "users"), limit(USERS_COUNT_FALLBACK_LIMIT))
    );
    return fallbackSnap.size;
  }
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
