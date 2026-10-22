/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the LICENSE file
 * in the root directory of the React Native source tree.
 *
 * Derived from React Native's XMLHttpRequest implementation at v0.88.0-rc.3:
 * https://github.com/facebook/react-native/blob/v0.88.0-rc.3/packages/react-native/Libraries/Network/XMLHttpRequest.js
 * The state machine is preserved while the RCTNetworking boundary is adapted
 * to Nitro Fetch and the Flow types are expressed as TypeScript.
 */

import { bytesToBlob } from './blob';
import {
  sendXMLHttpRequest,
  type XMLHttpRequestTransportHandle,
} from './XMLHttpRequestTransport';
import { utf8ToString } from './utf8';

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

class NitroXMLHttpRequestEventTarget extends NitroEventTarget {
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

type XHRInterceptor = {
  requestSent(
    id: number,
    url: string,
    method: string,
    headers: Record<string, string>
  ): void;
  responseReceived(
    id: number,
    url: string,
    status: number,
    headers: Record<string, string>
  ): void;
  dataReceived(id: number, data: string): void;
  loadingFinished(id: number, encodedDataLength: number): void;
  loadingFailed(id: number, error: string): void;
};

type XHRPerformanceLogger = {
  startTimespan(key: string): void;
  stopTimespan(key: string): void;
};

type ResponseType = '' | 'arraybuffer' | 'blob' | 'document' | 'json' | 'text';

const UNSENT = 0;
const OPENED = 1;
const HEADERS_RECEIVED = 2;
const LOADING = 3;
const DONE = 4;

const SUPPORTED_RESPONSE_TYPES: Record<ResponseType, boolean> = {
  'arraybuffer': typeof globalThis.ArrayBuffer === 'function',
  'blob': typeof globalThis.Blob === 'function',
  'document': false,
  'json': true,
  'text': true,
  '': true,
};

let nextRequestId = 1;

/**
 * React Native-compatible XMLHttpRequest state machine backed by Nitro Fetch.
 *
 * React Native normally feeds this state machine with RCTNetworking events.
 * XMLHttpRequestTransport emits the same lifecycle from a Nitro Fetch request.
 */
export class NitroXMLHttpRequest extends NitroEventTarget {
  static readonly UNSENT = UNSENT;
  static readonly OPENED = OPENED;
  static readonly HEADERS_RECEIVED = HEADERS_RECEIVED;
  static readonly LOADING = LOADING;
  static readonly DONE = DONE;

  static _interceptor: XHRInterceptor | null = null;

  readonly UNSENT = UNSENT;
  readonly OPENED = OPENED;
  readonly HEADERS_RECEIVED = HEADERS_RECEIVED;
  readonly LOADING = LOADING;
  readonly DONE = DONE;

  onabort: ((event: ProgressEvent) => void) | null = null;
  onerror: ((event: ProgressEvent) => void) | null = null;
  onload: ((event: ProgressEvent) => void) | null = null;
  onloadend: ((event: ProgressEvent) => void) | null = null;
  onloadstart: ((event: ProgressEvent) => void) | null = null;
  onprogress: ((event: ProgressEvent) => void) | null = null;
  onreadystatechange: ((event: Event) => void) | null = null;
  ontimeout: ((event: ProgressEvent) => void) | null = null;

  readonly upload = new NitroXMLHttpRequestEventTarget();

  readyState = UNSENT;
  responseHeaders: Record<string, string> | null | undefined;
  status = 0;
  statusText = '';
  timeout = 0;
  responseURL = '';
  withCredentials = true;

  _requestId: number | null = null;
  _aborted = false;
  _cachedResponse: unknown;
  _hasError = false;
  _headers: Record<string, string> = {};
  _lowerCaseResponseHeaders: Record<string, string> = {};
  _method: string | null = null;
  _perfKey: string | null = null;
  _responseType: ResponseType = '';
  _response = '';
  _sent = false;
  _url: string | null = null;
  _timedOut = false;
  _trackingName: string | null = null;
  _incrementalEvents = false;
  _performanceLogger: XHRPerformanceLogger | null = null;

  private _requestHandle: XMLHttpRequestTransportHandle | null = null;
  private _chunks: Uint8Array<ArrayBuffer>[] = [];
  private _loaded = 0;

  static __setInterceptor_DO_NOT_USE(interceptor: XHRInterceptor | null): void {
    NitroXMLHttpRequest._interceptor = interceptor;
  }

