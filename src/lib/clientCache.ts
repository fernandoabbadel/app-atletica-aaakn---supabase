/**
 * Client-side Cache via localStorage
 * 
 * Stores data in browser with automatic expiry checks.
 * Safe fallback if storage full.
 * 
 * Usage:
 * ```typescript
 * const data = await clientCache.getOrSet(
 *   'album_data',
 *   () => fetch('/api/album').then(r => r.json()),
 *   86400000 // 24 hours
 * );
 * ```
 */

interface ClientCacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
  version: number;
}

type ClientCacheMetadataEntry = ClientCacheEntry<unknown>;

export class ClientCache {
  private static readonly PREFIX = 'aaakn_';
  private static readonly VERSION = 1;

  /**
   * Get or set value with automatic fetcher
   */
  static async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs: number = 86400000 // 24 hours default
  ): Promise<T> {
    // Try to get from cache first
    const cached = this.get<T>(key);
    if (cached !== null) {
      // Background refresh (don't wait)
      fetcher().then(fresh => this.set(key, fresh, ttlMs)).catch(err => {
        console.debug(`[ClientCache] Background refresh failed for key "${key}":`, err);
      });
      return cached;
    }

    // Cache miss: fetch now
    const value = await fetcher();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Get value from cache
   */
  static get<T>(key: string): T | null {
    try {
      const stored = localStorage.getItem(this.PREFIX + key);
      if (!stored) return null;

      const entry: ClientCacheEntry<T> = JSON.parse(stored);

      // Check expiry
      if (entry.expiresAt <= Date.now()) {
        this.delete(key);
        return null;
      }

      // Check version compatibility
      if (entry.version !== this.VERSION) {
        this.delete(key);
        return null;
      }

      return entry.value;
    } catch (error) {
      console.warn(`[ClientCache] Error reading key "${key}":`, error);
      return null;
    }
  }

  /**
   * Set value in cache
   */
  static set<T>(key: string, value: T, ttlMs: number = 86400000) {
    try {
      const entry: ClientCacheEntry<T> = {
        value,
        expiresAt: Date.now() + ttlMs,
        createdAt: Date.now(),
        version: this.VERSION,
      };

      localStorage.setItem(this.PREFIX + key, JSON.stringify(entry));
    } catch (error) {
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        console.warn('[ClientCache] localStorage full, clearing old entries');
        this.cleanupOldest(Math.ceil(this.getStorageSize() * 0.2)); // Clear 20%
        try {
          localStorage.setItem(this.PREFIX + key, JSON.stringify({
            value,
            expiresAt: Date.now() + ttlMs,
            createdAt: Date.now(),
            version: this.VERSION,
          }));
        } catch (retryError) {
          console.error('[ClientCache] Failed to set key even after cleanup:', retryError);
        }
      } else {
        console.warn(`[ClientCache] Error setting key "${key}":`, error);
      }
    }
  }

  /**
   * Delete specific key
   */
  static delete(key: string) {
    localStorage.removeItem(this.PREFIX + key);
  }

  /**
   * Invalidate by pattern (e.g., 'events_*')
   */
  static invalidatePattern(pattern: string) {
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
    const keysToDelete: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.PREFIX)) {
        const shortKey = key.substring(this.PREFIX.length);
        if (regex.test(shortKey)) {
          keysToDelete.push(key);
        }
      }
    }

    keysToDelete.forEach(key => localStorage.removeItem(key));
  }

  /**
   * Clear all cache entries
   */
  static clear() {
    const keysToDelete: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.PREFIX)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => localStorage.removeItem(key));
  }

  /**
   * Clear expired entries
   */
  static cleanup() {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(this.PREFIX)) continue;

      try {
        const stored = localStorage.getItem(key);
        if (!stored) continue;

        const entry: ClientCacheMetadataEntry = JSON.parse(stored);
        if (entry.expiresAt <= now) {
          keysToDelete.push(key);
        }
      } catch {
        keysToDelete.push(key); // Delete if parse fails
      }
    }

    keysToDelete.forEach(key => localStorage.removeItem(key));
    return keysToDelete.length;
  }

  /**
   * Get storage size estimate in bytes
   */
  static getStorageSize(): number {
    let size = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.PREFIX)) {
        const value = localStorage.getItem(key);
        if (value) {
          size += key.length + value.length;
        }
      }
    }

    return size;
  }

  /**
   * Get statistics
   */
  static getStats() {
    const now = Date.now();
    let totalSize = 0;
    let expiredCount = 0;
    let validCount = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(this.PREFIX)) continue;

      try {
        const value = localStorage.getItem(key);
        if (value) {
          totalSize += key.length + value.length;

          const entry: ClientCacheMetadataEntry = JSON.parse(value);
          if (entry.expiresAt <= now) {
            expiredCount++;
          } else {
            validCount++;
          }
        }
      } catch {
        // Skip parse errors
      }
    }

    return {
      validEntries: validCount,
      expiredEntries: expiredCount,
      storageSizeMb: (totalSize / 1024 / 1024).toFixed(2),
      estimatedFull: (totalSize / (5 * 1024 * 1024) * 100).toFixed(1), // 5MB typical limit
    };
  }

  /**
   * List all cached keys with metadata
   */
  static listKeys(limit: number = 50) {
    const keys: Array<{ key: string; sizeBytes: number; expiresInMs: number }> = [];

    for (let i = 0; i < localStorage.length && keys.length < limit; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(this.PREFIX)) continue;

      try {
        const value = localStorage.getItem(key);
        if (value) {
          const entry: ClientCacheMetadataEntry = JSON.parse(value);
          keys.push({
            key: key.substring(this.PREFIX.length),
            sizeBytes: key.length + value.length,
            expiresInMs: entry.expiresAt - Date.now(),
          });
        }
      } catch {
        // Skip
      }
    }

    return keys;
  }

  /**
   * Clean up oldest entries to free space
   */
  private static cleanupOldest(targetBytes: number) {
    const entries: Array<{ fullKey: string; createdAt: number; sizeBytes: number }> = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(this.PREFIX)) continue;

      try {
        const value = localStorage.getItem(key);
        if (value) {
          const entry: ClientCacheMetadataEntry = JSON.parse(value);
          entries.push({
            fullKey: key,
            createdAt: entry.createdAt,
            sizeBytes: key.length + value.length,
          });
        }
      } catch {
        // Delete unparseable entries
        localStorage.removeItem(key);
      }
    }

    // Sort by creation time (oldest first)
    entries.sort((a, b) => a.createdAt - b.createdAt);

    let freedBytes = 0;
    for (const entry of entries) {
      localStorage.removeItem(entry.fullKey);
      freedBytes += entry.sizeBytes;
      if (freedBytes >= targetBytes) break;
    }
  }
}

export default ClientCache;

/**
 * React Hook for client-side caching
 */
import { useEffect, useState } from 'react';

export function useCachedData<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = 86400000
): { data: T | null; loading: boolean; error: Error | null } {
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: Error | null;
  }>({
    data: ClientCache.get<T>(key),
    loading: false,
    error: null,
  });

  useEffect(() => {
    let isMounted = true;

    const fetch = async () => {
      try {
        setState(prev => ({ ...prev, loading: true }));
        const data = await ClientCache.getOrSet(key, fetcher, ttlMs);
        if (isMounted) {
          setState({ data, loading: false, error: null });
        }
      } catch (error) {
        if (isMounted) {
          setState(prev => ({
            ...prev,
            loading: false,
            error: error instanceof Error ? error : new Error(String(error)),
          }));
        }
      }
    };

    if (state.data === null) {
      fetch();
    }

    return () => {
      isMounted = false;
    };
  }, [fetcher, key, state.data, ttlMs]);

  return state;
}
