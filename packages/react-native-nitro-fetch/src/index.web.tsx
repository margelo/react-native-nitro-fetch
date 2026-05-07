// Web entry for react-native-nitro-fetch.
// Native (Cronet/URLSession) is unavailable on the web, so we delegate to the
// browser's built-in fetch and stub native-only APIs with console.warn.

import { NitroRequest as NitroRequestClass } from './Request';
import type { RequestRedirect, RequestCache } from './Request';

export { NitroHeaders as Headers } from './Headers';
export { NitroResponse as Response } from './Response';
export { NitroRequest as Request } from './Request';
export type { RequestRedirect, RequestCache } from './Request';

export { NetworkInspector } from './NetworkInspector';
export type {
  NetworkEntry,
  NetworkEntryCallback,
  WebSocketEntry,
  WebSocketMessage,
  InspectorEntry,
} from './NetworkInspector';
export { generateCurl } from './CurlGenerator';
export type { CurlOptions } from './CurlGenerator';
export { profileFetch } from './HermesProfiler';
export type { ProfileResult } from './HermesProfiler';

export type { NitroFormDataPart } from './NitroFetch.nitro';
export type {
  NitroRequest as NitroRequest,
  NitroResponse as NitroResponse,
} from './NitroFetch.nitro';

export type TokenRefreshConfig = {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body?: string;
  responseType?: 'json' | 'text';
  mappings?: {
    jsonPath: string;
    header: string;
    valueTemplate?: string;
  }[];
  compositeHeaders?: {
    header: string;
    template: string;
    paths: Record<string, string>;
  }[];
};

export async function fetch(
  input: RequestInfo | URL,
  init?: RequestInit & {
    stream?: boolean;
    redirect?: RequestRedirect;
    cache?: RequestCache;
  }
): Promise<Response> {
  let resolvedInput: RequestInfo | URL = input;
  let resolvedInit = init;
  if (input instanceof NitroRequestClass) {
    const method = (init?.method ?? input.method).toUpperCase();
    const hasBodyMethod = method !== 'GET' && method !== 'HEAD';
    let body: BodyInit | null | undefined = init?.body;
    if (body === undefined && hasBodyMethod) {
      const bytes = await input.arrayBuffer().catch(() => undefined);
      body = bytes && bytes.byteLength > 0 ? bytes : null;
    }
    resolvedInput = input.url;
    resolvedInit = {
      ...init,
      method,
      headers: (init?.headers ??
        (input.headers as unknown as HeadersInit)) as HeadersInit,
      body,
      redirect: init?.redirect ?? input.redirect,
      cache: init?.cache ?? input.cache,
      signal: init?.signal ?? input.signal,
    };
  }
  return globalThis.fetch(resolvedInput as RequestInfo, resolvedInit);
}

export type NitroWorkletMapper<T> = (payload: {
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  redirected: boolean;
  headers: { key: string; value: string }[];
  bodyBytes?: ArrayBuffer;
  bodyString?: string;
}) => T;

export async function nitroFetchOnWorklet<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  mapWorklet: NitroWorkletMapper<T>,
  _options?: { preferBytes?: boolean; runtimeName?: string }
): Promise<T> {
  console.warn(
    'nitroFetchOnWorklet: worklets are not available on web; running on the JS thread'
  );
  const res = await globalThis.fetch(input as RequestInfo, init);
  const bodyBytes = await res.clone().arrayBuffer();
  let bodyString: string | undefined;
  try {
    bodyString = await res.clone().text();
  } catch {
    bodyString = undefined;
  }
  const headers: { key: string; value: string }[] = [];
  res.headers.forEach((v, k) => headers.push({ key: k, value: v }));
  return mapWorklet({
    url: res.url,
    status: res.status,
    statusText: res.statusText,
    ok: res.ok,
    redirected: (res as { redirected?: boolean }).redirected ?? false,
    headers,
    bodyBytes,
    bodyString,
  });
}

export async function prefetch(
  _input: RequestInfo | URL,
  _init?: RequestInit
): Promise<void> {
  console.warn('prefetch is not available on web');
}

export async function prefetchOnAppStart(
  _input: RequestInfo | URL,
  _init?: RequestInit & { prefetchKey?: string }
): Promise<void> {
  console.warn('prefetchOnAppStart is not available on web');
}

export async function removeFromAutoPrefetch(
  _prefetchKey: string
): Promise<void> {
  console.warn('removeFromAutoPrefetch is not available on web');
}

export async function removeAllFromAutoprefetch(): Promise<void> {
  console.warn('removeAllFromAutoprefetch is not available on web');
}

export const NitroFetch: unknown = new Proxy(
  {},
  {
    get(_target, prop) {
      console.warn(`NitroFetch.${String(prop)} is not available on web`);
      return undefined;
    },
  }
);

export function registerTokenRefresh(
  _options: { target: 'websocket' | 'fetch' | 'all' } & TokenRefreshConfig
): void {
  console.warn('registerTokenRefresh is not available on web');
}

export function clearTokenRefresh(
  _target?: 'websocket' | 'fetch' | 'all'
): void {
  console.warn('clearTokenRefresh is not available on web');
}

export async function callRefreshEndpoint(
  _config: TokenRefreshConfig
): Promise<Record<string, string>> {
  console.warn('callRefreshEndpoint is not available on web');
  return {};
}

export function getStoredTokenRefreshConfig(
  _target: 'websocket' | 'fetch'
): TokenRefreshConfig | null {
  console.warn('getStoredTokenRefreshConfig is not available on web');
  return null;
}

export function getNestedField(
  obj: unknown,
  dotPath: string
): string | undefined {
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current != null ? String(current) : undefined;
}

export function applyTemplate(template: string, value: string): string {
  return template.replace(/\{\{value\}\}/g, value);
}
