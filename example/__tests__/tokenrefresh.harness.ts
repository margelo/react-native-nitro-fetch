import { describe, it, expect } from 'react-native-harness';
import {
  fetch as nitroFetch,
  prefetch,
  removeFromAutoPrefetch,
  callRefreshEndpoint,
  registerTokenRefresh,
  getStoredTokenRefreshConfig,
  clearTokenRefresh,
} from 'react-native-nitro-fetch';
import { BASE } from '../test-utils/server';

describe('NitroFetch - Token refresh (callRefreshEndpoint)', () => {
  it('maps a JSON field into a templated header', async () => {
    const headers = await callRefreshEndpoint({
      url: `${BASE}/token`,
      method: 'POST',
      responseType: 'json',
      mappings: [
        {
          jsonPath: 'access_token',
          header: 'Authorization',
          valueTemplate: 'Bearer {{value}}',
        },
      ],
    });
    expect(headers.Authorization).toBe('Bearer tok_abc123');
  });

  it('maps a field without a template verbatim', async () => {
    const headers = await callRefreshEndpoint({
      url: `${BASE}/token`,
      method: 'POST',
      responseType: 'json',
      mappings: [{ jsonPath: 'token_type', header: 'X-Token-Type' }],
    });
    expect(headers['X-Token-Type']).toBe('Bearer');
  });

  it('resolves a nested dot-path and builds a composite header', async () => {
    const headers = await callRefreshEndpoint({
      url: `${BASE}/token`,
      method: 'POST',
      responseType: 'json',
      compositeHeaders: [
        {
          header: 'X-User',
          template: '{{id}}@{{region}}',
          paths: { id: 'user.id', region: 'user.region' },
        },
      ],
    });
    expect(headers['X-User']).toBe('u_42@us');
  });

  it('applies a text-response template', async () => {
    const headers = await callRefreshEndpoint({
      url: `${BASE}/token/text`,
      method: 'GET',
      responseType: 'text',
      textHeader: 'X-Raw-Token',
      textTemplate: 'v={{value}}',
    });
    expect(headers['X-Raw-Token']).toBe('v=plain-token-xyz');
  });

  it('rejects when the refresh endpoint returns a non-2xx status', async () => {
    let threw = false;
    try {
      await callRefreshEndpoint({
        url: `${BASE}/token/fail`,
        method: 'POST',
        responseType: 'json',
        mappings: [{ jsonPath: 'access_token', header: 'Authorization' }],
      });
    } catch (e: any) {
      threw = true;
      expect(e.message).toContain('Token refresh failed');
    }
    expect(threw).toBe(true);
  });
});

// The point of a refresh is that the minted token reaches the real request.
// The test-server /anything/* routes echo back the headers they received, so we
// can assert the token actually landed on the wire — both on a direct fetch and
// through the prefetch -> cache -> consume path the native cold-start replays.
describe('NitroFetch - Token refresh flows to the API', () => {
  it('injects the refreshed token into a downstream API request', async () => {
    const headers = await callRefreshEndpoint({
      url: `${BASE}/token`,
      method: 'POST',
      responseType: 'json',
      mappings: [
        {
          jsonPath: 'access_token',
          header: 'Authorization',
          valueTemplate: 'Bearer {{value}}',
        },
      ],
    });
    const res = await nitroFetch(`${BASE}/anything/token-flow-direct`, {
      headers,
    });
    const json = await res.json();
    expect(res.ok).toBe(true);
    expect(json.headers.Authorization).toBe('Bearer tok_abc123');
  });

  it('flows a composite refreshed header to the API', async () => {
    const headers = await callRefreshEndpoint({
      url: `${BASE}/token`,
      method: 'POST',
      responseType: 'json',
      compositeHeaders: [
        {
          header: 'X-User',
          template: '{{id}}@{{region}}',
          paths: { id: 'user.id', region: 'user.region' },
        },
      ],
    });
    const res = await nitroFetch(`${BASE}/anything/token-flow-composite`, {
      headers,
    });
    const json = await res.json();
    expect(json.headers['X-User']).toBe('u_42@us');
  });

  it('carries the refreshed token through a prefetch to the API', async () => {
    const STAMP = String(Date.now());
    const KEY = 'tokflow-' + STAMP;
    const URL = `${BASE}/anything/tokflow-${STAMP}`;
    const refreshed = await callRefreshEndpoint({
      url: `${BASE}/token`,
      method: 'POST',
      responseType: 'json',
      mappings: [
        {
          jsonPath: 'access_token',
          header: 'Authorization',
          valueTemplate: 'Bearer {{value}}',
        },
      ],
    });
    // Prefetch fires the real request with the refreshed header; the server
    // echoes it into the body, which the cache then serves back on consume.
    await prefetch(URL, {
      headers: { ...refreshed, prefetchKey: KEY },
      prefetchCacheTtlMs: 60_000,
    } as any);
    const res = await nitroFetch(URL, {
      headers: { prefetchKey: KEY },
      prefetchCacheTtlMs: 60_000,
    } as any);
    const json = await res.json();
    // Served from the prefetch cache…
    expect(res.headers.get('nitroPrefetched')).toBe('true');
    // …and the token that reached the API during the prefetch is the fresh one.
    expect(json.headers.Authorization).toBe('Bearer tok_abc123');
    await removeFromAutoPrefetch(KEY);
  });
});

describe('NitroFetch - Token refresh config persistence', () => {
  const config = {
    target: 'fetch' as const,
    url: `${BASE}/token`,
    method: 'POST' as const,
    responseType: 'json' as const,
    mappings: [
      {
        jsonPath: 'access_token',
        header: 'Authorization',
        valueTemplate: 'Bearer {{value}}',
      },
    ],
  };

  it('round-trips a fetch refresh config through secure storage', () => {
    registerTokenRefresh(config);
    const stored = getStoredTokenRefreshConfig('fetch');
    expect(stored).not.toBeNull();
    expect(stored!.url).toBe(config.url);
    expect(stored!.method).toBe('POST');
    expect(stored!.mappings?.[0]?.header).toBe('Authorization');
    // `target` is a routing key for registration, not part of the stored config.
    expect((stored as any).target).toBeUndefined();
  });

  it('clearTokenRefresh removes the stored config', () => {
    registerTokenRefresh(config);
    expect(getStoredTokenRefreshConfig('fetch')).not.toBeNull();
    clearTokenRefresh('fetch');
    expect(getStoredTokenRefreshConfig('fetch')).toBeNull();
  });
});
