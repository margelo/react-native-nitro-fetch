import type {
  NitroFetch as NitroFetchModule,
  NitroHeader,
  NitroRequest,
  NitroResponse,
} from './NitroFetch.nitro';
import type { NitroEnv } from './NitroEnv.nitro';
import { NitroFetch as NitroFetchSingleton, NitroEnv as NitroEnvSingleton } from './NitroInstances';

// Base64 helpers (no external deps)
const b64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const triple = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    output +=
      b64Alphabet[(triple >> 18) & 0x3f] +
      b64Alphabet[(triple >> 12) & 0x3f] +
      b64Alphabet[(triple >> 6) & 0x3f] +
      b64Alphabet[triple & 0x3f];
  }
  if (i < bytes.length) {
    const remaining = bytes.length - i; // 1 or 2
    const a = bytes[i];
    const b = remaining === 2 ? bytes[i + 1] : 0;
    const triple = (a << 16) | (b << 8);
    output += b64Alphabet[(triple >> 18) & 0x3f];
    output += b64Alphabet[(triple >> 12) & 0x3f];
    output += remaining === 2 ? b64Alphabet[(triple >> 6) & 0x3f] : '=';
    output += '=';
  }
  return output;
}

function base64ToBytes(b64: string): Uint8Array {
  // Remove padding and invalid chars
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const len = clean.length;
  if (len % 4 !== 0) throw new Error('Invalid base64');

  const placeholders = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const byteLen = ((len * 3) >> 2) - placeholders;
  const bytes = new Uint8Array(byteLen);

  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const c1 = b64Alphabet.indexOf(clean[i]);
    const c2 = b64Alphabet.indexOf(clean[i + 1]);
    const c3 = b64Alphabet.indexOf(clean[i + 2]);
    const c4 = b64Alphabet.indexOf(clean[i + 3]);
    const triple = (c1 << 18) | (c2 << 12) | ((c3 & 0x3f) << 6) | (c4 & 0x3f);
    if (p < byteLen) bytes[p++] = (triple >> 16) & 0xff;
    if (p < byteLen) bytes[p++] = (triple >> 8) & 0xff;
    if (p < byteLen) bytes[p++] = triple & 0xff;
  }
  return bytes;
}

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

async function bodyToBase64(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body == null) return undefined;
  if (typeof body === 'string') {
    const encoder = new TextEncoder();
    return bytesToBase64(encoder.encode(body));
  }
  if (body instanceof URLSearchParams) {
    const encoder = new TextEncoder();
    return bytesToBase64(encoder.encode(body.toString()))
  }
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) {
    return bytesToBase64(new Uint8Array(body));
  }
  if (ArrayBuffer.isView(body)) {
    return bytesToBase64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  // TODO: Blob/FormData support can be added later
  throw new Error('Unsupported body type for nitro fetch');
}

function pairsToHeaders(pairs: NitroHeader[]): Headers {
  const h = new Headers();
  for (const [k, v] of pairs) h.append(k, v);
  return h;
}

const NitroFetchHybrid: NitroFetchModule = NitroFetchSingleton;
const NitroEnvHybrid: NitroEnv = NitroEnvSingleton;

let providedEnv: NitroEnv | null = null;
let client: NitroFetchModule["createClient"] extends (...args: any) => infer R ? R : any;

export function setNitroEnv(env: NitroEnv) {
  providedEnv = env;
  try {
    client = NitroFetchSingleton.createClient(providedEnv);
  } catch (_) {
    // Native not ready; client remains undefined. JS fallback will be used.
  }
}

export async function nitroFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // If native implementation is not present yet, fallback to global fetch
  const hasNative = typeof (NitroFetchHybrid as any)?.request === 'function';
  if (!hasNative) {
    console.log('no native fetch')
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
  const bodyBase64 = await bodyToBase64(body);

  const req: NitroRequest = {
    url,
    method: (method?.toUpperCase() as any) ?? 'GET',
    headers,
    bodyBase64,
    followRedirects: true,
  };

  let res: NitroResponse;
  // Ensure we have a client instance
  if (!client) {
    try {
      const envToUse: NitroEnv | undefined = providedEnv ?? (NitroEnvHybrid as any);
      client = NitroFetchSingleton.createClient(envToUse);
    } catch (_) {
      // Will fallback below
    }
  }
  try {
    // @ts-expect-error runtime hybrid object
    res = await client.request(req);
  } catch (e) {
    // Native not implemented yet – fall back to platform fetch
    // @ts-ignore
    return fetch(input as any, init);
  }
  const bytes = base64ToBytes(res.bodyBase64 ?? '');

  // If Response is available, construct a real Response object for compatibility
  if (typeof Response !== 'undefined') {
    const respInit: ResponseInit = {
      status: res.status,
      statusText: res.statusText,
      headers: pairsToHeaders(res.headers),
    };
    return new Response(bytes, respInit);
  }

  // Fallback lightweight Response-like object (minimal methods)
  const decoder = new TextDecoder();
  const headersObj = Object.fromEntries(res.headers);
  const light: any = {
    url: res.url,
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    redirected: res.redirected,
    headers: headersObj,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => decoder.decode(bytes),
    json: async () => JSON.parse(decoder.decode(bytes)),
  };
  return light as Response;
}

export type { NitroRequest, NitroResponse } from './NitroFetch.nitro';
export type { NitroEnv } from './NitroEnv.nitro';
