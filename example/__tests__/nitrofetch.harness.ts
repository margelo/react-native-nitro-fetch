import { describe, it, expect } from 'react-native-harness';
import {
  fetch as nitroFetch,
  NitroFetch,
  nitroFetchOnWorklet,
  prefetch,
  prefetchOnAppStart,
  removeFromAutoPrefetch,
  __readAutoPrefetchQueue,
  XMLHttpRequest as NitroXMLHttpRequest,
} from 'react-native-nitro-fetch';
import { Platform } from 'react-native';
import { getRuntimeKind, RuntimeKind } from 'react-native-worklets';
import { BASE, OTHER_ORIGIN } from '../test-utils/server';

const image = `${BASE}/image/jpeg`;

const blockJsThread = (ms: number) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {}
};

const abortWith = (controller: AbortController, reason?: unknown) => {
  if (reason !== undefined) {
    Object.defineProperty(controller.signal, 'reason', { value: reason });
  }
  controller.abort();
};

const timeoutReason = () => {
  const reason = new Error('signal timed out');
  reason.name = 'TimeoutError';
  return reason;
};

type NitroXMLHttpRequestInstance = InstanceType<typeof NitroXMLHttpRequest>;

// Sends a GET; `done` resolves on load. `setUp` runs between open() and
// send(), where headers and listeners can be set.
const sendXMLHttpRequest = (
  url: string,
  setUp?: (xhr: NitroXMLHttpRequestInstance) => void
) => {
  const xhr = new NitroXMLHttpRequest();
  const done = new Promise<void>((resolve, reject) => {
    xhr.onload = () => resolve();
    xhr.onerror = () => reject(new Error('XMLHttpRequest failed'));
  });
  xhr.open('GET', url);
  setUp?.(xhr);
  xhr.send();
  return { xhr, done };
};

// SuperAgent adds this listener to every request.
const watchLikeSuperAgent = (xhr: NitroXMLHttpRequestInstance) => {
  xhr.addEventListener('readystatechange', () => {});
};

const abortAfterNativeDone = async (
  init?: Record<string, unknown>,
  reason?: unknown
) => {
  const controller = new AbortController();
  const pending = (nitroFetch as any)(`${BASE}/delay/1`, {
    ...init,
    signal: controller.signal,
  });
  await new Promise((r) => setTimeout(r, 100));
  blockJsThread(2000);
  abortWith(controller, reason);
  return Promise.race([
    pending.then(
      () => 'resolved',
      (e: any) => e?.name ?? 'rejected'
    ),
    new Promise((r) => setTimeout(() => r('hung'), 3000)),
  ]);
};

describe('NitroFetch - Native registerPrefetch', () => {
  const NP_URL = `${BASE}/anything/native-prefetch-test`;
  const NP_KEY = 'harness-native-prefetch';

  it('serves a cache hit on the first JS fetch (first-run prefetching)', async () => {
    // The native registration in AppDelegate / MainApplication uses a long
    // prefetchCacheTtlMs (300s) so the cache survives well past app launch;
    // pass the same TTL here so the cache-hit lookup uses the matching window.
    const res = await nitroFetch(NP_URL, {
      headers: { prefetchKey: NP_KEY },
      prefetchCacheTtlMs: 300_000,
    } as any);
    expect(res.ok).toBe(true);
    expect(res.headers.get('nitroPrefetched')).toBe('true');
  });

  it('replays a natively-registered binary body byte-exact on cold start', async () => {
    // The cold-start replay runs before Nitro exists, so the bytes travel as base64
    // and are decoded natively. AppDelegate / MainApplication register [0,127,128,255,254].
    const res = await nitroFetch(`${BASE}/post`, {
      method: 'POST',
      body: new Uint8Array([0, 127, 128, 255, 254]),
      headers: {
        'Content-Type': 'application/octet-stream',
        'prefetchKey': 'harness-native-prefetch-binary',
      },
      prefetchCacheTtlMs: 300_000,
    } as any);
    expect(res.ok).toBe(true);
    expect(res.headers.get('nitroPrefetched')).toBe('true');
    const json = (await res.json()) as any;
    expect(json.dataBase64).toBe('AH+A//4=');
  });

  it('removeFromAutoPrefetch deletes the natively-registered entry', async () => {
    // Native registration shares storage with JS prefetchOnAppStart, so
    // removeFromAutoPrefetch is the canonical removal API for both paths.
    await removeFromAutoPrefetch(NP_KEY);
    await removeFromAutoPrefetch('harness-native-prefetch-binary');
  });
});

describe('NitroFetch - Prefetch cache TTL', () => {
  it('custom TTL keeps the prefetch fresh past the 5s default', async () => {
    // Unique per-run key + URL so we never collide with a previous app session.
    const STAMP = String(Date.now());
    const KEY = 'ttl-long-' + STAMP;
    const URL = `${BASE}/anything/ttl-test-${STAMP}`;
    await prefetch(URL, {
      headers: { prefetchKey: KEY },
      prefetchCacheTtlMs: 60_000,
    } as any);
    // Wait past the default 5s window (giving the prefetch ample time to land).
    // 8s exceeds the 5s default; the 60s TTL keeps the entry fresh.
    await new Promise((r) => setTimeout(r, 8_000));
    const res = await nitroFetch(URL, {
      headers: { prefetchKey: KEY },
      prefetchCacheTtlMs: 60_000,
    } as any);
    expect(res.ok).toBe(true);
    expect(res.headers.get('nitroPrefetched')).toBe('true');
  });

  it('prefetchOnAppStart persists prefetchCacheTtlMs into the queue', async () => {
    const KEY = 'pf-ttl-persisted';
    await prefetchOnAppStart(`${BASE}/get`, {
      prefetchKey: KEY,
      prefetchCacheTtlMs: 12_345,
    } as any);
    const entry = __readAutoPrefetchQueue().find(
      (e: any) => e?.prefetchKey === KEY
    );
    expect(entry).toBeDefined();
    expect(entry!.prefetchCacheTtlMs).toBe(12_345);
    await removeFromAutoPrefetch(KEY);
  });

  it('omitting prefetchCacheTtlMs leaves the queue entry without the field', async () => {
    const KEY = 'pf-ttl-omitted';
    await prefetchOnAppStart(`${BASE}/get`, {
      prefetchKey: KEY,
    } as any);
    const entry = __readAutoPrefetchQueue().find(
      (e: any) => e?.prefetchKey === KEY
    );
    expect(entry).toBeDefined();
    expect(entry!.prefetchCacheTtlMs).toBeUndefined();
    await removeFromAutoPrefetch(KEY);
  });
});

