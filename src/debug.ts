/**
 * Debug utilities for inspecting prefetch cache state
 *
 * Note: The prefetch cache is now managed natively (Android/iOS) and cannot be
 * inspected directly from JavaScript. These functions are kept for API compatibility
 * but return empty results.
 */

export interface CacheStats {
  cachedCount: number;
  pendingCount: number;
  cachedKeys: string[];
  pendingKeys: string[];
  cachedEntries: Array<{
    key: string;
    url: string;
    size: number;
    ageMs: number;
  }>;
}

/**
 * Get current cache statistics (development only)
 * Note: Returns empty stats as cache is now native-only
 */
export function getCacheStats(): CacheStats {
  console.warn(
    '[nitro-fetch] Cache is now managed natively - JS inspection not available'
  );
  return {
    cachedCount: 0,
    pendingCount: 0,
    cachedKeys: [],
    pendingKeys: [],
    cachedEntries: [],
  };
}

/**
 * Clear all prefetch caches (development only)
 * Note: No-op as cache is now managed natively
 */
export function clearAllCaches(): void {
  console.warn(
    '[nitro-fetch] Cache is now managed natively - use native debugging tools'
  );
}

/**
 * Log cache state to console (development only)
 * Note: No-op as cache is now managed natively
 */
export function logCacheState(): void {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Prefetch Cache State');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Cache is now managed natively.');
  console.log(
    'Use native debugging tools (Logcat/Xcode) for cache inspection.'
  );
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

/**
 * Monitor cache changes (development only)
 * Note: No-op as cache is now managed natively
 */
export function watchCache(intervalMs: number = 2000): () => void {
  console.warn(
    '[nitro-fetch] Cache monitoring not available - cache is managed natively'
  );
  return () => {};
}
