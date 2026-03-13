import 'web-streams-polyfill/polyfill';
import { TextDecoder } from './TextDecoder';

export { TextDecoder };
export {
  fetch,
  prefetch,
  prefetchOnAppStart,
  removeFromAutoPrefetch,
  clearAutoPrefetchQueue,
  fetchOnWorklet as nitroFetchOnWorklet,
} from './fetch';
export type {
  FetchOptions,
  FetchResponse,
  PrefetchOptions,
  WorkletMapper,
} from './fetch';
