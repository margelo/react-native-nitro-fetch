import 'web-streams-polyfill/polyfill';
import { TextDecoder } from './TextDecoder';

export { TextDecoder };
export {
  fetch,
  prefetch,
  prefetchOnAppStart,
  removeFromAutoPrefetch,
  clearAutoPrefetchQueue,
} from './fetch';
export type { FetchOptions, FetchResponse, PrefetchOptions } from './fetch';

// Debug utilities (only available in __DEV__)
export {
  getCacheStats,
  clearAllCaches,
  logCacheState,
  watchCache,
} from './debug';
export type { CacheStats } from './debug';
