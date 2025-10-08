import { NitroModules } from 'react-native-nitro-modules';
import type {
  NitroFetch as NitroFetchType,
  NitroResponse,
} from './NitroFetch.nitro';
import { TextDecoder } from './TextDecoder';

const NitroFetch: NitroFetchType =
  NitroModules.createHybridObject<NitroFetchType>('NitroFetch');

const textDecoder = new TextDecoder();

export class FetchResponse {
  private _nativeResponse: NitroResponse;
  private _bodyStream: ReadableStream<Uint8Array> | null = null;

  constructor(nativeResponse: NitroResponse) {
    this._nativeResponse = nativeResponse;
  }

  get headers(): Headers {
    const headersInit: [string, string][] = this._nativeResponse.headers.map(
      (h) => [h.key, h.value]
    );
    return new Headers(headersInit);
  }

  get ok(): boolean {
    return this._nativeResponse.ok;
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
    return this._nativeResponse.bodyUsed;
  }

  get body(): ReadableStream<Uint8Array> | null {
    if (this._bodyStream === null) {
      this._bodyStream = new ReadableStream<Uint8Array>({
        start: (controller) => {
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

  private async _consumeBody(): Promise<Uint8Array> {
    if (this._nativeResponse.bodyUsed) {
      throw new TypeError('Body has already been consumed');
    }

    const stream = this.body;
    if (stream === null) {
      throw new TypeError('Response body is not available');
    }

    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLength += value.length;
      }
    } finally {
      reader.releaseLock();
    }

    // Fast path: single chunk
    if (chunks.length === 1) {
      return chunks[0]!;
    }

    // Multi-chunk: concatenate
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  async text(): Promise<string> {
    const bytes = await this._consumeBody();
    return textDecoder.decode(bytes);
  }

  async blob(): Promise<Blob> {
    const bytes = await this._consumeBody();
    return new Blob([bytes as BlobPart]);
  }

  async bytes(): Promise<Uint8Array> {
    return this._consumeBody();
  }

  async json(): Promise<any> {
    const text = await this.text();
    return JSON.parse(text);
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
}

export async function fetch(
  url: string,
  options?: {
    method?: string;
    headers?: HeadersInit;
    body?: BodyInit | null;
  }
): Promise<FetchResponse> {
  const client = NitroFetch.createClient();

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

  const nativeResponse = await client.request(request);
  return new FetchResponse(nativeResponse);
}
