import { NitroHeaders } from './Headers';
import { stringToUTF8, utf8ToString } from './utf8';
import type { NitroHeader } from './NitroFetch.nitro';

export type ResponseType =
  | 'basic'
  | 'cors'
  | 'default'
  | 'error'
  | 'opaque'
  | 'opaqueredirect';

export interface NitroResponseInit {
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  redirected: boolean;
  headers: NitroHeader[] | NitroHeaders;
  bodyBytes?: ArrayBuffer;
  bodyString?: string;
  body?: ReadableStream<Uint8Array<ArrayBuffer>>;
  type?: ResponseType;
}

function isNitroResponseInit(arg: any): arg is NitroResponseInit {
  return (
    arg != null &&
    typeof arg === 'object' &&
    'url' in arg &&
    'status' in arg &&
    'ok' in arg
  );
}

export class NitroResponse {
  readonly url: string;
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly redirected: boolean;
  readonly headers: NitroHeaders;
  readonly type: ResponseType;

  private _bodyBytes: ArrayBuffer | undefined;
  private _bodyString: string | undefined;
  private _bodyStream: ReadableStream<Uint8Array<ArrayBuffer>> | undefined;
  private _bodyUsed: boolean = false;

  constructor(body?: BodyInit | null, init?: ResponseInit);
  constructor(init: NitroResponseInit);
  constructor(
    bodyOrInit?: BodyInit | NitroResponseInit | null,
    init?: ResponseInit
  ) {
    if (isNitroResponseInit(bodyOrInit)) {
      // Internal constructor path
      const nitroInit = bodyOrInit;
      this.url = nitroInit.url;
      this.ok = nitroInit.ok;
      this.status = nitroInit.status;
      this.statusText = nitroInit.statusText;
      this.redirected = nitroInit.redirected;
      this.type = nitroInit.type ?? 'basic';

      if (nitroInit.headers instanceof NitroHeaders) {
        this.headers = nitroInit.headers;
      } else {
        this.headers = new NitroHeaders(nitroInit.headers);
      }

      this._bodyBytes = nitroInit.bodyBytes;
      this._bodyString = nitroInit.bodyString;
      this._bodyStream = nitroInit.body;
    } else {
      // Public constructor: new Response(body?, init?)
      const body = bodyOrInit as BodyInit | null | undefined;
      this.status = init?.status ?? 200;
      this.statusText = init?.statusText ?? '';
      this.ok = this.status >= 200 && this.status < 300;
      this.url = '';
      this.redirected = false;
      this.type = 'default';
      this.headers = new NitroHeaders(init?.headers as any);

      if (body == null) {
        // no body
      } else if (typeof body === 'string') {
        this._bodyString = body;
      } else if (body instanceof ArrayBuffer) {
        this._bodyBytes = body;
      } else if (ArrayBuffer.isView(body)) {
        const view = body as ArrayBufferView;
        this._bodyBytes = (view.buffer as ArrayBuffer).slice(
          view.byteOffset,
          view.byteOffset + view.byteLength
        );
      } else if (
        typeof ReadableStream !== 'undefined' &&
        body instanceof ReadableStream
      ) {
        this._bodyStream = body;
      } else if (
        typeof URLSearchParams !== 'undefined' &&
        body instanceof URLSearchParams
      ) {
        this._bodyString = body.toString();
        if (!this.headers.has('content-type')) {
          this.headers.set(
            'content-type',
            'application/x-www-form-urlencoded;charset=UTF-8'
          );
        }
      } else if (typeof Blob !== 'undefined' && body instanceof Blob) {
        // Store as string — RN Blobs are string-backed
        this._bodyString = '';
        this._bodyStream = body.stream?.() as
          | ReadableStream<Uint8Array<ArrayBuffer>>
          | undefined;
      }
    }
  }

  get bodyUsed(): boolean {
    return this._bodyUsed;
  }

