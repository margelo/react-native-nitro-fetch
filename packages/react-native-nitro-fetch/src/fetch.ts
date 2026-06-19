import 'web-streams-polyfill/polyfill';
import type {
  NitroFetch as NitroFetchModule,
  NitroFormDataPart,
  NitroHeader,
  NitroRequest as NitroRequestNative,
  NitroResponse as NitroResponseNative,
} from './NitroFetch.nitro';
import {
  NitroFetch as NitroFetchSingleton,
  NitroCronetSingleton,
} from './NitroInstances';
import { NativeStorage as NativeStorageSingleton } from './NitroInstances';
import { NitroHeaders } from './Headers';
import { NitroResponse } from './Response';
import { NitroRequest as NitroRequestClass } from './Request';
import type { RequestRedirect, RequestCache } from './Request';
import { NetworkInspector } from './NetworkInspector';

// No base64: pass strings/ArrayBuffers directly

function headersToPairs(headers?: HeadersInit): NitroHeader[] | undefined {
  'worklet';
  if (!headers) return undefined;
  const pairs: NitroHeader[] = [];
  if (headers instanceof Headers) {
    headers.forEach((v, k) => pairs.push({ key: k, value: v }));
    return pairs;
  }
  if (Array.isArray(headers)) {
    // Convert tuple pairs to objects if needed
    for (const entry of headers as any[]) {
      if (Array.isArray(entry) && entry.length >= 2) {
        pairs.push({ key: String(entry[0]), value: String(entry[1]) });
      } else if (
        entry &&
        typeof entry === 'object' &&
        'key' in entry &&
        'value' in entry
      ) {
        pairs.push(entry as NitroHeader);
      }
    }
    return pairs;
  }
  // Check if it's a plain object (Record<string, string>) first
  // Plain objects don't have forEach, so check for its absence
  if (typeof headers === 'object' && headers !== null) {
    // Check if it's a Headers instance by checking for forEach method
    const hasForEach = typeof (headers as any).forEach === 'function';

    if (hasForEach) {
      // Headers-like object (duck typing)
      (headers as any).forEach((v: string, k: string) =>
        pairs.push({ key: k, value: v })
      );
      return pairs;
    } else {
      // Plain object (Record<string, string>)
      // Use Object.keys to iterate since Object.entries might not work in worklets
      const keys = Object.keys(headers);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const v = (headers as Record<string, string>)[k];
        if (v !== undefined) {
          pairs.push({ key: k, value: String(v) });
        }
      }
      return pairs;
    }
  }
  return pairs;
}

function serializeFormData(fd: FormData): NitroFormDataPart[] {
  const parts: NitroFormDataPart[] = [];

  if (typeof (fd as any).getParts === 'function') {
    const rnParts: any[] = (fd as any).getParts();
    for (const part of rnParts) {
      if (part.string !== undefined) {
        parts.push({ name: part.fieldName, value: String(part.string) });
      } else if (part.uri) {
        parts.push({
          name: part.fieldName,
          fileUri: part.uri,
          fileName: part.fileName ?? part.name ?? 'file',
          mimeType: part.type ?? 'application/octet-stream',
        });
      }
    }
    return parts;
  }

  fd.forEach((value: any, key: string) => {
    if (typeof value === 'string') {
      parts.push({ name: key, value });
    } else if (value && typeof value === 'object') {
      parts.push({
        name: key,
        fileUri: value.uri ?? value.fileUri,
        fileName: value.name ?? value.fileName ?? 'file',
        mimeType: value.type ?? value.mimeType ?? 'application/octet-stream',
      });
    }
  });
  return parts;
}

function isFormData(body: unknown): body is FormData {
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
  if (
    body &&
    typeof body === 'object' &&
    typeof (body as any).append === 'function' &&
    typeof (body as any).getParts === 'function'
  ) {
    return true;
  }
  return false;
}