  constructor() {
    super();
    this._reset();
  }

  _reset(): void {
    this.readyState = this.UNSENT;
    this.responseHeaders = undefined;
    this.status = 0;
    this.statusText = '';
    this.responseURL = '';
    this._requestId = null;
    this._requestHandle = null;
    this._cachedResponse = undefined;
    this._hasError = false;
    this._headers = {};
    this._response = '';
    this._responseType = '';
    this._sent = false;
    this._lowerCaseResponseHeaders = {};
    this._timedOut = false;
    this._chunks = [];
    this._loaded = 0;
  }

  get responseType(): ResponseType {
    return this._responseType;
  }

  set responseType(responseType: ResponseType) {
    if (this._sent) {
      throw new Error(
        "Failed to set the 'responseType' property on 'XMLHttpRequest': The " +
          'response type cannot be set after the request has been sent.'
      );
    }
    const isSupported = Object.prototype.hasOwnProperty.call(
      SUPPORTED_RESPONSE_TYPES,
      responseType
    );
    if (!isSupported) {
      console.warn(
        `The provided value '${responseType}' is not a valid 'responseType'.`
      );
      return;
    }
    if (
      !SUPPORTED_RESPONSE_TYPES[responseType] &&
      responseType !== 'document'
    ) {
      throw new Error(
        `The provided value '${responseType}' is unsupported in this environment.`
      );
    }
    this._responseType = responseType;
  }

  get responseText(): string {
    if (this._responseType !== '' && this._responseType !== 'text') {
      throw new Error(
        "The 'responseText' property is only available if 'responseType' " +
          `is set to '' or 'text', but it is '${this._responseType}'.`
      );
    }
    if (this.readyState < LOADING) return '';
    return this._response;
  }

  get response(): unknown {
    const responseType = this.responseType;
    if (responseType === '' || responseType === 'text') {
      if (this.readyState < LOADING || this._hasError) return '';
      return this._response;
    }

    if (this.readyState !== DONE) return null;
    if (this._cachedResponse !== undefined) return this._cachedResponse;

    if (responseType === 'document') {
      this._cachedResponse = null;
    } else if (responseType === 'arraybuffer') {
      const bytes = this._mergeChunks();
      this._cachedResponse = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      );
    } else if (responseType === 'blob') {
      const bytes = this._mergeChunks();
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      );
      const contentType = this.getResponseHeader('content-type') ?? '';
      this._cachedResponse = bytesToBlob(buffer, contentType);
    } else if (responseType === 'json') {
      try {
        this._cachedResponse = JSON.parse(this._response);
      } catch {
        this._cachedResponse = null;
      }
    } else {
      this._cachedResponse = null;
    }

