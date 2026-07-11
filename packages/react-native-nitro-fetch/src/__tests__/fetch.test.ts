jest.mock('react-native-nitro-modules', () => ({
  NitroModules: {
    box: (value: unknown) => value,
    createHybridObject: () => ({}),
  },
}));

import { buildNitroRequestPure } from '../fetch';

function buildRequest(body: BodyInit) {
  return buildNitroRequestPure('https://example.com/upload', {
    method: 'POST',
    body,
  });
}

describe('buildNitroRequestPure request bodies', () => {
  it('encodes an ArrayBuffer as base64 for the current wire type', () => {
    const body = new Uint8Array([0x00, 0x7f, 0x80, 0xff]).buffer;

    const request = buildRequest(body);

    expect(request.bodyString).toBeUndefined();
    expect(request.bodyBytes).toBe('AH+A/w==');
  });

  it('encodes only the bytes in a typed-array subview', () => {
    const backing = new Uint8Array([0xaa, 0x00, 0x01, 0x02, 0xbb]);

    const request = buildRequest(backing.subarray(1, 4));

    expect(request.bodyBytes).toBe('AAEC');
  });

  it('preserves an empty binary body', () => {
    const request = buildRequest(new ArrayBuffer(0));

    expect(request.bodyBytes).toBe('');
  });

  it('encodes non-ASCII bytes without text conversion', () => {
    const request = buildRequest(
      new Uint8Array([0x80, 0xff, 0xc3, 0xa9]).buffer
    );

    expect(request.bodyBytes).toBe('gP/DqQ==');
  });

  it('uses the worklet-safe fallback when btoa is unavailable', () => {
    const originalBtoa = globalThis.btoa;
    Object.defineProperty(globalThis, 'btoa', {
      configurable: true,
      value: undefined,
    });

    try {
      const request = buildRequest(new Uint8Array([0x00, 0x01, 0x02]).buffer);
      expect(request.bodyBytes).toBe('AAEC');
    } finally {
      Object.defineProperty(globalThis, 'btoa', {
        configurable: true,
        value: originalBtoa,
      });
    }
  });

  it('keeps string and URLSearchParams bodies on the string path', () => {
    expect(buildRequest('hello').bodyString).toBe('hello');
    expect(
      buildRequest(new URLSearchParams({ message: 'café' })).bodyString
    ).toBe('message=caf%C3%A9');
  });
});
