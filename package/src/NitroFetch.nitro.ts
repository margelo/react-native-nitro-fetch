import type { HybridObject } from 'react-native-nitro-modules';

// Minimal request/response types to model WHATWG fetch without streaming.
export type NitroRequestMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS';

export interface NitroHeader {
  key: string;
  value: string;
}
export interface NitroRequest {
  url: string;
  method?: NitroRequestMethod;
  // Flattened list to keep bridging simple and deterministic
  headers?: NitroHeader[];
  // Body as either UTF-8 string or raw bytes.
  bodyString?: string;
  bodyBytes?: string; //will be ArrayBuffer in future
  // Controls
  timeoutMs?: number;
  followRedirects?: boolean; // default true
}

export interface NitroResponse {
  url: string; // final URL after redirects
  status: number;
  statusText: string;
  ok: boolean;
  redirected: boolean;
  headers: NitroHeader[];
  // Body as either UTF-8 string or raw bytes (first implementation target)
  bodyString?: string;
  bodyBytes?: string; //will be ArrayBuffer in future
}

export interface NitroFetchClient
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  // Client-binded request that uses the env configured at creation.
  request(req: NitroRequest): Promise<NitroResponse>;
  // Start a prefetch for a given request; expects a header `prefetchKey`.
  prefetch(req: NitroRequest): Promise<void>;
}

export interface NitroFetch
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  // Create a client bound to a given environment (e.g., cache dir).
  createClient(): NitroFetchClient;

  // Optional future: global abort/teardown
  // shutdown(): void;
}





export interface NativeStorage extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  getString(key: string): string;
  setString(key: string, value: string): void;
  removeString(key: string): void;
}