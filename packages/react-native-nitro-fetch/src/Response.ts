import { NitroHeaders } from './Headers';
import { Body } from './Body';
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

  private _body: Body;

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

      this.headers = new NitroHeaders(nitroInit.headers);
      this._body = new Body({
        bytes: nitroInit.bodyBytes,
        text: nitroInit.bodyString,
        stream: nitroInit.body,
      });
    } else {
      // Public constructor: new Response(body?, init?)
      const body = bodyOrInit as BodyInit | null | undefined;
      this.status = init?.status ?? 200;
      this.statusText = init?.statusText ?? '';
      if (
        !Number.isInteger(this.status) ||
        this.status < 200 ||
        this.status > 599
      ) {
        throw new RangeError(
          'Response status must be an integer between 200 and 599.'
        );
      }
      if (/[^\t\x20-\x7e\x80-\xff]/.test(this.statusText)) {
        throw new TypeError('Invalid response status text.');
      }
      if (body != null && [204, 205, 304].includes(this.status)) {
        throw new TypeError('This response status cannot have a body.');
      }
      this.ok = this.status >= 200 && this.status < 300;
      this.url = '';
      this.redirected = false;
      this.type = 'default';
      this.headers = new NitroHeaders(init?.headers as any);
      this._body = new Body();

      if (body == null) {
        // no body
      } else if (typeof body === 'string') {
        this._body = new Body({ text: body });
        if (!this.headers.has('content-type')) {
          this.headers.set('content-type', 'text/plain;charset=UTF-8');
        }
      } else if (body instanceof ArrayBuffer) {
        this._body = new Body({ bytes: body.slice(0) });
      } else if (ArrayBuffer.isView(body)) {
        const view = body as ArrayBufferView;
        this._body = new Body({
          bytes: (view.buffer as ArrayBuffer).slice(
            view.byteOffset,
            view.byteOffset + view.byteLength
          ),
        });
      } else if (
        typeof ReadableStream !== 'undefined' &&
        body instanceof ReadableStream
      ) {
        this._body = new Body({ stream: body });
      } else if (
        typeof URLSearchParams !== 'undefined' &&
        body instanceof URLSearchParams
      ) {
        this._body = new Body({ text: body.toString() });
        if (!this.headers.has('content-type')) {
          this.headers.set(
            'content-type',
            'application/x-www-form-urlencoded;charset=UTF-8'
          );
        }
      } else if (typeof Blob !== 'undefined' && body instanceof Blob) {
        this._body = new Body({ blob: body });
        if (body.type && !this.headers.has('content-type')) {
          this.headers.set('content-type', body.type);
        }
      } else {
        throw new TypeError('Unsupported NitroResponse body type.');
      }
    }
  }

  get bodyUsed(): boolean {
    return this._body.used;
  }

  get body(): ReadableStream<Uint8Array<ArrayBuffer>> | null {
    return this._body.stream;
  }

  async text(): Promise<string> {
    return this._body.text();
  }

  async json(): Promise<any> {
    return JSON.parse(await this.text());
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this._body.arrayBuffer();
  }

  async blob(): Promise<Blob> {
    const contentType = this.headers.get('content-type') ?? '';
    return this._body.blob(contentType);
  }

  async bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return new Uint8Array(await this.arrayBuffer());
  }

  clone(): NitroResponse {
    const body = this._body.clone();
    const cloned = new NitroResponse({
      url: this.url,
      status: this.status,
      statusText: this.statusText,
      ok: this.ok,
      redirected: this.redirected,
      headers: this.headers,
      type: this.type,
    });
    cloned._body = body;
    return cloned;
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

  static json(data: unknown, init?: ResponseInit): NitroResponse {
    const body = JSON.stringify(data);
    if (body === undefined) {
      throw new TypeError('The value cannot be serialized as JSON.');
    }
    const headers = new NitroHeaders(init?.headers as any);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return new NitroResponse(body, {
      ...init,
      headers: headers as unknown as HeadersInit,
    });
  }

  static redirect(url: string, status: number = 302): NitroResponse {
    const validStatuses = [301, 302, 303, 307, 308];
    if (!validStatuses.includes(status)) {
      throw new RangeError(
        `Invalid redirect status: ${status}. Must be one of ${validStatuses.join(
          ', '
        )}`
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
