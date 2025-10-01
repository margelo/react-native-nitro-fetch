export {
  nitroFetch as fetch,
  nitroFetchOnWorklet,
  prefetch,
  prefetchOnAppStart,
  removeFromAutoPrefetch,
  removeAllFromAutoprefetch,
  getNetworkQualityEstimate,
} from './fetch';
export type { NitroRequest, NitroResponse } from './fetch';
export type { NetworkQualityEstimate } from './NitroFetch.nitro';
export { NitroFetch } from './NitroInstances';
import './fetch';

// Keep legacy export to avoid breaking any local tests/usages during scaffolding.
// Will be removed once native Cronet path is ready.
export function multiply(a: number, b: number): number {
  return a * b;
}