function normalizeBody(body: BodyInit | null | undefined):
  | {
      bodyString?: string;
      bodyBytes?: ArrayBuffer;
      bodyFormData?: NitroFormDataPart[];
    }
  | undefined {
  'worklet';
  if (body == null) return undefined;
  if (typeof body === 'string') return { bodyString: body };

  if (isFormData(body)) {
    return { bodyFormData: serializeFormData(body as FormData) };
  }
  if (body instanceof URLSearchParams) return { bodyString: body.toString() };
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer)
    return { bodyBytes: body };
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    return {
      //@ts-ignore
      bodyBytes: view.buffer.slice(
        view.byteOffset,
        view.byteOffset + view.byteLength
      ),
    };
  }
  throw new Error('Unsupported body type for nitro fetch');
}

const NitroFetchHybrid: NitroFetchModule = NitroFetchSingleton;

let client: ReturnType<NitroFetchModule['createClient']> | undefined;

function ensureClient() {
  if (client) return client;
  try {
    client = NitroFetchHybrid.createClient();
  } catch (err) {
    console.error('Failed to create NitroFetch client', err);
    // native not ready; keep undefined
  }
  return client;
}

function buildNitroRequest(
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

  if (input instanceof NitroRequestClass) {
    url = input.url;
    method = init?.method ?? input.method;
    headersInit = init?.headers ?? (input.headers as any);
    body = init?.body ?? input.body ?? null;
    if (!init?.redirect) redirectOption = input.redirect;
    if (!init?.cache) cacheOption = input.cache;
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
  }

  const headers = headersToPairs(headersInit) ?? [];
  const normalized = normalizeBody(body);

  // Inject cache-control headers based on cache option
  if (cacheOption === 'no-store') {
    headers.push({ key: 'Cache-Control', value: 'no-store' });
  } else if (cacheOption === 'no-cache') {
    headers.push({ key: 'Cache-Control', value: 'no-cache' });
  } else if (cacheOption === 'reload') {
    headers.push({ key: 'Cache-Control', value: 'no-cache' });
    headers.push({ key: 'Pragma', value: 'no-cache' });
  }

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
    prefetchCacheTtlMs,
  };
}

// Pure JS version of buildNitroRequest that doesnt use anything that breaks worklets. TODO: Merge this to use Same logic for Worklets and normal Fetch
function headersToPairsPure(headers?: HeadersInit): NitroHeader[] | undefined {
  'worklet';
  if (!headers) return undefined;
  const pairs: NitroHeader[] = [];

  if (Array.isArray(headers)) {
    // Convert tuple pairs to objects if needed
    for (const entry of headers as any[]) {
      if (Array.isArray(entry) && entry.length >= 2) {
        pairs.push({ key: String(entry[0]), value: String(entry[1]) });
      } else if (
        entry &&
        typeof entry === 'object' &&
        'key' in entry &&
        'value' in entry
      ) {
        pairs.push(entry as NitroHeader);
      }
    }
    return pairs;
  }

  // Check if it's a plain object (Record<string, string>) first
  // Plain objects don't have forEach, so check for its absence
  if (typeof headers === 'object' && headers !== null) {
    // Check if it's a Headers instance by checking for forEach method
    const hasForEach = typeof (headers as any).forEach === 'function';

    if (hasForEach) {
      // Headers-like object (duck typing)
      (headers as any).forEach((v: string, k: string) =>
        pairs.push({ key: k, value: v })
      );
      return pairs;
    } else {
      // Plain object (Record<string, string>)
      // Use Object.keys to iterate since Object.entries might not work in worklets
      const keys = Object.keys(headers);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const v = (headers as Record<string, string>)[k];
        if (v !== undefined) {
          pairs.push({ key: k, value: String(v) });
        }
      }
      return pairs;
    }
  }

  return pairs;
}
// Pure JS version of buildNitroRequest that doesnt use anything that breaks worklets
function normalizeBodyPure(
  body: BodyInit | null | undefined
): { bodyString?: string; bodyBytes?: ArrayBuffer } | undefined {
  'worklet';
  if (body == null) return undefined;
  if (typeof body === 'string') return { bodyString: body };

  // Check for URLSearchParams (duck typing)
  // It should be an object, have a toString method, and typically append/delete methods
  // But mainly we care about toString() returning the query string
  if (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as any).toString === 'function' &&
    Object.prototype.toString.call(body) === '[object URLSearchParams]'
  ) {
    return { bodyString: body.toString() };
  }

  // Check for ArrayBuffer (using toString tag to avoid instanceof)
  if (
    typeof ArrayBuffer !== 'undefined' &&
    Object.prototype.toString.call(body) === '[object ArrayBuffer]'
  ) {
    return { bodyBytes: body as ArrayBuffer };
  }

  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    return {
      //@ts-ignore
      bodyBytes: view.buffer.slice(
        view.byteOffset,
        view.byteOffset + view.byteLength
      ),
    };
  }
  throw new Error(
    'Unsupported body type for nitro fetch worklet (FormData is not available in worklets)'
  );
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

  const headers = headersToPairsPure(headersInit);
  const normalized = normalizeBodyPure(body);

  const prefetchCacheTtlMs =
    typeof init?.prefetchCacheTtlMs === 'number'
      ? init.prefetchCacheTtlMs
      : undefined;

  return {
    url,
    method: (method?.toUpperCase() as any) ?? 'GET',
    headers,
    bodyString: normalized?.bodyString,
    bodyBytes: normalized?.bodyBytes,
    followRedirects: true,
    prefetchCacheTtlMs,
  };
}

