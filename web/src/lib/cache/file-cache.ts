import { LRUCache } from 'lru-cache'

interface CachedFile {
  arrayBuffer: ArrayBuffer
  parsedAt: number
}

interface CacheStats {
  size: number
  calculatedSize: number
  hits: number
  misses: number
  hitRate: string
}

/**
 * LRU cache for file ArrayBuffers
 *
 * Caches downloaded files from Supabase Storage to avoid redundant downloads
 * when the same file is requested multiple times (e.g., zooming, data type switches)
 *
 * Configuration:
 * - Max 50 files
 * - Max 1GB total size
 * - 15 minute TTL per entry
 */
class FileCache {
  private cache: LRUCache<string, CachedFile>

  constructor() {
    this.cache = new LRUCache({
      max: 50, // Max 50 files
      maxSize: 1024 * 1024 * 1024, // 1GB total
      sizeCalculation: (value) => value.arrayBuffer.byteLength,
      ttl: 1000 * 60 * 15, // 15 minutes
      // Allow stale entries to be returned while background refresh happens
      allowStale: false,
      // Update TTL on access
      updateAgeOnGet: true,
      updateAgeOnHas: false,
    })
  }

  /**
   * Get file from cache or fetch if not present
   *
   * @param key - Cache key (usually storage_path)
   * @param fetchFn - Function to fetch file if not in cache
   * @returns ArrayBuffer of file contents
   */
  async getOrFetch(
    key: string,
    fetchFn: () => Promise<ArrayBuffer>
  ): Promise<ArrayBuffer> {
    const cached = this.cache.get(key)

    if (cached) {
      return cached.arrayBuffer
    }

    const arrayBuffer = await fetchFn()

    this.cache.set(key, {
      arrayBuffer,
      parsedAt: Date.now()
    })

    return arrayBuffer
  }

  /**
   * Manually invalidate a cache entry
   * Useful when a file is updated (though recordings are immutable in our system)
   */
  invalidate(key: string): boolean {
    return this.cache.delete(key)
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
    const hits = this.cache.calculatedSize !== undefined ?
      (this.cache as any).hits || 0 : 0
    const misses = (this.cache as any).misses || 0
    const total = hits + misses
    const hitRate = total > 0 ? ((hits / total) * 100).toFixed(1) + '%' : '0%'

    return {
      size: this.cache.size,
      calculatedSize: this.cache.calculatedSize || 0,
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
      console.log('[FileCache] Stats:', {
        entries: stats.size,
        totalSize: `${(stats.calculatedSize / 1024 / 1024).toFixed(2)}MB`,
        hitRate: stats.hitRate,
        hits: stats.hits,
        misses: stats.misses
      })
    }
  }
}

// Export singleton instance
export const fileCache = new FileCache()

// Export class for testing
export { FileCache }
