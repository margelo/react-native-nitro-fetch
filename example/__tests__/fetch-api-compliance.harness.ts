import { describe, it, expect } from 'react-native-harness';
import {
  fetch as nitroFetch,
  Headers,
  Response,
  Request,
} from 'react-native-nitro-fetch';

const BASE = 'https://httpbin.org';

describe('Headers - Construction', () => {
  it('constructs from plain object', () => {
    const h = new Headers({
      'Content-Type': 'text/plain',
      'Accept': 'application/json',
    });
    expect(h.get('content-type')).toBe('text/plain');
    expect(h.get('accept')).toBe('application/json');
  });

  it('constructs from tuple array', () => {
    const h = new Headers([
      ['x-foo', 'bar'],
      ['x-baz', 'qux'],
    ]);
    expect(h.get('x-foo')).toBe('bar');
    expect(h.get('x-baz')).toBe('qux');
  });

  it('constructs from another Headers instance', () => {
    const original = new Headers({ 'X-Custom': 'value' });
    const copy = new Headers(original);
    expect(copy.get('x-custom')).toBe('value');
  });

  it('constructs empty', () => {
    const h = new Headers();
    expect(h.has('anything')).toBe(false);
  });
});

describe('Headers - Mutation', () => {
  it('append() comma-combines values', () => {
    const h = new Headers({ Accept: 'text/html' });
    h.append('Accept', 'application/json');
    expect(h.get('accept')).toBe('text/html, application/json');
  });

  it('set() replaces existing value', () => {
    const h = new Headers({ Accept: 'text/html' });
    h.set('Accept', 'application/json');
    expect(h.get('accept')).toBe('application/json');
  });

  it('delete() removes header', () => {
    const h = new Headers({ 'X-Remove': 'yes' });
    expect(h.has('x-remove')).toBe(true);
    h.delete('X-Remove');
    expect(h.has('x-remove')).toBe(false);
  });

  it('getSetCookie() returns array of values', () => {
    const h = new Headers();
    h.append('Set-Cookie', 'a=1');
    h.append('Set-Cookie', 'b=2');
    const cookies = h.getSetCookie();
    expect(cookies.length).toBe(2);
    expect(cookies[0]).toBe('a=1');
    expect(cookies[1]).toBe('b=2');
  });
});

describe('Headers - Iteration', () => {
  it('for...of iterates entries', () => {
    const h = new Headers({ 'X-A': '1', 'X-B': '2' });
    const pairs: [string, string][] = [];
    for (const [key, value] of h) {
      pairs.push([key, value]);
    }
    expect(pairs.length).toBe(2);
  });

  it('entries() yields [key, value] pairs', () => {
    const h = new Headers({ 'X-Test': 'val' });
    const entries = Array.from(h.entries());
    expect(entries.length).toBe(1);
    expect(entries[0]![0]).toBe('x-test');
    expect(entries[0]![1]).toBe('val');
  });

  it('keys() yields header names', () => {
    const h = new Headers({ 'X-Key': 'v' });
    const keys = Array.from(h.keys());
    expect(keys.length).toBe(1);
    expect(keys[0]).toBe('x-key');
  });

  it('values() yields header values', () => {
    const h = new Headers({ 'X-Val': 'hello' });
    const values = Array.from(h.values());
    expect(values.length).toBe(1);
    expect(values[0]).toBe('hello');
  });
});

describe('Headers - Case Insensitivity', () => {
  it('get/has/set/delete are all case-insensitive', () => {
    const h = new Headers({ 'Content-Type': 'text/plain' });
    expect(h.get('content-type')).toBe('text/plain');
    expect(h.get('CONTENT-TYPE')).toBe('text/plain');
    expect(h.has('Content-Type')).toBe(true);
    h.set('CONTENT-TYPE', 'application/json');
    expect(h.get('content-type')).toBe('application/json');
    h.delete('Content-Type');
    expect(h.has('content-type')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------
describe('Response - bodyUsed tracking', () => {
  it('bodyUsed is false before consumption', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    expect(res.bodyUsed).toBe(false);
  });

  it('bodyUsed is true after text()', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    await res.text();
    expect(res.bodyUsed).toBe(true);
  });

  it('throws TypeError on re-read after text()', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    await res.text();
    let threw = false;
    try {
      await res.json();
    } catch (e: any) {
      threw = true;
      expect(e instanceof TypeError).toBe(true);
    }
    expect(threw).toBe(true);
  });

  it('bodyUsed is true after json()', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    await res.json();
    expect(res.bodyUsed).toBe(true);
  });

  it('bodyUsed is true after arrayBuffer()', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    await res.arrayBuffer();
    expect(res.bodyUsed).toBe(true);
  });
});

