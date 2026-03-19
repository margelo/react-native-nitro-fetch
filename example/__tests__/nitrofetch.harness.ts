import { describe, it, expect } from 'react-native-harness';
import {
  fetch as nitroFetch,
  nitroFetchOnWorklet,
  prefetch,
} from 'react-native-nitro-fetch';
import { getRuntimeKind, RuntimeKind } from 'react-native-worklets';

const image = 'https://httpbin.org/image/jpeg';

const BASE = 'https://httpbin.org';

describe('NitroFetch - Basic GET', () => {
  it('returns status 200 and ok=true for successful GET', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.url).toContain('httpbin');
  });

  it('text() returns a non-empty string', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    const text = await res.text();
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  it('json() returns object with url property', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    const body = await res.json();
    expect(typeof body).toBe('object');
    expect(body.url).toBeDefined();
  });

  it('status 404 → ok=false, status=404', async () => {
    const res = await nitroFetch(`${BASE}/status/404`);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it('status 500 → ok=false, status=500', async () => {
    const res = await nitroFetch(`${BASE}/status/500`);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
  });

  it('clone() returns response with same status and ok', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    const cloned = res.clone();
    expect(cloned.status).toBe(res.status);
    expect(cloned.ok).toBe(res.ok);
  });
});

describe('NitroFetch - HTTP Methods', () => {
  it('POST JSON body → json().json.x === 1', async () => {
    const res = await nitroFetch(`${BASE}/post`, {
      method: 'POST',
      body: JSON.stringify({ x: 1 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await res.json();
    expect(body.json.x).toBe(1);
  });

  it('PUT → status 200', async () => {
    const res = await nitroFetch(`${BASE}/put`, {
      method: 'PUT',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
  });

  it('PATCH → status 200', async () => {
    const res = await nitroFetch(`${BASE}/patch`, {
      method: 'PATCH',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
  });

  it('DELETE → status 200', async () => {
    const res = await nitroFetch(`${BASE}/delete`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
  });
});

describe('NitroFetch - Request Body Types', () => {
  it('string body → json().data contains the string', async () => {
    const bodyString = 'hello-nitro';
    const res = await nitroFetch(`${BASE}/post`, {
      method: 'POST',
      body: bodyString,
      headers: { 'Content-Type': 'text/plain' },
    });
    const body = await res.json();
    expect(body.data).toContain(bodyString);
  });

  it('URLSearchParams body → echoed form or data', async () => {
    const params = new URLSearchParams({ foo: 'bar' });
    const res = await nitroFetch(`${BASE}/post`, {
      method: 'POST',
      body: params.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const body = await res.json();
    const hasForm = body.form && body.form.foo === 'bar';
    const hasData =
      typeof body.data === 'string' && body.data.includes('foo=bar');
    expect(hasForm || hasData).toBe(true);
  });

  it('FormData text field → json().form.user === "alice"', async () => {
    const fd = new FormData();
    fd.append('user', 'alice');
    const res = await nitroFetch(`${BASE}/post`, {
      method: 'POST',
      body: fd,
    });
    const body = await res.json();
    expect(body.form.user).toBe('alice');
  });

  it('FormData with file URI → json().files has entries', async () => {
    // Use a data URI as a synthetic file-like entry
    const fd = new FormData();
    fd.append('photo', {
      uri: image,
      type: 'image/jpeg',
      name: 'test.jpg',
    } as any);
    const res = await nitroFetch(`${BASE}/post`, {
      method: 'POST',
      body: fd,
    });
    const body = await res.json();
    expect(Object.keys(body.files).length).toBeGreaterThan(0);
  });
});

describe('NitroFetch - Response Headers', () => {
  it('custom request header echoed by httpbin', async () => {
    const res = await nitroFetch(`${BASE}/headers`, {
      headers: { 'X-Test-Header': 'nitro' },
    });
    const body = await res.json();
    expect(body.headers['X-Test-Header']).toBe('nitro');
  });

  it('headers.get("content-type") returns non-null string', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    const ct = res.headers.get('content-type');
    expect(ct).not.toBeNull();
    expect(typeof ct).toBe('string');
  });

  it('headers.get is case-insensitive', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    const lower = res.headers.get('content-type');
    const upper = res.headers.get('CONTENT-TYPE');
    expect(lower).toBe(upper);
  });

  it('headers.has("content-type") returns true', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    expect(res.headers.has('content-type')).toBe(true);
  });

  it('headers.has("x-nonexistent-header") returns false', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    expect(res.headers.has('x-nonexistent-header')).toBe(false);
  });

  it('headers.forEach iterates at least one entry', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    let count = 0;
    res.headers.forEach(() => {
      count++;
    });
    expect(count).toBeGreaterThan(0);
  });
});

describe('NitroFetch - Redirects', () => {
  it('follows redirect → redirected=true, status=200', async () => {
    const res = await nitroFetch(`${BASE}/redirect/1`);
    expect(res.redirected).toBe(true);
    expect(res.status).toBe(200);
  });
});

describe('NitroFetch - Prefetch', () => {
  it('prefetch without prefetchKey throws', async () => {
    let threw = false;
    try {
      await prefetch(`${BASE}/get`);
    } catch (e: any) {
      threw = true;
      expect(e.message).toContain('prefetchKey');
    }
    expect(threw).toBe(true);
  });

  it('prefetch with prefetchKey in headers resolves without error', async () => {
    await prefetch(`${BASE}/get`, {
      headers: { prefetchKey: 'test-key-headers' },
    });
  });

  it('prefetch with init.prefetchKey resolves without error', async () => {
    await prefetch(`${BASE}/get`, { prefetchKey: 'test-key-init' } as any);
  });
});

describe('NitroFetch - AbortController', () => {
  it('pre-aborted signal throws AbortError synchronously', async () => {
    const controller = new AbortController();
    controller.abort();
    let threw = false;
    try {
      await nitroFetch(`${BASE}/get`, { signal: controller.signal });
    } catch (e: any) {
      threw = true;
      expect(e.name).toBe('AbortError');
    }
    expect(threw).toBe(true);
  });

  it('abort mid-flight cancels a slow request', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const t0 = Date.now();
    let threw = false;
    try {
      await nitroFetch(`${BASE}/delay/20`, { signal: controller.signal });
    } catch (e: any) {
      threw = true;
      expect(e.name).toBe('AbortError');
    }
    const elapsed = Date.now() - t0;
    expect(threw).toBe(true);
    // Should cancel well before the 20s delay completes
    expect(elapsed).toBeLessThan(5000);
  });

  it('normal fetch with signal (not aborted) succeeds', async () => {
    const controller = new AbortController();
    const res = await nitroFetch(`${BASE}/get`, {
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
  });

  it('fetch without signal still works', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
  });
});

describe('NitroFetch - nitroFetchOnWorklet', () => {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(['bitcoin'].join(','))}&vs_currencies=usd`;
  const mapper = (payload: { bodyString?: string }) => {
    'worklet';
    const txt = payload.bodyString ?? '';
    const json = JSON.parse(txt) as Record<string, { usd: number }>;
    const entries = Object.entries(json);
    const arr = [];
    for (let i = 0; i < entries.length; ++i) {
      const entry = entries[i];
      arr.push({ id: entry[0], usd: entry[1].usd });
    }
    // Manual sort (localeCompare not available in worklets, use plain compare)
    for (let i = 0; i < arr.length - 1; ++i) {
      for (let j = i + 1; j < arr.length; ++j) {
        if (arr[i].id > arr[j].id) {
          const tmp = arr[i] as { id: string; usd: number };
          arr[i] = arr[j];
          arr[j] = tmp;
        }
      }
    }
    return { result: arr, runtimeKind: getRuntimeKind() };
  };

  it('GET with string mapper returns non-empty string', async () => {
    const { result, runtimeKind } = await nitroFetchOnWorklet(
      url,
      undefined,
      mapper,
      {
        preferBytes: false,
      }
    );
    expect(result.length).toBeGreaterThan(0);
    expect((result as any)[0].id).toBe('bitcoin');
    expect((result as any)[0].usd).toBeGreaterThan(0);
    expect(runtimeKind).toBe(RuntimeKind.Worker); // Worker Runtime only
  });
});

describe('NitroFetch - Streaming', () => {
  it('streams JSON lines from /stream/5 and produces non-empty text', async () => {
    const res = (await (nitroFetch as any)(`${BASE}/stream/5`, {
      stream: true,
    })) as any;

    const readable = res.body?.getReader?.();
    expect(readable).toBeDefined();

    const decoder =
      new (require('react-native-nitro-text-decoder').TextDecoder)();
    let aggregated = '';
    let chunks = 0;

    // Read until done, accumulating decoded text

    while (true) {
      const { done, value } = await readable.read();
      if (done) break;
      chunks++;
      if (value) {
        aggregated += decoder.decode(value, { stream: true });
      }
    }

    expect(chunks).toBeGreaterThan(0);
    expect(aggregated.length).toBeGreaterThan(0);
    // Basic sanity: each line should be valid JSON when split
    const lines = aggregated
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const first = JSON.parse(lines[0]);
    expect(typeof first).toBe('object');
  });

  it('streams bytes from /drip and accumulates total length', async () => {
    const durationSeconds = 2;
    const numBytes = 64;
    const res = (await (nitroFetch as any)(
      `${BASE}/drip?duration=${durationSeconds}&numbytes=${numBytes}&delay=0`,
      { stream: true }
    )) as any;

    const readable = res.body?.getReader?.();
    expect(readable).toBeDefined();

    let total = 0;
    let chunks = 0;

    while (true) {
      const { done, value } = await readable.read();
      if (done) break;
      chunks++;
      total += value?.byteLength ?? 0;
    }

    expect(chunks).toBeGreaterThan(0);
    expect(total).toBe(numBytes);
  });
});
