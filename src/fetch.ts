import { NitroModules } from 'react-native-nitro-modules';
import type {
  NitroCronet as NitroCronetType,
  UrlRequest,
  UrlResponseInfo,
} from './NitroCronet.nitro';
import { TextDecoder } from './TextDecoder';

export const NitroCronet: NitroCronetType =
  NitroModules.createHybridObject<NitroCronetType>('NitroCronet');

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: ArrayBuffer | Uint8Array | string;
  cache?: 'default' | 'no-cache';
}

export interface PrefetchOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: ArrayBuffer | string;
  prefetchKey: string;
  maxAge?: number;
}

export class FetchResponse {
  private _info: UrlResponseInfo;
  private _stream: ReadableStream<Uint8Array>;
  private _streamUsed = false;

  constructor(info: UrlResponseInfo, stream: ReadableStream<Uint8Array>) {
    this._info = info;
    this._stream = stream;
  }

  get headers(): Headers {
    return new Headers(this._info.allHeaders);
  }

  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  get status(): number {
    return this._info.httpStatusCode;
  }

  get statusText(): string {
    return this._info.httpStatusText;
  }

  get url(): string {
    return this._info.url;
  }

  get redirected(): boolean {
    return this._info.urlChain.length > 1;
  }

  public readonly type = 'default';

  get bodyUsed(): boolean {
    return this._streamUsed;
  }

  get body(): ReadableStream<Uint8Array> | null {
    if (this._streamUsed) {
      return null;
    }
    return this._stream;
  }

  private async _consumeStream(): Promise<Uint8Array> {
    if (this._streamUsed) {
      throw new TypeError('Body has already been used');
    }
    this._streamUsed = true;

    const reader = this._stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        totalLength += value.length;
      }
    } catch (error) {
      throw error;
    } finally {
      reader.releaseLock();
    }

    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  async json(): Promise<any> {
    const text = await this.text();
    return JSON.parse(text);
  }

  async text(): Promise<string> {
    const bytes = await this._consumeStream();
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
  }

  async bytes(): Promise<Uint8Array> {
    return this._consumeStream();
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = await this._consumeStream();
    const result = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    return result;
  }

  async blob(): Promise<Blob> {
    const buffer = await this.arrayBuffer();
    return new Blob([buffer]);
  }

  async formData(): Promise<FormData> {
    const text = await this.text();
    const searchParams = new URLSearchParams(text);
    const formData = new FormData();
    searchParams.forEach((value, key) => {
      formData.append(key, value);
    });
    return formData;
  }

  toString(): string {
    return `FetchResponse: { status: ${this.status}, statusText: ${this.statusText}, url: ${this.url} }`;
  }

  toJSON(): object {
    return {
      status: this.status,
      statusText: this.statusText,
      redirected: this.redirected,
      url: this.url,
    };
  }

  get info(): UrlResponseInfo {
    return this._info;
  }

  get data(): Uint8Array {
    throw new Error(
      'data property is deprecated - use bytes(), text(), or json() instead'
    );
  }
}

export async function prefetch(options: PrefetchOptions): Promise<void> {
  const {
    url,
    method = 'GET',
    headers = {},
    body,
    prefetchKey,
    maxAge = 5000,
  } = options;

  const headersWithKey = {
    ...headers,
    prefetchKey,
  };

  await NitroCronet.prefetch(url, method, headersWithKey, body, maxAge);
}

export async function prefetchOnAppStart(
  options: PrefetchOptions
): Promise<void> {
  if (!options.prefetchKey) {
    throw new Error('prefetchOnAppStart requires a prefetchKey');
  }

  const headersObj: Record<string, string> = { ...options.headers };

  const entry = {
    url: options.url,
    method: options.method,
    prefetchKey: options.prefetchKey,
    headers: headersObj,
    maxAge: options.maxAge ?? 5000,
  };

  const { MMKV } = require('react-native-mmkv');
  const storage = new MMKV();
  const KEY = 'nitrofetch_autoprefetch_queue';

  let arr: any[] = [];
  try {
    const raw = storage.getString(KEY);
    if (raw) {
      arr = JSON.parse(raw);
    }
    if (!Array.isArray(arr)) {
      arr = [];
    }
  } catch (e) {
    arr = [];
  }

  arr = arr.filter((e) => e && e.prefetchKey !== options.prefetchKey);

  arr.push(entry);

  const newQueueStr = JSON.stringify(arr);
  storage.set(KEY, newQueueStr);
}

