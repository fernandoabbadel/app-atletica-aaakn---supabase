/**
 * Server-side In-Memory Cache (Mock Redis)
 * 
 * Used in API routes with gzip compression.
 * TTL: 5-15 minutes automatic expiry.
 * 
 * Usage:
 * ```typescript
 * const data = await serverCache.getOrSet(
 *   'dashboard_data',
 *   () => fetchDashboardFromDB(),
 *   300_000 // 5 minutes
 * );
 * ```
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
  hitCount: number;
}

export class ServerCache {
  private static cache = new Map<string, CacheEntry<unknown>>();
  private static cleanupInterval: NodeJS.Timeout | null = null;
  private static totalHits = 0;
  private static totalMisses = 0;

  /**
   * Initialize cleanup interval (run once on first cache call)
   */
  private static ensureCleanup() {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60_000); // Cleanup every 60s

    // Allow process to exit even with interval running
    this.cleanupInterval.unref();
  }

  /**
   * Get or set value with automatic fetcher
   */
  static async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs: number = 300_000 // 5 minutes default
  ): Promise<T> {
    this.ensureCleanup();

    const cached = this.cache.get(key);

    // Return cached value if valid
    if (cached && cached.expiresAt > Date.now()) {
      cached.hitCount++;
      this.totalHits++;
      return cached.value as T;
    }

    // Cache miss: fetch fresh
    this.totalMisses++;

    try {
      const value = await fetcher();
      this.set(key, value, ttlMs);
      return value;
    } catch (error) {
      // On error, return stale cache if available
      if (cached) {
        console.warn(`[ServerCache] Fetcher failed for key "${key}", returning stale cache`);
        return cached.value as T;
      }
      throw error;
    }
  }

  /**
   * Manually set value in cache
   */
  static set<T>(key: string, value: T, ttlMs: number = 300_000) {
    this.ensureCleanup();

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
      hitCount: 0,
    });
  }

  /**
   * Get value without side effects
   */
  static get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry || entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  /**
   * Delete specific key
   */
  static delete(key: string) {
    this.cache.delete(key);
  }

  /**
   * Invalidate by pattern (e.g., 'events_*')
   */
  static invalidatePattern(pattern: string) {
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache
   */
  static clear() {
    this.cache.clear();
    this.totalHits = 0;
    this.totalMisses = 0;
  }

  /**
   * Cleanup expired entries
   */
  private static cleanup() {
    const now = Date.now();
    let expiredCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      console.debug(`[ServerCache] Cleaned up ${expiredCount} expired entries`);
    }
  }

  /**
   * Get statistics
   */
  static getStats() {
    const now = Date.now();
    const entries = Array.from(this.cache.values());

    return {
      size: this.cache.size,
      hitRate:
        this.totalHits + this.totalMisses > 0
          ? (this.totalHits / (this.totalHits + this.totalMisses)).toFixed(2)
          : '0.00',
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      avgHitCount: entries.length > 0 ? (entries.reduce((sum, e) => sum + e.hitCount, 0) / entries.length).toFixed(1) : 0,
      memoryEstimateMb: (JSON.stringify(this.cache).length / 1024 / 1024).toFixed(2),
      expiringInNextMinute: entries.filter(e => e.expiresAt - now < 60_000).length,
    };
  }

  /**
   * Debug: List all keys
   */
  static listKeys(limit: number = 50) {
    const keys = Array.from(this.cache.keys()).slice(0, limit);
    return keys.map(key => {
      const entry = this.cache.get(key)!;
      return {
        key,
        sizeBytes: JSON.stringify(entry.value).length,
        expiresInMs: entry.expiresAt - Date.now(),
        hitCount: entry.hitCount,
      };
    });
  }
}

export default ServerCache;
