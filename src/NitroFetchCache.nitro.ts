import type { HybridObject } from 'react-native-nitro-modules';

export interface CachedPrefetchResponse {
  url: string;
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
  timestampMs: number;
}

export interface NitroFetchCache
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /**
   * Get a cached prefetch response if it exists and is fresh.
   * Returns null if not found or expired.
   * This removes the entry from the cache upon retrieval.
   */
  getCachedPrefetch(
    key: string,
    maxAgeMs: number
  ): CachedPrefetchResponse | undefined;

  /**
   * Check if a prefetch is currently pending (in progress).
   */
  isPrefetchPending(key: string): boolean;

  /**
   * Clear all cached and pending prefetches.
   */
  clearAll(): void;
}
