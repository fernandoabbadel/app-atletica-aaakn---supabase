type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

const LIMITS_BY_PATH: Record<string, number> = {
  "/api/public/landing": 30,
  "/api/public/tenants": 180,
};

const DEFAULT_LIMIT = 90;

const getBucketKey = (ip: string, path: string): string =>
  `${ip.trim() || "unknown"}:${path.trim() || "/"}`;

const getLimitForPath = (path: string): number => LIMITS_BY_PATH[path] ?? DEFAULT_LIMIT;

export const consumeRateLimit = (
  ip: string,
  path: string,
  now: number = Date.now()
): { allowed: boolean; remaining: number; resetAt: number } => {
  const key = getBucketKey(ip, path);
  const limit = getLimitForPath(path);
  const current = buckets.get(key);

  if (!current || now >= current.resetAt) {
    const nextBucket: Bucket = { count: 1, resetAt: now + WINDOW_MS };
    buckets.set(key, nextBucket);
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      resetAt: nextBucket.resetAt,
    };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.resetAt,
    };
  }

  current.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - current.count),
    resetAt: current.resetAt,
  };
};

export const cleanupExpiredRateLimitBuckets = (now: number = Date.now()): void => {
  buckets.forEach((bucket, key) => {
    if (now >= bucket.resetAt + WINDOW_MS) {
      buckets.delete(key);
    }
  });
};
