export {};

const QUEUE_KEY = 'nitrofetch_autoprefetch_queue';

// Each write stores a new "ciphertext", like AES-GCM with a random IV.
const mockStore = new Map<string, string>();
let mockWrites = 0;
const mockEncrypt = (key: string, value: string) => {
  mockStore.set(key, `enc:${++mockWrites}:${value}`);
};
const mockDecrypt = (key: string) =>
  (mockStore.get(key) ?? '').replace(/^enc:\d+:/, '');
const mockStorage = {
  getString: jest.fn((key: string) => mockStore.get(key) ?? ''),
  getSecureString: jest.fn(mockDecrypt),
  setSecureString: jest.fn(mockEncrypt),
  removeSecureString: jest.fn((key: string) => {
    mockStore.delete(key);
  }),
};

jest.mock('../NitroInstances', () => ({
  NativeStorage: mockStorage,
  NitroFetch: {},
}));

let prefetch: typeof import('../fetch-core/prefetch');

beforeAll(async () => {
  // Bun does not hoist Jest-compatible module mocks. Load the implementation
  // only after registering the mocks so native modules stay out of the process.
  prefetch = await import('../fetch-core/prefetch');
});

beforeEach(async () => {
  await prefetch.removeAllFromAutoprefetch();
  jest.clearAllMocks();
});

const register = (key: string, headers: Record<string, string> = {}) =>
  prefetch.prefetchOnAppStart(`https://api.example.com/${key}`, {
    headers: { prefetchKey: key, ...headers },
  });

const savedQueue = (): Array<Record<string, any>> =>
  JSON.parse(mockDecrypt(QUEUE_KEY) || '[]');

const savedKeys = () => savedQueue().map((entry) => entry.prefetchKey);

// Like `AutoPrefetcher.registerPrefetch` saving from its own thread.
const saveFromNative = (key: string) =>
  mockEncrypt(
    QUEUE_KEY,
    JSON.stringify([
      ...savedQueue(),
      { url: `https://api.example.com/${key}`, prefetchKey: key },
    ])
  );

it('decrypts the queue once and does not rewrite unchanged requests', async () => {
  for (const key of ['assets', 'geo', 'tickers']) await register(key);
  expect(mockStorage.setSecureString).toHaveBeenCalledTimes(3);
  jest.clearAllMocks();

  for (const key of ['assets', 'geo', 'tickers']) await register(key);

  expect(mockStorage.getSecureString).toHaveBeenCalledTimes(1);
  expect(mockStorage.setSecureString).not.toHaveBeenCalled();
  expect(savedKeys()).toEqual(['assets', 'geo', 'tickers']);
});

it('rewrites a request whose headers changed', async () => {
  await register('assets', { 'User-Agent': 'App/1.0' });
  jest.clearAllMocks();

  await register('assets', { 'User-Agent': 'App/1.1' });

  expect(mockStorage.setSecureString).toHaveBeenCalledTimes(1);
  expect(savedQueue()).toHaveLength(1);
  expect(savedQueue()[0]?.headers['User-Agent']).toBe('App/1.1');
});

it('keeps requests that native code saved after the queue was read', async () => {
  await register('assets');
  saveFromNative('native');
  jest.clearAllMocks();

  await register('geo');

  expect(mockStorage.getSecureString).toHaveBeenCalledTimes(1);
  expect(savedKeys()).toEqual(['assets', 'native', 'geo']);
});

it('keeps requests that native code saved while the queue was decrypted', async () => {
  await register('assets');
  mockStorage.getSecureString.mockImplementationOnce((key: string) => {
    const plain = mockDecrypt(key);
    saveFromNative('native');
    return plain;
  });

  await register('assets');
  await register('geo');

  expect(savedKeys()).toEqual(['assets', 'native', 'geo']);
});

it('keeps requests that native code saved right after a write', async () => {
  mockStorage.setSecureString.mockImplementationOnce(
    (key: string, value: string) => {
      mockEncrypt(key, value);
      saveFromNative('native');
    }
  );

  await register('assets');
  await register('geo');

  expect(savedKeys()).toEqual(['assets', 'native', 'geo']);
});

it('saves requests again after the queue was cleared', async () => {
  await register('assets');
  await register('geo');

  await prefetch.removeFromAutoPrefetch('assets');
  expect(savedKeys()).toEqual(['geo']);
  await prefetch.removeAllFromAutoprefetch();
  await register('geo');

  expect(savedKeys()).toEqual(['geo']);
});

it('treats an unreadable queue as empty', async () => {
  await register('assets');
  mockStorage.getSecureString.mockImplementationOnce(() => {
    throw new Error('Keystore unavailable');
  });

  await register('geo');
  await register('tickers');

  expect(savedKeys()).toEqual(['geo', 'tickers']);
});
