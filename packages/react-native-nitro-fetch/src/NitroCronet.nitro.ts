import type { HybridObject } from 'react-native-nitro-modules';

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
  wasCached: boolean;
}

export interface RequestException {
  message: string;
}

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
  setHttpMethod(httpMethod: string): void;
  addHeader(name: string, value: string): void;
  setUploadBody(body: ArrayBuffer | string): void;
  disableCache(): void;
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

// The new streaming client — separate from NitroFetchClient
export interface NitroCronet
  extends HybridObject<{ android: 'kotlin'; ios: 'swift' }> {
  newUrlRequestBuilder(url: string): UrlRequestBuilder;
}
