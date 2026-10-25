// Dynamic imports do not mark this file as a TypeScript module. Keep generated
// test declarations module-scoped so they cannot collide with the source file.
export {};

jest.mock('../fetch-core/fetch', () => ({
  nitroFetch: jest.fn(),
}));
jest.mock('../NitroInstances', () => ({
  NativeStorage: {},
}));

type NitroFetchFunction = typeof import('../fetch-core/fetch').nitroFetch;
type CallRefreshEndpoint = typeof import('../tokenRefresh').callRefreshEndpoint;

let mockNitroFetch: jest.MockedFunction<NitroFetchFunction>;
let callRefreshEndpoint: CallRefreshEndpoint;

const PIN_ERROR = 'ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN';

describe('callRefreshEndpoint', () => {
  const globalFetch = globalThis.fetch;

  beforeAll(async () => {
    // Bun does not hoist Jest-compatible module mocks. Load the implementation
    // only after registering the mocks so native modules stay out of the process.
    const fetchModule = await import('../fetch-core/fetch');
    mockNitroFetch =
      fetchModule.nitroFetch as jest.MockedFunction<NitroFetchFunction>;
    callRefreshEndpoint = (await import('../tokenRefresh')).callRefreshEndpoint;
  });

  beforeEach(() => {
    mockNitroFetch.mockReset();
    globalThis.fetch = jest.fn(() =>
      Promise.reject(new Error('the global fetch does not apply the pin file'))
    );
  });

  afterAll(() => {
    globalThis.fetch = globalFetch;
  });

  it('sends the refresh with the nitro client, which applies the pin file', async () => {
    mockNitroFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'abc' }),
    } as unknown as Response);

    const headers = await callRefreshEndpoint({
      url: 'https://auth.example.com/refresh',
      headers: { 'Content-Type': 'application/json' },
      body: '{"refresh":"r"}',
      mappings: [
        {
          jsonPath: 'token',
          header: 'Authorization',
          valueTemplate: 'Bearer {{value}}',
        },
      ],
    });

    expect(mockNitroFetch).toHaveBeenCalledWith(
      'https://auth.example.com/refresh',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"refresh":"r"}',
      }
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(headers).toEqual({ Authorization: 'Bearer abc' });
  });

  it('rejects with the pin error of the nitro client', async () => {
    mockNitroFetch.mockRejectedValue(
      new TypeError(
        `Certificate pinning failed for www.gstatic.com (${PIN_ERROR})`
      )
    );

    await expect(
      callRefreshEndpoint({ url: 'https://www.gstatic.com/generate_204' })
    ).rejects.toThrow(PIN_ERROR);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
