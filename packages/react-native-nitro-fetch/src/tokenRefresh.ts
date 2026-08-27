import { NativeStorage as NativeStorageSingleton } from './NitroInstances';
import {
  getNestedField,
  applyTemplate,
  applyCompositeTemplate,
} from './tokenRefreshConfig';
import type { TokenRefreshConfig } from './tokenRefreshConfig';
export { getNestedField, applyTemplate } from './tokenRefreshConfig';
export type { TokenRefreshConfig } from './tokenRefreshConfig';

// Storage keys
const KEY_WS = 'nitro_token_refresh_websocket';
const KEY_FETCH = 'nitro_token_refresh_fetch';
const KEY_WS_CACHE = 'nitro_token_refresh_ws_cache';
const KEY_FETCH_CACHE = 'nitro_token_refresh_fetch_cache';

type TokenRefreshTarget = 'websocket' | 'fetch' | 'all';

export async function callRefreshEndpoint(
  config: TokenRefreshConfig
): Promise<Record<string, string>> {
  const method = config.method ?? 'POST';
  const response = await fetch(config.url, {
    method,
    headers: config.headers,
    body: config.body,
  });

  if (!response.ok) {
    throw new Error(
      `Token refresh failed: ${response.status} ${response.statusText}`
    );
  }

  const headers: Record<string, string> = {};

  if (config.responseType === 'text') {
    const text = await response.text();
    if (config.textHeader) {
      headers[config.textHeader] = config.textTemplate
        ? applyTemplate(config.textTemplate, text)
        : text;
    }
    return headers;
  }

  // Default: json
  const json = await response.json();

  if (config.mappings) {
    for (const mapping of config.mappings) {
      const value = getNestedField(json, mapping.jsonPath);
      if (value != null) {
        headers[mapping.header] = mapping.valueTemplate
          ? applyTemplate(mapping.valueTemplate, value)
          : value;
      }
    }
  }

  if (config.compositeHeaders) {
    for (const comp of config.compositeHeaders) {
      const values: Record<string, string> = Object.create(null);
      for (const [placeholder, jsonPath] of Object.entries(comp.paths)) {
        values[placeholder] = getNestedField(json, jsonPath) ?? '';
      }
      headers[comp.header] = applyCompositeTemplate(comp.template, values);
    }
  }

  return headers;
}

export function registerTokenRefresh(
  options: { target: TokenRefreshTarget } & TokenRefreshConfig
): void {
  const { target, ...config } = options;
  const raw = JSON.stringify(config);
  if (target === 'websocket' || target === 'all') {
    NativeStorageSingleton.setSecureString(KEY_WS, raw);
  }
  if (target === 'fetch' || target === 'all') {
    NativeStorageSingleton.setSecureString(KEY_FETCH, raw);
  }
}

export function clearTokenRefresh(target?: TokenRefreshTarget): void {
  const t = target ?? 'all';
  if (t === 'websocket' || t === 'all') {
    NativeStorageSingleton.removeSecureString(KEY_WS);
    NativeStorageSingleton.removeSecureString(KEY_WS_CACHE);
  }
  if (t === 'fetch' || t === 'all') {
    NativeStorageSingleton.removeSecureString(KEY_FETCH);
    NativeStorageSingleton.removeSecureString(KEY_FETCH_CACHE);
  }
}

export function getStoredTokenRefreshConfig(
  target: 'websocket' | 'fetch'
): TokenRefreshConfig | null {
  const key = target === 'websocket' ? KEY_WS : KEY_FETCH;
  try {
    const raw = NativeStorageSingleton.getSecureString(key);
    if (!raw) return null;
    return JSON.parse(raw) as TokenRefreshConfig;
  } catch {
    return null;
  }
}