    return this._cachedResponse;
  }

  __didCreateRequest(requestId: number): void {
    this._requestId = requestId;
    const interceptor = NitroXMLHttpRequest._interceptor;
    if (interceptor == null) return;
    interceptor.requestSent(
      requestId,
      this._url ?? '',
      this._method ?? 'GET',
      this._headers
    );
  }

  __didUploadProgress(
    requestId: number,
    progress: number,
    total: number
  ): void {
    if (requestId !== this._requestId) return;
    this.upload.dispatchProgress('progress', {
      lengthComputable: true,
      loaded: progress,
      total,
    });
  }

  __didReceiveResponse(
    requestId: number,
    status: number,
    responseHeaders: Record<string, string> | null,
    responseURL: string | null
  ): void {
    if (requestId !== this._requestId) return;
    const performanceLogger = this._performanceLogger;
    if (this._perfKey != null && performanceLogger != null) {
      performanceLogger.stopTimespan(this._perfKey);
    }
    this.status = status;
    this.setResponseHeaders(responseHeaders);
    this.setReadyState(this.HEADERS_RECEIVED);
    this.responseURL = responseURL ?? '';

    const interceptor = NitroXMLHttpRequest._interceptor;
    if (interceptor == null) return;
    interceptor.responseReceived(
      requestId,
      responseURL ?? this._url ?? '',
      status,
      responseHeaders ?? {}
    );
  }

  __didReceiveData(requestId: number, response: string): void {
    if (requestId !== this._requestId) return;
    this._response = response;
    this._cachedResponse = undefined;
    this.setReadyState(this.LOADING);

    const interceptor = NitroXMLHttpRequest._interceptor;
    interceptor?.dataReceived(requestId, response);
  }

  __didReceiveIncrementalData(
    requestId: number,
    responseText: string,
    progress: number,
    total: number
  ): void {
    if (requestId !== this._requestId) return;
    // Nitro decodes all bytes received so far. Assigning the complete text keeps
    // split UTF-8 characters correct while preserving React Native's lifecycle.
    this._response = responseText;
    this._cachedResponse = undefined;

    const interceptor = NitroXMLHttpRequest._interceptor;
    interceptor?.dataReceived(requestId, responseText);

    this.setReadyState(this.LOADING);
    this.__didReceiveDataProgress(requestId, progress, total);
  }

  __didReceiveDataProgress(
    requestId: number,
    loaded: number,
    total: number
  ): void {
    if (requestId !== this._requestId) return;
    this._dispatch('progress', {
      lengthComputable: total >= 0,
      loaded,
      total,
    });
  }

  __didCompleteResponse(
    requestId: number,
    error: string,
    timeOutError: boolean
  ): void {
    if (requestId !== this._requestId) return;
    if (error) {
      if (this._responseType === '' || this._responseType === 'text') {
        this._response = error;
      }
      this._hasError = true;
      this._timedOut = timeOutError;
    }
    this._requestHandle = null;
    this._requestId = null;
    this.setReadyState(this.DONE);

    const interceptor = NitroXMLHttpRequest._interceptor;
    if (interceptor == null) return;
    if (error) {
      interceptor.loadingFailed(requestId, error);
    } else {
      interceptor.loadingFinished(requestId, this._response.length);
    }
  }

  getAllResponseHeaders(): string | null {
    if (!this.responseHeaders) return null;

    const unsortedHeaders = new Map<
      string,
      {
        lowerHeaderName: string;
        upperHeaderName: string;
        headerValue: string;
      }
    >();
    for (const rawHeaderName of Object.keys(this.responseHeaders)) {
      const headerValue = this.responseHeaders[rawHeaderName];
      if (headerValue == null) continue;
      const lowerHeaderName = rawHeaderName.toLowerCase();
      const header = unsortedHeaders.get(lowerHeaderName);
      if (header) {
        header.headerValue += `, ${headerValue}`;
        unsortedHeaders.set(lowerHeaderName, header);
      } else {
        unsortedHeaders.set(lowerHeaderName, {
          lowerHeaderName,
          upperHeaderName: rawHeaderName.toUpperCase(),
          headerValue,
        });
      }
    }

    const sortedHeaders = Array.from(unsortedHeaders.values());
    sortedHeaders.sort((a, b) => {
      if (a.upperHeaderName < b.upperHeaderName) return -1;
      if (a.upperHeaderName > b.upperHeaderName) return 1;
      return 0;
    });
    const headerLines = sortedHeaders.map((header) => {
      return `${header.lowerHeaderName}: ${header.headerValue}`;
    });
    return `${headerLines.join('\r\n')}\r\n`;
  }

  getResponseHeader(header: string): string | null {
    const value = this._lowerCaseResponseHeaders[header.toLowerCase()];
    return value ?? null;
  }

  setRequestHeader(header: string, value: unknown): void {
    if (this.readyState !== this.OPENED) {
      throw new Error('Request has not been opened');
    }
    const key = header.toLowerCase();
    const existing = this._headers[key];
    const stringValue = String(value);
    this._headers[key] =
      existing !== undefined ? `${existing}, ${stringValue}` : stringValue;
  }

  setTrackingName(trackingName: string | null): NitroXMLHttpRequest {
    this._trackingName = trackingName;
    return this;
  }

  setPerformanceLogger(
    performanceLogger: XHRPerformanceLogger
  ): NitroXMLHttpRequest {
    this._performanceLogger = performanceLogger;
    return this;
  }

  open(
    method: string,
    url: string | URL,
    async?: boolean,
    _username?: string | null,
    _password?: string | null
  ): void {
    if (this.readyState !== this.UNSENT) {
      throw new Error('Cannot open, already sending');
    }
    if (async !== undefined && !async) {
      throw new Error('Synchronous http requests are not supported');
    }
    const requestURL = String(url);
    if (!requestURL) {
      throw new Error('Cannot load an empty url');
    }
    this._method = method.toUpperCase();
    this._url = requestURL;
    this._aborted = false;
    this.setReadyState(this.OPENED);
  }

  overrideMimeType(_mime: string): void {
    if (this.readyState === this.LOADING || this.readyState === this.DONE) {
      throw new Error('overrideMimeType() cannot be called while loading');
    }
  }

  send(data: Document | XMLHttpRequestBodyInit | null = null): void {
    if (this.readyState !== this.OPENED) {
      throw new Error('Request has not been opened');
    }
    if (this._sent) {
      throw new Error('Request has already been sent');
    }
    this._sent = true;

    const method = this._method;
    const url = this._url;
    if (method == null) {
      throw new Error('XMLHttpRequest method needs to be defined');
    }
    if (url == null) {
      throw new Error('XMLHttpRequest URL needs to be defined');
    }
    if (method === 'GET' || method === 'HEAD') {
      data = null;
    }

    const friendlyName = this._trackingName ?? url;
    const performanceLogger = this._performanceLogger;
    if (performanceLogger != null) {
      this._perfKey = `network_XMLHttpRequest_${friendlyName}`;
      performanceLogger.startTimespan(this._perfKey);
    }

    const incrementalEvents =
      this._incrementalEvents ||
      this.onreadystatechange != null ||
      this.onprogress != null;
    const requestId = nextRequestId;
    nextRequestId += 1;
    this.__didCreateRequest(requestId);

    this._requestHandle = sendXMLHttpRequest(
      {
        body: data,
        headers: this._headers,
        method,
        timeout: this.timeout,
        url,
        withCredentials: this.withCredentials,
      },
      {
        onChunk: (chunk, loaded, total) => {
          if (requestId !== this._requestId) return;
          this._chunks.push(chunk);
          this._loaded = loaded;
          const receivesText =
            this._responseType !== 'arraybuffer' &&
            this._responseType !== 'blob';
          if (receivesText && incrementalEvents) {
            const bytes = this._mergeChunks();
            const responseText = utf8ToString(bytes);
            this.__didReceiveIncrementalData(
              requestId,
              responseText,
              loaded,
              total
            );
          } else {
            this.__didReceiveDataProgress(requestId, loaded, total);
          }
        },
        onComplete: (error, timedOut) => {
          if (requestId !== this._requestId) return;
          if (!error) {
            const receivesText =
              this._responseType !== 'arraybuffer' &&
              this._responseType !== 'blob';
            if (receivesText) {
              const bytes = this._mergeChunks();
              const responseText = utf8ToString(bytes);
              if (!incrementalEvents || this.readyState < this.LOADING) {
                this.__didReceiveData(requestId, responseText);
              }
            } else if (this.readyState < this.LOADING) {
              this.setReadyState(this.LOADING);
            }
          }
          this.__didCompleteResponse(requestId, error, timedOut);
        },
        onResponse: (status, headers, responseURL) => {
          this.__didReceiveResponse(requestId, status, headers, responseURL);
        },
        onUploadProgress: (loaded, total) => {
          this.__didUploadProgress(requestId, loaded, total);
        },
      }
    );
  }

  abort(): void {
    this._aborted = true;
    const requestHandle = this._requestHandle;
    this._requestHandle = null;
    requestHandle?.abort();
    if (
      !(
        this.readyState === this.UNSENT ||
        (this.readyState === this.OPENED && !this._sent) ||
        this.readyState === this.DONE
      )
    ) {
      this._reset();
      this.setReadyState(this.DONE);
    }
    this._reset();
  }

  setResponseHeaders(responseHeaders: Record<string, string> | null): void {
    this.responseHeaders = responseHeaders;
    const headers = responseHeaders ?? {};
    this._lowerCaseResponseHeaders = {};
    for (const headerName of Object.keys(headers)) {
      const headerValue = headers[headerName];
      if (headerValue == null) continue;
      this._lowerCaseResponseHeaders[headerName.toLowerCase()] = headerValue;
    }
  }

  setReadyState(newState: number): void {
    this.readyState = newState;
    this._dispatch('readystatechange');
    if (newState !== this.DONE) return;
    if (this._aborted) {
      this._dispatch('abort');
    } else if (this._hasError) {
      this._dispatch(this._timedOut ? 'timeout' : 'error');
    } else {
      this._dispatch('load');
    }
    this._dispatch('loadend');
  }

  addEventListener(
    type: string,
    listener: Listener | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (type === 'readystatechange' || type === 'progress') {
      this._incrementalEvents = true;
    }
    super.addEventListener(type, listener, options);
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
}

Object.defineProperty(NitroXMLHttpRequest.prototype, Symbol.toStringTag, {
  configurable: true,
  value: 'XMLHttpRequest',
});
