import { NitroHeaders } from './Headers';
import { stringToUTF8, utf8ToString } from './utf8';

export type RequestRedirect = 'follow' | 'error' | 'manual';
export type RequestCache =
  | 'default'
  | 'no-store'
  | 'no-cache'
  | 'reload'
  | 'force-cache'
  | 'only-if-cached';

export interface NitroRequestInit {
  method?: string;
  headers?: HeadersInit | NitroHeaders;
  body?: BodyInit | null;
  redirect?: RequestRedirect;
  signal?: AbortSignal | null;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  mode?: RequestMode;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  integrity?: string;
  keepalive?: boolean;
}

export class NitroRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: NitroHeaders;
  readonly redirect: RequestRedirect;
  readonly signal: AbortSignal;
  readonly cache: RequestCache;
  readonly credentials: RequestCredentials;
  readonly mode: RequestMode;
  readonly referrer: string;
  readonly referrerPolicy: ReferrerPolicy;
  readonly integrity: string;
  readonly keepalive: boolean;
  readonly destination: string;

  private _body: BodyInit | null;
  private _bodyUsed: boolean = false;

  constructor(
    input: string | URL | NitroRequest | Request,
    init?: NitroRequestInit
  ) {
    if (input instanceof NitroRequest) {
      // Clone from another NitroRequest
      this.url = input.url;
      this.method = (init?.method ?? input.method).toUpperCase();
      this.headers = new NitroHeaders(
        init?.headers
          ? init.headers instanceof NitroHeaders
            ? init.headers
            : (init.headers as any)
          : input.headers
      );
      this.redirect = init?.redirect ?? input.redirect;
      this.signal = init?.signal ?? input.signal;
      this.cache = init?.cache ?? input.cache;
      this.credentials = init?.credentials ?? input.credentials;
      this.mode = init?.mode ?? input.mode;
      this.referrer = init?.referrer ?? input.referrer;
      this.referrerPolicy = init?.referrerPolicy ?? input.referrerPolicy;
      this.integrity = init?.integrity ?? input.integrity;
      this.keepalive = init?.keepalive ?? input.keepalive;
      this._body = init?.body !== undefined ? (init.body ?? null) : input._body;
    } else if (
      typeof input === 'object' &&
      input !== null &&
      'url' in input &&
      'method' in input &&
      'headers' in input &&
      !(input instanceof URL)
    ) {
      // Construct from a Request-like object (standard Request or duck-typed)
      this.url = input.url;
      this.method = (init?.method ?? input.method).toUpperCase();
      this.headers = new NitroHeaders(
        init?.headers
          ? init.headers instanceof NitroHeaders
            ? init.headers
            : (init.headers as any)
          : (input.headers as any)
      );
      this.redirect =
        init?.redirect ?? (input.redirect as RequestRedirect) ?? 'follow';
      this.signal = init?.signal ?? input.signal;
      this.cache = init?.cache ?? (input.cache as RequestCache) ?? 'default';
      this.credentials =
        init?.credentials ?? input.credentials ?? 'same-origin';
      this.mode = init?.mode ?? input.mode ?? 'cors';
      this.referrer = init?.referrer ?? input.referrer ?? 'about:client';
      this.referrerPolicy =
        init?.referrerPolicy ?? (input.referrerPolicy as ReferrerPolicy) ?? '';
      this.integrity = init?.integrity ?? input.integrity ?? '';
      this.keepalive = init?.keepalive ?? input.keepalive ?? false;
      this._body = init?.body ?? null;
    } else {
      this.url = String(input);
      this.method = (init?.method ?? 'GET').toUpperCase();
      this.headers = new NitroHeaders(
        init?.headers
          ? init.headers instanceof NitroHeaders
            ? init.headers
            : (init.headers as any)
          : undefined
      );
      this.redirect = init?.redirect ?? 'follow';
      this.signal = init?.signal ?? new AbortController().signal;
      this.cache = init?.cache ?? 'default';
      this.credentials = init?.credentials ?? 'same-origin';
      this.mode = init?.mode ?? 'cors';
      this.referrer = init?.referrer ?? 'about:client';
      this.referrerPolicy = init?.referrerPolicy ?? '';
      this.integrity = init?.integrity ?? '';
      this.keepalive = init?.keepalive ?? false;
      this._body = init?.body ?? null;
    }

    this.destination = '';
  }

  get bodyUsed(): boolean {
    return this._bodyUsed;
  }

  get body(): ReadableStream<Uint8Array> | null {
    if (this._body == null) return null;
    const bodyBytes = this._getBodyBytes();
    if (!bodyBytes) return null;
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bodyBytes));
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
    if (this._body == null) return undefined;
    if (typeof this._body === 'string') {
      const encoded = stringToUTF8(this._body);
      return (encoded.buffer as ArrayBuffer).slice(
        encoded.byteOffset,
        encoded.byteOffset + encoded.byteLength
      );
    }
    if (this._body instanceof ArrayBuffer) return this._body;
    if (ArrayBuffer.isView(this._body)) {
      const view = this._body;
      return (view.buffer as ArrayBuffer).slice(
        view.byteOffset,
        view.byteOffset + view.byteLength
      );
    }
    return undefined;
  }

  private _getBodyString(): string {
    if (this._body == null) return '';
    if (typeof this._body === 'string') return this._body;
    const bytes = this._getBodyBytes();
    if (bytes) return utf8ToString(new Uint8Array(bytes));
    return '';
  }

  async text(): Promise<string> {
    this._throwIfBodyUsed();
    this._bodyUsed = true;
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
    return this._getBodyBytes() ?? new ArrayBuffer(0);
  }

  async blob(): Promise<Blob> {
    this._throwIfBodyUsed();
    this._bodyUsed = true;
    const buffer = this._getBodyBytes() ?? new ArrayBuffer(0);
    const contentType = this.headers.get('content-type') ?? '';
    return new Blob([buffer], { type: contentType });
  }

  async bytes(): Promise<Uint8Array> {
    this._throwIfBodyUsed();
    this._bodyUsed = true;
    const buffer = this._getBodyBytes() ?? new ArrayBuffer(0);
    return new Uint8Array(buffer);
  }

  clone(): NitroRequest {
    if (this._bodyUsed) {
      throw new TypeError('Cannot clone a Request whose body has been used.');
    }
    return new NitroRequest(this);
  }

  async formData(): Promise<never> {
    throw new TypeError('formData() is not supported in NitroRequest');
  }
}
