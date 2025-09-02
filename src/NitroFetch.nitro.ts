import type { HybridObject } from 'react-native-nitro-modules';
import type { NitroEnv } from './NitroEnv.nitro';

// Minimal request/response types to model WHATWG fetch without streaming.
export type NitroRequestMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS';

export type NitroHeader = [string, string];

export interface NitroRequest {
  url: string;
  method?: NitroRequestMethod;
  // Flattened list to keep bridging simple and deterministic
  headers?: NitroHeader[];
  // Body encoded as base64. Omit or empty for no body.
  bodyBase64?: string;
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
  // Body as base64, not streamed (first implementation target)
  bodyBase64: string;
}

export interface NitroFetchClient
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  // Client-binded request that uses the env configured at creation.
  request(req: NitroRequest): Promise<NitroResponse>;
}

export interface NitroFetch
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  // Create a client bound to a given environment (e.g., cache dir).
  createClient(env?: NitroEnv): NitroFetchClient;

  // Optional future: global abort/teardown
  // shutdown(): void;
}