export async function removeFromAutoPrefetch(
  prefetchKey: string
): Promise<void> {
  const { MMKV } = require('react-native-mmkv');
  const storage = new MMKV();
  const KEY = 'nitrofetch_autoprefetch_queue';

  let arr: any[] = [];
  try {
    const raw = storage.getString(KEY);
    if (raw) {
      arr = JSON.parse(raw);
    }
    if (!Array.isArray(arr)) {
      arr = [];
    }
  } catch {
    arr = [];
  }

  const next = arr.filter((e) => e && e.prefetchKey !== prefetchKey);

  if (next.length === 0) {
    if (typeof (storage as any).delete === 'function') {
      (storage as any).delete(KEY);
    } else {
      storage.set(KEY, JSON.stringify([]));
    }
  } else if (next.length !== arr.length) {
    storage.set(KEY, JSON.stringify(next));
  }
}

export async function clearAutoPrefetchQueue(): Promise<void> {
  const { MMKV } = require('react-native-mmkv');
  const storage = new MMKV();
  const KEY = 'nitrofetch_autoprefetch_queue';

  storage.set(KEY, JSON.stringify([]));
}

function createResponseFromNativeCache(cached: {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
}): FetchResponse {
  const data = new Uint8Array(cached.body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });

  const info: UrlResponseInfo = {
    url: cached.url,
    httpStatusCode: cached.status,
    httpStatusText: cached.statusText,
    allHeaders: cached.headers,
    allHeadersAsList: Object.entries(cached.headers).map(([key, value]) => ({
      key,
      value,
    })),
    urlChain: [cached.url],
    negotiatedProtocol: '',
    proxyServer: '',
    receivedByteCount: data.length,
    wasCached: true,
  };

  return new FetchResponse(info, stream);
}

async function tryConsumePrefetch(
  prefetchKey: string
): Promise<FetchResponse | null> {
  const nativeCached = await NitroCronet.consumeNativePrefetch(prefetchKey);
  if (nativeCached) {
    return createResponseFromNativeCache(nativeCached);
  }

  return null;
}

export async function fetch(
  url: string,
  options?: FetchOptions
): Promise<FetchResponse> {
  const prefetchKey = options?.headers?.prefetchKey;
  if (prefetchKey) {
    const prefetched = await tryConsumePrefetch(prefetchKey);
    if (prefetched) {
      return prefetched;
    }
  }

  return new Promise((resolve, reject) => {
    let responseInfo: UrlResponseInfo | null = null;
    let request: UrlRequest;
    let streamController: ReadableStreamDefaultController<Uint8Array>;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        if (request && !request.isDone()) {
          request.cancel();
        }
      },
    });

    // Create the builder
    const builder = NitroCronet.newUrlRequestBuilder(url);

    // Set up callbacks using the builder pattern
    builder.onRedirectReceived((_info, _newLocationUrl) => {
      request.followRedirect();
    });

    builder.onResponseStarted((info) => {
      responseInfo = info;
      resolve(new FetchResponse(info, stream));
      // Native manages the buffer internally
      request.read();
    });

    builder.onReadCompleted((_info, byteBuffer, bytesRead) => {
      // Copy the data since native will reuse the buffer for the next read
      // This copy is cheap compared to allocating 160+ buffers per large file
      const chunk = new Uint8Array(bytesRead);
      chunk.set(new Uint8Array(byteBuffer, 0, bytesRead));
      streamController.enqueue(chunk);

      if (!request.isDone()) {
        request.read();
      }
    });

    builder.onSucceeded((_info) => {
      streamController.close();
    });

    builder.onFailed((_info, error) => {
      streamController.error(new Error(error.message));
      if (!responseInfo) {
        reject(new Error(error.message));
      }
    });

    builder.onCanceled((_info) => {
      streamController.close();
    });

    if (options?.method) {
      builder.setHttpMethod(options.method);
    }

    // Disable cache if requested
    if (options?.cache === 'no-cache') {
      builder.disableCache();
    }

    if (options?.headers) {
      const headers = new Headers(options.headers);
      headers.forEach((value, key) => {
        builder.addHeader(key, value);
      });
    }

    // Handle request body if provided
    if (options?.body) {
      if (typeof options.body === 'string') {
        builder.setUploadBody(options.body);
      } else if (options.body instanceof ArrayBuffer) {
        builder.setUploadBody(options.body);
      } else {
        // Uint8Array - convert to ArrayBuffer
        const arrayBuffer = options.body.buffer.slice(
          options.body.byteOffset,
          options.body.byteOffset + options.body.byteLength
        ) as ArrayBuffer;
        builder.setUploadBody(arrayBuffer);
      }
    }

    request = builder.build();
    request.start();
  });
}
