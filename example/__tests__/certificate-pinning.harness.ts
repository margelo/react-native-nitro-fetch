import { describe, it, expect } from 'react-native-harness';
import {
  callRefreshEndpoint,
  fetch as nitroFetch,
  prefetch,
} from 'react-native-nitro-fetch';
import { NitroWebSocket } from 'react-native-nitro-websockets';

// The example app bundles nitro-fetch-pinning.json (android/app/src/main/assets and the iOS app target):
//   - aws.amazon.com is pinned to the Amazon Trust Services roots its chain ends at, so it connects.
//   - gstatic.com (includeSubdomains) is pinned to a key no chain contains, so www.gstatic.com fails.
//   - google.com (exact host only) is pinned to that same key, so www.google.com is not pinned.
//   - amazon.com (includeSubdomains) is pinned to that key too. Host matching follows Cronet on every
//     path: the most specific live entry decides, and expired entries are skipped. So
//     docs.aws.amazon.com is unpinned (aws.amazon.com is exact-only), and www.amazon.com, whose own
//     entry has expired, falls back to amazon.com and fails.
//   - expired.badssl.com is pinned too, but its certificate has expired, so it must fail with the
//     platform's certificate error rather than the pinning error.
//   - wss:// uses the same hosts. None of them runs a WebSocket server, so a connection that
//     passes the pin check fails at the upgrade instead. AppDelegate.swift and MainApplication.kt
//     prewarm wss://www.gstatic.com/ on every launch.
// No other suite uses these hosts. example.com is not in the file.
const PINNED_OK = 'https://aws.amazon.com/robots.txt';
const PINNED_MISMATCH = 'https://www.gstatic.com/generate_204';
const SUBDOMAIN_OF_EXACT_PIN = 'https://www.google.com/generate_204';
const UNDER_EXACT_ONLY_ENTRY = 'https://docs.aws.amazon.com/';
const EXPIRED_UNDER_PINNED_PARENT = 'https://www.amazon.com/';
const EXPIRED_CERTIFICATE = 'https://expired.badssl.com/';
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

  it('falls back to the parent entry when the exact entry has expired', async () => {
    const error = await failureOf(() =>
      nitroFetch(EXPIRED_UNDER_PINNED_PARENT, { method: 'HEAD' })
    );
    expect(error).toBeDefined();
    expect(String(error?.message)).toContain(PIN_ERROR);
  });

  it('reports an untrusted certificate on a pinned host as a certificate error', async () => {
    const error = await failureOf(() => nitroFetch(EXPIRED_CERTIFICATE));
    expect(error).toBeDefined();
    expect(String(error?.message)).not.toContain(PIN_ERROR);
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

  it('stops at an exact-only entry instead of using a parent with includeSubdomains', async () => {
    const res = await nitroFetch(UNDER_EXACT_ONLY_ENTRY, { method: 'HEAD' });
    expect(typeof res.status).toBe('number');
  });

  it('fetches a FormData file part from a host that is not in the pin file', async () => {
    const res = await uploadPartFrom(UNPINNED);
    expect(typeof res.status).toBe('number');
  });
});

describe('Certificate pinning: callRefreshEndpoint', () => {
  it('rejects a refresh from a host whose pins do not match', async () => {
    const error = await failureOf(() =>
      callRefreshEndpoint({
        url: PINNED_MISMATCH,
        method: 'GET',
        responseType: 'text',
      })
    );
    expect(error).toBeDefined();
    expect(String(error?.message)).toContain(PIN_ERROR);
  });

  it('refreshes from a host whose pins match', async () => {
    const headers = await callRefreshEndpoint({
      url: `${PINNED_OK}?refresh=1`,
      method: 'GET',
      responseType: 'text',
      textHeader: 'x-refreshed',
    });
    expect(typeof headers['x-refreshed']).toBe('string');
  });
});

const WSS_PINNED_MISMATCH = 'wss://www.gstatic.com/generate_204';
// AppDelegate.swift and MainApplication.kt prewarm this URL on every launch.
const WSS_PREWARMED_MISMATCH = 'wss://www.gstatic.com/';
const WSS_EXPIRED_UNDER_PINNED_PARENT = 'wss://www.amazon.com/';
const WSS_SUBDOMAIN_OF_EXACT_PIN = 'wss://www.google.com/';
const WSS_PINNED_OK = 'wss://aws.amazon.com/';
const WSS_EXPIRED_CERTIFICATE = 'wss://expired.badssl.com/';
const WSS_UNPINNED = 'wss://example.com/';
const WSS_TIMEOUT_MS = 15_000;
// The error of a connection that got through TLS and the pin check to a server that doesn't
// speak WebSocket (iOS, Android).
const UPGRADE_FAILED = /bad response from the server|not 101/;
// A certificate error (iOS, Android), so DNS failures or no network can't pass for one.
const CERTIFICATE_ERROR = /certificate|\bcert\b/i;

// Resolves with 'open', or with the error the connection failed with.
function wsOutcome(ws: NitroWebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timeout: ${ws.url} did not open or fail in ${WSS_TIMEOUT_MS} ms`
        )
      );
      ws.close();
    }, WSS_TIMEOUT_MS);
    const settle = (outcome: string) => {
      clearTimeout(timer);
      resolve(outcome);
    };
    ws.onopen = () => {
      settle('open');
      ws.close();
    };
    ws.onerror = (error) => settle(String(error));
    ws.onclose = (event) => settle(`closed with ${event.code}`);
  });
}

describe('Certificate pinning: wss://', () => {
  it('fails when the chain has no pinned key', async () => {
    const outcome = await wsOutcome(new NitroWebSocket(WSS_PINNED_MISMATCH));
    expect(outcome).toContain(PIN_ERROR);
  });

  it('does not hand over a prewarmed socket whose pins do not match', async () => {
    const ws = new NitroWebSocket(WSS_PREWARMED_MISMATCH);
    // The adopted prewarm has already failed; a new connection would still be CONNECTING.
    expect(ws.readyState).toBe('CLOSED');
    expect(await wsOutcome(ws)).toContain(PIN_ERROR);
  });

  it('falls back to the parent entry when the exact entry has expired', async () => {
    const outcome = await wsOutcome(
      new NitroWebSocket(WSS_EXPIRED_UNDER_PINNED_PARENT)
    );
    expect(outcome).toContain(PIN_ERROR);
  });

  it('passes the pin check when the chain contains a pinned root', async () => {
    const outcome = await wsOutcome(new NitroWebSocket(WSS_PINNED_OK));
    expect(outcome).toMatch(UPGRADE_FAILED);
  });

  it('does not apply an exact-host pin to its subdomains', async () => {
    const outcome = await wsOutcome(
      new NitroWebSocket(WSS_SUBDOMAIN_OF_EXACT_PIN)
    );
    expect(outcome).toMatch(UPGRADE_FAILED);
  });

  it('reports an untrusted certificate on a pinned host as a certificate error', async () => {
    const outcome = await wsOutcome(
      new NitroWebSocket(WSS_EXPIRED_CERTIFICATE)
    );
    expect(outcome).toMatch(CERTIFICATE_ERROR);
    expect(outcome).not.toContain(PIN_ERROR);
  });

  it('does not check a host that is not in the pin file', async () => {
    const outcome = await wsOutcome(new NitroWebSocket(WSS_UNPINNED));
    expect(outcome).toMatch(UPGRADE_FAILED);
  });
});
