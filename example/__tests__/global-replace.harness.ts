import { describe, it, expect } from 'react-native-harness';
import axios from 'axios';
import {
  fetch as nitroFetch,
  Headers as NitroHeaders,
  Request as NitroRequest,
  Response as NitroResponse,
} from 'react-native-nitro-fetch';
import { BASE } from '../test-utils/server';

// ---------------------------------------------------------------------------
// Perform the global replace exactly as documented
// ---------------------------------------------------------------------------
const _origFetch = globalThis.fetch;
const _origHeaders = globalThis.Headers;
const _origRequest = globalThis.Request;
const _origResponse = globalThis.Response;

globalThis.fetch = nitroFetch;
globalThis.Headers = NitroHeaders;
globalThis.Request = NitroRequest;
globalThis.Response = NitroResponse;

// ---------------------------------------------------------------------------
// Headers - forEach thisArg support
// ---------------------------------------------------------------------------
describe('Global Replace - Headers forEach thisArg', () => {
  it('forEach calls callback with thisArg binding', () => {
    const h = new NitroHeaders({ 'x-key': 'value' });
    const ctx = { collected: '' };
    h.forEach(function (this: { collected: string }, value: string) {
      this.collected = value;
    }, ctx);
    expect(ctx.collected).toBe('value');
  });

  it('forEach works without thisArg', () => {
    const h = new Headers({ 'x-a': '1', 'x-b': '2' });
    const values: string[] = [];
    h.forEach((value: string) => values.push(value));
    expect(values.length).toBe(2);
  });

  it('forEach receives (value, key, headers) args', () => {
    const h = new Headers({ 'content-type': 'text/plain' });
    let receivedValue = '';
    let receivedKey = '';
    let receivedHeaders: Headers | null = null;
    h.forEach((value: string, key: string, headers: Headers) => {
      receivedValue = value;
      receivedKey = key;
      receivedHeaders = headers;
    });
    expect(receivedValue).toBe('text/plain');
    expect(receivedKey).toBe('content-type');
    expect(receivedHeaders).toBe(h);
  });
});

// ---------------------------------------------------------------------------
// Request - accepts standard Request input (pre-replace original)
// ---------------------------------------------------------------------------
describe('Global Replace - NitroRequest from standard Request', () => {
  it('constructs from a standard Request object', () => {
    const stdReq = new _origRequest('https://example.com/api', {
      method: 'POST',
      headers: { 'X-Std': 'header' },
    });
    const nitroReq = new NitroRequest(stdReq);
    expect(nitroReq.url).toBe('https://example.com/api');
    expect(nitroReq.method).toBe('POST');
    expect(nitroReq.headers.get('x-std')).toBe('header');
  });

  it('init overrides standard Request properties', () => {
    const stdReq = new _origRequest('https://example.com', { method: 'GET' });
    const nitroReq = new NitroRequest(stdReq, { method: 'PUT' });
    expect(nitroReq.method).toBe('PUT');
  });

  it('preserves standard Request headers when no init headers', () => {
    const stdReq = new _origRequest('https://example.com', {
      headers: { Authorization: 'Bearer token123' },
    });
    const nitroReq = new NitroRequest(stdReq);
    expect(nitroReq.headers.get('authorization')).toBe('Bearer token123');
  });
});

