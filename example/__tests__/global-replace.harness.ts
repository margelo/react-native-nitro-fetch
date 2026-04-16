import { describe, it, expect } from 'react-native-harness';
import {
  fetch as nitroFetch,
  Headers as NitroHeaders,
  Request as NitroRequest,
  Response as NitroResponse,
} from 'react-native-nitro-fetch';

const BASE = 'https://httpbin.org';

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
