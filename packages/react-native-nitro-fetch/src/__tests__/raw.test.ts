// Dynamic imports do not mark this file as a TypeScript module. Keep generated
// test declarations module-scoped so they cannot collide with the source file.
export {};

const mockRequest = jest.fn();

jest.mock('../fetch-core/client', () => ({
  NitroFetchHybrid: { createClient: () => ({}) },
  clientUnavailableError: () => new Error('NitroFetch client not available'),
  ensureClient: () => ({ cancelRequest: () => {}, request: mockRequest }),
}));

type NitroFetchRawFunction = typeof import('../fetch-core/raw').nitroFetchRaw;

let nitroFetchRaw: NitroFetchRawFunction;

// Node has no FileReader. Like React Native's, this one reads a Blob
// asynchronously.
class MockFileReader {
  error: unknown = null;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  result: ArrayBuffer | null = null;

  readAsArrayBuffer(blob: Blob): void {
    blob.arrayBuffer().then((bytes) => {
      this.result = bytes;
      this.onload?.();
    });
  }
}

describe('nitroFetchRaw', () => {
  const globals = globalThis as { FileReader?: unknown };
  let previousFileReader: unknown;

  beforeAll(async () => {
    // Bun does not hoist Jest-compatible module mocks. Load the implementation
    // only after registering the mock.
    nitroFetchRaw = (await import('../fetch-core/raw')).nitroFetchRaw;
  });

  beforeEach(() => {
    mockRequest.mockReset();
    previousFileReader = globals.FileReader;
    globals.FileReader = MockFileReader;
  });

  afterEach(() => {
    globals.FileReader = previousFileReader;
  });

  it('sends a Blob body as its bytes', async () => {
    mockRequest.mockResolvedValue({ headers: [], ok: true, status: 200 });

    await nitroFetchRaw('https://example.com/upload', {
      body: new Blob(['body']),
      method: 'POST',
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    const request = mockRequest.mock.calls[0]?.[0];
    expect(new TextDecoder().decode(request.bodyBytes)).toBe('body');
  });

  it('sends nothing when aborted while a Blob body is read', async () => {
    const controller = new AbortController();
    const pending = nitroFetchRaw('https://example.com/upload', {
      body: new Blob(['body']),
      method: 'POST',
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
