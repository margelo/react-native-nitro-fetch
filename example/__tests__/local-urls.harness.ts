import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from 'react-native-harness';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { TextDecoder as NitroTextDecoder } from 'react-native-nitro-text-decoder';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';

declare const performance: { now(): number };

// Most apps ship a global TextDecoder; provide one so data: text decodes.
const g = globalThis as { TextDecoder?: unknown };
if (g.TextDecoder == null) g.TextDecoder = NitroTextDecoder;

// Regression coverage for Expensify/App#92652: fetch() must read local resources.

// data: URLs — decoded in JS, no native bridge, no server.
describe('Local URLs - data:', () => {
  it('decodes a text data: URL', async () => {
    const res = await nitroFetch('data:text/plain,Hello%2C%20World');
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(await res.text()).toBe('Hello, World');
  });

  it('decodes a base64 text data: URL', async () => {
    const res = await nitroFetch('data:text/plain;base64,SGVsbG8gV29ybGQ=');
    expect(await res.text()).toBe('Hello World');
  });

  it('parses JSON from a data: URL', async () => {
    const res = await nitroFetch('data:application/json,%7B%22a%22%3A1%7D');
    expect(res.headers.get('content-type')).toBe('application/json');
    const json = await res.json();
    expect(json.a).toBe(1);
  });

  it('returns raw bytes for a binary base64 data: URL', async () => {
    // [255, 216, 255, 224] — not valid UTF-8, so it must come back as bytes.
    const res = await nitroFetch(
      'data:application/octet-stream;base64,/9j/4A=='
    );
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.length).toBe(4);
    expect(Array.from(buf)).toEqual([255, 216, 255, 224]);
  });

  it('defaults the media type when omitted', async () => {
    const res = await nitroFetch('data:,hello');
    expect(res.headers.get('content-type')).toBe('text/plain;charset=US-ASCII');
    expect(await res.text()).toBe('hello');
  });
});

// file:// + scheme-less paths (the exact bug) — fixture written via react-native-fs.
describe('Local URLs - file:// and scheme-less paths', () => {
  const dir = RNFS.CachesDirectoryPath;
  const textPath = `${dir}/nitro-fetch-local-test.txt`;
  const binPath = `${dir}/nitro-fetch-local-test.jpg`;
  // Mirrors a picked spreadsheet read through a scheme-less absolute path.
  const TEXT = 'col1,col2\nfoo,bar\nbaz,qux\n';
  const BIN_BYTES = [255, 216, 255, 224]; // base64 "/9j/4A=="

  beforeAll(async () => {
    await RNFS.writeFile(textPath, TEXT, 'utf8');
    await RNFS.writeFile(binPath, '/9j/4A==', 'base64');
  });

  afterAll(async () => {
    try {
      await RNFS.unlink(textPath);
    } catch {
      // best-effort cleanup
    }
    try {
      await RNFS.unlink(binPath);
    } catch {
      // best-effort cleanup
    }
  });

  it('reads a file:// URL', async () => {
    const res = await nitroFetch(`file://${textPath}`);
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(await res.text()).toBe(TEXT);
  });

  it('reads a scheme-less absolute path (the iOS importer case)', async () => {
    const res = await nitroFetch(textPath);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(TEXT);
  });

  it('guesses Content-Type from the file extension', async () => {
    const res = await nitroFetch(`file://${textPath}`);
    expect(res.headers.get('content-type')).toBe('text/plain');
  });

  it('returns raw bytes for a binary file', async () => {
    const res = await nitroFetch(`file://${binPath}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(buf)).toEqual(BIN_BYTES);
  });

  it('rejects when the file does not exist', async () => {
    let threw = false;
    try {
      const res = await nitroFetch(`${dir}/nitro-fetch-missing-xyz.txt`);
      await res.text();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

// blob: unsupported (RN blob registry unreachable); content:// shares the tested readFileBytes path.
describe('Local URLs - unsupported schemes', () => {
  it('rejects blob: URLs with a TypeError', async () => {
    let err: unknown;
    try {
      await nitroFetch('blob:http://localhost/abc-123');
    } catch (e) {
      err = e;
    }
    expect(err instanceof TypeError).toBe(true);
  });
});

// Performance guard: the data: fast path is JS-only; trips only on a pathological regression.
describe('Local URLs - performance guard', () => {
  it('data: fast-path stays cheap', async () => {
    const DATA = 'data:text/plain;base64,SGVsbG8gV29ybGQ=';
    const N = 2000;
    for (let i = 0; i < 50; i++) {
      await nitroFetch(DATA); // warmup
    }
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const r = await nitroFetch(DATA);
      await r.text();
    }
    const perCallMs = (performance.now() - t0) / N;

    console.log(
      `[perf] data: fast-path ~${perCallMs.toFixed(4)} ms/call (N=${N})`
    );
    expect(perCallMs).toBeLessThan(2);
  });
});
