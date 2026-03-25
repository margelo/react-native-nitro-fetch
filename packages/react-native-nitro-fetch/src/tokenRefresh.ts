import { NativeStorage as NativeStorageSingleton } from './NitroInstances';

// Storage keys
const KEY_WS = 'nitro_token_refresh_websocket';
const KEY_FETCH = 'nitro_token_refresh_fetch';
const KEY_WS_CACHE = 'nitro_token_refresh_ws_cache';
const KEY_FETCH_CACHE = 'nitro_token_refresh_fetch_cache';

type TokenRefreshTarget = 'websocket' | 'fetch' | 'all';

type TokenRefreshJsonMapping = {
  jsonPath: string;
  header: string;
  valueTemplate?: string;
};

type TokenRefreshCompositeHeader = {
  header: string;
  template: string;
  paths: Record<string, string>;
};

export type TokenRefreshConfig = {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body?: string;
  responseType?: 'json' | 'text';
  mappings?: TokenRefreshJsonMapping[];
  compositeHeaders?: TokenRefreshCompositeHeader[];
  textHeader?: string;
  textTemplate?: string;
  onFailure?: 'skip' | 'useStoredHeaders';
};

// — Helpers —

/**
 * Resolve a dot-notation path inside a parsed JSON object.
 */
export function getNestedField(
  obj: unknown,
  dotPath: string
): string | undefined {
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current != null ? String(current) : undefined;
}

export function applyTemplate(template: string, value: string): string {
  return template.replace(/\{\{value\}\}/g, value);
}

function applyCompositeTemplate(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_: string, key: string) => values[key] ?? ''
  );
}

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
      const values: Record<string, string> = {};
      for (const [placeholder, jsonPath] of Object.entries(comp.paths)) {
        const val = getNestedField(json, jsonPath);
        if (val != null) values[placeholder] = val;
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
