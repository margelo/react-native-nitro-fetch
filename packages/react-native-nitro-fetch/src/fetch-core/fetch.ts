import { NitroResponse } from '../Response';
import { NitroRequest as NitroRequestClass } from '../Request';
import type { RequestRedirect, RequestCache } from '../Request';
import { resolveRequestBody, resolveBlobBody } from './body';
import { isHttpUrl, getUrlString } from './url';
import { nitroFetchRaw } from './raw';
import { nitroStreamFetch } from './stream';

export async function nitroFetch(
  input: RequestInfo | URL,
  init?: RequestInit & {
    /**
     * Opt in to the streaming transport. Required for SSE, token streams, or any
     * progressive body — omitting it is silent, not an error.
     *
     * When `true` (http(s) URLs only), the promise resolves as soon as response
     * headers arrive and `response.body` emits one chunk per native read.
     *
     * When omitted or `false`, the whole body is buffered natively and the
     * promise resolves only after the last byte. `response.body` is still a
     * `ReadableStream`, so a reader loop compiles and parses every frame
     * correctly — but it enqueues the entire body as a single chunk and closes.
     * Nothing arrives early.
     *
     * Not a free upgrade: the streaming transport is a separate native client.
     * It does not consult the prefetch cache, always reports
     * `response.redirected === false`, and ignores `redirect: 'error'`.
     *
     * @default false
     */
    stream?: boolean;
    redirect?: RequestRedirect;
    cache?: RequestCache;
  }
): Promise<Response> {
  // Merge defaults from NitroRequestClass if input is one
  if (input instanceof NitroRequestClass) {
    init = {
      ...init,
      signal: init?.signal ?? input.signal,
      redirect: (init?.redirect as RequestRedirect) ?? input.redirect,
      cache: (init?.cache as RequestCache) ?? input.cache,
    } as any;
  }

  // Streaming is http(s)-only; local URLs fall through to nitroFetchRaw (check runs only when streaming).
  if ((init as any)?.stream === true && isHttpUrl(getUrlString(input))) {
    init = await resolveRequestBody(input, init);
    init = await resolveBlobBody(init);
    return nitroStreamFetch(input, init);
  }

  const redirectOption: RequestRedirect =
    (init?.redirect as RequestRedirect) ?? 'follow';
  const res = await nitroFetchRaw(input, init);

  // Handle redirect: "error" — if we got a 3xx back (followRedirects was false), throw
  if (redirectOption === 'error' && res.status >= 300 && res.status < 400) {
    throw new TypeError(
      `redirect mode is "error": redirected request to "${res.url}"`
    );
  }

  const response = new NitroResponse({
    url: res.url,
    status: res.status,
    statusText: res.statusText,
    ok: res.ok,
    redirected: res.redirected,
    headers: res.headers,
    bodyBytes: res.bodyBytes,
    bodyString: res.bodyString,
  });
  return response as unknown as Response;
}
