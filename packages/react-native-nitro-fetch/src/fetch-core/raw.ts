import type {
  NitroHeader,
  NitroResponse as NitroResponseNative,
} from '../NitroFetch.nitro';
import { NetworkInspector } from '../NetworkInspector';
import { NitroFetchHybrid, ensureClient } from './client';
import { resolveRequestBody, resolveBlobBody } from './body';
import { buildNitroRequest } from './request';
import { isHttpUrl } from './url';
import { createAbortError } from './errors';
import { fetchLocalResource } from './local';

export async function nitroFetchRaw(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<NitroResponseNative> {
  const signal = init?.signal as AbortSignal | undefined | null;

  // Fast-abort: reject synchronously before any bridge work.
  if (signal?.aborted) {
    throw createAbortError();
  }

  // Extract body from standard Request when init.body is absent (ky/undici pattern)
  init = await resolveRequestBody(input, init);
  // Resolve Blob body to string before passing to sync buildNitroRequest
  init = await resolveBlobBody(init);

  const hasNative =
    typeof (NitroFetchHybrid as any)?.createClient === 'function';
  if (!hasNative) {
    // Fallback path not supported for raw; use global fetch and synthesize minimal shape
    // @ts-ignore: global fetch exists in RN
    const res = await fetch(input as any, init);
    const url = (res as any).url ?? String(input);
    const bytes = await res.arrayBuffer();
    const headers: NitroHeader[] = [];
    res.headers.forEach((v, k) => headers.push({ key: k, value: v }));
    return {
      url,
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      redirected: (res as any).redirected ?? false,
      headers,
      bodyBytes: bytes,
      bodyString: undefined,
    } as any as NitroResponseNative; // bleee
  }

  const req = buildNitroRequest(input, init);

  // Route non-http(s) (data:/file://content://scheme-less) off the HTTP client.
  if (!isHttpUrl(req.url)) {
    return fetchLocalResource(req);
  }

  // Inspector: record start (zero cost when disabled — single boolean check)
  let inspectorId: string | undefined;
  if (NetworkInspector.isEnabled()) {
    inspectorId = String(Date.now()) + '-' + String(Math.random()).slice(2, 8);
    NetworkInspector._recordStart(
      inspectorId,
      req.url,
      req.method ?? 'GET',
      req.headers ?? [],
      req.bodyString
    );
  }

  // Only allocate a requestId when a signal is present — zero overhead otherwise.
  const requestId = signal ? String(Math.random()) : undefined;
  if (requestId) req.requestId = requestId;

  const client = ensureClient();
  if (!client || typeof (client as any).request !== 'function')
    throw new Error('NitroFetch client not available');

  // Wire up the abort listener with { once: true } so it auto-removes
  // after firing, avoiding a dangling reference to the client closure.
  let abortListener: (() => void) | undefined;
  if (signal && requestId) {
    abortListener = () => {
      try {
        client.cancelRequest(requestId);
      } catch {
        // Client may already be torn down — swallow.
      }
    };
    signal.addEventListener('abort', abortListener, { once: true });
  }

  try {
    const res: NitroResponseNative = await client.request(req);
    if (signal?.aborted) throw createAbortError();
    if (inspectorId) {
      NetworkInspector._recordEnd(
        inspectorId,
        res.status,
        res.statusText,
        res.headers ?? [],
        res.bodyString?.length ?? 0,
        undefined,
        res.bodyString ?? undefined
      );
    }
    return res;
  } catch (e) {
    if (inspectorId) {
      NetworkInspector._recordEnd(inspectorId, 0, '', [], 0, String(e));
    }
    // If the signal was aborted (either before or during the request),
    // surface a spec-compliant AbortError regardless of what native threw.
    if (signal?.aborted) {
      throw createAbortError();
    }
    throw e;
  } finally {
    // Idempotent cleanup — removeEventListener is a no-op if the listener
    // already fired (thanks to { once: true }) or was never added.
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
  }
}

// NitroHeaders is now imported from './Headers'
