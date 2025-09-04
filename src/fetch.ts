import type {
  NitroFetch as NitroFetchModule,
  NitroHeader,
  NitroRequest,
  NitroResponse,
} from './NitroFetch.nitro';
import { NitroFetch as NitroFetchSingleton } from './NitroInstances';

// No base64: pass strings/ArrayBuffers directly

function headersToPairs(headers?: HeadersInit): NitroHeader[] | undefined {
  if (!headers) return undefined;
  const pairs: NitroHeader[] = [];
  if (headers instanceof Headers) {
    headers.forEach((v, k) => pairs.push([k, v]));
    return pairs;
  }
  if (Array.isArray(headers)) {
    // Already pairs
    return headers as NitroHeader[];
  }
  // Record<string, string>
  for (const [k, v] of Object.entries(headers)) {
    pairs.push([k, String(v)]);
  }
  return pairs;
}

function normalizeBody(body: BodyInit | null | undefined): { bodyString?: string; bodyBytes?: ArrayBuffer } | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return { bodyString: body };
  if (body instanceof URLSearchParams) return { bodyString: body.toString() };
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return { bodyBytes: body };
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    // Pass a copy/slice of the underlying bytes without base64
    return { bodyBytes: view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) };
  }
  // TODO: Blob/FormData support can be added later
  throw new Error('Unsupported body type for nitro fetch');
}

function pairsToHeaders(pairs: NitroHeader[]): Headers {
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

export async function nitroFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // If native implementation is not present yet, fallback to global fetch
  const hasNative = typeof (NitroFetchHybrid as any)?.createClient === 'function';
  if (!hasNative) {
    // @ts-ignore: global fetch exists in RN
    return fetch(input as any, init);
  }

  // Normalize request
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

  const req: NitroRequest = {
    url,
    method: (method?.toUpperCase() as any) ?? 'GET',
    headers,
    bodyString: normalized?.bodyString,
    bodyBytes: normalized?.bodyBytes,
    followRedirects: true,
  };

  let res: NitroResponse;
  // Ensure we have a client instance bound to env
  ensureClient();
  if (!client || typeof (client as any).request !== 'function') {
    console.warn('NitroFetch client not available, falling back to global fetch', client);
    // @ts-ignore
    return fetch(input as any, init);
  }
  try {
    console.log('Using nitro fetch for', req.method, req.url);
    // @ts-expect-error runtime hybrid object
    res = await client.request(req);
  } catch (e) {
    // Native not implemented yet – fall back to platform fetch
    // @ts-ignore
    return fetch(input as any, init);
  }
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

export type { NitroRequest, NitroResponse } from './NitroFetch.nitro';