describe('Response - body ReadableStream', () => {
  it('body returns a ReadableStream', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    const body = res.body;
    expect(body).not.toBeNull();
    expect(typeof (body as any).getReader).toBe('function');
  });

  it('body reader yields data', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    const reader = res.body!.getReader();
    const { done, value } = await reader.read();
    expect(done).toBe(false);
    expect(value).toBeDefined();
    expect(value!.byteLength).toBeGreaterThan(0);
    // Drain remaining
    while (true) {
      const r = await reader.read();
      if (r.done) break;
    }
  });
});

describe('Response - blob() and bytes()', () => {
  it('blob() returns Blob with correct size', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    const blob = await res.blob();
    expect(blob instanceof Blob).toBe(true);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('bytes() returns Uint8Array', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    const bytes = await res.bytes();
    expect(bytes instanceof Uint8Array).toBe(true);
    expect(bytes.length).toBeGreaterThan(0);
  });
});

describe('Response - type property', () => {
  it('normal response has type "basic"', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    expect((res as any).type).toBe('basic');
  });

  it('Response.error() has type "error"', () => {
    const r = Response.error();
    expect(r.type).toBe('error');
  });
});

describe('Response - static methods', () => {
  it('Response.error() returns status 0', () => {
    const r = Response.error();
    expect(r.status).toBe(0);
    expect(r.ok).toBe(false);
  });

  it('Response.json() creates response with JSON body and content-type', async () => {
    const r = Response.json({ hello: 'world' });
    expect(r.status).toBe(200);
    expect(r.ok).toBe(true);
    expect(r.headers.get('content-type')).toBe('application/json');
    const body = await r.json();
    expect(body.hello).toBe('world');
  });

  it('Response.json() respects custom status', async () => {
    const r = Response.json({ err: true }, { status: 400 });
    expect(r.status).toBe(400);
    expect(r.ok).toBe(false);
  });

  it('Response.redirect() sets Location header', () => {
    const r = Response.redirect('https://example.com', 302);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://example.com');
  });

  it('Response.redirect() throws for invalid status', () => {
    let threw = false;
    try {
      Response.redirect('https://example.com', 200);
    } catch (e: any) {
      threw = true;
      expect(e instanceof RangeError).toBe(true);
    }
    expect(threw).toBe(true);
  });
});

