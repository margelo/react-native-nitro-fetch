import { NativeStorage as NativeStorageSingleton } from './NitroInstances';

// Storage keys
const KEY_WS = 'nitro_token_refresh_websocket';
const KEY_FETCH = 'nitro_token_refresh_fetch';
const KEY_WS_CACHE = 'nitro_token_refresh_ws_cache';
const KEY_FETCH_CACHE = 'nitro_token_refresh_fetch_cache';

/** Which app-start requests a token refresh applies to. */
export type TokenRefreshTarget = 'websocket' | 'fetch' | 'all';

/** Copies a value from the refresh response into a request header. */
export type TokenRefreshJsonMapping = {
  /** Dot path to the value in the JSON response, such as `data.token`. */
  jsonPath: string;
  /** Header to set. */
  header: string;
  /** Template for the value, such as `Bearer {{value}}`. */
  valueTemplate?: string;
};

/** Builds one header from several values in the refresh response. */
export type TokenRefreshCompositeHeader = {
  /** Header to set. */
  header: string;
  /** Template with a `{{name}}` placeholder for each entry in `paths`. */
  template: string;
  /** Placeholder names mapped to dot paths in the JSON response. */
  paths: Record<string, string>;
};

/** Copies a value from the refresh response into a prefetch's JSON body. */
export type TokenRefreshBodyMapping = {
  /** Dot path to the value in the JSON response. */
  jsonPath: string;
  /** Dot path to set in the request body, such as `auth.token`. */
  bodyPath: string;
  /** Template for the value, such as `Bearer {{value}}`. */
  valueTemplate?: string;
};

/** Copies a value from the refresh response into a prefetch's form-data field. */
export type TokenRefreshFormDataMapping = {
  /** Dot path to the value in the JSON response. */
  jsonPath: string;
  /** Form field to set. */
  field: string;
  /** Template for the value, such as `Bearer {{value}}`. */
  valueTemplate?: string;
};

/** How to get a fresh token at app start, before JavaScript runs, and where to put it. */
export type TokenRefreshConfig = {
  /** Refresh endpoint. */
  url: string;
  /** Default `'POST'`. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  /** Headers for the refresh request. */
  headers?: Record<string, string>;
  /** Body for the refresh request. */
  body?: string;
  /** How to read the refresh response. Default `'json'`. */
  responseType?: 'json' | 'text';
  /** Values to copy into headers. */
  mappings?: TokenRefreshJsonMapping[];
  /** Headers built from several values. */
  compositeHeaders?: TokenRefreshCompositeHeader[];
  /** With a `'text'` response, the header to set. */
  textHeader?: string;
  /** With a `'text'` response, a template for the value, such as `Bearer {{value}}`. */
  textTemplate?: string;
  /** Values to copy into a prefetch's JSON body. */
  bodyMappings?: TokenRefreshBodyMapping[];
  /** Values to copy into a prefetch's form-data fields. */
  formDataMappings?: TokenRefreshFormDataMapping[];
  /** With a `'text'` response, the dot path to set in a prefetch's JSON body. */
  bodyTextPath?: string;
  /** With a `'text'` response, the form field to set. */
  formDataTextField?: string;
  /** What to do if the refresh fails. The default, `'useStoredHeaders'`, reuses the last good headers. */
  onFailure?: 'skip' | 'useStoredHeaders';
};

// — Helpers —

/** Read the value at a dot path, such as `data.token`, in a parsed JSON object. */
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

/** Replaces each `{{value}}` in `template` with `value`. */
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

/** Calls the refresh endpoint from JavaScript and returns the headers the config builds from its response. */
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

/** Saves a token refresh config, encrypted, for app-start prefetches and WebSocket prewarms. */
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

/** Removes the saved config and cached headers. Default `'all'`. */
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

/** Reads back the saved config, or `null` if none is saved. */
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
