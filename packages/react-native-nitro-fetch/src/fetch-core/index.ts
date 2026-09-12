// Concrete path so Metro resolves it even with unstable_enablePackageExports: false (#103).
import 'web-streams-polyfill/dist/polyfill.js';

export { nitroFetch } from './fetch';
export {
  prefetch,
  prefetchOnAppStart,
  removeFromAutoPrefetch,
  removeAllFromAutoprefetch,
  __readAutoPrefetchQueue,
} from './prefetch';
export { nitroFetchOnWorklet } from './worklet';
export type { NitroWorkletMapper } from './worklet';
export { buildNitroRequestPure } from './request';
export type { NitroFormDataPart } from '../NitroFetch.nitro';
export type {
  NitroRequest as NitroRequestNativeType,
  NitroResponse as NitroResponseNativeType,
} from '../NitroFetch.nitro';
export { NitroHeaders } from '../Headers';
export { NitroResponse } from '../Response';
export { NitroRequest as NitroRequestClass } from '../Request';
export type { RequestRedirect, RequestCache } from '../Request';