function createAbortError(): Error {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

async function resolveRequestBody(
  input: RequestInfo | URL,
  init: RequestInit | undefined
): Promise<RequestInit | undefined> {
  if (typeof input === 'string' || input instanceof URL) return init;
  if (input instanceof NitroRequestClass) return init;
  if (init?.body != null) return init;
  const req = input as Request;
  if (typeof req.clone !== 'function') return init;
  const method = (init?.method ?? req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return init;
  try {
    const text = await req.clone().text();
    if (text.length === 0) return init;
    return { ...(init ?? {}), body: text };
  } catch {
    return init;
  }
}

async function resolveBlobBody(
  init: RequestInit | undefined
): Promise<RequestInit | undefined> {
  if (!init?.body) return init;
  if (typeof Blob !== 'undefined' && init.body instanceof Blob) {
    const blob = init.body as Blob;
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    // Auto-set Content-Type from Blob.type if not already provided
    let headers = init.headers;
    if (blob.type) {
      const pairs = headersToPairs(headers) ?? [];
      const hasContentType = pairs.some(
        (h) => h.key.toLowerCase() === 'content-type'
      );
      if (!hasContentType) {
        pairs.push({ key: 'Content-Type', value: blob.type });
        headers = pairs.map((h) => [h.key, h.value] as [string, string]);
      }
    }
    return { ...init, body: text, headers };
  }
  return init;
}

// http(s) -> native client; anything else is a local resource (hot path).
function isHttpUrl(url: string): boolean {
  if (url.startsWith('http://') || url.startsWith('https://')) return true;
  const c = url.charCodeAt(0);
  if (c !== 104 && c !== 72) return false; // not 'h'/'H'
  return /^https?:/i.test(url);
}

function getUrlString(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  const u = (input as { url?: unknown } | null)?.url;
  return typeof u === 'string' ? u : String(input);
}

function base64ToBytes(b64: string): Uint8Array {
  const decode = (globalThis as { atob?: (s: string) => string }).atob;
  if (typeof decode === 'function') {
    const bin = decode(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // base64 fallback for runtimes without a global atob.
  /* eslint-disable no-bitwise */
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | chars.indexOf(clean[i]!);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (buf >> bits) & 0xff;
    }
  }
  return out;
  /* eslint-enable no-bitwise */
}

type MinimalTextDecoder = {
  decode(input: ArrayBufferView): string;
};
type TextDecoderCtor = new (
  label?: string,
  options?: { fatal?: boolean }
) => MinimalTextDecoder;

// Cached: our nitro-text-decoder if the app bundles it (aliased require keeps it optional, not a dep), else a global TextDecoder.
let _decoder: MinimalTextDecoder | null | undefined;
function resolveTextDecoder(): MinimalTextDecoder | null {
  if (_decoder !== undefined) return _decoder;
  try {
    const dynamicRequire = require;
    const mod = dynamicRequire('react-native-nitro-text-decoder') as {
      TextDecoder?: TextDecoderCtor;
    };
    if (mod && typeof mod.TextDecoder === 'function') {
      _decoder = new mod.TextDecoder('utf-8', { fatal: true });
      return _decoder;
    }
  } catch {
    // optional, not bundled
  }
  const GlobalTextDecoder = (globalThis as { TextDecoder?: TextDecoderCtor })
    .TextDecoder;
  if (typeof GlobalTextDecoder === 'function') {
    _decoder = new GlobalTextDecoder('utf-8', { fatal: true });
    return _decoder;
  }
  _decoder = null;
  return _decoder;
}

// data: text via a TextDecoder; null (bytes-only) + a one-time warn if none.
let _warnedNoTextDecoder = false;
function decodeUtf8(bytes: Uint8Array): string | null {
  const decoder = resolveTextDecoder();
  if (decoder) {
    try {
      return decoder.decode(bytes);
    } catch {
      return null; // invalid UTF-8 -> keep bytes only
    }
  }
  if (!_warnedNoTextDecoder) {
    _warnedNoTextDecoder = true;
    console.warn(
      '[nitro-fetch] Reading a data: URL as text needs a TextDecoder. Install ' +
        'react-native-nitro-text-decoder or expose a global TextDecoder. The ' +
        'body is still available via response.arrayBuffer()/bytes().'
    );
  }
  return null;
}

// Decode a data: URL into a synthetic 200 response, entirely in JS.
function decodeDataUrl(url: string): NitroResponseNative {
  const comma = url.indexOf(',');
  if (comma < 0) throw new TypeError('Failed to fetch: invalid data: URL');
  const meta = url.slice(5, comma); // strip leading "data:"
  const rawData = url.slice(comma + 1);
  const isBase64 = /;base64\s*$/i.test(meta);
  const mediaType =
    (isBase64 ? meta.replace(/;base64\s*$/i, '') : meta).trim() ||
    'text/plain;charset=US-ASCII';

  let bodyString: string | undefined;
  let bodyBytes: ArrayBuffer | undefined;
  let length: number;
  if (isBase64) {
    const bytes = base64ToBytes(rawData);
    length = bytes.byteLength;
    // bytes for arrayBuffer/bytes; string for text/json when a decoder exists.
    bodyBytes = bytes.buffer as ArrayBuffer;
    const decoded = decodeUtf8(bytes);
    if (decoded != null) bodyString = decoded;
  } else {
    bodyString = decodeURIComponent(rawData);
    length =
      typeof TextEncoder !== 'undefined'
        ? new TextEncoder().encode(bodyString).length
        : bodyString.length;
  }

  return {
    url,
    status: 200,
    statusText: 'OK',
    ok: true,
    redirected: false,
    headers: [
      { key: 'Content-Type', value: mediaType },
      { key: 'Content-Length', value: String(length) },
    ],
    bodyString,
    bodyBytes,
  } as NitroResponseNative;
}

// Non-http(s): decode data: in JS, reject blob:, read file/content/path natively.
async function fetchLocalResource(
  req: NitroRequestNative
): Promise<NitroResponseNative> {
  const url = req.url;
  if (url.startsWith('data:')) return decodeDataUrl(url);
  if (url.startsWith('blob:')) {
    throw new TypeError(
      'nitro-fetch cannot read blob: URLs (the React Native blob registry is not ' +
        'reachable from native). Read blobs with the platform fetch/FileReader instead.'
    );
  }
  ensureClient();
  if (!client || typeof client.request !== 'function') {
    throw new Error('NitroFetch client not available');
  }
  return client.request(req);
}

async function nitroFetchRaw(
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

  ensureClient();
  if (!client || typeof (client as any).request !== 'function')
    throw new Error('NitroFetch client not available');

  // Wire up the abort listener with { once: true } so it auto-removes
  // after firing, avoiding a dangling reference to the client closure.
  let abortListener: (() => void) | undefined;
  if (signal && requestId) {
    abortListener = () => {
      try {
        client!.cancelRequest(requestId);
      } catch {
        // Client may already be torn down — swallow.
      }
    };
    signal.addEventListener('abort', abortListener, { once: true });
  }

  try {
    const res: NitroResponseNative = await client.request(req);
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

async function nitroStreamFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = typeof input === 'string' ? input : String(input);
  const method = init?.method?.toUpperCase() ?? 'GET';
  const headers = headersToPairs(init?.headers);

  // Inspector: record start
  let inspectorId: string | undefined;
  if (NetworkInspector.isEnabled()) {
    inspectorId = String(Date.now()) + '-' + String(Math.random()).slice(2, 8);
    NetworkInspector._recordStart(
      inspectorId,
      url,
      method,
      headers ?? [],
      typeof init?.body === 'string' ? init.body : undefined
    );
  }

  const builder = NitroCronetSingleton.newUrlRequestBuilder(url);
  builder.setHttpMethod(method);
  headers?.forEach((h) => builder.addHeader(h.key, h.value));

  const body = init?.body;
  if (body != null) {
    if (typeof body === 'string') builder.setUploadBody(body);
    else if (body instanceof ArrayBuffer) builder.setUploadBody(body);
  }

  return new Promise((resolveResponse, rejectResponse) => {
    let streamController: ReadableStreamDefaultController<
      Uint8Array<ArrayBuffer>
    >;

    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        streamController = controller;
      },
    });

    let responseResolved = false;
    let streamBytesReceived = 0;

    builder.onResponseStarted((info) => {
      if (responseResolved) return;
      responseResolved = true;
      const status = info.httpStatusCode;
      const responseHeaders = new NitroHeaders(
        Object.entries(info.allHeaders).map(([key, value]) => ({ key, value }))
      );
      const response = new NitroResponse({
        url: info.url,
        ok: status >= 200 && status < 300,
        status,
        statusText: info.httpStatusText,
        headers: responseHeaders,
        redirected: false,
        body: stream,
      });
      resolveResponse(response as unknown as Response);
      // Android/Cronet: kick off the first buffer read.
      // iOS/URLSession handles reading automatically so this is a no-op there.
      request.read();
    });

    builder.onReadCompleted((_info, byteBuffer, bytesRead) => {
      const chunk = new Uint8Array(byteBuffer, 0, bytesRead).slice();
      streamBytesReceived += bytesRead;
      streamController.enqueue(chunk);
      if (!request.isDone()) {
        request.read();
      }
    });

    builder.onSucceeded((_info) => {
      streamController.close();
      if (inspectorId) {
        const info = _info as any;
        const status = info?.httpStatusCode ?? 0;
        const hdrs = info?.allHeadersAsList ?? [];
        NetworkInspector._recordEnd(
          inspectorId,
          status,
          info?.httpStatusText ?? '',
          hdrs,
          streamBytesReceived
        );
      }
    });

    builder.onFailed((_info, error) => {
      const err = new Error(error.message);
      if (inspectorId) {
        NetworkInspector._recordEnd(inspectorId, 0, '', [], 0, error.message);
      }
      if (!responseResolved) {
        responseResolved = true;
        rejectResponse(err);
      } else {
        streamController.error(err);
      }
    });

    builder.onCanceled(() => {
      const err = createAbortError();
      if (inspectorId) {
        NetworkInspector._recordEnd(
          inspectorId,
          0,
          '',
          [],
          0,
          'Request canceled'
        );
      }
      if (!responseResolved) {
        responseResolved = true;
        rejectResponse(err);
      } else {
        streamController.error(err);
      }
    });

    const request = builder.build();
    request.start();
  });
}

