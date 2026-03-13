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

// Used by fetchSync / worklets — body is a plain decoded string (no ArrayBuffer)
export interface SyncFetchResponse {
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
}

export interface NitroCronet
    extends HybridObject<{ android: 'kotlin'; ios: 'swift' }> {
    newUrlRequestBuilder(url: string): UrlRequestBuilder;
    prefetch(
        url: string,
        httpMethod: string,
        headers: Record<string, string>,
        body: ArrayBuffer | string | undefined,
        maxAge: number
    ): Promise<void>;

    fetchSync(
        url: string,
        httpMethod: string,
        headers: Record<string, string>,
        body: string | undefined
    ): SyncFetchResponse;

    consumeNativePrefetch(
        prefetchKey: string
    ): Promise<CachedFetchResponse | undefined>;
}
