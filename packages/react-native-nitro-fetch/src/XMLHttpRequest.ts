import { bytesToBlob } from './blob';
import { nitroFetch } from './fetch-core/fetch';
import { isFormData } from './fetch-core/body';
import { stringToUTF8, utf8ToString } from './utf8';

type Listener = EventListenerOrEventListenerObject;

type ProgressInit = {
  lengthComputable?: boolean;
  loaded?: number;
  total?: number;
};

class NitroProgressEvent {
  readonly bubbles = false;
  readonly cancelable = false;
  readonly composed = false;
  readonly currentTarget: EventTarget;
  readonly defaultPrevented = false;
  readonly eventPhase = 2;
  readonly isTrusted = false;
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly returnValue = true;
  readonly srcElement: EventTarget;
  readonly target: EventTarget;
  readonly timeStamp = Date.now();
  readonly total: number;
  readonly type: string;
  cancelBubble = false;

  readonly NONE = 0;
  readonly CAPTURING_PHASE = 1;
  readonly AT_TARGET = 2;
  readonly BUBBLING_PHASE = 3;

  constructor(target: EventTarget, type: string, init: ProgressInit = {}) {
    this.currentTarget = target;
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.srcElement = target;
    this.target = target;
    this.total = init.total ?? 0;
    this.type = type;
  }

  composedPath(): EventTarget[] {
    return [this.target];
  }

  initEvent(): void {}

  preventDefault(): void {}

  stopImmediatePropagation(): void {}

  stopPropagation(): void {}
}

class NitroEventTarget {
  private readonly _listeners = new Map<string, Set<Listener>>();

