jest.mock('react-native-nitro-modules', () => ({
  NitroModules: {
    box: (value: unknown) => value,
    createHybridObject: () => ({}),
  },
}));

import { buildNitroRequestPure } from '../fetch';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

describe('buildNitroRequestPure', () => {
  it('passes ArrayBuffer request bodies through as bodyBytes', () => {
    const bytes = new Uint8Array([0x00, 0x7f, 0x80, 0xff]);
    const req = buildNitroRequestPure('https://example.com/upload', {
      method: 'POST',
      body: toArrayBuffer(bytes),
    });

    expect(req.bodyString).toBeUndefined();
    expect(req.bodyBytes).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(req.bodyBytes as ArrayBuffer)).toEqual(bytes);
  });

  it('copies typed array request bodies into exact bodyBytes', () => {
    const backing = new Uint8Array([0xaa, 0x00, 0x01, 0x02, 0xbb]);
    const view = backing.subarray(1, 4);
    const req = buildNitroRequestPure('https://example.com/upload', {
      method: 'POST',
      body: view,
    });

    expect(req.bodyString).toBeUndefined();
    expect(new Uint8Array(req.bodyBytes as ArrayBuffer)).toEqual(
      new Uint8Array([0x00, 0x01, 0x02])
    );
  });

  it('preserves an empty ArrayBuffer request body', () => {
    const req = buildNitroRequestPure('https://example.com/upload', {
      method: 'POST',
      body: new ArrayBuffer(0),
    });

    expect(req.bodyString).toBeUndefined();
    expect((req.bodyBytes as ArrayBuffer).byteLength).toBe(0);
  });

  it('preserves non-ASCII UTF-8 bytes without base64 encoding', () => {
    const bytes = new TextEncoder().encode('héllø 🌍');
    const req = buildNitroRequestPure('https://example.com/upload', {
      method: 'POST',
      body: bytes,
    });

    expect(new Uint8Array(req.bodyBytes as ArrayBuffer)).toEqual(bytes);
  });

  it('keeps string bodies on the string path', () => {
    const req = buildNitroRequestPure('https://example.com/upload', {
      method: 'POST',
      body: 'héllø 🌍',
    });

    expect(req.bodyString).toBe('héllø 🌍');
    expect(req.bodyBytes).toBeUndefined();
  });
});
