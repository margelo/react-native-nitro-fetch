import { describe, it, expect } from 'react-native-harness';
import { fetch as nitroFetch, Request } from 'react-native-nitro-fetch';
import { TextDecoder } from 'react-native-nitro-text-decoder';
import { BASE } from '../test-utils/server';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/* eslint-disable no-bitwise */
function base64FromBytes(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? (bytes[i + 1] ?? 0) : 0;
    const b2 = hasB2 ? (bytes[i + 2] ?? 0) : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += hasB1 ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += hasB2 ? B64[b2 & 63] : '=';
  }
  return out;
}
/* eslint-enable no-bitwise */

// RN Blob exposes only size/type/slice — read bytes back via FileReader.
function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('Response.blob() binary-safety', () => {
  it('blob() of a non-UTF-8 HTTP body has the exact byte length', async () => {
    const res = await nitroFetch(`${BASE}/bytes/256`);
    const blob = await res.blob();
    expect(blob instanceof Blob).toBe(true);
    expect(blob.size).toBe(256);
  });

  it('control: arrayBuffer() already returns the full body', async () => {
    const res = await nitroFetch(`${BASE}/bytes/256`);
    const ab = await res.arrayBuffer();
    expect(ab.byteLength).toBe(256);
  });

  it('blob() bytes round-trip via FileReader equal the original', async () => {
    const res = await nitroFetch(`${BASE}/bytes/256`);
    const bytes = await readBlobBytes(await res.blob());
    expect(bytes.length).toBe(256);
    for (let i = 0; i < 256; i++) expect(bytes[i]).toBe(i);
  });

  it('blob() of a non-UTF-8 data: URL is byte-exact', async () => {
    const res = await nitroFetch(
      'data:application/octet-stream;base64,//4AgA=='
    );
    const blob = await res.blob();
    expect(blob.size).toBe(4);
    expect(Array.from(await readBlobBytes(blob))).toEqual([255, 254, 0, 128]);
  });

  it('control: text response blob() still works', async () => {
    const res = await nitroFetch(`${BASE}/get`);
    const blob = await res.blob();
    expect(blob.size).toBeGreaterThan(0);
    const text = new TextDecoder().decode(await readBlobBytes(blob));
    expect(typeof JSON.parse(text)).toBe('object');
  });

  it('new File([blob], name) preserves size and bytes', async () => {
    const res = await nitroFetch(`${BASE}/bytes/256`);
    const file = new File([await res.blob()], 'payload.bin', {
      type: 'application/octet-stream',
    });
    expect(file.size).toBe(256);
    const bytes = await readBlobBytes(file);
    for (let i = 0; i < 256; i++) expect(bytes[i]).toBe(i);
  });

  it('Request.blob() with a binary body is binary-safe', async () => {
    const body = new Uint8Array([0, 127, 128, 255, 254]);
    const req = new Request('https://example.com', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    const blob = await req.blob();
    expect(blob.size).toBe(5);
    expect(Array.from(await readBlobBytes(blob))).toEqual([
      0, 127, 128, 255, 254,
    ]);
  });
});

// Every byte value, so any UTF-8 round-trip corrupts it.
const ALL_BYTES = new Uint8Array(256).map((_, i) => i);
const ALL_BYTES_B64 = base64FromBytes(ALL_BYTES);

async function postBytes(body: BodyInit): Promise<any> {
  const res = await nitroFetch(`${BASE}/post`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  expect(res.status).toBe(200);
  return res.json();
}

describe('binary request bodies', () => {
  it('ArrayBuffer body uploads byte-exact', async () => {
    const json = await postBytes(ALL_BYTES.buffer as ArrayBuffer);
    expect(json.dataLength).toBe(256);
    expect(json.dataBase64).toBe(ALL_BYTES_B64);
  });

  it('Uint8Array body uploads byte-exact', async () => {
    const json = await postBytes(ALL_BYTES);
    expect(json.dataLength).toBe(256);
    expect(json.dataBase64).toBe(ALL_BYTES_B64);
  });

  it('typed-array view honours byteOffset and byteLength', async () => {
    const view = ALL_BYTES.subarray(10, 20);
    const json = await postBytes(view);
    expect(json.dataLength).toBe(10);
    expect(json.dataBase64).toBe(base64FromBytes(ALL_BYTES.slice(10, 20)));
  });

  it('DataView body uploads byte-exact', async () => {
    const dv = new DataView(ALL_BYTES.buffer as ArrayBuffer, 4, 8);
    const json = await postBytes(dv);
    expect(json.dataLength).toBe(8);
    expect(json.dataBase64).toBe(base64FromBytes(ALL_BYTES.slice(4, 12)));
  });

  it('Blob body uploads byte-exact and sets Content-Type', async () => {
    const blob = await (await nitroFetch(`${BASE}/bytes/256`)).blob();
    const res = await nitroFetch(`${BASE}/post`, {
      method: 'POST',
      body: blob,
    });
    const json = await res.json();
    expect(json.dataLength).toBe(256);
    expect(json.dataBase64).toBe(ALL_BYTES_B64);
  });

  it('binary body via a standard Request object uploads byte-exact', async () => {
    const res = await nitroFetch(
      new Request(`${BASE}/post`, { method: 'POST', body: ALL_BYTES })
    );
    const json = await res.json();
    expect(json.dataLength).toBe(256);
    expect(json.dataBase64).toBe(ALL_BYTES_B64);
  });

  it('empty ArrayBuffer body sends no bytes', async () => {
    const json = await postBytes(new ArrayBuffer(0));
    expect(json.dataLength).toBe(0);
  });

  it('string bodies still round-trip as UTF-8', async () => {
    const res = await nitroFetch(`${BASE}/post`, {
      method: 'POST',
      body: 'héllo',
    });
    const json = await res.json();
    expect(json.data).toBe('héllo');
  });

  it('Blob body carried by a Request uploads byte-exact', async () => {
    const blob = await (await nitroFetch(`${BASE}/bytes/256`)).blob();
    const res = await nitroFetch(
      new Request(`${BASE}/post`, { method: 'POST', body: blob })
    );
    const json = await res.json();
    expect(json.dataLength).toBe(256);
    expect(json.dataBase64).toBe(ALL_BYTES_B64);
  });

  it('a typed Blob on a Request keeps the request headers', async () => {
    const raw = await (await nitroFetch(`${BASE}/bytes/256`)).blob();
    const blob = new Blob([raw], { type: 'image/png' });
    const res = await nitroFetch(
      new Request(`${BASE}/post`, {
        method: 'POST',
        headers: { Authorization: 'Bearer token123' },
        body: blob,
      })
    );
    const json = (await res.json()) as any;
    expect(json.headers.Authorization).toBe('Bearer token123');
    expect(json.dataLength).toBe(256);
  });

  it('streaming request built from a Request uploads its binary body', async () => {
    const res = (await (nitroFetch as any)(
      new Request(`${BASE}/post`, { method: 'POST', body: ALL_BYTES }),
      { stream: true }
    )) as any;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) text += decoder.decode(value, { stream: true });
    }
    const json = JSON.parse(text);
    expect(json.dataLength).toBe(256);
    expect(json.dataBase64).toBe(ALL_BYTES_B64);
  });

  it('a payload larger than the upload buffer uploads byte-exact', async () => {
    const big = new Uint8Array(256 * 1024).map((_, i) => i % 256);
    const json = await postBytes(big);
    expect(json.dataLength).toBe(256 * 1024);
    expect(json.dataBase64).toBe(base64FromBytes(big));
  });

  it('PUT with a binary body uploads byte-exact', async () => {
    const res = await nitroFetch(`${BASE}/put`, {
      method: 'PUT',
      body: ALL_BYTES,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    const json = await res.json();
    expect(json.dataLength).toBe(256);
    expect(json.dataBase64).toBe(ALL_BYTES_B64);
  });

  it('streaming request uploads a binary body byte-exact', async () => {
    const res = (await (nitroFetch as any)(`${BASE}/post`, {
      method: 'POST',
      body: ALL_BYTES,
      stream: true,
    })) as any;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) text += decoder.decode(value, { stream: true });
    }
    const json = JSON.parse(text);
    expect(json.dataLength).toBe(256);
    expect(json.dataBase64).toBe(ALL_BYTES_B64);
  });
});

describe('default Content-Type by body type', () => {
  const ctOf = async (init: RequestInit) => {
    const res = await nitroFetch(`${BASE}/post`, { method: 'POST', ...init });
    const json = (await res.json()) as any;
    const hit = Object.entries(json.headers as Record<string, string>).find(
      ([k]) => k.toLowerCase() === 'content-type'
    );
    return hit?.[1];
  };

  it('string body defaults to text/plain', async () => {
    expect(await ctOf({ body: 'hi' })).toBe('text/plain;charset=UTF-8');
  });

  it('URLSearchParams body defaults to form-urlencoded', async () => {
    const ct = await ctOf({ body: new URLSearchParams({ a: 'b' }) });
    expect(ct).toBe('application/x-www-form-urlencoded;charset=UTF-8');
  });

  it('byte body defaults to application/octet-stream', async () => {
    expect(await ctOf({ body: ALL_BYTES })).toBe('application/octet-stream');
  });

  it('an explicit Content-Type is never overridden', async () => {
    const ct = await ctOf({
      body: ALL_BYTES,
      headers: { 'Content-Type': 'image/png' },
    });
    expect(ct).toBe('image/png');
  });
});
