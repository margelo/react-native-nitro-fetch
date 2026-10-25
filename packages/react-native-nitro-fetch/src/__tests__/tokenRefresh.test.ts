import { NitroResponse } from '../Response';

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
    mockNitroFetch.mockResolvedValue(
      new NitroResponse('{"token":"abc"}', {
        status: 200,
      }) as unknown as Response
    );

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

  it('rejects an empty JSON body, as React Native fetch and the native refresh do', async () => {
    for (const response of [
      new NitroResponse('', { status: 200 }),
      new NitroResponse(null, { status: 204 }),
    ]) {
      mockNitroFetch.mockResolvedValueOnce(response as unknown as Response);
      await expect(
        callRefreshEndpoint({
          url: 'https://auth.example.com/refresh',
          compositeHeaders: [
            {
              header: 'Authorization',
              template: 'Bearer {{token}}',
              paths: { token: 'token' },
            },
          ],
        })
      ).rejects.toThrow(SyntaxError);
    }
  });
});
