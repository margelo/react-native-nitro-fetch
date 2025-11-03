import { NitroModules } from 'react-native-nitro-modules';
import type {
  NitroCronet as NitroCronetType,
  UrlRequest,
  UrlResponseInfo,
} from './NitroCronet.nitro';
import { TextDecoder } from './TextDecoder';

// AbortError class for React Native (DOMException not available)
export class AbortError extends Error {
  constructor(message: string = 'The operation was aborted.') {
    super(message);
    this.name = 'AbortError';
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AbortError.prototype);
  }
}

export const NitroCronet: NitroCronetType =
  NitroModules.createHybridObject<NitroCronetType>('NitroCronet');

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: ArrayBuffer | Uint8Array | string;
  cache?: 'default' | 'no-cache';
  signal?: AbortSignal;
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

  clone(): FetchResponse {
    if (this._streamUsed) {
      throw new TypeError(
        'Cannot clone a Response whose body has already been used'
      );
    }

    // Tee the stream so both the original and clone can be read independently
    const [stream1, stream2] = this._stream.tee();

    // Update the current instance to use the first teed stream
    this._stream = stream1;

    // Create a new FetchResponse with the second teed stream and cloned info
    return new FetchResponse(this._info, stream2);
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

// Optional off-thread processing using react-native-worklets-core
export type WorkletMapper<T> = (response: FetchResponse) => T | Promise<T>;

let nitroRuntime: any | undefined;
let WorkletsRef: any | undefined;

function ensureWorkletRuntime(name = 'nitro-fetch'): any | undefined {
  try {
    const { Worklets } = require('react-native-worklets-core');
    nitroRuntime = nitroRuntime ?? Worklets.createRuntime(name);
    return nitroRuntime;
  } catch {
    console.warn('react-native-worklets-core not available');
    return undefined;
  }
}

function getWorklets(): any | undefined {
  try {
    if (WorkletsRef) return WorkletsRef;
    const { Worklets } = require('react-native-worklets-core');
    WorkletsRef = Worklets;
    return WorkletsRef;
  } catch {
    console.warn('react-native-worklets-core not available');
    return undefined;
  }
}

export async function fetchOnWorklet<T>(
  url: string,
  options: FetchOptions | undefined,
  mapWorklet: WorkletMapper<T>,
  runtimeOptions?: { runtimeName?: string }
): Promise<T> {
  let rt: any | undefined;
  let Worklets: any | undefined;
  try {
    rt = ensureWorkletRuntime(runtimeOptions?.runtimeName);
    Worklets = getWorklets();
  } catch (e) {
    console.error('fetchOnWorklet: setup failed', e);
  }

  // Fallback: if runtime is not available, do the work on JS
  if (!rt || !Worklets || typeof rt.run !== 'function') {
    console.warn('fetchOnWorklet: no runtime, mapping on JS thread');
    const res = await fetch(url, options);
    return mapWorklet(res);
  }

  return await new Promise<T>((resolve, reject) => {
    try {
      rt.run(async (map: WorkletMapper<T>) => {
        'worklet';
        try {
          const res = await fetch(url, options);
          const out = map(res);
          // Resolve back on JS thread
          Worklets.runOnJS(resolve)(out as any);
        } catch (e) {
          Worklets.runOnJS(reject)(e as any);
        }
      }, mapWorklet as any);
    } catch (e) {
      console.error('fetchOnWorklet: rt.run failed', e);
      reject(e);
    }
  });
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
  try {
    const nativeCached = await NitroCronet.consumeNativePrefetch(prefetchKey);
    if (nativeCached) {
      return createResponseFromNativeCache(nativeCached);
    }
    return null;
  } catch (error) {
    // Prefetch not found or expired - return null to fall back to normal fetch
    return null;
  }
}

export async function fetch(
  url: string,
  options?: FetchOptions
): Promise<FetchResponse> {
  // Check if already aborted
  if (options?.signal?.aborted) {
    return Promise.reject(new AbortError());
  }

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
    let abortHandler: (() => void) | undefined;
    let streamClosed = false;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        streamClosed = true;
        if (request && !request.isDone()) {
          request.cancel();
        }
      },
    });

    // Set up abort handling
    if (options?.signal) {
      abortHandler = () => {
        if (request && !request.isDone()) {
          request.cancel();
        }
      };
      options.signal.addEventListener('abort', abortHandler);
    }

    const cleanup = () => {
      if (options?.signal && abortHandler) {
        options.signal.removeEventListener('abort', abortHandler);
      }
    };

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
      // Skip if stream is already closed/errored
      if (streamClosed) {
        return;
      }

      // Copy the data since native will reuse the buffer for the next read
      // slice() is more efficient than creating+copying with .set()
      const chunk = new Uint8Array(byteBuffer, 0, bytesRead).slice();
      streamController.enqueue(chunk);

      if (!request.isDone()) {
        request.read();
      }
    });

    builder.onSucceeded((_info) => {
      cleanup();
      if (!streamClosed) {
        streamClosed = true;
        streamController.close();
      }
    });

    builder.onFailed((_info, error) => {
      cleanup();
      if (!streamClosed) {
        streamClosed = true;
        streamController.error(new Error(error.message));
      }
      if (!responseInfo) {
        reject(new Error(error.message));
      }
    });

    builder.onCanceled((_info) => {
      cleanup();
      const abortError = new AbortError();
      if (!streamClosed) {
        streamClosed = true;
        streamController.error(abortError);
      }
      if (!responseInfo) {
        reject(abortError);
      }
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

    // Check if aborted before starting
    if (options?.signal?.aborted) {
      cleanup();
      reject(new AbortError());
      return;
    }

    request.start();
  });
}