// ---------------------------------------------------------------------------
// End-to-end: use global fetch/Headers/Request/Response after replacement
// ---------------------------------------------------------------------------
describe('Global Replace - fetch() works via globalThis', () => {
  it('basic GET', async () => {
    const res = await fetch(`${BASE}/get`);
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.url).toContain('/get');
  });

  it('POST with body', async () => {
    const res = await fetch(`${BASE}/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain('/post');
  });
});

describe('Global Replace - new Headers()', () => {
  it('constructs and manipulates via globalThis.Headers', () => {
    const h = new Headers({ 'X-Global': 'test' });
    expect(h.get('x-global')).toBe('test');
    h.set('X-Another', 'value');
    expect(h.has('x-another')).toBe(true);
  });
});

describe('Global Replace - new Request()', () => {
  it('constructs via globalThis.Request', () => {
    const req = new Request('https://example.com', { method: 'DELETE' });
    expect(req.url).toBe('https://example.com');
    expect(req.method).toBe('DELETE');
  });
});

describe('Global Replace - new Response()', () => {
  it('constructs via globalThis.Response', async () => {
    const res = new Response('hello', { status: 201 });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).toBe('hello');
  });

  it('Response.json() works', async () => {
    const res = Response.json({ ok: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('Response.error() works', () => {
    const res = Response.error();
    expect(res.status).toBe(0);
    expect(res.type).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Axios via Nitro fetch adapter (docs: global-replace.md -> Axios)
// ---------------------------------------------------------------------------
const api = axios.create({
  baseURL: BASE,
  adapter: 'fetch',
  // Request/Response are null (not undefined) on purpose: axios merges env
  // with skipUndefined, so undefined would fall back to the global Request/
  // Response and re-enable the DOM-Request / stream-wrapping path. null forces
  // the plain fetch(url, options) path through Nitro. `null!` narrows to never,
  // which the optional constructor types accept without a cast.
  env: {
    fetch: nitroFetch,
    Request: null!,
    Response: null!,
  },
});

describe('Global Replace - Axios fetch adapter via Nitro', () => {
  it('GET routes through Nitro fetch', async () => {
    const res = await api.get('/get');
    expect(res.status).toBe(200);
    expect(res.data.method).toBe('GET');
    expect(res.data.url).toContain('/get');
  });

  it('serializes query params the axios way', async () => {
    const res = await api.get('/get', { params: { a: '1', b: 'two' } });
    expect(res.data.args.a).toBe('1');
    expect(res.data.args.b).toBe('two');
  });

  it('POST sends a JSON body and parses the JSON response', async () => {
    const res = await api.post('/post', { hello: 'world', n: 42 });
    expect(res.status).toBe(200);
    expect(res.data.json.hello).toBe('world');
    expect(res.data.json.n).toBe(42);
  });

  it('sends custom request headers', async () => {
    const res = await api.get('/headers', { headers: { 'X-Custom': 'nitro' } });
    expect(res.data.headers['X-Custom']).toBe('nitro');
  });

  it('exposes response headers', async () => {
    const res = await api.get('/get');
    expect(String(res.headers['content-type'])).toContain('application/json');
  });

  it('rejects on non-2xx with an AxiosError (settle semantics)', async () => {
    let threw = false;
    try {
      await api.get('/status/418');
    } catch (e: any) {
      threw = true;
      expect(axios.isAxiosError(e)).toBe(true);
      expect(e.response.status).toBe(418);
    }
    expect(threw).toBe(true);
  });

  it('honors a validateStatus override', async () => {
    const res = await api.get('/status/404', { validateStatus: () => true });
    expect(res.status).toBe(404);
  });

  it('reads an arraybuffer responseType', async () => {
    const res = await api.get('/bytes/16', { responseType: 'arraybuffer' });
    expect(res.data.byteLength).toBe(16);
  });

  it('runs request and response interceptors', async () => {
    const reqId = api.interceptors.request.use((config) => {
      config.headers.set('X-Intercepted', 'yes');
      return config;
    });
    const resId = api.interceptors.response.use((response) => {
      response.data.intercepted = true;
      return response;
    });
    try {
      const res = await api.get('/headers');
      expect(res.data.headers['X-Intercepted']).toBe('yes');
      expect(res.data.intercepted).toBe(true);
    } finally {
      api.interceptors.request.eject(reqId);
      api.interceptors.response.eject(resId);
    }
  });
});

// ---------------------------------------------------------------------------
// Cleanup: restore originals
// ---------------------------------------------------------------------------
describe('Global Replace - Cleanup', () => {
  it('restores original globals', () => {
    globalThis.fetch = _origFetch;
    globalThis.Headers = _origHeaders;
    globalThis.Request = _origRequest;
    globalThis.Response = _origResponse;
    expect(globalThis.fetch).toBe(_origFetch);
  });
});
