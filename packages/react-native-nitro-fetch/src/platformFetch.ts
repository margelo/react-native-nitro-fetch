import { NitroRequest, consumeRawBodyOf, rawBodyOf } from './Request';

/** Preserve platform Request handling, including opaque RN FormData bodies. */
export async function platformFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (!(input instanceof NitroRequest)) return globalThis.fetch(input, init);

  const request = new NitroRequest(input, init);
  const raw = rawBodyOf(request);
  const body =
    typeof ReadableStream !== 'undefined' && raw instanceof ReadableStream
      ? await request.arrayBuffer()
      : consumeRawBodyOf(request);
  return globalThis.fetch(request.url, {
    ...init,
    method: request.method,
    headers: request.headers as unknown as HeadersInit,
    body,
    signal: request.signal,
    redirect: request.redirect,
    cache: request.cache,
    credentials: request.credentials,
    mode: request.mode,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    keepalive: request.keepalive,
  });
}