  get body(): ReadableStream<Uint8Array<ArrayBuffer>> | null {
    if (this._bodyStream) return this._bodyStream;
    const bytes = this._getBodyBytes();
    if (!bytes) return null;
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    });
  }

  private _throwIfBodyUsed(): void {
    if (this._bodyUsed) {
      throw new TypeError('Body has already been consumed.');
    }
  }

  private _getBodyBytes(): ArrayBuffer | undefined {
    if (this._bodyBytes) return this._bodyBytes;
    if (this._bodyString != null) {
      const encoded = stringToUTF8(this._bodyString);
      return (encoded.buffer as ArrayBuffer).slice(
        encoded.byteOffset,
        encoded.byteOffset + encoded.byteLength
      );
    }
    return undefined;
  }

  private _getBodyString(): string {
    if (this._bodyString != null) return this._bodyString;
    if (this._bodyBytes) {
      return utf8ToString(new Uint8Array(this._bodyBytes));
    }
    return '';
  }

  async text(): Promise<string> {
    this._throwIfBodyUsed();
    this._bodyUsed = true;
    if (this._bodyStream && !this._bodyBytes && this._bodyString == null) {
      const reader = this._bodyStream.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      // Concatenate chunks
      let totalLen = 0;
      for (const c of chunks) totalLen += c.byteLength;
      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      return utf8ToString(merged);
    }

    return this._getBodyString();
  }

  async json(): Promise<any> {
    this._throwIfBodyUsed();
    this._bodyUsed = true;
    const t = this._getBodyString();
    return JSON.parse(t || '{}');
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    this._throwIfBodyUsed();
    this._bodyUsed = true;
    if (this._bodyStream && !this._bodyBytes && this._bodyString == null) {
      const reader = this._bodyStream.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      let totalLen = 0;
      for (const c of chunks) totalLen += c.byteLength;
      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      return merged.buffer.slice(
        merged.byteOffset,
        merged.byteOffset + merged.byteLength
      );
    }

    return this._getBodyBytes() ?? new ArrayBuffer(0);
  }

  async blob(): Promise<Blob> {
    this._throwIfBodyUsed();
    this._bodyUsed = true;
    // RN's Blob doesn't support ArrayBuffer/ArrayBufferView — use string body
    const bodyStr = this._getBodyString();
    const contentType = this.headers.get('content-type') ?? '';
    return new Blob([bodyStr], { type: contentType });
  }

  async bytes(): Promise<Uint8Array<ArrayBuffer>> {
    this._throwIfBodyUsed();
    this._bodyUsed = true;
    const buffer = this._getBodyBytes() ?? new ArrayBuffer(0);
    return new Uint8Array(buffer);
  }

  clone(): NitroResponse {
    if (this._bodyUsed) {
      throw new TypeError('Cannot clone a Response whose body has been used.');
    }
    return new NitroResponse({
      url: this.url,
      status: this.status,
      statusText: this.statusText,
      ok: this.ok,
      redirected: this.redirected,
      headers: this.headers,
      bodyBytes: this._bodyBytes,
      bodyString: this._bodyString,
      type: this.type,
    });
  }

  async formData(): Promise<never> {
    throw new TypeError('formData() is not supported in NitroResponse');
  }

  // --- Static methods ---

  static error(): NitroResponse {
    return new NitroResponse({
      url: '',
      status: 0,
      statusText: '',
      ok: false,
      redirected: false,
      headers: [],
      type: 'error',
    });
  }

  static json(
    data: unknown,
    init?: {
      status?: number;
      statusText?: string;
      headers?: Record<string, string> | [string, string][];
    }
  ): NitroResponse {
    const body = JSON.stringify(data);
    const headers = new NitroHeaders(init?.headers as any);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return new NitroResponse({
      url: '',
      status: init?.status ?? 200,
      statusText: init?.statusText ?? '',
      ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
      redirected: false,
      headers,
      bodyString: body,
    });
  }

  static redirect(url: string, status: number = 302): NitroResponse {
    const validStatuses = [301, 302, 303, 307, 308];
    if (!validStatuses.includes(status)) {
      throw new RangeError(
        `Invalid redirect status: ${status}. Must be one of ${validStatuses.join(', ')}`
      );
    }
    const headers = new NitroHeaders();
    headers.set('location', url);
    return new NitroResponse({
      url: '',
      status,
      statusText: '',
      ok: false,
      redirected: false,
      headers,
    });
  }
}
