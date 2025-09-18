import type {
  NitroFetch as NitroFetchModule,
  NitroHeader,
  NitroRequest,
  NitroResponse,
} from './NitroFetch.nitro';
import { NitroFetch as NitroFetchSingleton } from './NitroInstances';

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
      } else if (entry && typeof entry === 'object' && 'key' in entry && 'value' in entry) {
        pairs.push(entry as NitroHeader);
      }
    }
    return pairs;
  }
  // Record<string, string>
  for (const [k, v] of Object.entries(headers)) {
    pairs.push({ key: k, value: String(v) });
  }
  return pairs;
}

function normalizeBody(body: BodyInit | null | undefined): { bodyString?: string; bodyBytes?: ArrayBuffer } | undefined {
  'worklet';
  if (body == null) return undefined;
  if (typeof body === 'string') return { bodyString: body };
  if (body instanceof URLSearchParams) return { bodyString: body.toString() };
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return { bodyBytes: body };
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    // Pass a copy/slice of the underlying bytes without base64
    //@ts-ignore
    return { bodyBytes: view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) };
  }
  // TODO: Blob/FormData support can be added later
  throw new Error('Unsupported body type for nitro fetch');
}

// @ts-ignore
function pairsToHeaders(pairs: NitroHeader[]): Headers {
  'worklet';
  const h = new Headers();
  for (const { key, value } of pairs) h.append(key, value);
  return h;
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

function buildNitroRequest(input: RequestInfo | URL, init?: RequestInit): NitroRequest {
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
    bodyBytes: normalized?.bodyBytes,
    followRedirects: true,
  };
}

async function nitroFetchRaw(input: RequestInfo | URL, init?: RequestInit): Promise<NitroResponse> {
  'worklet';
  const hasNative = typeof (NitroFetchHybrid as any)?.createClient === 'function';
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
    } as NitroResponse;
  }

  const req = buildNitroRequest(input, init);
  ensureClient();
  if (!client || typeof (client as any).request !== 'function') throw new Error('NitroFetch client not available');
  const res: NitroResponse = await client.request(req);
  return res;
}

export async function nitroFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  'worklet';
  // If native implementation is not present yet, fallback to global fetch
  const hasNative = typeof (NitroFetchHybrid as any)?.createClient === 'function';
  if (!hasNative) {
    // @ts-ignore: global fetch exists in RN
    return fetch(input as any, init);
  }

  const res = await nitroFetchRaw(input, init);

  const bytes = res.bodyBytes
    ? new Uint8Array(res.bodyBytes)
    : res.bodyString != null
      ? new TextEncoder().encode(res.bodyString)
      : new Uint8Array();

  // If Response is available, construct a real Response object for compatibility
  if (typeof Response !== 'undefined') {
    const respInit: ResponseInit = {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers.reduce((acc, { key, value }) => {
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>),
    };
    // Prefer native bytes if available
    return new Response(res.bodyBytes ?? bytes, respInit);
  }

  // Fallback lightweight Response-like object (minimal methods)
  const headersObj = res.headers.reduce((acc, { key, value }) => {
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>);
  const light: any = {
    url: res.url,
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    redirected: res.redirected,
    headers: headersObj,
    arrayBuffer: async () => (res.bodyBytes ?? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    text: async () => res.bodyString ?? new TextDecoder().decode(bytes),
    json: async () => JSON.parse(res.bodyString ?? new TextDecoder().decode(bytes)),
  };
  return light as Response;
}

// Start a native prefetch. Requires a `prefetchKey` header on the request.
export async function prefetch(input: RequestInfo | URL, init?: RequestInit): Promise<void> {
  // If native implementation is not present yet, do nothing
  const hasNative = typeof (NitroFetchHybrid as any)?.createClient === 'function';
  if (!hasNative) return;

  // Build NitroRequest and ensure prefetchKey header exists
  const req = buildNitroRequest(input, init);
  const hasKey = req.headers?.some(h => h.key.toLowerCase() === 'prefetchkey') ?? false;
  // Also support passing prefetchKey via non-standard field on init
  const fromInit = (init as any)?.prefetchKey as string | undefined;
  if (!hasKey && fromInit) {
    req.headers = (req.headers ?? []).concat([{ key: 'prefetchKey', value: fromInit }]);
  }
  const finalHasKey = req.headers?.some(h => h.key.toLowerCase() === 'prefetchkey');
  if (!finalHasKey) {
    throw new Error('prefetch requires a \"prefetchKey\" header');
  }

  // Ensure client and call native prefetch
  ensureClient();
  if (!client || typeof (client as any).prefetch !== 'function') return;
  await client.prefetch(req);
}

// Persist a request to MMKV so native can prefetch it on app start.
// Stores an array of entries under the same key Android reads: "nitrofetch_autoprefetch_queue".
export async function prefetchOnAppStart(
  input: RequestInfo | URL,
  init?: RequestInit & { prefetchKey?: string }
): Promise<void> {
  // Resolve request and prefetchKey
  const req = buildNitroRequest(input, init);
  const fromHeader = req.headers?.find(h => h.key.toLowerCase() === 'prefetchkey')?.value;
  const fromInit = (init as any)?.prefetchKey as string | undefined;
  const prefetchKey = fromHeader ?? fromInit;
  if (!prefetchKey) {
    throw new Error('prefetchOnAppStart requires a "prefetchKey" (header or init.prefetchKey)');
  }

  // Convert headers to a plain object for storage
  const headersObj = (req.headers ?? []).reduce((acc, { key, value }) => {
    acc[String(key)] = String(value);
    return acc;
  }, {} as Record<string, string>);

  const entry = {
    url: req.url,
    prefetchKey,
    headers: headersObj,
  } as const;

  // Write or append to MMKV queue
  try {
    // Dynamically require to keep it optional for consumers
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MMKV } = require('react-native-mmkv');
    const storage = new MMKV(); // default instance matches Android's defaultMMKV
    const KEY = 'nitrofetch_autoprefetch_queue';
    let arr: any[] = [];
    try {
      const raw = storage.getString(KEY);
      if (raw) arr = JSON.parse(raw);
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    arr.push(entry);
    storage.set(KEY, JSON.stringify(arr));
  } catch (e) {
    console.warn('react-native-mmkv not available; prefetchOnAppStart is a no-op', e);
  }
}

// Remove one entry (by prefetchKey) from the auto-prefetch queue in MMKV.
export async function removeFromAutoPrefetch(prefetchKey: string): Promise<void> {
  // No-op on iOS
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MMKV } = require('react-native-mmkv');
    const storage = new MMKV();
    const KEY = 'nitrofetch_autoprefetch_queue';
    let arr: any[] = [];
    try {
      const raw = storage.getString(KEY);
      if (raw) arr = JSON.parse(raw);
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    const next = arr.filter((e) => e && e.prefetchKey !== prefetchKey);
    if (next.length === 0) {
      if (typeof (storage as any).delete === 'function') {
        (storage as any).delete(KEY);
      } else {
        storage.set(KEY, JSON.stringify([]));
      }
    } else if (next.length !== arr.length) {
      storage.set(KEY, JSON.stringify(next));
    }
  } catch (e) {
    console.warn('react-native-mmkv not available; removeFromAutoPrefetch is a no-op', e);
  }
}

// Remove all entries from the auto-prefetch queue in MMKV.
export async function removeAllFromAutoprefetch(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MMKV } = require('react-native-mmkv');
    const storage = new MMKV();
    const KEY = 'nitrofetch_autoprefetch_queue';
    if (typeof (storage as any).delete === 'function') {
      (storage as any).delete(KEY);
    } else {
      storage.set(KEY, JSON.stringify([]));
    }
  } catch (e) {
    console.warn('react-native-mmkv not available; removeAllFromAutoprefetch is a no-op', e);
  }
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
let WorkletsRef: any | undefined;
function ensureWorkletRuntime(name = 'nitro-fetch'): any | undefined {
  console.log('ensuring worklet runtime');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Worklets } = require('react-native-worklets-core');
    nitroRuntime = nitroRuntime ?? Worklets.createRuntime(name);
    console.log('nitroRuntime:', !!nitroRuntime);
    return nitroRuntime;
  } catch {
    console.warn('react-native-worklets-core not available');
    return undefined;
  }
}