export async function nitroFetch(
  input: RequestInfo | URL,
  init?: RequestInit & {
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

// Start a native prefetch. Requires a `prefetchKey` header on the request.
export async function prefetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<void> {
  // If native implementation is not present yet, do nothing
  const hasNative =
    typeof (NitroFetchHybrid as any)?.createClient === 'function';
  if (!hasNative) return;

  // Build NitroRequest and ensure prefetchKey header exists
  const req = buildNitroRequest(input, init);
  const hasKey =
    req.headers?.some((h) => h.key.toLowerCase() === 'prefetchkey') ?? false;
  // Also support passing prefetchKey via non-standard field on init
  const fromInit = (init as any)?.prefetchKey as string | undefined;
  if (!hasKey && fromInit) {
    req.headers = (req.headers ?? []).concat([
      { key: 'prefetchKey', value: fromInit },
    ]);
  }
  const finalHasKey = req.headers?.some(
    (h) => h.key.toLowerCase() === 'prefetchkey'
  );
  if (!finalHasKey) {
    throw new Error('prefetch requires a "prefetchKey" header');
  }

  // Ensure client and call native prefetch
  ensureClient();
  if (!client || typeof (client as any).prefetch !== 'function') return;
  await client.prefetch(req);
}

const AUTOPREFETCH_QUEUE_KEY = 'nitrofetch_autoprefetch_queue';

// Persist a request to storage so native can prefetch it on app start.
export async function prefetchOnAppStart(
  input: RequestInfo | URL,
  init?: RequestInit & { prefetchKey?: string }
): Promise<void> {
  // Resolve request and prefetchKey
  const req = buildNitroRequest(input, init);
  const fromHeader = req.headers?.find(
    (h) => h.key.toLowerCase() === 'prefetchkey'
  )?.value;
  const fromInit = (init as any)?.prefetchKey as string | undefined;
  const prefetchKey = fromHeader ?? fromInit;
  if (!prefetchKey) {
    throw new Error(
      'prefetchOnAppStart requires a "prefetchKey" (header or init.prefetchKey)'
    );
  }

  // Convert headers to a plain object for storage
  const headersObj = (req.headers ?? []).reduce(
    (acc, { key, value }) => {
      acc[String(key)] = String(value);
      return acc;
    },
    {} as Record<string, string>
  );

  const entry: Record<string, any> = {
    url: req.url,
    prefetchKey,
    headers: headersObj,
  };
  if (req.method && req.method !== 'GET') entry.method = req.method;
  if (req.bodyString !== undefined) entry.bodyString = req.bodyString;
  if (req.bodyFormData && req.bodyFormData.length > 0)
    entry.bodyFormData = req.bodyFormData;
  if (typeof req.timeoutMs === 'number') entry.timeoutMs = req.timeoutMs;
  if (req.followRedirects === false) entry.followRedirects = false;
  if (typeof req.prefetchCacheTtlMs === 'number')
    entry.prefetchCacheTtlMs = req.prefetchCacheTtlMs;

  // Write or append to storage queue
  try {
    let arr: any[] = [];
    try {
      const raw = NativeStorageSingleton.getString(AUTOPREFETCH_QUEUE_KEY);
      if (raw) arr = JSON.parse(raw);
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    if (arr.some((e) => e && e.prefetchKey === prefetchKey)) {
      arr = arr.filter((e) => e && e.prefetchKey !== prefetchKey);
    }
    arr.push(entry);
    NativeStorageSingleton.setString(
      AUTOPREFETCH_QUEUE_KEY,
      JSON.stringify(arr)
    );
  } catch (e) {
    console.warn('Failed to persist prefetch queue', e);
  }
}

// Remove one entry (by prefetchKey) from the auto-prefetch queue.
export async function removeFromAutoPrefetch(
  prefetchKey: string
): Promise<void> {
  try {
    let arr: any[] = [];
    try {
      const raw = NativeStorageSingleton.getString(AUTOPREFETCH_QUEUE_KEY);
      if (raw) arr = JSON.parse(raw);
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    const next = arr.filter((e) => e && e.prefetchKey !== prefetchKey);
    if (next.length === 0) {
      NativeStorageSingleton.removeString(AUTOPREFETCH_QUEUE_KEY);
    } else if (next.length !== arr.length) {
      NativeStorageSingleton.setString(
        AUTOPREFETCH_QUEUE_KEY,
        JSON.stringify(next)
      );
    }
  } catch (e) {
    console.warn('Failed to remove from prefetch queue', e);
  }
}

// Remove all entries from the auto-prefetch queue.
export async function removeAllFromAutoprefetch(): Promise<void> {
  NativeStorageSingleton.setString(AUTOPREFETCH_QUEUE_KEY, JSON.stringify([]));
}

export function __readAutoPrefetchQueue(): Array<Record<string, any>> {
  try {
    const raw = NativeStorageSingleton.getString(AUTOPREFETCH_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Optional off-thread processing using react-native-worklets

export type NitroWorkletMapper<T> = (payload: {
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  redirected: boolean;
  headers: NitroHeader[];
  bodyBytes?: ArrayBuffer;
  bodyString?: string;
}) => T;

let nitroRuntime: any | undefined;
function ensureWorkletRuntime(name = 'nitro-fetch'): any | undefined {
  try {
    const { createWorkletRuntime } = require('react-native-worklets');
    nitroRuntime = nitroRuntime ?? createWorkletRuntime(name);
    return nitroRuntime;
  } catch {
    console.warn('react-native-worklets not available');
    return undefined;
  }
}

export async function nitroFetchOnWorklet<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  mapWorklet: NitroWorkletMapper<T>,
  options?: { preferBytes?: boolean; runtimeName?: string }
): Promise<T> {
  const preferBytes = options?.preferBytes === true; // default true
  let runOnRuntimeAsync: any;
  let rt: any;
  try {
    rt = ensureWorkletRuntime(options?.runtimeName);
    const worklets = require('react-native-worklets');
    runOnRuntimeAsync = worklets.runOnRuntimeAsync;
  } catch {
    // Module not available
  }
  // Fallback: if runtime is not available, do the work on JS
  if (!runOnRuntimeAsync || !rt) {
    console.warn('nitroFetchOnWorklet: no runtime, mapping on JS thread');
    const res = await nitroFetchRaw(input, init);
    const payload = {
      url: res.url,
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      redirected: res.redirected,
      headers: res.headers,
      bodyBytes: preferBytes ? res.bodyBytes : undefined,
      bodyString: preferBytes ? undefined : res.bodyString,
    } as const;
    return mapWorklet(payload as any);
  }
  return await runOnRuntimeAsync(rt, () => {
    'worklet';
    const nitroFetchClient = NitroFetchHybrid.createClient();
    const request = buildNitroRequestPure(input, init);
    const res = nitroFetchClient.requestSync(request);
    const payload = {
      url: res.url,
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      redirected: res.redirected,
      headers: res.headers,
      bodyBytes: preferBytes ? res.bodyBytes : undefined,
      bodyString: preferBytes ? undefined : res.bodyString,
    } as const;

    return mapWorklet(payload as any);
  });
}

export type { NitroFormDataPart } from './NitroFetch.nitro';
export type {
  NitroRequest as NitroRequestNativeType,
  NitroResponse as NitroResponseNativeType,
} from './NitroFetch.nitro';
export { NitroHeaders } from './Headers';
export { NitroResponse } from './Response';
export { NitroRequest as NitroRequestClass } from './Request';
export type { RequestRedirect, RequestCache } from './Request';
