import { NitroModules } from 'react-native-nitro-modules';
import type {
  NitroCronet as NitroCronetType,
  UrlRequest,
  UrlRequestCallback,
  UrlResponseInfo,
} from './NitroCronet.nitro';
import { TextDecoder } from './TextDecoder';

export const NitroCronet: NitroCronetType =
  NitroModules.createHybridObject<NitroCronetType>('NitroCronet');

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: ArrayBuffer | Uint8Array | string;
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
      console.error('[NitroFetch] Error reading stream:', error);
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

export function fetch(
  url: string,
  options?: FetchOptions
): Promise<FetchResponse> {
  try {
    const engine = NitroCronet.getEngine();

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

      const callback: UrlRequestCallback = {
        onRedirectReceived(_info, _newLocationUrl) {
          request.followRedirect();
        },

        onResponseStarted(info) {
          responseInfo = info;
          resolve(new FetchResponse(info, stream));
          const buffer = new ArrayBuffer(65536); // 64KB buffer
          request.read(buffer);
        },

        onReadCompleted(_info, byteBuffer) {
          const chunk = new Uint8Array(byteBuffer);
          streamController.enqueue(chunk);

          if (!request.isDone()) {
            const buffer = new ArrayBuffer(65536);
            request.read(buffer);
          }
        },

        onSucceeded(_info) {
          streamController.close();
        },

        onFailed(_info, error) {
          streamController.error(new Error(error.message));
          if (!responseInfo) {
            reject(new Error(error.message));
          }
        },

        onCanceled(_info) {
          streamController.close();
        },
      };

      const builder = engine.newUrlRequestBuilder(url, callback);

      if (options?.method) {
        builder.setHttpMethod(options.method);
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
  } catch (error) {
    throw error;
  }
}
