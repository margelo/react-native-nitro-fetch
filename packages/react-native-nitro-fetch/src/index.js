export {
  nitroFetch as fetch,
  nitroFetchOnWorklet,
  prefetch,
  prefetchOnAppStart,
  removeFromAutoPrefetch,
  removeAllFromAutoprefetch,
} from './fetch';
export { NitroFetch } from './NitroInstances';
export {
  registerTokenRefresh,
  clearTokenRefresh,
  callRefreshEndpoint,
  getStoredTokenRefreshConfig,
  getNestedField,
  applyTemplate,
} from './tokenRefresh';
import './fetch';
// Keep legacy export to avoid breaking any local tests/usages during scaffolding.
// Will be removed once native Cronet path is ready.
export function multiply(a, b) {
  return a * b;
}
