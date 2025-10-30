import type { HybridObject } from 'react-native-nitro-modules';
import type { RequestException } from './NitroException';

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

// TEMP: Removed for now - too complex, use setUploadBody() instead
// export interface UploadDataSink
//   extends HybridObject<{ android: 'kotlin'; ios: 'swift' }> {
//   onReadSucceeded(finalChunk: boolean): void;
//   onReadError(error: string): void;
//   onRewindSucceeded(): void;
//   onRewindError(error: string): void;
// }

// export interface UploadDataProvider {
//   length: number;
//   read(uploadDataSink: UploadDataSink, byteBuffer: ArrayBuffer): void;
//   rewind(uploadDataSink: UploadDataSink): void;
// }

export interface UrlRequest
  extends HybridObject<{ android: 'kotlin'; ios: 'swift' }> {
  start(): void;
  followRedirect(): void;
  read(): void;
  cancel(): void;
  isDone(): boolean;
}

export interface UrlRequestBuilder
  extends HybridObject<{ android: 'kotlin'; ios: 'swift' }> {
  // Request configuration
  setHttpMethod(httpMethod: string): void;
  addHeader(name: string, value: string): void;
  // TEMP: Removed for now - too complex, use setUploadBody() instead
  // setUploadDataProvider(provider: UploadDataProvider): void;
  setUploadBody(body: ArrayBuffer | string): void;
  disableCache(): void;
  setPriority(priority: number): void; // 0=IDLE, 1=LOWEST, 2=LOW, 3=MEDIUM, 4=HIGHEST
  allowDirectExecutor(): void;

  // Callback setters (each takes only 1 callback to avoid Swift compiler bug)
  onSucceeded(callback: (info: UrlResponseInfo) => void): void;
  onFailed(
    callback: (
      info: UrlResponseInfo | undefined,
      error: RequestException
    ) => void
  ): void;
  onCanceled(callback: (info: UrlResponseInfo | undefined) => void): void;
  onRedirectReceived(
    callback: (info: UrlResponseInfo, newLocationUrl: string) => void
  ): void;
  onResponseStarted(callback: (info: UrlResponseInfo) => void): void;
  onReadCompleted(
    callback: (
      info: UrlResponseInfo,
      byteBuffer: ArrayBuffer,
      bytesRead: number
    ) => void
  ): void;

  build(): UrlRequest;
}

export interface CachedFetchResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
}

/**
 * Usage example:
 *
 * const builder = cronet.newUrlRequestBuilder(url);
 * builder.onSucceeded((info) => console.log('Success!', info));
 * builder.onFailed((info, error) => console.error('Failed!', error));
 * builder.onCanceled((info) => console.log('Canceled'));
 * builder.setHttpMethod('GET');
 * builder.addHeader('Authorization', 'Bearer token');
 * const request = builder.build();
 * request.start();
 */
export interface NitroCronet
  extends HybridObject<{ android: 'kotlin'; ios: 'swift' }> {
  /**
   * Creates a new URL request builder.
   * Use setter methods to configure callbacks (each setter takes only 1 callback to avoid Swift compiler bug).
   * See: https://github.com/mrousavy/nitro/issues/975
   */
  newUrlRequestBuilder(url: string): UrlRequestBuilder;
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
