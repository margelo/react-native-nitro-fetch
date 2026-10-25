import type { HybridObject } from 'react-native-nitro-modules';
import type { UrlResponseInfo } from './NitroCronet.nitro';

// Minimal request/response types to model WHATWG fetch without streaming.
export type NitroRequestMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS';

export type NitroRequestCredentials = 'include' | 'omit' | 'same-origin';

export type NitroRequestPriority = 'high' | 'low';

export interface NitroHeader {
  key: string;
  value: string;
}

export interface NitroFormDataPart {
  name: string;
  value?: string;
  fileUri?: string;
  fileName?: string;
  mimeType?: string;
}

export interface NitroRequest {
  url: string;
  method?: NitroRequestMethod;
  // Flattened list to keep bridging simple and deterministic
  headers?: NitroHeader[];
  // Body as either UTF-8 string or raw bytes.
  bodyString?: string;
  bodyBytes?: ArrayBuffer;
  // Base64 body for the persisted prefetch queue, replayed from JSON before Nitro exists.
  bodyBytesBase64?: string;
  // Multipart form data parts (for file uploads)
  bodyFormData?: NitroFormDataPart[];
  // Controls
  timeoutMs?: number;
  followRedirects?: boolean; // default true
  credentials?: NitroRequestCredentials; // default 'same-origin'; 'omit' skips cookie jar read/write
  priority?: NitroRequestPriority;
  // Max age (ms) a prefetch cache entry is considered fresh at read time.
  // Default 5000 when omitted. <= 0 disables cache hits.
  prefetchCacheTtlMs?: number;
  // Optional ID used for cancellation via cancelRequest()
  requestId?: string;
}

// How requestWithEvents() sends a request and returns its body.
export interface NitroRequestOptions {
  // Return the body as bodyBytes, exactly as received, instead of decoding it
  // as text.
  responseBytes?: boolean;
  // A method NitroRequestMethod does not cover, such as PROPFIND. Sent instead
  // of the request's method.
  customMethod?: string;
  // Run on the stream client's connections (its own Cronet engine on Android,
  // its own URLSession on iOS), so a long-lived response cannot hold the
  // default client's.
  separateConnections?: boolean;
}

export interface NitroResponse {
  url: string; // final URL after redirects
  status: number;
  statusText: string;
  ok: boolean;
  redirected: boolean;
  headers: NitroHeader[];
  bodyString?: string;
  bodyBytes?: ArrayBuffer;
}

export interface NitroFetchClient extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  // Client-binded request that uses the env configured at creation.
  request(req: NitroRequest): Promise<NitroResponse>;
  // request(), for the XMLHttpRequest polyfill. The callbacks report the
  // response while it loads:
  // - onResponseStarted gets the status, headers and final URL before the
  //   body, unless the whole body arrives with them.
  // - onData gets the body as it arrives when the server streams it, and the
  //   response then resolves without a body: at once for text/event-stream,
  //   NDJSON and multipart/x-mixed-replace, from 400 ms or 8 MB for a body
  //   without an exact length (or a text body with onProgress), and for a
  //   text body larger than 256 KB, so JS decodes it while it downloads.
  //   Native
  //   sends the next chunk once JS has returned from this one, and joins what
  //   arrives meanwhile into chunks of up to 64 KB. JS returns false once it
  //   no longer wants the body, such as after an abort.
  // - onProgress gets the bytes received so far and the exact length (-1 if
  //   unknown), at most every 50 ms and once at the end.
  requestWithEvents(
    req: NitroRequest,
    options: NitroRequestOptions,
    onResponseStarted?: (info: UrlResponseInfo) => void,
    onData?: (chunk: ArrayBuffer) => boolean,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<NitroResponse>;
  // Start a prefetch for a given request; expects a header `prefetchKey`.
  prefetch(req: NitroRequest): Promise<void>;

  // Synchronous version of request for worklets
  requestSync(req: NitroRequest): NitroResponse;

  // Cancel an in-flight request by its requestId
  cancelRequest(requestId: string): void;
}

export interface NitroFetch extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  // Create a client bound to a given environment (e.g., cache dir).
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
