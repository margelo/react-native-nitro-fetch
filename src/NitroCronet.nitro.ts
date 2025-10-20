import type { HybridObject } from 'react-native-nitro-modules';
import type { RequestException } from './NitroException.nitro';

export interface HttpHeader {
  key: string;
  value: string;
}

export interface UrlResponseInfo {
  url: string;
  httpStatusCode: number;
  httpStatusText: string;
  allHeaders: Record<string, string>;
  allHeadersAsList: HttpHeader[];
  urlChain: string[];
  negotiatedProtocol: string;
  proxyServer: string;
  receivedByteCount: number;
  wasCached: boolean; // useful to know
}

export interface UrlRequestCallback {
  onRedirectReceived(info: UrlResponseInfo, newLocationUrl: string): void;
  onResponseStarted(info: UrlResponseInfo): void;
  onReadCompleted(info: UrlResponseInfo, byteBuffer: ArrayBuffer): void;
  onSucceeded(info: UrlResponseInfo): void;
  onFailed(info: UrlResponseInfo | undefined, error: RequestException): void;
  onCanceled(info: UrlResponseInfo | undefined): void;
}

export interface UploadDataSink {
  onReadSucceeded(finalChunk: boolean): void;
  onReadError(error: string): void;
  onRewindSucceeded(): void;
  onRewindError(error: string): void;
}

export interface UploadDataProvider {
  length: number;
  read(uploadDataSink: UploadDataSink, byteBuffer: ArrayBuffer): void;
  rewind(uploadDataSink: UploadDataSink): void;
}

export interface UrlRequest
  extends HybridObject<{ android: 'kotlin'; ios: 'swift' }> {
  start(): void;
  followRedirect(): void;
  read(buffer: ArrayBuffer): void;
  cancel(): void;
  isDone(): boolean;
}

export interface UrlRequestBuilder
  extends HybridObject<{ android: 'kotlin'; ios: 'swift' }> {
  setHttpMethod(httpMethod: string): void;
  addHeader(name: string, value: string): void;
  setUploadDataProvider(provider: UploadDataProvider): void;
  setUploadBody(body: ArrayBuffer | string): void; // Simple helper for common case
  disableCache(): void;
  setPriority(priority: number): void; // 0=IDLE, 1=LOWEST, 2=LOW, 3=MEDIUM, 4=HIGHEST
  allowDirectExecutor(): void;
  build(): UrlRequest;
}

export interface CachedFetchResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
}

export interface NitroCronet
  extends HybridObject<{ android: 'kotlin'; ios: 'swift' }> {
  newUrlRequestBuilder(
    url: string,
    callback: UrlRequestCallback
  ): UrlRequestBuilder;
  /**
   * Start a prefetch request that will be stored in the native cache.
   * The response will be available for consumption via prefetchKey.
   * @param maxAge Maximum age in milliseconds for the cached response to be considered fresh
   */
  prefetch(
    url: string,
    httpMethod: string,
    headers: Record<string, string>,
    body: ArrayBuffer | string | undefined,
    maxAge: number
  ): Promise<void>;

  /**
   * Try to consume a prefetched response from the native cache.
   * Returns a promise that resolves with the cached response if found and fresh,
   * or waits for a pending prefetch to complete, or rejects if not available.
   */
  consumeNativePrefetch(
    prefetchKey: string
  ): Promise<CachedFetchResponse | undefined>;
}