  addEventListener(
    type: string,
    listener: Listener | null,
    _options?: boolean | AddEventListenerOptions
  ): void {
    if (listener == null) return;
    let listeners = this._listeners.get(type);
    if (listeners == null) {
      listeners = new Set();
      this._listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(
    type: string,
    listener: Listener | null,
    _options?: boolean | EventListenerOptions
  ): void {
    if (listener == null) return;
    const listeners = this._listeners.get(type);
    listeners?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    const propertyName = `on${event.type}`;
    const target = this as unknown as Record<string, unknown>;
    const handler = target[propertyName];
    if (typeof handler === 'function') {
      handler.call(this, event);
    }

    const listeners = this._listeners.get(event.type);
    if (listeners == null) return true;
    const snapshot = Array.from(listeners);
    for (const listener of snapshot) {
      if (typeof listener === 'function') {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
      }
    }
    return !event.defaultPrevented;
  }

  protected _dispatch(type: string, init: ProgressInit = {}): void {
    const target = this as unknown as EventTarget;
    const event = new NitroProgressEvent(target, type, init);
    this.dispatchEvent(event as unknown as Event);
  }
}

class NitroXMLHttpRequestUpload extends NitroEventTarget {
  onabort: ((event: ProgressEvent) => void) | null = null;
  onerror: ((event: ProgressEvent) => void) | null = null;
  onload: ((event: ProgressEvent) => void) | null = null;
  onloadend: ((event: ProgressEvent) => void) | null = null;
  onloadstart: ((event: ProgressEvent) => void) | null = null;
  onprogress: ((event: ProgressEvent) => void) | null = null;
  ontimeout: ((event: ProgressEvent) => void) | null = null;

  dispatchProgress(type: string, init: ProgressInit = {}): void {
    this._dispatch(type, init);
  }
}

type NitroRequestInit = RequestInit & { stream?: boolean };

type RequestHeader = {
  name: string;
  value: string;
};

const SUPPORTED_RESPONSE_TYPES = new Set<XMLHttpRequestResponseType>([
  '',
  'arraybuffer',
  'blob',
  'document',
  'json',
  'text',
]);

/**
 * XMLHttpRequest-compatible wrapper backed by Nitro Fetch.
 *
 * The implementation targets React Native clients such as SuperAgent. It uses
 * Nitro's streaming transport so response headers and download progress arrive
 * before the full body has been buffered.
 */
export class NitroXMLHttpRequest extends NitroEventTarget {
  static readonly UNSENT = 0;
  static readonly OPENED = 1;
  static readonly HEADERS_RECEIVED = 2;
  static readonly LOADING = 3;
  static readonly DONE = 4;

  readonly UNSENT = NitroXMLHttpRequest.UNSENT;
  readonly OPENED = NitroXMLHttpRequest.OPENED;
  readonly HEADERS_RECEIVED = NitroXMLHttpRequest.HEADERS_RECEIVED;
  readonly LOADING = NitroXMLHttpRequest.LOADING;
  readonly DONE = NitroXMLHttpRequest.DONE;

  onabort: ((event: ProgressEvent) => void) | null = null;
  onerror: ((event: ProgressEvent) => void) | null = null;
  onload: ((event: ProgressEvent) => void) | null = null;
  onloadend: ((event: ProgressEvent) => void) | null = null;
  onloadstart: ((event: ProgressEvent) => void) | null = null;
  onprogress: ((event: ProgressEvent) => void) | null = null;
  onreadystatechange: ((event: Event) => void) | null = null;
  ontimeout: ((event: ProgressEvent) => void) | null = null;

  readonly upload = new NitroXMLHttpRequestUpload();

  readyState = NitroXMLHttpRequest.UNSENT;
  response: unknown = null;
  responseText = '';
  responseURL = '';
  responseXML: Document | null = null;
  status = 0;
  statusText = '';
  timeout = 0;
  withCredentials = false;

  private _responseType: XMLHttpRequestResponseType = '';
  private _method = '';
  private _url = '';
  private _requestHeaders = new Map<string, RequestHeader>();
  private _responseHeaders = new Map<string, RequestHeader>();
  private _abortController: AbortController | null = null;
  private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private _requestVersion = 0;
  private _sending = false;
  private _uploadComplete = true;
  private _uploadSize: number | undefined;
  private _loaded = 0;
  private _total = 0;
  private _lengthComputable = false;
  private _chunks: Uint8Array<ArrayBuffer>[] = [];

  get responseType(): XMLHttpRequestResponseType {
    return this._responseType;
  }

  set responseType(value: XMLHttpRequestResponseType) {
    if (
      this.readyState === NitroXMLHttpRequest.LOADING ||
      this.readyState === NitroXMLHttpRequest.DONE
    ) {
      throw new Error('responseType cannot be changed while loading');
    }
    if (!SUPPORTED_RESPONSE_TYPES.has(value)) {
      throw new Error(`Unsupported XMLHttpRequest responseType: ${value}`);
    }
    this._responseType = value;
  }

  open(
    method: string,
    url: string | URL,
    async: boolean = true,
    _username?: string | null,
    _password?: string | null
  ): void {
    if (!async) {
      throw new Error('Synchronous XMLHttpRequest is not supported');
    }
    if (method.length === 0) {
      throw new Error('XMLHttpRequest method cannot be empty');
    }
    if (this._sending) {
      this.abort();
    }

    this._requestVersion += 1;
    this._method = method.toUpperCase();
    this._url = String(url);
    this._requestHeaders.clear();
    this._resetResponse();
    this.readyState = NitroXMLHttpRequest.OPENED;
    this._dispatch('readystatechange');
  }

  setRequestHeader(name: string, value: string): void {
    if (this.readyState !== NitroXMLHttpRequest.OPENED || this._sending) {
      throw new Error('setRequestHeader() requires an opened request');
    }
    const normalizedName = name.toLowerCase();
    const previous = this._requestHeaders.get(normalizedName);
    if (previous == null) {
      const stringValue = String(value);
      this._requestHeaders.set(normalizedName, { name, value: stringValue });
      return;
    }
    const stringValue = String(value);
    previous.value = `${previous.value}, ${stringValue}`;
  }

  getResponseHeader(name: string): string | null {
    if (this.readyState < NitroXMLHttpRequest.HEADERS_RECEIVED) return null;
    const normalizedName = name.toLowerCase();
    const header = this._responseHeaders.get(normalizedName);
    return header?.value ?? null;
  }

  getAllResponseHeaders(): string {
    if (this.readyState < NitroXMLHttpRequest.HEADERS_RECEIVED) return '';
    let result = '';
    for (const header of this._responseHeaders.values()) {
      result += `${header.name}: ${header.value}\r\n`;
    }
    return result;
  }

  overrideMimeType(_mime: string): void {
    if (this.readyState === NitroXMLHttpRequest.LOADING) {
      throw new Error('overrideMimeType() cannot be called while loading');
    }
  }

  send(body: Document | XMLHttpRequestBodyInit | null = null): void {
    if (this.readyState !== NitroXMLHttpRequest.OPENED || this._sending) {
      throw new Error('send() requires an opened request');
    }

    let requestBody = body;
    if (this._method === 'GET' || this._method === 'HEAD') {
      requestBody = null;
    }

    this._sending = true;
    this._loaded = 0;
    this._chunks = [];
    this._uploadComplete = requestBody == null;
    this._uploadSize = this._bodySize(requestBody);
    this._abortController = new AbortController();
    const requestVersion = this._requestVersion;

    const headers: [string, string][] = [];
    for (const header of this._requestHeaders.values()) {
      headers.push([header.name, header.value]);
    }

    const credentials: RequestCredentials = this.withCredentials
      ? 'include'
      : 'same-origin';
    // Nitro's streaming builder cannot read React Native file URIs. Keep
    // multipart requests on the buffered client, which builds them natively.
    const stream = !isFormData(requestBody);
    const init: NitroRequestInit = {
      method: this._method,
      headers,
      credentials,
      signal: this._abortController.signal,
      stream,
    };
    if (requestBody != null) {
      init.body = requestBody as BodyInit;
    }

    this._dispatch('loadstart');
    if (!this._uploadComplete) {
      this.upload.dispatchProgress('loadstart');
    }
    this._armTimeout(requestVersion);
    this._performRequest(requestVersion, init);
  }

  abort(): void {
    if (!this._sending) {
      this.readyState = NitroXMLHttpRequest.UNSENT;
      return;
    }
    this._terminate('abort');
  }

  private async _performRequest(
    requestVersion: number,
    init: NitroRequestInit
  ): Promise<void> {
    try {
      const response = await nitroFetch(this._url, init);
      if (!this._isCurrent(requestVersion)) return;

      this._setResponseMetadata(response);
      this._completeUpload();
      this._setReadyState(NitroXMLHttpRequest.HEADERS_RECEIVED);

      const body = response.body;
      if (body != null) {
        const reader = body.getReader();
        while (true) {
          const result = await reader.read();
          if (!this._isCurrent(requestVersion)) return;
          if (result.done) break;
          if (result.value != null) {
            this._receiveChunk(result.value);
          }
        }
      }

      if (!this._isCurrent(requestVersion)) return;
      this._finishResponse();
    } catch {
      if (!this._isCurrent(requestVersion)) return;
      this._failRequest();
    }
  }

  private _setResponseMetadata(response: Response): void {
    this.status = response.status;
    this.statusText = response.statusText;
    this.responseURL = response.url;
    this._responseHeaders.clear();
    response.headers.forEach((value, name) => {
      const normalizedName = name.toLowerCase();
      this._responseHeaders.set(normalizedName, { name, value });
    });

    const contentLength = response.headers.get('content-length');
    const parsedLength = contentLength == null ? 0 : Number(contentLength);
    this._lengthComputable = Number.isFinite(parsedLength) && parsedLength > 0;
    this._total = this._lengthComputable ? parsedLength : 0;
  }

  private _receiveChunk(chunk: Uint8Array<ArrayBuffer>): void {
    const ownedChunk = chunk.slice();
    this._chunks.push(ownedChunk);
    this._loaded += ownedChunk.byteLength;

    if (this._responseType === '' || this._responseType === 'text') {
      const bytes = this._mergeChunks();
      this.responseText = utf8ToString(bytes);
      this.response = this.responseText;
    }

    this._setReadyState(NitroXMLHttpRequest.LOADING, true);
    this._dispatch('progress', {
      lengthComputable: this._lengthComputable,
      loaded: this._loaded,
      total: this._total,
    });
  }

  private _finishResponse(): void {
    const bytes = this._mergeChunks();
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    );

    if (this._responseType === 'arraybuffer') {
      this.response = buffer;
    } else if (this._responseType === 'blob') {
      const contentType = this.getResponseHeader('content-type') ?? '';
      this.response = bytesToBlob(buffer, contentType);
    } else if (this._responseType === 'json') {
      const text = utf8ToString(bytes);
      try {
        this.response = text.length === 0 ? null : JSON.parse(text);
      } catch {
        this.response = null;
      }
    } else if (this._responseType === 'document') {
      this.response = null;
      this.responseXML = null;
    } else {
      this.responseText = utf8ToString(bytes);
      this.response = this.responseText;
    }

    this._sending = false;
    this._abortController = null;
    this._clearTimeout();
    this._setReadyState(NitroXMLHttpRequest.DONE);
    const progress = this._responseProgress();
    this._dispatch('load', progress);
    this._dispatch('loadend', progress);
  }

  private _failRequest(): void {
    this._sending = false;
    this._abortController = null;
    this._clearTimeout();
    this.status = 0;
    this.statusText = '';
    this.responseURL = '';
    this._failUpload('error');
    this._setReadyState(NitroXMLHttpRequest.DONE);
    this._dispatch('error');
    this._dispatch('loadend');
  }

  private _terminate(type: 'abort' | 'timeout'): void {
    this._requestVersion += 1;
    this._sending = false;
    this._clearTimeout();
    const controller = this._abortController;
    this._abortController = null;
    controller?.abort();
    this.status = 0;
    this.statusText = '';
    this.responseURL = '';
    this._failUpload(type);
    this._setReadyState(NitroXMLHttpRequest.DONE);
    this._dispatch(type);
    this._dispatch('loadend');
    if (type === 'abort') {
      this.readyState = NitroXMLHttpRequest.UNSENT;
    }
  }

  private _completeUpload(): void {
    if (this._uploadComplete) return;
    this._uploadComplete = true;
    const lengthComputable = this._uploadSize != null;
    const total = this._uploadSize ?? 0;
    const progress = { lengthComputable, loaded: total, total };
    this.upload.dispatchProgress('progress', progress);
    this.upload.dispatchProgress('load', progress);
    this.upload.dispatchProgress('loadend', progress);
  }

  private _failUpload(type: 'abort' | 'error' | 'timeout'): void {
    if (this._uploadComplete) return;
    this._uploadComplete = true;
    this.upload.dispatchProgress(type);
    this.upload.dispatchProgress('loadend');
  }

  private _armTimeout(requestVersion: number): void {
    if (this.timeout <= 0) return;
    this._timeoutTimer = setTimeout(() => {
      if (!this._isCurrent(requestVersion)) return;
      this._terminate('timeout');
    }, this.timeout);
  }

  private _clearTimeout(): void {
    if (this._timeoutTimer == null) return;
    clearTimeout(this._timeoutTimer);
    this._timeoutTimer = null;
  }

  private _isCurrent(requestVersion: number): boolean {
    return this._sending && requestVersion === this._requestVersion;
  }

  private _setReadyState(readyState: number, repeat: boolean = false): void {
    if (this.readyState === readyState && !repeat) return;
    this.readyState = readyState;
    this._dispatch('readystatechange');
  }

  private _responseProgress(): ProgressInit {
    return {
      lengthComputable: this._lengthComputable,
      loaded: this._loaded,
      total: this._total,
    };
  }

  private _mergeChunks(): Uint8Array<ArrayBuffer> {
    const merged = new Uint8Array(this._loaded);
    let offset = 0;
    for (const chunk of this._chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  }

  private _bodySize(
    body: Document | XMLHttpRequestBodyInit | null
  ): number | undefined {
    if (body == null) return 0;
    if (typeof body === 'string') {
      const bytes = stringToUTF8(body);
      return bytes.byteLength;
    }
    if (body instanceof ArrayBuffer) return body.byteLength;
    if (ArrayBuffer.isView(body)) return body.byteLength;
    if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size;
    if (
      typeof URLSearchParams !== 'undefined' &&
      body instanceof URLSearchParams
    ) {
      const serialized = body.toString();
      const encoded = stringToUTF8(serialized);
      return encoded.byteLength;
    }
    return undefined;
  }

  private _resetResponse(): void {
    this._sending = false;
    this._abortController = null;
    this._clearTimeout();
    this._responseHeaders.clear();
    this._chunks = [];
    this._loaded = 0;
    this._total = 0;
    this._lengthComputable = false;
    this.response = null;
    this.responseText = '';
    this.responseURL = '';
    this.responseXML = null;
    this.status = 0;
    this.statusText = '';
  }
}

Object.defineProperty(NitroXMLHttpRequest.prototype, Symbol.toStringTag, {
  configurable: true,
  value: 'XMLHttpRequest',
});
