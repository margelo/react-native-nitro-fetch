import { describe, it, expect } from 'react-native-harness';
import { fetch as nitroFetch, prefetch } from 'react-native-nitro-fetch';

// The example app bundles nitro-fetch-pinning.json (android/app/src/main/assets and the iOS app target):
//   - aws.amazon.com is pinned to the Amazon Trust Services roots its chain ends at, so it connects.
//   - gstatic.com (includeSubdomains) is pinned to a key no chain contains, so www.gstatic.com fails.
//   - google.com (exact host only) is pinned to that same key, so www.google.com is not pinned.
// No other suite uses aws.amazon.com, gstatic.com or google.com. example.com is not in the file.
const PINNED_OK = 'https://aws.amazon.com/robots.txt';
const PINNED_MISMATCH = 'https://www.gstatic.com/generate_204';
const SUBDOMAIN_OF_EXACT_PIN = 'https://www.google.com/generate_204';
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

// Multipart upload whose file part is fetched from `partUrl` (the HttpURLConnection path on Android).
function uploadPartFrom(partUrl: string) {
  const form = new FormData();
  form.append('file', {
    uri: partUrl,
    name: 'part.bin',
    type: 'application/octet-stream',
  } as any);
  return nitroFetch(UNPINNED, { method: 'POST', body: form as any });
}

describe('Certificate pinning: pinned hosts', () => {
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

  it('fetches a FormData file part from a host whose pins match', async () => {
    const res = await uploadPartFrom(PINNED_OK);
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

  it('rejects a FormData file part from a host whose pins do not match', async () => {
    const error = await failureOf(() => uploadPartFrom(PINNED_MISMATCH));
    expect(error).toBeDefined();
    expect(String(error?.message)).toContain(PIN_ERROR);
  });

  it('still reports a caller abort as an AbortError', async () => {
    const controller = new AbortController();
    const pending = nitroFetch(`${PINNED_OK}?abort=1`, {
      signal: controller.signal,
    });
    controller.abort();
    const error = await failureOf(() => pending);
    expect(error?.name).toBe('AbortError');
  });
});

describe('Certificate pinning: hosts without pins', () => {
  it('fetches a host that is not in the pin file', async () => {
    const res = await nitroFetch(UNPINNED);
    expect(res.status).toBe(200);
  });

  it('streams from a host that is not in the pin file', async () => {
    const res = await nitroFetch(UNPINNED, { stream: true } as any);
    await res.text();
    expect(res.status).toBe(200);
  });

  it('does not apply an exact-host pin to its subdomains', async () => {
    const res = await nitroFetch(SUBDOMAIN_OF_EXACT_PIN);
    expect(res.status).toBe(204);
  });

  it('fetches a FormData file part from a host that is not in the pin file', async () => {
    const res = await uploadPartFrom(UNPINNED);
    expect(typeof res.status).toBe('number');
  });
});
