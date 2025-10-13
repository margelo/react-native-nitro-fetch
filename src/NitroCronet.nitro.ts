import type { HybridObject } from 'react-native-nitro-modules';

export interface HttpHeader {
  key: string;
  value: string;
}

export interface UrlResponseInfo {
  url: string;
  httpStatusCode: number;
  httpStatusText: string;
  allHeaders: Record<string, string>; // Nitro doesn't support Map, use Record
  allHeadersAsList: HttpHeader[];
  urlChain: string[];
  negotiatedProtocol: string;
  proxyServer: string;
  receivedByteCount: number;
  wasCached: boolean; // useful to know
}

export interface CronetException {
  message: string;
  // Note: errorCode, internalErrorCode, and immediatelyRetryable are only available
  // in specific Cronet exception subclasses (NetworkException, QuicException, etc.)
  // and cannot be reliably accessed from the base CronetException class
}

export interface UrlRequestCallback {
  onRedirectReceived(info: UrlResponseInfo, newLocationUrl: string): void;
  onResponseStarted(info: UrlResponseInfo): void;
  onReadCompleted(info: UrlResponseInfo, byteBuffer: ArrayBuffer): void;
  onSucceeded(info: UrlResponseInfo): void;
  onFailed(info: UrlResponseInfo | undefined, error: CronetException): void;
  onCanceled(info: UrlResponseInfo | undefined): void;
}
export interface UrlRequest
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  start(): void;
  followRedirect(): void;
  read(buffer: ArrayBuffer): void;
  cancel(): void;
  isDone(): boolean;
}

export interface UrlRequestBuilder
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  setHttpMethod(httpMethod: string): void;
  addHeader(name: string, value: string): void;
  // setUploadDataProvider(provider: UploadDataProvider): void;
  disableCache(): void;
  setPriority(priority: number): void; // 0=IDLE, 1=LOWEST, 2=LOW, 3=MEDIUM, 4=HIGHEST
  allowDirectExecutor(): void;

  build(): UrlRequest;
}
export interface CronetEngine
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  newUrlRequestBuilder(
    url: string,
    callback: UrlRequestCallback
    // executor?: Executor
  ): UrlRequestBuilder;

  shutdown(): void;

  getVersionString(): string;

  startNetLogToFile(fileName: string, logAll: boolean): void;

  stopNetLog(): void;
}
export interface NitroCronet
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  getEngine(): CronetEngine;

  createEngine(): CronetEngine;

  shutdownAll(): void;
}
