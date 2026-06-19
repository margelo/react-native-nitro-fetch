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
});
