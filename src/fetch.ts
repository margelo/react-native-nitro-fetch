import { NitroModules } from 'react-native-nitro-modules';
import type {
  CronetEngine,
  CronetException,
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

  // Response properties
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

  // Stream access - returns the underlying stream
  get body(): ReadableStream<Uint8Array> | null {
    if (this._streamUsed) {
      return null;
    }
    return this._stream;
  }

  // Helper to consume entire stream into buffer
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

    // Combine all chunks into single Uint8Array
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  // All these methods consume the stream
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

  // Legacy properties for backwards compatibility
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
  options?: RequestInit
): Promise<FetchResponse> {
  try {
    const engine = NitroCronet.getEngine();

    return new Promise((resolve, reject) => {
      let responseInfo: UrlResponseInfo | null = null;
      let request: UrlRequest;
      let streamController: ReadableStreamDefaultController<Uint8Array>;

      // Always create a stream
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
        cancel() {
          // User called cancel on the stream, cancel the request
          if (request && !request.isDone()) {
            request.cancel();
          }
        },
      });

      const callback: UrlRequestCallback = {
        onRedirectReceived(info, newLocationUrl) {
          // Auto-follow redirects by default
          request.followRedirect();
        },

        onResponseStarted(info) {
          responseInfo = info;

          // Resolve immediately with the streaming response
          // User can now choose to stream or buffer
          resolve(new FetchResponse(info, stream));

          // Start reading data
          const buffer = new ArrayBuffer(65536); // 64KB buffer
          request.read(buffer);
        },

        onReadCompleted(info, byteBuffer) {
          const chunkSize = byteBuffer.byteLength;

          // Push chunk to stream
          const chunk = new Uint8Array(byteBuffer);
          streamController.enqueue(chunk);

          // Continue reading if not done
          if (!request.isDone()) {
            const buffer = new ArrayBuffer(65536);
            request.read(buffer);
          }
        },

        onSucceeded(info) {
          // Close the stream when done
          streamController.close();
        },

        onFailed(info, error) {
          console.error('[NitroFetch] Request failed:', {
            url: info?.url || url,
            error: error.message,
            errorType: error.errorCode,
            internalError: error.internalErrorCode,
          });

          // Error the stream
          streamController.error(new Error(error.message));

          // If we haven't resolved yet, reject the promise
          if (!responseInfo) {
            reject(new Error(error.message));
          }
        },

        onCanceled(info) {
          streamController.close();
        },
      };

      const builder = engine.newUrlRequestBuilder(url, callback);

      // Apply options
      if (options?.method) {
        builder.setHttpMethod(options.method);
      }

      if (options?.headers) {
        const headers = new Headers(options.headers);
        headers.forEach((value, key) => {
          builder.addHeader(key, value);
        });
      }

      request = builder.build();
      request.start();
    });
  } catch (error) {
    throw error;
  }
}

// /**
//  * A response implementation for the `fetch` API.
//  */
// export class FetchResponse {
//   private _info: UrlResponseInfo;
//   private _body: Uint8Array;

//   constructor(info: UrlResponseInfo, body: Uint8Array) {
//     this._info = info;
//     this._body = body;
//   }

//   // Response properties
//   get headers(): Headers {
//     return new Headers(this._info.allHeaders);
//   }

//   get ok(): boolean {
//     return this.status >= 200 && this.status < 300;
//   }

//   get status(): number {
//     return this._info.httpStatusCode;
//   }

//   get statusText(): string {
//     return this._info.httpStatusText;
//   }

//   get url(): string {
//     return this._info.url;
//   }

//   get redirected(): boolean {
//     return this._info.urlChain.length > 1;
//   }

//   public readonly type = 'default';
//   public readonly bodyUsed = false;

//   // Response methods
//   async json(): Promise<any> {
//     const text = await this.text();
//     return JSON.parse(text);
//   }

//   async bytes(): Promise<Uint8Array<ArrayBuffer>> {
//     return new Uint8Array(
//       this._body.buffer.slice(
//         this._body.byteOffset,
//         this._body.byteOffset + this._body.byteLength
//       ) as ArrayBuffer
//     );
//   }

