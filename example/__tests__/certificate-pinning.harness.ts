import { describe, it, expect } from 'react-native-harness';
import { fetch as nitroFetch, prefetch } from 'react-native-nitro-fetch';

// The example app bundles nitro-fetch-pinning.json (android/app/src/main/assets and the iOS app target):
//   - aws.amazon.com is pinned to the Amazon Trust Services roots its chain ends at, so it connects.
//   - gstatic.com (includeSubdomains) is pinned to a key no chain contains, so www.gstatic.com fails.
// Neither host is used by any other suite. example.com is not pinned.
const PINNED_OK = 'https://aws.amazon.com/';
const PINNED_MISMATCH = 'https://www.gstatic.com/generate_204';
const UNPINNED = 'https://example.com/';
const PIN_ERROR = 'ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN';

async function failureOf(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('Certificate pinning', () => {
  it('connects when the chain contains a pinned root', async () => {
    const res = await nitroFetch(PINNED_OK, { method: 'HEAD' });
    expect(typeof res.status).toBe('number');
  });

  it('connects on the streaming transport when the chain contains a pinned root', async () => {
    const res = await nitroFetch(PINNED_OK, {
      method: 'HEAD',
      stream: true,
    } as any);
    await res.text();
    expect(typeof res.status).toBe('number');
  });

  it('rejects a subdomain of a pinned parent whose chain has no pinned key', async () => {
    const error = await failureOf(() => nitroFetch(PINNED_MISMATCH));
    expect(error).toBeDefined();
    expect(String(error?.message)).toContain(PIN_ERROR);
  });

  it('rejects on the streaming transport as a failure, not an abort', async () => {
    const error = await failureOf(async () => {
      const res = await nitroFetch(PINNED_MISMATCH, { stream: true } as any);
      await res.text();
    });
    expect(error).toBeDefined();
    expect(error?.name).not.toBe('AbortError');
    expect(String(error?.message)).toContain(PIN_ERROR);
  });

  it('rejects a fetch that joins a failed prefetch', async () => {
    const url = `${PINNED_MISMATCH}?prefetch=1`;
    const init = { headers: { prefetchKey: 'certificate-pinning-mismatch' } };
    await prefetch(url, init).catch(() => {});
    const error = await failureOf(() => nitroFetch(url, init));
    expect(error).toBeDefined();
    expect(String(error?.message)).toContain(PIN_ERROR);
  });

  it('leaves hosts without pins alone', async () => {
    const res = await nitroFetch(UNPINNED);
    expect(res.status).toBe(200);
  });
});
