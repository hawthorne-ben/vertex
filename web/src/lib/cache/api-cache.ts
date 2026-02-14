import { LRUCache } from 'lru-cache'

interface CachedResponse {
  data: any
  fetchedAt: number
}

interface CacheStats {
  size: number
  hits: number
  misses: number
  hitRate: string
}

/**
 * LRU cache for API responses
 *
 * Caches API responses to avoid redundant fetches when the same data
 * is requested multiple times (e.g., switching between metrics on map)
 *
 * Configuration:
 * - Max 100 entries
 * - No TTL (analytics are computed once and immutable unless explicitly recomputed)
 * - Only invalidated manually via invalidate() or invalidatePattern()
 */
class ApiCache {
  private cache: LRUCache<string, CachedResponse>

  constructor() {
    this.cache = new LRUCache({
      max: 100, // Max 100 cached responses
      // No TTL - analytics are immutable, only invalidate on recompute
      ttl: 0,
      allowStale: false,
      updateAgeOnGet: false,
      updateAgeOnHas: false,
    })
  }

  /**
   * Get response from cache or fetch if not present
   *
   * @param key - Cache key (usually the full request URL)
   * @param fetchFn - Function to fetch data if not in cache
   * @returns Cached or freshly fetched data
   */
  async getOrFetch<T = any>(
    key: string,
    fetchFn: () => Promise<T>
  ): Promise<T> {
    const cached = this.cache.get(key)

    if (cached) {
      return cached.data as T
    }

    const data = await fetchFn()

    this.cache.set(key, {
      data,
      fetchedAt: Date.now()
    })

    return data
  }

  /**
   * Manually invalidate a cache entry
   * Useful when data is recomputed (e.g., after re-analysis)
   */
  invalidate(key: string): boolean {
    return this.cache.delete(key)
  }

  /**
   * Invalidate all entries matching a pattern
   * Useful for invalidating all cached data for a specific ride
   */
  invalidatePattern(pattern: string): number {
    let count = 0
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key)
        count++
      }
    }
    return count
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Check if key exists in cache
   */
  has(key: string): boolean {
    return this.cache.has(key)
  }

  /**
   * Get cache statistics
   */
  stats(): CacheStats {
    const hits = (this.cache as any).hits || 0
    const misses = (this.cache as any).misses || 0
    const total = hits + misses
    const hitRate = total > 0 ? ((hits / total) * 100).toFixed(1) + '%' : '0%'

    return {
      size: this.cache.size,
      hits,
      misses,
      hitRate
    }
  }

  /**
   * Log current cache statistics (dev only)
   */
  logStats(): void {
    if (process.env.NODE_ENV === 'development') {
      const stats = this.stats()
      console.log('[ApiCache] Stats:', {
        entries: stats.size,
        hitRate: stats.hitRate,
        hits: stats.hits,
        misses: stats.misses
      })
    }
  }
}

// Export singleton instance
export const apiCache = new ApiCache()

// Export class for testing
export { ApiCache }
