import { NitroModules } from 'react-native-nitro-modules';
import type {
  NitroFetch as NitroFetchType,
  NitroResponse,
} from './NitroFetch.nitro';
import { TextDecoder } from 'react-native-nitro-fetch';

const NitroFetch: NitroFetchType =
  NitroModules.createHybridObject<NitroFetchType>('NitroFetch');

// Create a singleton client that's reused across all fetch calls
let _sharedClient: ReturnType<typeof NitroFetch.createClient> | null = null;
function getSharedClient() {
  if (_sharedClient === null) {
    _sharedClient = NitroFetch.createClient();
  }
  return _sharedClient;
}

export class FetchResponse {
  private _nativeResponse: NitroResponse; // Native object handle
  private _bodyStream: ReadableStream<Uint8Array> | null = null;
  private _streamLocked = false;

  constructor(nativeResponse: NitroResponse) {
    this._nativeResponse = nativeResponse;
  }

  // Response properties - direct pass-through to native
  get headers(): Headers {
    const headersInit: [string, string][] = this._nativeResponse.headers.map(
      (h) => [h.key, h.value]
    );
    return new Headers(headersInit);
  }

  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  get status(): number {
    return this._nativeResponse.status;
  }

  get statusText(): string {
    return this._nativeResponse.statusText;
  }

  get url(): string {
    return this._nativeResponse.url;
  }

  get redirected(): boolean {
    return this._nativeResponse.redirected;
  }

  get bodyUsed(): boolean {
    return this._streamLocked;
  }

  // Stream access - creates JS stream backed by native callbacks
  // The body getter creates the stream lazily and caches it (called only once)
  get body(): ReadableStream<Uint8Array> | null {
    // Create stream lazily on first access
    if (this._bodyStream === null) {
      this._bodyStream = new ReadableStream<Uint8Array>({
        start: (controller) => {
          this._streamLocked = true;

          // Set up callbacks for native streaming (only called once!)
          this._nativeResponse.stream({
            onData: (chunk: ArrayBuffer) => {
              controller.enqueue(new Uint8Array(chunk));
            },
            onComplete: () => {
              controller.close();
            },
            onError: (error: string) => {
              controller.error(new Error(error));
            },
          });
        },
        cancel: () => {
          this._nativeResponse.cancel();
        },
      });
    }

    return this._bodyStream;
  }

  // Convenience methods - all use the body stream internally
  async json(): Promise<any> {
    const text = await this.text();
    return JSON.parse(text);
  }

  async text(): Promise<string> {
    const stream = this.body;
    if (stream === null) {
      throw new TypeError('Body has already been used');
    }

    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    // Concatenate chunks
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return new TextDecoder('utf-8').decode(result);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const stream = this.body;
    if (stream === null) {
      throw new TypeError('Body has already been used');
    }

    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    // Concatenate chunks
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result.buffer;
  }

  async bytes(): Promise<Uint8Array> {
    const buffer = await this.arrayBuffer();
    return new Uint8Array(buffer);
  }

  // async blob(): Promise<Blob> {
  //   const buffer = await this.arrayBuffer();
  //   return new Blob([buffer]);
  // }

  async formData(): Promise<FormData> {
    const text = await this.text();
    const searchParams = new URLSearchParams(text);
    const formData = new FormData();
    searchParams.forEach((value, key) => {
      formData.append(key, value);
    });
    return formData;
  }
}

export async function fetch(
  url: string,
  options?: RequestInit
): Promise<FetchResponse> {
  const client = getSharedClient();

  // Convert headers from RequestInit format to NitroHeader[] format
  let headers: Array<{ key: string; value: string }> | undefined;
  if (options?.headers) {
    const headersObj =
      options.headers instanceof Headers
        ? Object.fromEntries(options.headers.entries())
        : options.headers;

    headers = Object.entries(headersObj).map(([key, value]) => ({
      key,
      value: String(value),
    }));
  }

  const request = {
    url,
    method: (options?.method as any) || 'GET',
    headers,
    bodyString: options?.body ? String(options.body) : undefined,
  };

  try {
    const nativeResponse = await client.request(request);

    const response = new FetchResponse(nativeResponse);
    return response;
  } catch (error) {
    console.error('[fetch.ts] Error during request:', error);
    throw error;
  }
}