//   get body(): ReadableStream<Uint8Array<ArrayBuffer>> | null {}

//   async text(): Promise<string> {
//     const decoder = new TextDecoder();
//     return decoder.decode(this._body);
//   }

//   async arrayBuffer(): Promise<ArrayBuffer> {
//     return this._body.buffer.slice(
//       this._body.byteOffset,
//       this._body.byteOffset + this._body.byteLength
//     ) as ArrayBuffer;
//   }

//   async blob(): Promise<Blob> {
//     const buffer = await this.arrayBuffer();
//     return new Blob([buffer]);
//   }

//   async formData(): Promise<FormData> {
//     const text = await this.text();
//     const searchParams = new URLSearchParams(text);
//     const formData = new FormData();
//     searchParams.forEach((value, key) => {
//       formData.append(key, value);
//     });
//     return formData;
//   }

//   clone(): FetchResponse {
//     throw new Error('Not implemented');
//   }

//   // For debugging
//   toString(): string {
//     return `FetchResponse: { status: ${this.status}, statusText: ${this.statusText}, url: ${this.url} }`;
//   }

//   toJSON(): object {
//     return {
//       status: this.status,
//       statusText: this.statusText,
//       redirected: this.redirected,
//       url: this.url,
//     };
//   }

//   // Legacy properties for backwards compatibility
//   get info(): UrlResponseInfo {
//     return this._info;
//   }

//   get data(): Uint8Array {
//     return this._body;
//   }
// }

// /**
//  * A fetch implementation using Cronet.
//  */
// export function fetch(
//   url: string,
//   options?: FetchOptions
// ): Promise<FetchResponse> {
//   const engine = NitroCronet.getEngine();
//   return fetchWithEngine(engine, url, options);
// }

// /**
//  * Fetch with a specific Cronet engine.
//  */
// export function fetchWithEngine(
//   engine: CronetEngine,
//   url: string,
//   options?: FetchOptions
// ): Promise<FetchResponse> {
//   return new Promise((resolve, reject) => {
//     const chunks: Uint8Array[] = [];
//     let request: UrlRequest | null = null;

//     const callback: UrlRequestCallback = {
//       onRedirectReceived(_info: UrlResponseInfo, _newLocationUrl: string) {
//         request?.followRedirect();
//       },

//       onResponseStarted(_info: UrlResponseInfo) {
//         // Allocate buffer and start reading
//         const buffer = new ArrayBuffer(32 * 1024); // 32KB chunks
//         request?.read(buffer);
//       },

//       onReadCompleted(_info: UrlResponseInfo, byteBuffer: ArrayBuffer) {
//         // Extract data from buffer
//         const chunk = new Uint8Array(byteBuffer);
//         chunks.push(chunk);

//         // Continue reading
//         const buffer = new ArrayBuffer(32 * 1024);
//         request?.read(buffer);
//       },

//       onSucceeded(info: UrlResponseInfo) {
//         // Concatenate all chunks
//         const totalLength = chunks.reduce(
//           (sum, chunk) => sum + chunk.length,
//           0
//         );
//         const body = new Uint8Array(totalLength);
//         let offset = 0;
//         for (const chunk of chunks) {
//           body.set(chunk, offset);
//           offset += chunk.length;
//         }
//         resolve(new FetchResponse(info, body));
//       },

//       onFailed(_info: UrlResponseInfo | undefined, error: CronetException) {
//         reject(new Error(error.message));
//       },

//       onCanceled(_info: UrlResponseInfo | undefined) {
//         reject(new Error('Request canceled'));
//       },
//     };

//     const builder = engine.newUrlRequestBuilder(url, callback);

//     // Set method
//     builder.setHttpMethod(options?.method || 'GET');

//     // Set headers
//     if (options?.headers) {
//       for (const [name, value] of Object.entries(options.headers)) {
//         builder.addHeader(name, value);
//       }
//     }

//     // TODO: Handle body/upload data provider if needed

//     request = builder.build();
//     request.start();
//   });
// }

// export { NitroCronet };
