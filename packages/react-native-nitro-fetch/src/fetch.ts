import 'web-streams-polyfill/polyfill';
import type {
  NitroFetch as NitroFetchModule,
  NitroFormDataPart,
  NitroHeader,
  NitroRequest,
  NitroResponse,
} from './NitroFetch.nitro';
import {
  boxedNitroFetch,
  NitroFetch as NitroFetchSingleton,
  NitroCronetSingleton,
} from './NitroInstances';
import { NativeStorage as NativeStorageSingleton } from './NitroInstances';

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
  init?: RequestInit
): NitroRequest {
  'worklet';
  let url: string;
  let method: string | undefined;
  let headersInit: HeadersInit | undefined;
  let body: BodyInit | null | undefined;

  if (typeof input === 'string' || input instanceof URL) {
    url = String(input);
    method = init?.method;
    headersInit = init?.headers;
    body = init?.body ?? null;
  } else {
    // Request object
    url = input.url;
    method = input.method;
    headersInit = input.headers as any;
    // Clone body if needed – Request objects in RN typically allow direct access
    body = init?.body ?? null;
  }

  const headers = headersToPairs(headersInit);
  const normalized = normalizeBody(body);

  return {
    url,
    method: (method?.toUpperCase() as any) ?? 'GET',
    headers,
    bodyString: normalized?.bodyString,
    bodyBytes: undefined as any,
    bodyFormData: normalized?.bodyFormData,
    followRedirects: true,
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
  init?: RequestInit
): NitroRequest {
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

  return {
    url,
    method: (method?.toUpperCase() as any) ?? 'GET',
    headers,
    bodyString: normalized?.bodyString,
    // Only include bodyBytes when provided to avoid signaling upload data unintentionally
    bodyBytes: undefined as any,
    followRedirects: true,
  };
}

function createAbortError(): Error {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

async function nitroFetchRaw(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<NitroResponse> {
  const signal = init?.signal as AbortSignal | undefined | null;

  // Fast-abort: reject synchronously before any bridge work.
  if (signal?.aborted) {
    throw createAbortError();
  }

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
    } as any as NitroResponse; // bleee
  }

  const req = buildNitroRequest(input, init);

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
    const res: NitroResponse = await client.request(req);
    return res;
  } catch (e) {
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

// Simple Headers-like class that supports get() method
class NitroHeaders {
  private _headers: Map<string, string>;

  constructor(headers: NitroHeader[]) {
    this._headers = new Map();
    for (const { key, value } of headers) {
      // Headers are case-insensitive, normalize to lowercase
      this._headers.set(key.toLowerCase(), value);
    }
  }

  get(name: string): string | null {
    return this._headers.get(name.toLowerCase()) ?? null;
  }

  has(name: string): boolean {
    return this._headers.has(name.toLowerCase());
  }

  forEach(callback: (value: string, key: string) => void): void {
    this._headers.forEach(callback);
  }

  entries(): IterableIterator<[string, string]> {
    return this._headers.entries();
  }

  keys(): IterableIterator<string> {
    return this._headers.keys();
  }

  values(): IterableIterator<string> {
    return this._headers.values();
  }
}

async function nitroStreamFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = typeof input === 'string' ? input : String(input);
  const method = init?.method?.toUpperCase() ?? 'GET';
  const headers = headersToPairs(init?.headers);

  const builder = NitroCronetSingleton.newUrlRequestBuilder(url);
  builder.setHttpMethod(method);
  headers?.forEach((h) => builder.addHeader(h.key, h.value));

  const body = init?.body;
  if (body != null) {
    if (typeof body === 'string') builder.setUploadBody(body);
    else if (body instanceof ArrayBuffer) builder.setUploadBody(body);
  }

  return new Promise((resolveResponse, rejectResponse) => {
    let streamController: ReadableStreamDefaultController<Uint8Array>;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });

    let responseResolved = false;

    builder.onResponseStarted((info) => {
      if (responseResolved) return;
      responseResolved = true;
      const status = info.httpStatusCode;
      const responseHeaders = new NitroHeaders(
        Object.entries(info.allHeaders).map(([key, value]) => ({ key, value }))
      );
      // Use a plain object — React Native's Response constructor does not
      // propagate a ReadableStream to .body, so we set it explicitly.
      const response: any = {
        url: info.url,
        ok: status >= 200 && status < 300,
        status,
        statusText: info.httpStatusText,
        headers: responseHeaders,
        redirected: false,
        body: stream,
        bodyUsed: false,
      };
      resolveResponse(response as Response);
      // Android/Cronet: kick off the first buffer read.
      // iOS/URLSession handles reading automatically so this is a no-op there.
      request.read();
    });

    builder.onReadCompleted((_info, byteBuffer, bytesRead) => {
      const chunk = new Uint8Array(byteBuffer, 0, bytesRead).slice();
      streamController.enqueue(chunk);
      if (!request.isDone()) {
        request.read();
      }
    });

    builder.onSucceeded(() => streamController.close());

    builder.onFailed((_info, error) => {
      const err = new Error(error.message);
      if (!responseResolved) {
        responseResolved = true;
        rejectResponse(err);
      } else {
        streamController.error(err);
      }
    });

    builder.onCanceled(() => {
      const err = createAbortError();
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
  init?: RequestInit & { stream?: boolean }
): Promise<Response> {
  if ((init as any)?.stream === true) {
    return nitroStreamFetch(input, init);
  }
  const res = await nitroFetchRaw(input, init);

  const headersObj = new NitroHeaders(res.headers);

  const bodyBytes = res.bodyBytes;
  const bodyString = res.bodyString;

  const makeLight = (): any => ({
    url: res.url,
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    redirected: res.redirected,
    headers: headersObj,
    arrayBuffer: async () => bodyBytes,
    text: async () => bodyString,
    json: async () => JSON.parse(bodyString ?? '{}'),
    clone: () => makeLight(),
  });

  const light: any = makeLight();
  return light as Response;
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

  const entry = {
    url: req.url,
    prefetchKey,
    headers: headersObj,
  } as const;

  // Write or append to storage queue
  try {
    const KEY = 'nitrofetch_autoprefetch_queue';
    let arr: any[] = [];
    try {
      const raw = NativeStorageSingleton.getString(
        'nitrofetch_autoprefetch_queue'
      );
      if (raw) arr = JSON.parse(raw);
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    if (arr.some((e) => e && e.prefetchKey === prefetchKey)) {
      arr = arr.filter((e) => e && e.prefetchKey !== prefetchKey);
    }
    arr.push(entry);
    NativeStorageSingleton.setString(KEY, JSON.stringify(arr));
  } catch (e) {
    console.warn('Failed to persist prefetch queue', e);
  }
}

// Remove one entry (by prefetchKey) from the auto-prefetch queue.
export async function removeFromAutoPrefetch(
  prefetchKey: string
): Promise<void> {
  try {
    const KEY = 'nitrofetch_autoprefetch_queue';
    let arr: any[] = [];
    try {
      const raw = NativeStorageSingleton.getString(
        'nitrofetch_autoprefetch_queue'
      );
      if (raw) arr = JSON.parse(raw);
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    const next = arr.filter((e) => e && e.prefetchKey !== prefetchKey);
    if (next.length === 0) {
      NativeStorageSingleton.removeString(KEY);
    } else if (next.length !== arr.length) {
      NativeStorageSingleton.setString(KEY, JSON.stringify(next));
    }
  } catch (e) {
    console.warn('Failed to remove from prefetch queue', e);
  }
}

// Remove all entries from the auto-prefetch queue.
export async function removeAllFromAutoprefetch(): Promise<void> {
  const KEY = 'nitrofetch_autoprefetch_queue';
  NativeStorageSingleton.setString(KEY, JSON.stringify([]));
}

// Optional off-thread processing using react-native-worklets-core
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
    console.warn('react-native-worklets-core not available');
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
    const unboxedNitroFetch = boxedNitroFetch.unbox();
    const unboxedClient = unboxedNitroFetch.createClient();
    const request = buildNitroRequestPure(input, init);
    const res = unboxedClient.requestSync(request);
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

export type {
  NitroFormDataPart,
  NitroRequest,
  NitroResponse,
} from './NitroFetch.nitro';