describe('Response - clone()', () => {
  it('clone() before consumption works', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    const cloned = res.clone();
    const text1 = await res.text();
    const text2 = await cloned.text();
    expect(text1).toBe(text2);
  });

  it('clone() after consumption throws TypeError', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    await res.text();
    let threw = false;
    try {
      res.clone();
    } catch (e: any) {
      threw = true;
      expect(e instanceof TypeError).toBe(true);
    }
    expect(threw).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------
describe('Request - Construction', () => {
  it('constructs from string URL', () => {
    const req = new Request('https://example.com/api');
    expect(req.url).toBe('https://example.com/api');
    expect(req.method).toBe('GET');
  });

  it('constructs with init overrides', () => {
    const req = new Request('https://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(req.method).toBe('POST');
    expect(req.headers.get('content-type')).toBe('application/json');
  });

  it('constructs from another Request', () => {
    const original = new Request('https://example.com', {
      method: 'PUT',
      headers: { 'X-Custom': 'value' },
    });
    const copy = new Request(original);
    expect(copy.url).toBe('https://example.com');
    expect(copy.method).toBe('PUT');
    expect(copy.headers.get('x-custom')).toBe('value');
  });

  it('init overrides Request properties', () => {
    const original = new Request('https://example.com', { method: 'PUT' });
    const modified = new Request(original, { method: 'DELETE' });
    expect(modified.method).toBe('DELETE');
  });
});

describe('Request - Properties', () => {
  it('method defaults to GET and is uppercased', () => {
    const req = new Request('https://example.com');
    expect(req.method).toBe('GET');
  });

  it('headers is a Headers instance', () => {
    const req = new Request('https://example.com', {
      headers: { 'X-Test': 'val' },
    });
    expect(typeof req.headers.get).toBe('function');
    expect(req.headers.get('x-test')).toBe('val');
  });

  it('redirect defaults to "follow"', () => {
    const req = new Request('https://example.com');
    expect(req.redirect).toBe('follow');
  });
});

describe('Request - Body', () => {
  it('text() returns body string', async () => {
    const req = new Request('https://example.com', {
      method: 'POST',
      body: 'hello',
    });
    const text = await req.text();
    expect(text).toBe('hello');
    expect(req.bodyUsed).toBe(true);
  });

  it('json() parses body', async () => {
    const req = new Request('https://example.com', {
      method: 'POST',
      body: JSON.stringify({ x: 1 }),
    });
    const body = await req.json();
    expect(body.x).toBe(1);
  });

  it('clone() works before body consumption', () => {
    const req = new Request('https://example.com', {
      method: 'POST',
      body: 'test',
    });
    const cloned = req.clone();
    expect(cloned.url).toBe(req.url);
    expect(cloned.method).toBe(req.method);
  });
});

describe('Request - Integration with fetch()', () => {
  it('fetch() accepts Request object', async () => {
    const req = new Request(`${BASE}/get`);
    const res = await nitroFetch(req as any);
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
  });

  it('fetch() init overrides Request properties', async () => {
    const req = new Request(`${BASE}/post`, { method: 'GET' });
    const res = await nitroFetch(req as any, {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain('/post');
  });
});

// ---------------------------------------------------------------------------
// redirect option
// ---------------------------------------------------------------------------
describe('Fetch - redirect option', () => {
  it('"follow" follows redirect (default)', async () => {
    const res = await nitroFetch(`${BASE}/redirect/1`);
    expect(res.status).toBe(200);
    expect(res.redirected).toBe(true);
  });

  it('"error" throws TypeError on redirect', async () => {
    let threw = false;
    try {
      await nitroFetch(`${BASE}/redirect/1`, { redirect: 'error' } as any);
    } catch (e: any) {
      threw = true;
      expect(e instanceof TypeError).toBe(true);
    }
    expect(threw).toBe(true);
  });

  it('"manual" returns 3xx response with Location header', async () => {
    const res = await nitroFetch(`${BASE}/redirect/1`, {
      redirect: 'manual',
    } as any);
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('location')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cache option
// ---------------------------------------------------------------------------
describe('Fetch - cache option', () => {
  it('"no-store" sends Cache-Control: no-store header', async () => {
    const res = await nitroFetch(`${BASE}/headers`, {
      cache: 'no-store',
    } as any);
    const body = await res.json();
    const cc =
      body.headers['Cache-Control'] || body.headers['cache-control'] || '';
    expect(cc).toContain('no-store');
  });

  it('"no-cache" sends Cache-Control: no-cache header', async () => {
    const res = await nitroFetch(`${BASE}/headers`, {
      cache: 'no-cache',
    } as any);
    const body = await res.json();
    const cc =
      body.headers['Cache-Control'] || body.headers['cache-control'] || '';
    expect(cc).toContain('no-cache');
  });

  it('"reload" sends Cache-Control + Pragma headers', async () => {
    const res = await nitroFetch(`${BASE}/headers`, { cache: 'reload' } as any);
    const body = await res.json();
    const cc =
      body.headers['Cache-Control'] || body.headers['cache-control'] || '';
    const pragma = body.headers.Pragma || body.headers.pragma || '';
    expect(cc).toContain('no-cache');
    expect(pragma).toContain('no-cache');
  });
});

// ---------------------------------------------------------------------------
// Response public constructor — new Response(body, init)
// ---------------------------------------------------------------------------
describe('Response - Public Constructor', () => {
  it('new Response() creates empty 200 response', () => {
    const r = new Response();
    expect(r.status).toBe(200);
    expect(r.ok).toBe(true);
    expect(r.statusText).toBe('');
    expect(r.url).toBe('');
    expect(r.redirected).toBe(false);
    expect(r.type).toBe('default');
  });

  it('new Response(string) sets body', async () => {
    const r = new Response('hello world');
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toBe('hello world');
  });

  it('new Response(null) creates no-body response', async () => {
    const r = new Response(null);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toBe('');
  });

  it('new Response(body, { status }) sets status', () => {
    const r = new Response(null, { status: 404 });
    expect(r.status).toBe(404);
    expect(r.ok).toBe(false);
  });

  it('new Response(body, { status: 204 }) is ok', () => {
    const r = new Response(null, { status: 204 });
    expect(r.ok).toBe(true);
  });

  it('new Response(body, { statusText }) sets statusText', () => {
    const r = new Response(null, { status: 404, statusText: 'Not Found' });
    expect(r.statusText).toBe('Not Found');
  });

  it('new Response(body, { headers }) sets headers', () => {
    const r = new Response('data', {
      headers: { 'X-Custom': 'test', 'Content-Type': 'text/plain' },
    });
    expect(r.headers.get('x-custom')).toBe('test');
    expect(r.headers.get('content-type')).toBe('text/plain');
  });

  it('new Response(json string) with json() works', async () => {
    const r = new Response(JSON.stringify({ a: 1, b: 2 }), {
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await r.json();
    expect(body.a).toBe(1);
    expect(body.b).toBe(2);
  });

  it('new Response(string).arrayBuffer() works', async () => {
    const r = new Response('test');
    const ab = await r.arrayBuffer();
    expect(ab.byteLength).toBe(4);
  });

  it('new Response(string).bytes() works', async () => {
    const r = new Response('test');
    const bytes = await r.bytes();
    expect(bytes instanceof Uint8Array).toBe(true);
    expect(bytes.length).toBe(4);
  });

  it('new Response(string).clone() works', async () => {
    const r = new Response('clone me');
    const cloned = r.clone();
    const t1 = await r.text();
    const t2 = await cloned.text();
    expect(t1).toBe('clone me');
    expect(t2).toBe('clone me');
  });

  it('bodyUsed tracking works on public constructor', async () => {
    const r = new Response('body');
    expect(r.bodyUsed).toBe(false);
    await r.text();
    expect(r.bodyUsed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Headers sorted iteration order
// ---------------------------------------------------------------------------
describe('Headers - Sorted Iteration', () => {
  it('keys() yields in alphabetical order', () => {
    const h = new Headers({
      'z-header': '1',
      'a-header': '2',
      'm-header': '3',
    });
    const keys = Array.from(h.keys());
    expect(keys[0]).toBe('a-header');
    expect(keys[1]).toBe('m-header');
    expect(keys[2]).toBe('z-header');
  });

  it('entries() yields in alphabetical order by key', () => {
    const h = new Headers({ 'x-beta': 'b', 'x-alpha': 'a' });
    const entries = Array.from(h.entries());
    expect(entries[0]![0]).toBe('x-alpha');
    expect(entries[0]![1]).toBe('a');
    expect(entries[1]![0]).toBe('x-beta');
    expect(entries[1]![1]).toBe('b');
  });

  it('values() yields in alphabetical key order', () => {
    const h = new Headers({
      'c-hdr': 'third',
      'a-hdr': 'first',
      'b-hdr': 'second',
    });
    const values = Array.from(h.values());
    expect(values[0]).toBe('first');
    expect(values[1]).toBe('second');
    expect(values[2]).toBe('third');
  });

  it('forEach() iterates in alphabetical order', () => {
    const h = new Headers({ 'z-key': 'z', 'a-key': 'a' });
    const order: string[] = [];
    h.forEach((_val: string, key: string) => order.push(key));
    expect(order[0]).toBe('a-key');
    expect(order[1]).toBe('z-key');
  });

  it('[Symbol.iterator] yields in alphabetical order', () => {
    const h = new Headers({ delta: '4', alpha: '1', charlie: '3', bravo: '2' });
    const keys: string[] = [];
    for (const [key] of h) {
      keys.push(key);
    }
    expect(keys).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
  });
});

// ---------------------------------------------------------------------------
// Blob request body
// ---------------------------------------------------------------------------
describe('Fetch - Blob request body', () => {
  it('sends Blob body as string in POST', async () => {
    const blob = new Blob(['hello from blob'], { type: 'text/plain' });
    const res = await nitroFetch(`${BASE}/post`, {
      method: 'POST',
      body: blob,
    });
    const body = await res.json();
    expect(body.data).toContain('hello from blob');
  });

  it('sends Blob body with JSON content', async () => {
    const json = JSON.stringify({ blob: true });
    const blob = new Blob([json], { type: 'application/json' });
    const res = await nitroFetch(`${BASE}/post`, {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await res.json();
    const parsed = JSON.parse(body.data);
    expect(parsed.blob).toBe(true);
  });
});