describe('NitroFetch - Basic GET', () => {
  it('returns status 200 and ok=true for successful GET', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.url).toContain('/get');
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

describe('NitroFetch - Response charset', () => {
  for (const value of ['iso-8859-1', 'ISO-8859-1', '"iso-8859-1"']) {
    it(`decodes a body declared as charset=${value}`, async () => {
      const res = await nitroFetch(
        `${BASE}/charset/${encodeURIComponent(value)}`
      );
      expect(await res.text()).toBe('café crème');
    });
  }
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
  it('custom request header echoed by the server', async () => {
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

describe('NitroFetch - Response bodies', () => {
  const MIXED = 'Zürich 日本語 данные 😀 ';
  const CJK = '日本語のテキストを読む。';

  const textUrl = (phrase: string, repeat: number, query = '') =>
    `${BASE}/text?phrase=${encodeURIComponent(phrase)}&repeat=${repeat}${query}`;

  const firstDifference = (a: string, b: string) => {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a.charCodeAt(i) !== b.charCodeAt(i)) return i;
    }
    return a.length === b.length ? -1 : n;
  };

  const firstByteMismatch = (
    bytes: Uint8Array,
    expected: (i: number) => number
  ) => {
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] !== expected(i)) return i;
    }
    return -1;
  };

  it('HEAD with a Content-Length has an empty body', async () => {
    const res = await nitroFetch(`${BASE}/bytes/1000000`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('1000000');
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it('304 with a Content-Length has an empty body', async () => {
    const res = await nitroFetch(`${BASE}/not-modified`);
    expect(res.status).toBe(304);
    expect(res.headers.get('content-length')).toBe('1000000');
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it('reads a gzip body much larger than its Content-Length', async () => {
    const res = await nitroFetch(textUrl(MIXED, 20000, '&gzip=1'));
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(firstDifference(await res.text(), MIXED.repeat(20000))).toBe(-1);
  });

  it('reads a chunked body without a Content-Length', async () => {
    const res = await nitroFetch(textUrl(MIXED, 20000, '&chunked=1'));
    expect(res.headers.get('content-length')).toBe(null);
    expect(firstDifference(await res.text(), MIXED.repeat(20000))).toBe(-1);
  });

  it('reads a body larger than 1 MB byte-exact', async () => {
    const n = 3 * 1024 * 1024 + 7;
    const res = await nitroFetch(`${BASE}/bytes/${n}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(n);
    expect(firstByteMismatch(bytes, (i) => i % 256)).toBe(-1);
  });

  it('decodes CJK text natively', async () => {
    const expected = CJK.repeat(20000);
    const raw = await NitroFetch.createClient().request({
      url: textUrl(CJK, 20000),
    });
    expect(raw.bodyBytes).toBe(undefined);
    expect(firstDifference(raw.bodyString ?? '', expected)).toBe(-1);
    const res = await nitroFetch(textUrl(CJK, 20000));
    expect(firstDifference(await res.text(), expected)).toBe(-1);
  });

  it('hands invalid UTF-8 to JS as exact bytes', async () => {
    for (const tail of [
      'eda080',
      'c0af',
      '80',
      'e381',
      'e38141',
      'f4908080',
      'f5808080',
    ]) {
      const url = textUrl('abc', 1000, `&invalid=${tail}`);
      const tailBytes = tail.match(/../g)!.map((h) => parseInt(h, 16));
      const expected = (i: number) =>
        i < 3000 ? 97 + (i % 3) : tailBytes[i - 3000]!;
      const raw = await NitroFetch.createClient().request({ url });
      expect(raw.bodyString).toBe(undefined);
      const rawBytes = new Uint8Array(raw.bodyBytes!);
      expect(rawBytes.length).toBe(3000 + tailBytes.length);
      expect(firstByteMismatch(rawBytes, expected)).toBe(-1);
      const res = await nitroFetch(url);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes.length).toBe(3000 + tailBytes.length);
      expect(firstByteMismatch(bytes, expected)).toBe(-1);
    }
  });

  it('decodes text in the charset the Content-Type declares', async () => {
    const phrase = 'café crème brûlée ';
    const res = await nitroFetch(textUrl(phrase, 100, '&charset=iso-8859-1'));
    expect(await res.text()).toBe(phrase.repeat(100));
  });

  it('completes 50 concurrent requests with their own bodies', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, async (_, i) => {
        const phrase = `r${i};`;
        const repeat = 1 + ((i * 7919) % 40000);
        const res = await nitroFetch(textUrl(phrase, repeat));
        return firstDifference(await res.text(), phrase.repeat(repeat));
      })
    );
    expect(results.filter((d) => d !== -1)).toEqual([]);
  });
});

describe('NitroFetch - Cross-origin redirects', () => {
  const redirectTo = (url: string, status = 302) =>
    `${BASE}/redirect-to?status=${status}&url=${encodeURIComponent(url)}`;

  it('drops Authorization when a redirect leaves the origin', async () => {
    const res = await nitroFetch(redirectTo(`${OTHER_ORIGIN}/headers`), {
      headers: { Authorization: 'Bearer secret' },
    });
    const json = await res.json();
    expect(res.redirected).toBe(true);
    expect(json.headers.Authorization).toBe(undefined);
  });

  it('drops Authorization on a cross-origin 307 that keeps the body', async () => {
    const res = await nitroFetch(redirectTo(`${OTHER_ORIGIN}/anything`, 307), {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer secret',
        'Content-Type': 'text/plain',
      },
      body: 'payload',
    });
    const json = await res.json();
    expect(json.method).toBe('POST');
    expect(json.data).toBe('payload');
    expect(json.headers.Authorization).toBe(undefined);
  });

  it('resends a byte body without Authorization on a cross-origin 307', async () => {
    const res = await nitroFetch(redirectTo(`${OTHER_ORIGIN}/anything`, 307), {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
      body: new Uint8Array([0, 127, 128, 255, 254]),
    });
    const json = await res.json();
    expect(json.method).toBe('POST');
    expect(json.dataLength).toBe(5);
    expect(json.dataBase64).toBe('AH+A//4=');
    expect(json.headers.Authorization).toBe(undefined);
  });

  const itAndroid = Platform.OS === 'android' ? it : it.skip;

  itAndroid('keeps Authorization on a same-origin redirect', async () => {
    const res = await nitroFetch(redirectTo(`${BASE}/headers`), {
      headers: { Authorization: 'Bearer secret' },
    });
    const json = await res.json();
    expect(json.headers.Authorization).toBe('Bearer secret');
  });

  itAndroid('keeps Authorization when a same-origin URL has a |', async () => {
    const res = await nitroFetch(redirectTo(`${BASE}/headers?q=a|b`), {
      headers: { Authorization: 'Bearer secret' },
    });
    const json = await res.json();
    expect(json.headers.Authorization).toBe('Bearer secret');
  });
});

describe('NitroFetch - Redirects', () => {
  it('follows redirect → redirected=true, status=200', async () => {
    const res = await nitroFetch(`${BASE}/redirect/1`);
    expect(res.redirected).toBe(true);
    expect(res.status).toBe(200);
  });
});

describe('NitroFetch - Streaming redirects', () => {
  function withTimeout<T>(promise: Promise<T>, ms = 5_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out after ${ms} ms`)),
        ms
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  it('stream: true follows redirects and reports redirected', async () => {
    const res = await withTimeout<any>(
      (nitroFetch as any)(`${BASE}/redirect/2`, { stream: true })
    );
    expect(res.status).toBe(200);
    expect(res.redirected).toBe(true);
    const json = JSON.parse(await withTimeout<string>(res.text()));
    expect(json.url).toContain('/get');
  });

  it("stream: true rejects a redirect with a TypeError when redirect is 'error'", async () => {
    let error: any;
    try {
      await withTimeout(
        (nitroFetch as any)(`${BASE}/redirect/1`, {
          stream: true,
          redirect: 'error',
        })
      );
    } catch (e) {
      error = e;
    }
    expect(error?.name).toBe('TypeError');
  });

  it("stream: true returns the 3xx response when redirect is 'manual'", async () => {
    const res = await withTimeout<any>(
      (nitroFetch as any)(`${BASE}/redirect/1`, {
        stream: true,
        redirect: 'manual',
      })
    );
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.redirected).toBe(false);
    expect(res.headers.get('location')).not.toBeNull();
    expect(await withTimeout<string>(res.text())).toBe('');
  });
});

describe('NitroFetch - HTTP cache', () => {
  const cacheId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const cacheReport = async (id: string) =>
    (await nitroFetch(`${BASE}/cache-report/${id}`)).json();

  it('serves a fresh max-age response from the cache', async () => {
    const id = cacheId();
    const url = `${BASE}/cache/${id}?maxAge=60`;
    const first = await (await nitroFetch(url)).json();
    const second = await (await nitroFetch(url)).json();
    expect(second).toEqual(first);
    expect(await cacheReport(id)).toEqual({ requests: 1, conditional: 0 });
  });

  it('revalidates with If-None-Match and reuses the cached body on 304', async () => {
    const id = cacheId();
    const url = `${BASE}/cache/${id}`;
    const first = await (await nitroFetch(url)).json();
    const res = await nitroFetch(url);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(first);
    expect(await cacheReport(id)).toEqual({ requests: 2, conditional: 1 });
  });

  // A watched XMLHttpRequest runs on the default client, so the two share one
  // cache.
  it('a watched XMLHttpRequest is served from what the default transport cached', async () => {
    const id = cacheId();
    const url = `${BASE}/cache/${id}?maxAge=60`;
    const first = await (await nitroFetch(url)).text();
    const { xhr, done } = sendXMLHttpRequest(url, watchLikeSuperAgent);
    await done;
    expect(xhr.responseText).toBe(first);
    expect(await cacheReport(id)).toEqual({ requests: 1, conditional: 0 });
  });

  it('the default transport is served from what a watched XMLHttpRequest cached', async () => {
    const id = cacheId();
    const url = `${BASE}/cache/${id}?maxAge=60`;
    const { xhr, done } = sendXMLHttpRequest(url, watchLikeSuperAgent);
    await done;
    expect(await (await nitroFetch(url)).text()).toBe(xhr.responseText);
    expect(await cacheReport(id)).toEqual({ requests: 1, conditional: 0 });
  });
});

describe('NitroFetch - prefetchOnAppStart persists method + body', () => {
  const findEntry = (key: string) =>
    __readAutoPrefetchQueue().find((e: any) => e?.prefetchKey === key);

  it('POST + string body round-trips through the queue', async () => {
    const KEY = 'pf-post-string';
    await prefetchOnAppStart(`${BASE}/post`, {
      method: 'POST',
      body: 'hello',
      prefetchKey: KEY,
    } as any);
    const entry = findEntry(KEY);
    expect(entry).toBeDefined();
    expect(entry!.method).toBe('POST');
    expect(entry!.bodyString).toBe('hello');
    expect(entry!.bodyFormData).toBeUndefined();
    await removeFromAutoPrefetch(KEY);
  });

  it('POST + JSON body round-trips through the queue with Content-Type', async () => {
    const KEY = 'pf-post-json';
    const payload = { user: 'alice', count: 42 };
    await prefetchOnAppStart(`${BASE}/post`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
        'prefetchKey': KEY,
      },
    });
    const entry = findEntry(KEY);
    expect(entry).toBeDefined();
    expect(entry!.method).toBe('POST');
    expect(entry!.bodyString).toBe(JSON.stringify(payload));
    const ct = Object.entries(entry!.headers as Record<string, string>).find(
      ([k]) => k.toLowerCase() === 'content-type'
    );
    expect(ct).toBeDefined();
    expect(ct![1]).toBe('application/json');
    await removeFromAutoPrefetch(KEY);
  });

  it('POST + FormData round-trips through the queue', async () => {
    const KEY = 'pf-post-fd';
    const fd = new FormData();
    fd.append('user', 'alice');
    fd.append('msg', 'hi');
    await prefetchOnAppStart(`${BASE}/post`, {
      method: 'POST',
      body: fd,
      prefetchKey: KEY,
    } as any);
    const entry = findEntry(KEY);
    expect(entry).toBeDefined();
    expect(entry!.method).toBe('POST');
    expect(Array.isArray(entry!.bodyFormData)).toBe(true);
    expect(entry!.bodyFormData.length).toBe(2);
    const userPart = entry!.bodyFormData.find((p: any) => p.name === 'user');
    expect(userPart).toBeDefined();
    expect(userPart.value).toBe('alice');
    await removeFromAutoPrefetch(KEY);
  });

  it('POST + ArrayBuffer body persists as base64 and uploads byte-exact', async () => {
    const KEY = 'pf-post-bytes';
    const bytes = new Uint8Array([0, 127, 128, 255, 254]);
    await prefetchOnAppStart(`${BASE}/post`, {
      method: 'POST',
      body: bytes,
      headers: {
        'Content-Type': 'application/octet-stream',
        'prefetchKey': KEY,
      },
    });
    const entry = findEntry(KEY);
    expect(entry).toBeDefined();
    expect(entry!.method).toBe('POST');
    expect(entry!.bodyBytesBase64).toBe('AH+A//4=');
    expect(entry!.bodyString).toBeUndefined();

    await prefetch(`${BASE}/post`, {
      method: 'POST',
      body: bytes,
      headers: {
        'Content-Type': 'application/octet-stream',
        'prefetchKey': KEY,
      },
    } as any);
    const res = await nitroFetch(`${BASE}/post`, {
      method: 'POST',
      body: bytes,
      headers: {
        'Content-Type': 'application/octet-stream',
        'prefetchKey': KEY,
      },
    });
    const json = (await res.json()) as any;
    expect(json.dataBase64).toBe('AH+A//4=');
    await removeFromAutoPrefetch(KEY);
  });

  it('GET (default) omits method/body from entry', async () => {
    const KEY = 'pf-get-default';
    await prefetchOnAppStart(`${BASE}/get`, { prefetchKey: KEY });
    const entry = findEntry(KEY);
    expect(entry).toBeDefined();
    expect(entry!.method).toBeUndefined();
    expect(entry!.bodyString).toBeUndefined();
    expect(entry!.bodyFormData).toBeUndefined();
    await removeFromAutoPrefetch(KEY);
  });

  it('redirect=error persists followRedirects=false', async () => {
    const KEY = 'pf-noredir';
    await prefetchOnAppStart(`${BASE}/get`, {
      prefetchKey: KEY,
      redirect: 'error',
    } as any);
    const entry = findEntry(KEY);
    expect(entry).toBeDefined();
    expect(entry!.followRedirects).toBe(false);
    await removeFromAutoPrefetch(KEY);
  });

  it('redirect=follow (default) omits followRedirects', async () => {
    const KEY = 'pf-yesredir';
    await prefetchOnAppStart(`${BASE}/get`, { prefetchKey: KEY });
    const entry = findEntry(KEY);
    expect(entry).toBeDefined();
    expect(entry!.followRedirects).toBeUndefined();
    await removeFromAutoPrefetch(KEY);
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

  it('abort after native has finished still rejects', async () => {
    expect(await abortAfterNativeDone()).toBe('AbortError');
  });

  it('pre-aborted signal rejects with signal.reason', async () => {
    const controller = new AbortController();
    const reason = timeoutReason();
    abortWith(controller, reason);
    let error: unknown;
    try {
      await nitroFetch(`${BASE}/get`, { signal: controller.signal });
    } catch (e) {
      error = e;
    }
    expect(error).toBe(reason);
  });

  it('abort mid-flight rejects with signal.reason', async () => {
    const controller = new AbortController();
    const reason = timeoutReason();
    setTimeout(() => abortWith(controller, reason), 100);
    let error: unknown;
    try {
      await nitroFetch(`${BASE}/delay/20`, { signal: controller.signal });
    } catch (e) {
      error = e;
    }
    expect(error).toBe(reason);
  });

  it('abort after native has finished rejects with signal.reason', async () => {
    expect(await abortAfterNativeDone(undefined, timeoutReason())).toBe(
      'TimeoutError'
    );
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

describe('NitroFetch - timeoutMs', () => {
  // iOS reports NSURLErrorTimedOut; on Android the library cancels the Cronet request.
  const timeoutError =
    Platform.OS === 'ios' ? /NSURLErrorDomain Code=-1001/ : /timed out/;
  const expectTimeout = async (run: () => Promise<unknown>) => {
    const t0 = Date.now();
    let error: any;
    try {
      await run();
    } catch (e) {
      error = e;
    }
    const elapsed = Date.now() - t0;
    expect(error).toBeDefined();
    expect(String(error?.message)).toMatch(timeoutError);
    expect(elapsed).toBeGreaterThanOrEqual(1500);
    expect(elapsed).toBeLessThan(5000);
  };

  it('rejects a request slower than the timeout', async () => {
    await expectTimeout(() =>
      nitroFetch(`${BASE}/delay/6`, { timeoutMs: 2000 })
    );
  });

  it('applies the timeout on the worklet runtime', async () => {
    await expectTimeout(() =>
      nitroFetchOnWorklet(`${BASE}/delay/6`, { timeoutMs: 2000 }, (payload) => {
        'worklet';
        return payload.status;
      })
    );
  });

  it('lets a request finish when the timeout is longer than the response', async () => {
    const res = await nitroFetch(`${BASE}/delay/1`, { timeoutMs: 5000 });
    expect(res.status).toBe(200);
  });

  it('prefetchOnAppStart persists timeoutMs into the queue', async () => {
    const KEY = 'pf-timeout-persisted';
    await prefetchOnAppStart(`${BASE}/get`, {
      prefetchKey: KEY,
      timeoutMs: 12_345,
    });
    const entry = __readAutoPrefetchQueue().find(
      (e: any) => e?.prefetchKey === KEY
    );
    expect(entry).toBeDefined();
    expect(entry!.timeoutMs).toBe(12_345);
    await removeFromAutoPrefetch(KEY);
  });
});

describe('NitroFetch - priority', () => {
  const run = Date.now();
  let seq = 0;
  const unique = (path: string) => `${BASE}${path}?run=${run}&seq=${seq++}`;
  const plain = (url: string) => nitroFetch(url);
  const streamed = (url: string, priority?: 'high' | 'low' | 'auto') =>
    (nitroFetch as any)(url, { stream: true, priority });
  const itSchedules = Platform.OS === 'android' ? it : it.skip;
  const settleOrder = async (
    block: (url: string) => Promise<unknown>,
    first: () => Promise<unknown>,
    second: () => Promise<unknown>
  ) => {
    const blockers = [
      block(unique('/delay/1')),
      ...Array.from({ length: 5 }, () => block(unique('/delay/2'))),
    ];
    await new Promise((r) => setTimeout(r, 300));
    const order: string[] = [];
    await Promise.all([
      first().then(() => order.push('first')),
      second().then(() => order.push('second')),
      ...blockers,
    ]);
    return order;
  };

  it('completes plain, worklet and streamed requests with every priority', async () => {
    for (const priority of ['high', 'low', 'auto'] as const) {
      const res = await nitroFetch(unique('/get'), { priority });
      expect(res.status).toBe(200);
      const status = await nitroFetchOnWorklet(
        unique('/get'),
        { priority },
        (payload) => {
          'worklet';
          return payload.status;
        }
      );
      expect(status).toBe(200);
      const stream = await streamed(unique('/get'), priority);
      expect(stream.status).toBe(200);
      expect((await stream.text()).length).toBeGreaterThan(0);
    }
    const unknown = await nitroFetch(unique('/get'), {
      priority: 'urgent' as any,
    });
    expect(unknown.status).toBe(200);
  });

  it('serves a prefetch made with a priority from the prefetch cache', async () => {
    const url = unique('/get');
    const key = `pf-priority-${run}`;
    await prefetch(url, { headers: { prefetchKey: key }, priority: 'low' });
    const res = await nitroFetch(url, { headers: { prefetchKey: key } });
    expect(res.status).toBe(200);
    expect(res.headers.get('nitroPrefetched')).toBe('true');
  });

  itSchedules('high jumps ahead of an earlier default request', async () => {
    const order = await settleOrder(
      plain,
      () => nitroFetch(unique('/get')),
      () => nitroFetch(unique('/get'), { priority: 'high' })
    );
    expect(order).toEqual(['second', 'first']);
  });

  itSchedules(
    'a default request jumps ahead of an earlier low one',
    async () => {
      const order = await settleOrder(
        plain,
        () => nitroFetch(unique('/get'), { priority: 'low' }),
        () => nitroFetch(unique('/get'))
      );
      expect(order).toEqual(['second', 'first']);
    }
  );

  itSchedules('auto and unknown values keep request order', async () => {
    const order = await settleOrder(
      plain,
      () => nitroFetch(unique('/get'), { priority: 'urgent' as any }),
      () => nitroFetch(unique('/get'), { priority: 'auto' })
    );
    expect(order).toEqual(['first', 'second']);
  });

  itSchedules('applies priority on the worklet runtime', async () => {
    const order = await settleOrder(
      plain,
      () => nitroFetch(unique('/get')),
      () =>
        nitroFetchOnWorklet(unique('/get'), { priority: 'high' }, (payload) => {
          'worklet';
          return payload.status;
        })
    );
    expect(order).toEqual(['second', 'first']);
  });

  itSchedules('applies priority to prefetch', async () => {
    const key = `pf-priority-order-${run}`;
    const url = unique('/get');
    const order = await settleOrder(
      plain,
      () => nitroFetch(unique('/get')),
      async () => {
        await prefetch(url, {
          headers: { prefetchKey: key },
          priority: 'high',
        });
        await nitroFetch(url, { headers: { prefetchKey: key } });
      }
    );
    expect(order).toEqual(['second', 'first']);
  });

  itSchedules('applies priority to streamed requests', async () => {
    const order = await settleOrder(
      (url) => streamed(url),
      () => streamed(unique('/get')),
      () => streamed(unique('/get'), 'high')
    );
    expect(order).toEqual(['second', 'first']);
  });

  it('prefetchOnAppStart persists high and low but not auto', async () => {
    await prefetchOnAppStart(unique('/get'), {
      prefetchKey: 'pf-priority-high',
      priority: 'high',
    });
    await prefetchOnAppStart(unique('/get'), {
      prefetchKey: 'pf-priority-low',
      priority: 'low',
    });
    await prefetchOnAppStart(unique('/get'), {
      prefetchKey: 'pf-priority-auto',
      priority: 'auto',
    });
    const queue = __readAutoPrefetchQueue();
    const find = (key: string) =>
      queue.find((e: any) => e?.prefetchKey === key);
    expect(find('pf-priority-high')?.priority).toBe('high');
    expect(find('pf-priority-low')?.priority).toBe('low');
    expect(find('pf-priority-auto')).toBeDefined();
    expect(find('pf-priority-auto')?.priority).toBeUndefined();
    await removeFromAutoPrefetch('pf-priority-high');
    await removeFromAutoPrefetch('pf-priority-low');
    await removeFromAutoPrefetch('pf-priority-auto');
  });
});

describe('NitroFetch - nitroFetchOnWorklet', () => {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
    ['bitcoin'].join(',')
  )}&vs_currencies=usd`;
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

describe('NitroFetch - Streaming garbage collection', () => {
  async function streamAndRead(refs: WeakRef<object>[]) {
    const res = await (nitroFetch as any)(`${BASE}/stream/3`, {
      stream: true,
    });
    refs.push(new WeakRef(res.body));
    await res.text();
  }

  async function collectGarbage() {
    let sink = 0;
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 8; i++) {
        const res = await nitroFetch(`${BASE}/bytes/4000000`);
        sink += (await res.arrayBuffer()).byteLength;
      }
      for (let i = 0; i < 20; i++) {
        sink += new Array(1_000_000).fill(i).length;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return sink;
  }

  it('frees stream: true requests once they finish', async () => {
    const refs: WeakRef<object>[] = [];
    for (let i = 0; i < 20; i++) await streamAndRead(refs);
    await collectGarbage();
    const alive = refs.filter((ref) => ref.deref() !== undefined).length;
    expect(alive).toBeLessThan(refs.length / 2);
  });
});

describe('NitroFetch - Reading while JavaScript is busy', () => {
  // Native callbacks reach JS through the RuntimeScheduler at
  // ImmediatePriority, in the order native queues them. A task queued at that
  // priority when a JS block ends runs after every callback native queued
  // during the block, and before anything native queues later.
  const runQueuedNativeCallbacks = () =>
    new Promise<void>((resolve) => {
      const scheduler = (globalThis as any).nativeRuntimeScheduler;
      scheduler.unstable_scheduleCallback(
        scheduler.unstable_ImmediatePriority,
        () => resolve()
      );
    });

  // Lets the request reach native, keeps JS busy while the whole response
  // arrives, then returns once JS has handled what native sent meanwhile.
  // A transport that reads the body natively is done by then. One that waits
  // for JS before each read has only delivered the headers.
  const blockJsWhileResponding = async () => {
    await runQueuedNativeCallbacks();
    blockJsThread(1_000);
    await runQueuedNativeCallbacks();
  };

  // Uncompressed and uncached. Small enough to fit any read-ahead window even
  // when native gets it in pieces as small as one TCP segment, and still two
  // native reads after the headers: the data, then the end of the body.
  const SIZE = 16 * 1024;
  const url = `${BASE}/text?phrase=x&repeat=${SIZE}`;

  // Each case sends one request first. The first request on a transport opens
  // a new connection (on Android, stream: true has its own Cronet engine),
  // which takes about a second on the emulator and would push the headers
  // past the block.
  const readWhileBlocked = async (init?: Record<string, unknown>) => {
    await (await (nitroFetch as any)(url, init)).arrayBuffer();
    const seen = { headers: false, body: false };
    const done = (nitroFetch as any)(url, init)
      .then((res: Response) => {
        seen.headers = true;
        return res.arrayBuffer();
      })
      .then((buffer: ArrayBuffer) => {
        seen.body = buffer.byteLength === SIZE;
      });
    await blockJsWhileResponding();
    const whenUnblocked = { ...seen };
    await done;
    expect(seen.body).toBe(true);
    return whenUnblocked;
  };

  it('default fetch reads the body while JavaScript is blocked', async () => {
    expect(await readWhileBlocked()).toEqual({ headers: true, body: true });
  });

  it('stream: true reads the body while JavaScript is blocked', async () => {
    expect(await readWhileBlocked({ stream: true })).toEqual({
      headers: true,
      body: true,
    });
  });

  const readXMLHttpRequestWhileBlocked = async (
    setUp?: (xhr: NitroXMLHttpRequestInstance) => void
  ) => {
    await sendXMLHttpRequest(url, setUp).done;
    const { xhr, done } = sendXMLHttpRequest(url, setUp);
    await blockJsWhileResponding();
    const readyStateWhenUnblocked = xhr.readyState;
    await done;
    expect(xhr.responseText.length).toBe(SIZE);
    return readyStateWhenUnblocked;
  };

  it('XMLHttpRequest reads the body while JavaScript is blocked', async () => {
    expect(await readXMLHttpRequestWhileBlocked()).toBe(
      NitroXMLHttpRequest.DONE
    );
  });

  it('XMLHttpRequest with a readystatechange listener reads the body while JavaScript is blocked', async () => {
    expect(await readXMLHttpRequestWhileBlocked(watchLikeSuperAgent)).toBe(
      NitroXMLHttpRequest.DONE
    );
  });
});

describe('NitroFetch - XMLHttpRequest event streams', () => {
  // EventSource clients send this Accept header by spec.
  const acceptEventStream = (xhr: NitroXMLHttpRequestInstance) => {
    xhr.setRequestHeader('Accept', 'text/event-stream');
    watchLikeSuperAgent(xhr);
  };

  it('streams the body as it arrives', async () => {
    const lengths: number[] = [];
    const { xhr, done } = sendXMLHttpRequest(
      `${BASE}/sse?count=4&interval=250`,
      (request) => {
        acceptEventStream(request);
        request.addEventListener('progress', () => {
          lengths.push(request.responseText.length);
        });
      }
    );
    await done;
    const full = 'data: 0\n\ndata: 1\n\ndata: 2\n\ndata: 3\n\n';
    expect(xhr.responseText).toBe(full);
    expect(lengths.some((length) => length > 0 && length < full.length)).toBe(
      true
    );
  });

  // Over HTTP/1.1, Cronet and URLSession open at most 6 connections per host.
  // Event streams on the default client would take all of them, and every
  // other request to the host would wait for a stream to end.
  it("doesn't hold the default client's connections", async () => {
    const streams = Array.from({ length: 6 }, () =>
      sendXMLHttpRequest(
        `${BASE}/drip?duration=10&numbytes=10`,
        acceptEventStream
      )
    );
    try {
      await Promise.all(
        streams.map(
          ({ xhr }) =>
            new Promise<void>((resolve) => {
              xhr.addEventListener('readystatechange', () => {
                if (xhr.readyState >= NitroXMLHttpRequest.HEADERS_RECEIVED) {
                  resolve();
                }
              });
            })
        )
      );
      const res = await nitroFetch(`${BASE}/get`);
      expect(res.status).toBe(200);
      expect(streams.map(({ xhr }) => xhr.readyState)).not.toContain(
        NitroXMLHttpRequest.DONE
      );
    } finally {
      streams.forEach(({ xhr }) => xhr.abort());
    }
  });
});

// Real-world HTTPS smoke test against a public API. The bulk of the suite runs
// against the local Express server (test-server/), so this keeps coverage of an
// actual TLS handshake + cert validation on the device's native stack.
describe('NitroFetch - real HTTPS (PokeAPI)', () => {
  it('GET https://pokeapi.co returns ditto over TLS', async () => {
    const res = await nitroFetch('https://pokeapi.co/api/v2/pokemon/ditto');
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('ditto');
  });
});

describe('NitroFetch - Streaming', () => {
  it('pre-aborted streamed request rejects with AbortError', async () => {
    const controller = new AbortController();
    controller.abort();
    let threw = false;

    try {
      await (nitroFetch as any)(`${BASE}/drip?duration=0&numbytes=1&delay=0`, {
        stream: true,
        signal: controller.signal,
      });
    } catch (error: any) {
      threw = true;
      expect(error.name).toBe('AbortError');
    }

    expect(threw).toBe(true);
  });

  it('request with an unparseable URL rejects with Invalid URL', async () => {
    for (const stream of [false, true]) {
      for (const url of ['https://exa mple.com', 'https://[']) {
        let error: any;
        try {
          await (nitroFetch as any)(url, stream ? { stream: true } : {});
        } catch (e) {
          error = e;
        }
        expect(String(error?.message)).toContain(`Invalid URL: ${url}`);
      }
    }
  });

  it('request with a space in the path or query succeeds', async () => {
    for (const stream of [false, true]) {
      for (const url of [`${BASE}/anything/a b`, `${BASE}/get?q=a b`]) {
        const res = await (nitroFetch as any)(
          url,
          stream ? { stream: true } : {}
        );
        expect(res.status).toBe(200);
      }
    }
  });

  it('aborting after the first /drip chunk rejects the next read with AbortError', async () => {
    const controller = new AbortController();
    const res = (await (nitroFetch as any)(
      `${BASE}/drip?duration=5&numbytes=5&delay=0`,
      { stream: true, signal: controller.signal }
    )) as any;
    const readable = res.body?.getReader?.();
    expect(readable).toBeDefined();

    const first = await readable.read();
    expect(first.done).toBe(false);
    expect(first.value?.byteLength).toBeGreaterThan(0);

    controller.abort();
    let threw = false;
    try {
      await readable.read();
    } catch (error: any) {
      threw = true;
      expect(error.name).toBe('AbortError');
    }

    expect(threw).toBe(true);
  });

  it('abort after native has finished settles instead of hanging', async () => {
    expect(await abortAfterNativeDone({ stream: true })).toBe('AbortError');
  });

  it('pre-aborted streamed request rejects with signal.reason', async () => {
    const controller = new AbortController();
    const reason = timeoutReason();
    abortWith(controller, reason);
    let error: unknown;
    try {
      await (nitroFetch as any)(`${BASE}/drip?duration=0&numbytes=1&delay=0`, {
        stream: true,
        signal: controller.signal,
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBe(reason);
  });

  it('aborting mid-stream rejects the next read with signal.reason', async () => {
    const controller = new AbortController();
    const res = (await (nitroFetch as any)(
      `${BASE}/drip?duration=5&numbytes=5&delay=0`,
      { stream: true, signal: controller.signal }
    )) as any;
    const reader = res.body.getReader();
    await reader.read();
    const reason = timeoutReason();
    abortWith(controller, reason);
    let error: unknown;
    try {
      await reader.read();
    } catch (e) {
      error = e;
    }
    expect(error).toBe(reason);
  });

  it('abort after the body has finished natively errors the reader', async () => {
    const controller = new AbortController();
    const res = (await (nitroFetch as any)(
      `${BASE}/drip?duration=1&numbytes=10&delay=0`,
      { stream: true, signal: controller.signal }
    )) as any;
    const reader = res.body.getReader();
    await reader.read();
    blockJsThread(2000);
    controller.abort();

    const outcome = await reader.read().then(
      (r: any) => (r.done ? 'eof' : 'chunk'),
      (e: any) => e?.name ?? 'rejected'
    );
    expect(outcome).toBe('AbortError');
  });

  // The server drips for 10s. Polling stops the moment it records either
  // outcome, so a request that drains to completion fails fast rather than
  // burning the whole budget. Cronet can take a few seconds to close the
  // socket when the cancel lands before the first read completes.
  const openDrip = async (id: string) =>
    (await (nitroFetch as any)(
      `${BASE}/drip?duration=10&numbytes=100&delay=0&id=${id}`,
      { stream: true }
    )) as any;

  const awaitDripOutcome = async (id: string) => {
    const deadline = Date.now() + 8_000;
    let report: any;
    do {
      report = await (await nitroFetch(`${BASE}/drip-report/${id}`)).json();
      if (report.disconnected || report.finished) return report;
      await new Promise((r) => setTimeout(r, 250));
    } while (Date.now() < deadline);
    return report;
  };

  it('reader.cancel() disconnects the native request from the server', async () => {
    const id = `reader-cancel-${String(Date.now())}`;
    const res = await openDrip(id);
    const reader = res.body.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await reader.cancel();

    const report = await awaitDripOutcome(id);
    expect(report.disconnected).toBe(true);
    expect(report.finished).toBe(false);
    expect(report.sent).toBeLessThan(report.total);
  });

  it('response.body.cancel() before the first read disconnects too', async () => {
    const id = `body-cancel-${String(Date.now())}`;
    const res = await openDrip(id);
    await res.body.cancel();

    const report = await awaitDripOutcome(id);
    expect(report.disconnected).toBe(true);
    expect(report.finished).toBe(false);
  });

  // 4 MB over 4 s. While JS is blocked, native queues as many chunks as it
  // may and stops reading, so the abort reaches a request that is paused.
  it('aborting while native waits for JavaScript disconnects too', async () => {
    const id = `paused-abort-${String(Date.now())}`;
    const controller = new AbortController();
    const res = (await (nitroFetch as any)(
      `${BASE}/drip?duration=4&numbytes=64&chunk=65536&delay=0&id=${id}`,
      { stream: true, signal: controller.signal }
    )) as any;
    const reader = res.body.getReader();
    await reader.read();
    blockJsThread(2_000);
    controller.abort();

    const outcome = await reader.read().then(
      () => 'chunk',
      (e: any) => e?.name ?? 'rejected'
    );
    expect(outcome).toBe('AbortError');
    const report = await awaitDripOutcome(id);
    expect(report.disconnected).toBe(true);
    expect(report.finished).toBe(false);
  });

  // URLSession reports a chunked body whose connection closes before the
  // final chunk as complete, so only Android sees this drop as an error.
  const itAndroid = Platform.OS === 'android' ? it : it.skip;

  itAndroid('a connection dropped mid-body rejects the reader', async () => {
    const res = (await (nitroFetch as any)(
      `${BASE}/drip?duration=0.5&numbytes=8&chunk=65536&delay=0&fail=1`,
      { stream: true }
    )) as any;
    const reader = res.body.getReader();
    // The body and the failure arrive while JS is busy.
    blockJsThread(1_000);
    let received = 0;
    const outcome = await (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return 'done';
        received += value.byteLength;
      }
    })().catch(() => 'rejected');
    expect(outcome).toBe('rejected');
    expect(received).toBeGreaterThan(0);
  });

  // Every 251st byte is a 'b', so a lost, repeated or reordered chunk moves
  // a 'b'. The reader keeps JS busy for 10 ms per chunk.
  it('delivers a multi-megabyte body byte-exact to a slow reader', async () => {
    const period = 251;
    const repeat = 16_000;
    const res = (await (nitroFetch as any)(
      `${BASE}/text?phrase=b${'a'.repeat(period - 1)}&repeat=${repeat}`,
      { stream: true }
    )) as any;
    const reader = res.body.getReader();
    let offset = 0;
    let firstWrongByte = -1;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (let i = 0; i < value.length && firstWrongByte < 0; i++) {
        const expected = (offset + i) % period === 0 ? 0x62 : 0x61;
        if (value[i] !== expected) firstWrongByte = offset + i;
      }
      offset += value.length;
      blockJsThread(10);
    }
    expect(firstWrongByte).toBe(-1);
    expect(offset).toBe(period * repeat);
  });

  // Smoke check, not a discriminator: a throw from a Nitro callback is
  // swallowed natively, so this only catches a cancel that wedges the client.
  it('repeated mid-stream cancels leave the client usable', async () => {
    for (let i = 0; i < 3; i++) {
      const res = (await (nitroFetch as any)(
        `${BASE}/drip?duration=3&numbytes=60&delay=0`,
        { stream: true }
      )) as any;
      const reader = res.body.getReader();
      await reader.read();
      await reader.cancel();
    }
    await new Promise((r) => setTimeout(r, 1_000));

    const after = await nitroFetch(`${BASE}/get`);
    expect(after.ok).toBe(true);
  });

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

  it('hands each /drip piece to the reader as it arrives', async () => {
    const res = (await (nitroFetch as any)(
      `${BASE}/drip?duration=2&numbytes=5&delay=0`,
      { stream: true }
    )) as any;
    const reader = res.body.getReader();
    const arrivals: number[] = [];
    while (true) {
      const { done } = await reader.read();
      if (done) break;
      arrivals.push(Date.now());
    }
    // The pieces are 400 ms apart, so none should wait for the next.
    expect(arrivals.length).toBe(5);
    expect(arrivals[4]! - arrivals[0]!).toBeGreaterThan(1_000);
  });
});

it('never sends prefetchKey to the server on any request path', async () => {
  const url = `${BASE}/headers`;
  const key = `harness-strip-${String(Date.now())}`;
  const init = {
    headers: { 'prefetchKey': key, 'X-Nitro-Test': 'keep' },
    prefetchCacheTtlMs: 60_000,
  } as any;
  const sentKeys = (json: any): string[] =>
    Object.keys(json.headers ?? {}).map((k) => k.toLowerCase());

  const plain = await nitroFetch(url, init);
  expect(plain.ok).toBe(true);
  expect(sentKeys(await plain.json())).not.toContain('prefetchkey');

  const streamed = (await (nitroFetch as any)(url, {
    ...init,
    stream: true,
  })) as any;
  const reader = streamed.body.getReader();
  const decoder =
    new (require('react-native-nitro-text-decoder').TextDecoder)();
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) text += decoder.decode(value, { stream: true });
  }
  expect(sentKeys(JSON.parse(text))).not.toContain('prefetchkey');

  await prefetch(url, init);
  const cached = await nitroFetch(url, init);
  expect(cached.headers.get('nitroPrefetched')).toBe('true');
  // Body echoes the prefetch's own outbound request.
  const cachedKeys = sentKeys(await cached.json());
  expect(cachedKeys).not.toContain('prefetchkey');
  expect(cachedKeys).toContain('x-nitro-test');

  await removeFromAutoPrefetch(key);
});
