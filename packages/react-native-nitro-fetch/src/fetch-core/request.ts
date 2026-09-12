import type { NitroRequest as NitroRequestNative } from '../NitroFetch.nitro';
import { NitroRequest as NitroRequestClass, rawBodyOf } from '../Request';
import type { RequestRedirect, RequestCache } from '../Request';
import {
  applyDefaultContentType,
  applyCacheHeaders,
  headersToPairs,
  headersToPairsPure,
} from './headers';
import { normalizeBody, normalizeBodyPure } from './body';

export function buildNitroRequest(
  input: RequestInfo | URL,
  init?: RequestInit & {
    redirect?: RequestRedirect;
    cache?: RequestCache;
    prefetchCacheTtlMs?: number;
  }
): NitroRequestNative {
  'worklet';
  let url: string;
  let method: string | undefined;
  let headersInit: HeadersInit | undefined;
  let body: BodyInit | null | undefined;
  let redirectOption: RequestRedirect =
    (init?.redirect as RequestRedirect) ?? 'follow';
  let cacheOption: RequestCache | undefined = init?.cache as
    | RequestCache
    | undefined;
  let credentialsOption: RequestCredentials | undefined = init?.credentials;

  if (input instanceof NitroRequestClass) {
    url = input.url;
    method = init?.method ?? input.method;
    headersInit = init?.headers ?? (input.headers as any);
    body = init?.body ?? rawBodyOf(input) ?? null;
    if (!init?.redirect) redirectOption = input.redirect;
    if (!init?.cache) cacheOption = input.cache;
    if (!init?.credentials) credentialsOption = input.credentials;
  } else if (typeof input === 'string' || input instanceof URL) {
    url = String(input);
    method = init?.method;
    headersInit = init?.headers;
    body = init?.body ?? null;
  } else {
    // Standard Request object
    url = input.url;
    method = input.method;
    headersInit = input.headers as any;
    body = init?.body ?? null;
    if (!init?.credentials) credentialsOption = (input as Request).credentials;
  }

  const headers = headersToPairs(headersInit) ?? [];
  const normalized = normalizeBody(body);
  applyDefaultContentType(headers, normalized?.contentType);

  applyCacheHeaders(headers, cacheOption);

  // Determine followRedirects based on redirect option
  const followRedirects = redirectOption === 'follow';

  const prefetchCacheTtlMs =
    typeof init?.prefetchCacheTtlMs === 'number'
      ? init.prefetchCacheTtlMs
      : undefined;

  return {
    url,
    method: (method?.toUpperCase() as any) ?? 'GET',
    headers: headers.length > 0 ? headers : undefined,
    bodyString: normalized?.bodyString,
    bodyBytes: normalized?.bodyBytes,
    bodyFormData: normalized?.bodyFormData,
    followRedirects,
    credentials: credentialsOption,
    prefetchCacheTtlMs,
  };
}

// Pure JS version of buildNitroRequest that doesnt use anything that breaks worklets
export function buildNitroRequestPure(
  input: RequestInfo | URL,
  init?: RequestInit & { prefetchCacheTtlMs?: number }
): NitroRequestNative {
  'worklet';
  let url: string;
  let method: string | undefined;
  let headersInit: HeadersInit | undefined;
  let body: BodyInit | null | undefined;

  // Check if input is URL-like without instanceof
  const isUrlObject =
    typeof input === 'object' &&
    input !== null &&
    Object.prototype.toString.call(input) === '[object URL]';

  if (typeof input === 'string' || isUrlObject) {
    url = String(input);
    method = init?.method;
    headersInit = init?.headers;
    body = init?.body ?? null;
  } else {
    // Request object
    const req = input as Request;
    url = req.url;
    method = req.method;
    headersInit = req.headers;
    // Clone body if needed – Request objects in RN typically allow direct access
    body = init?.body ?? null;
  }

  const headers = headersToPairsPure(headersInit) ?? [];
  const normalized = normalizeBodyPure(body);
  applyDefaultContentType(headers, normalized?.contentType);
  applyCacheHeaders(headers, init?.cache as RequestCache | undefined);

  const prefetchCacheTtlMs =
    typeof init?.prefetchCacheTtlMs === 'number'
      ? init.prefetchCacheTtlMs
      : undefined;

  return {
    url,
    method: (method?.toUpperCase() as any) ?? 'GET',
    headers: headers.length > 0 ? headers : undefined,
    bodyString: normalized?.bodyString,
    bodyBytes: normalized?.bodyBytes,
    followRedirects: true,
    credentials: init?.credentials,
    prefetchCacheTtlMs,
  };
}
