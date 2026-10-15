import type { HybridObject } from 'react-native-nitro-modules';

// Minimal request/response types to model WHATWG fetch without streaming.
/** HTTP method of a {@link NitroRequest}. */
export type NitroRequestMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS';

/** `'omit'` sends and saves no cookies. The other two behave the same. */
export type NitroRequestCredentials = 'include' | 'omit' | 'same-origin';

/** How urgent a {@link NitroRequest} is. */
export type NitroRequestPriority = 'high' | 'low';

/** One header name and value. */
export interface NitroHeader {
  /** Header name. */
  key: string;
  /** Header value. */
  value: string;
}

/** One part of a multipart form body. Set `value` for text, or `fileUri` to send a file. */
export interface NitroFormDataPart {
  /** Field name. */
  name: string;
  /** Text value. */
  value?: string;
  /** File to send. */
  fileUri?: string;
  /** File name sent to the server. Default `'file'`. */
  fileName?: string;
  /** File type. Default `'application/octet-stream'`. */
  mimeType?: string;
}

/** A request in the form the native client takes. */
export interface NitroRequest {
  url: string;
  /** Default `'GET'`. */
  method?: NitroRequestMethod;
  /** Headers as a flat list of name and value pairs. */
  headers?: NitroHeader[];
  /** Body as either UTF-8 string or raw bytes. */
  bodyString?: string;
  bodyBytes?: ArrayBuffer;
  /** Body as base64, for app-start prefetches saved as JSON. */
  bodyBytesBase64?: string;
  /** Multipart form data parts (for file uploads) */
  bodyFormData?: NitroFormDataPart[];
  // Controls
  /** Fails the request if no data arrives for this many milliseconds. */
  timeoutMs?: number;
  /** Default `true`. */
  followRedirects?: boolean;
  /** Default `'same-origin'`. `'omit'` skips reading and saving cookies. */
  credentials?: NitroRequestCredentials;
  /** How urgent the request is. */
  priority?: NitroRequestPriority;
  /** How long (ms) a prefetched response stays fresh. Default 5000. `<= 0` disables cache hits. */
  prefetchCacheTtlMs?: number;
  /** Optional ID used to cancel the request with `cancelRequest()`. */
  requestId?: string;
}

/** A response in the form the native client returns. */
export interface NitroResponse {
  /** Final URL after redirects. */
  url: string;
  status: number;
  statusText: string;
  /** `true` for a status from 200 to 299. */
  ok: boolean;
  /** Whether the request was redirected. */
  redirected: boolean;
  headers: NitroHeader[];
  /** Body as a UTF-8 string. */
  bodyString?: string;
  /** Body as raw bytes. */
  bodyBytes?: ArrayBuffer;
}

export interface NitroFetchClient extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  // Client-binded request that uses the env configured at creation.
  request(req: NitroRequest): Promise<NitroResponse>;
  // Start a prefetch for a given request; expects a header `prefetchKey`.
  prefetch(req: NitroRequest): Promise<void>;

  // Synchronous version of request for worklets
  requestSync(req: NitroRequest): NitroResponse;

  // Cancel an in-flight request by its requestId
  cancelRequest(requestId: string): void;
}

/** The native fetch module. Apps normally use `fetch` instead. */
export interface NitroFetch extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  /** Create a client bound to a given environment (e.g., cache dir). */
  createClient(): NitroFetchClient;

  // Optional future: global abort/teardown
  // shutdown(): void;
}

export interface NativeStorage extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  getString(key: string): string;
  setString(key: string, value: string): void;
  removeString(key: string): void;
  /** AES-GCM at rest in the same prefs/suite as getString; key material in Keystore / Keychain. */
  getSecureString(key: string): string;
  setSecureString(key: string, value: string): void;
  removeSecureString(key: string): void;
}