function getWorklets(): any | undefined {
  try {
    if (WorkletsRef) return WorkletsRef;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Worklets } = require('react-native-worklets-core');
    WorkletsRef = Worklets;
    return WorkletsRef;
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
 
  console.log('nitroFetchOnWorklet: starting');
  const preferBytes = options?.preferBytes === true; // default true
  console.log('nitroFetchOnWorklet: preferBytes:', preferBytes);
  let rt: any | undefined;
  let Worklets: any | undefined;
  try {
    rt = ensureWorkletRuntime(options?.runtimeName);
    console.log('nitroFetchOnWorklet: runtime created?', !!rt);
    Worklets = getWorklets();
    console.log('nitroFetchOnWorklet: Worklets available?', !!Worklets);
  } catch (e) {
    console.error('nitroFetchOnWorklet: setup failed', e);
  }

  // Fallback: if runtime is not available, do the work on JS
  if (!rt || !Worklets || typeof rt.run !== 'function') {
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

  return await new Promise<T>((resolve, reject) => {
    try {
      console.log('nitroFetchOnWorklet: about to call rt.run');
      rt.run(async (map: NitroWorkletMapper<T>) => {
        'worklet';
        try {
          console.log('nitroFetchOnWorklet: running fetch on worklet thread');
          const res = await nitroFetchRaw(input, init);
          console.log('nitroFetchOnWorklet: fetch completed');
          const url = res.url;
          const status = res.status;
          const statusText = res.statusText;
          const ok = res.ok;
          const redirected = res.redirected;
          const headersPairs: NitroHeader[] = res.headers;
          const bodyBytes: ArrayBuffer | undefined = preferBytes ? res.bodyBytes : undefined;
          const bodyString: string | undefined = preferBytes ? undefined : res.bodyString;
          const payload = { url, status, statusText, ok, redirected, headers: headersPairs, bodyBytes, bodyString };
          const out = map(payload);
          // Resolve back on JS thread
          Worklets.runOnJS(resolve)(out as any);
        } catch (e) {
          Worklets.runOnJS(reject)(e as any);
        }
      }, mapWorklet as any);
    } catch (e) {
      console.error('nitroFetchOnWorklet: rt.run failed', e);
      reject(e);
    }
  });
}

export const x = ensureWorkletRuntime();
export const y = getWorklets();

export type { NitroRequest, NitroResponse } from './NitroFetch.nitro';
