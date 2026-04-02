export {
  nitroFetch as fetch,
  nitroFetchOnWorklet,
  prefetch,
  prefetchOnAppStart,
  removeFromAutoPrefetch,
  removeAllFromAutoprefetch,
} from './fetch';
export type { NitroFormDataPart } from './fetch';
export type {
  NitroRequestNativeType as NitroRequest,
  NitroResponseNativeType as NitroResponse,
} from './fetch';
export type { RequestRedirect, RequestCache } from './fetch';
export type { BodyInit, ResponseInit } from './Response';
export { NitroHeaders as Headers } from './Headers';
export { NitroResponse as Response } from './Response';
export { NitroRequest as Request } from './Request';
export { NitroFetch } from './NitroInstances';
export {
  registerTokenRefresh,
  clearTokenRefresh,
  callRefreshEndpoint,
  getStoredTokenRefreshConfig,
  getNestedField,
  applyTemplate,
} from './tokenRefresh';
export type { TokenRefreshConfig } from './tokenRefresh';
import './fetch';

// Keep legacy export to avoid breaking any local tests/usages during scaffolding.
// Will be removed once native Cronet path is ready.
export function multiply(a: number, b: number): number {
  return a * b;
}
