import { describe, it, expect } from 'react-native-harness';
import { fetch as nitroFetch, Request } from 'react-native-nitro-fetch';
import { TextDecoder } from 'react-native-nitro-text-decoder';
import { BASE } from '../test-utils/server';

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
