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
  bodySize,
  sendXMLHttpRequest,
  type XMLHttpRequestTransportHandle,
} from './XMLHttpRequestTransport';
import { utf8Length, utf8ToString } from './utf8';

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
  // Set on a request's error event: why the client failed. Not in the spec,
  // and not named message, which axios would report instead of
  // "Network Error".
  nitroError?: string;
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

type ErrorReporter = { reportError?: (error: unknown) => void };

// Like a browser, a throwing listener does not stop the dispatch. React
// Native's ErrorUtils.reportError() hands the error to the global handler as
// non-fatal, so crash reporters see it; rethrowing it from a timer would be
// fatal.
function reportListenerError(error: unknown): void {
  const errorUtils = (globalThis as { ErrorUtils?: ErrorReporter }).ErrorUtils;
  if (typeof errorUtils?.reportError === 'function') {
    errorUtils.reportError(error);
  } else {
    console.error(error);
  }
}

class NitroEventTarget {
  protected readonly _listeners = new Map<string, Set<Listener>>();

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
    if (listeners == null) return;
    listeners.delete(listener);
    if (listeners.size === 0) this._listeners.delete(type);
  }

  dispatchEvent(event: Event): boolean {
    const propertyName = `on${event.type}`;
    const target = this as unknown as Record<string, unknown>;
    const handler = target[propertyName];
    if (typeof handler === 'function') {
      try {
        handler.call(this, event);
      } catch (error) {
        reportListenerError(error);
      }
    }

    const listeners = this._listeners.get(event.type);
    if (listeners == null) return true;
    const snapshot = Array.from(listeners);
    for (const listener of snapshot) {
      // A listener removed earlier in this dispatch does not run.
      if (!listeners.has(listener)) continue;
      try {
        if (typeof listener === 'function') {
          listener.call(this, event);
        } else {
          listener.handleEvent(event);
        }
      } catch (error) {
        reportListenerError(error);
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

  // Whether anything listens to the upload, like a browser's upload listener
  // flag.
  _isObserved(): boolean {
    return (
      this.onabort != null ||
      this.onerror != null ||
      this.onload != null ||
      this.onloadend != null ||
      this.onloadstart != null ||
      this.onprogress != null ||
      this.ontimeout != null ||
      this._listeners.size > 0
    );
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

// HTTP token characters, for methods and header names. In Hermes, one
// regular expression test costs less than a loop over the characters.
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const FORBIDDEN_METHODS = new Set(['CONNECT', 'TRACE', 'TRACK']);
// The methods XMLHttpRequest upper-cases. Others are sent as given.
const NORMALIZED_METHODS = new Set([
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'POST',
  'PUT',
]);
// The usual origin of a URL: http(s)://host[:port] with a plain host and a
// port up to 59999. isValidURL() accepts it without the full check.
const SIMPLE_HTTP_ORIGIN =
  /https?:\/\/[a-z0-9.-]+(?::[0-5]?\d{0,4})?(?=[/?#]|$)/iy;
// The last origin SIMPLE_HTTP_ORIGIN matched. Requests mostly go to an
// origin that was just checked.
let lastSimpleOrigin = '';
const INVALID_HEADER_VALUE = /[\0\n\r]/;
// Lower-case keys of valid header names. Apps send the same few names, and a
// Map lookup costs less than the token check and toLowerCase().
const MAX_HEADER_KEYS = 256;
const headerKeys = new Map<string, string>();

// The fields of a failed request's events.
const NO_PROGRESS: ProgressInit = {};

let nextRequestId = 1;

// The total for download progress events, or 0 when it is unknown.
// Content-Length counts encoded bytes, so it does not apply to a body the
// native client decompressed.
function responseLength(headers: Record<string, string>): number {
  const encoding = headers['content-encoding'];
  if (encoding && encoding.trim().toLowerCase() !== 'identity') return 0;
  const length = headers['content-length'];
  if (length == null) return 0;
  const total = Number(length);
  // Digits only: Number() would also accept '1e3', '0x400' or 'Infinity'.
  return total > 0 && total < Infinity && String(total) === length ? total : 0;
}

// The length of the bytes that end on a whole UTF-8 sequence. A sequence cut
// off at the end waits for the next chunk.
function completeUTF8Length(bytes: Uint8Array): number {
  const length = bytes.byteLength;
  // A sequence has at most 4 bytes, so a cut one starts in the last 3.
  for (let i = length - 1; i >= 0 && i >= length - 3; i--) {
    const byte = bytes[i] ?? 0;
    if (byte < 0x80) return length;
    if (byte >= 0xc0) {
      const size = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : 2;
      return length - i < size ? i : length;
    }
  }
  return length;
}

// A DOMException where the runtime has one, else an Error with the same name.
function domException(message: string, name: string): Error {
  if (typeof DOMException === 'function') {
    return new DOMException(message, name);
  }
  const error = new Error(message);
  error.name = name;
  return error;
}

function normalizeMethod(method: string): string {
  if (NORMALIZED_METHODS.has(method)) return method;
  if (!TOKEN.test(method)) {
    throw domException(
      `'${method}' is not a valid HTTP method.`,
      'SyntaxError'
    );
  }
  const upperCaseMethod = method.toUpperCase();
  if (FORBIDDEN_METHODS.has(upperCaseMethod)) {
    throw domException(
      `'${method}' HTTP method is unsupported.`,
      'SecurityError'
    );
  }
  return NORMALIZED_METHODS.has(upperCaseMethod) ? upperCaseMethod : method;
}

// The forbidden host code points that can be part of a host here: the others
// end the authority, and the host starts after the last '@'.
function isForbiddenHostCode(code: number): boolean {
  return (
    code <= 0x20 ||
    code === 0x3c || // <
    code === 0x3e || // >
    code === 0x5b || // [
    code === 0x5d || // ]
    code === 0x5e || // ^
    code === 0x7c || // |
    code === 0x7f
  );
}

// The URL parser rejects an http(s) URL whose host is empty or has a
// forbidden character, or whose port is invalid. Paths and other schemes are
// left to the client.
function isValidURL(url: string): boolean {
  const origin = lastSimpleOrigin;
  if (origin !== '' && url.startsWith(origin)) {
    // The origin has to end there: a path, a query, a fragment or the end.
    if (url.length === origin.length) return true;
    const next = url.charCodeAt(origin.length);
    if (next === 0x2f || next === 0x3f || next === 0x23) return true;
  }
  SIMPLE_HTTP_ORIGIN.lastIndex = 0;
  if (SIMPLE_HTTP_ORIGIN.test(url)) {
    lastSimpleOrigin = url.slice(0, SIMPLE_HTTP_ORIGIN.lastIndex);
    return true;
  }
  let start = 0;
  let end = url.length;
  while (start < end && url.charCodeAt(start) <= 0x20) start++;
  while (end > start && url.charCodeAt(end - 1) <= 0x20) end--;
  const input = url.slice(start, end).replace(/[\t\n\r]/g, '');
  const match = /^https?:[/\\]*([^/\\?#]*)/i.exec(input);
  if (match == null) return true;
  const authority = match[1] ?? '';
  const hostAndPort = authority.slice(authority.lastIndexOf('@') + 1);
  let port: string;
  const ipv6 = /^\[[0-9A-Fa-f:.]+\](.*)$/.exec(hostAndPort);
  if (ipv6 != null) {
    const rest = ipv6[1] ?? '';
    if (rest !== '' && !rest.startsWith(':')) return false;
    port = rest.slice(1);
  } else {
    const colon = hostAndPort.indexOf(':');
    const hostEnd = colon < 0 ? hostAndPort.length : colon;
    if (hostEnd === 0) return false;
    for (let i = 0; i < hostEnd; i++) {
      if (isForbiddenHostCode(hostAndPort.charCodeAt(i))) return false;
    }
    port = colon < 0 ? '' : hostAndPort.slice(colon + 1);
  }
  return port === '' || (/^\d+$/.test(port) && Number(port) <= 65535);
}

// The lower-case key for a valid header name, or null.
function headerKey(name: string): string | null {
  let key = headerKeys.get(name);
  if (key === undefined) {
    if (!TOKEN.test(name)) return null;
    key = name.toLowerCase();
    if (headerKeys.size >= MAX_HEADER_KEYS) headerKeys.clear();
    headerKeys.set(name, key);
  }
  return key;
}

// Whether a header value has no CR, LF or NUL. JSON.stringify() escapes those,
// other control characters, quotes and backslashes, so when it only adds the
// enclosing quotes there is none. In Hermes this native pass costs less than
// the regular expression, which then only checks values JSON had to escape.
function isValidHeaderValue(value: string): boolean {
  return (
    JSON.stringify(value).length === value.length + 2 ||
    !INVALID_HEADER_VALUE.test(value)
  );
}

// Leading and trailing HTTP whitespace is dropped, as in a browser.
function normalizeHeaderValue(value: string): string {
  const length = value.length;
  if (
    length === 0 ||
    (value.charCodeAt(0) > 0x20 && value.charCodeAt(length - 1) > 0x20)
  ) {
    return value;
  }
  return value.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
}

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
  responseURL = '';
  withCredentials = true;

  _requestId: number | null = null;
  _aborted = false;
  _cachedResponse: unknown;
  // Read only while _hasError is set.
  _errorMessage: string | undefined;
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
  // Binary response bytes, merged once the response is read.
  private _chunks: Uint8Array<ArrayBuffer>[] = [];
  private _loaded = 0;
  // The start of a UTF-8 sequence that continues in the next chunk.
  private _pendingText: Uint8Array | null = null;
  private _progressLoaded = -1;
  private _sendTime = 0;
  private _timeout = 0;
  private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private _total = 0;
  // The request body's size while its upload events are due: -2 when only
  // the native client knows it (FormData), -1 when no upload events are due.
  private _uploadTotal = -1;

  static __setInterceptor_DO_NOT_USE(interceptor: XHRInterceptor | null): void {
    NitroXMLHttpRequest._interceptor = interceptor;
  }

  constructor() {
    super();
    this._reset();
  }

  // Clears the response. open() and abort() keep the request settings, such
  // as responseType.
  _reset(): void {
    this.responseHeaders = undefined;
    this.status = 0;
    this.statusText = '';
    this.responseURL = '';
    this._cachedResponse = undefined;
    this._hasError = false;
    this._response = '';
    this._lowerCaseResponseHeaders = {};
    this._timedOut = false;
    this._chunks = [];
    this._loaded = 0;
    this._pendingText = null;
    this._progressLoaded = -1;
    this._total = 0;
  }

  get responseType(): ResponseType {
    return this._responseType;
  }

  set responseType(responseType: ResponseType) {
    // The spec allows this until LOADING, but send() picks the transport and
    // how the body is read from the response type.
    if (this._sent || this.readyState === LOADING || this.readyState === DONE) {
      throw domException(
        "Failed to set the 'responseType' property on 'XMLHttpRequest': The " +
          'response type cannot be set after the request has been sent.',
        'InvalidStateError'
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

  get timeout(): number {
    return this._timeout;
  }

  set timeout(timeout: number) {
    // An unsigned long, as in a browser. A string such as '5000' works too.
    // eslint-disable-next-line no-bitwise
    this._timeout = Number(timeout) >>> 0;
    // A new value counts from send(), and 0 stops the timer.
    if (this._requestId != null) this._startTimeout(this._requestId);
  }

  get responseText(): string {
    if (this._responseType !== '' && this._responseType !== 'text') {
      throw domException(
        "The 'responseText' property is only available if 'responseType' " +
          `is set to '' or 'text', but it is '${this._responseType}'.`,
        'InvalidStateError'
      );
    }
    if (this.readyState < LOADING) return '';
    return this._response;
  }

  // Documents are not supported, so there is never an XML response.
  get responseXML(): null {
    const responseType = this._responseType;
    if (responseType !== '' && responseType !== 'document') {
      throw domException(
        "The 'responseXML' property is only available if 'responseType' " +
          `is set to '' or 'document', but it is '${responseType}'.`,
        'InvalidStateError'
      );
    }
    return null;
  }

  get response(): unknown {
    const responseType = this.responseType;
    if (responseType === '' || responseType === 'text') {
      if (this.readyState < LOADING || this._hasError) return '';
      return this._response;
    }

    if (this.readyState !== DONE || this._hasError) return null;
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
    if (this._uploadTotal !== -1) {
      this._completeUpload(requestId);
      // An upload listener may have aborted the request.
      if (requestId !== this._requestId) return;
    }
    this.status = status;
    this.setResponseHeaders(responseHeaders);
    this._total = responseLength(this._lowerCaseResponseHeaders);
    this.setReadyState(this.HEADERS_RECEIVED);
    // A listener may have called abort() or open().
    if (requestId !== this._requestId) return;
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
    // Each chunk is decoded once and appended, so reading a growing response
    // stays linear.
    this._response += responseText;
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
    // Native reports the end of a buffered body, and so does the body itself.
    if (loaded === this._progressLoaded) return;
    this._progressLoaded = loaded;
    this._dispatch('progress', {
      lengthComputable: total > 0,
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
      // A network error leaves no response behind, so responseText stays
      // empty. The error event's nitroError carries the client's error.
      this._reset();
      this._errorMessage = error;
      this._hasError = true;
      this._timedOut = timeOutError;
    }
    this._requestHandle = null;
    this._requestId = null;
    this._clearTimeout();
    this.setReadyState(this.DONE);

    const interceptor = NitroXMLHttpRequest._interceptor;
    if (interceptor == null) return;
    if (error) {
      interceptor.loadingFailed(requestId, error);
    } else {
      interceptor.loadingFinished(requestId, this._response.length);
    }
  }

  getAllResponseHeaders(): string {
    if (!this.responseHeaders) return '';

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
    if (this.readyState !== this.OPENED || this._sent) {
      throw domException(
        "Failed to execute 'setRequestHeader' on 'XMLHttpRequest': The " +
          "object's state must be OPENED.",
        'InvalidStateError'
      );
    }
    const name = typeof header === 'string' ? header : String(header);
    const key = headerKey(name);
    if (key == null) {
      throw domException(
        `'${name}' is not a valid HTTP header field name.`,
        'SyntaxError'
      );
    }
    const stringValue = normalizeHeaderValue(
      typeof value === 'string' ? value : String(value)
    );
    if (!isValidHeaderValue(stringValue)) {
      throw domException(
        `'${stringValue}' is not a valid HTTP header field value.`,
        'SyntaxError'
      );
    }
    const existing = this._headers[key];
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
    if (async !== undefined && !async) {
      throw new Error('Synchronous http requests are not supported');
    }
    const requestMethod = normalizeMethod(
      typeof method === 'string' ? method : String(method)
    );
    const requestURL = typeof url === 'string' ? url : String(url);
    if (!requestURL) {
      throw domException('Cannot load an empty url', 'SyntaxError');
    }
    if (!isValidURL(requestURL)) {
      throw domException(`Invalid URL: '${requestURL}'`, 'SyntaxError');
    }
    // Like a browser, open() stops a request in flight without events and
    // reuses the object. A new object has nothing to reset.
    if (this._method != null) {
      this._terminate();
      this._sent = false;
      this._headers = {};
      this._reset();
    }
    this._method = requestMethod;
    this._url = requestURL;
    this._aborted = false;
    if (this.readyState !== this.OPENED) {
      this.setReadyState(this.OPENED);
    }
  }

  overrideMimeType(_mime: string): void {
    if (this.readyState === this.LOADING || this.readyState === this.DONE) {
      throw domException(
        'overrideMimeType() cannot be called while loading',
        'InvalidStateError'
      );
    }
  }

  send(data: Document | XMLHttpRequestBodyInit | null = null): void {
    if (this.readyState !== this.OPENED) {
      throw domException('Request has not been opened', 'InvalidStateError');
    }
    if (this._sent) {
      throw domException('Request has already been sent', 'InvalidStateError');
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
    this._sendTime = Date.now();
    const observesProgress =
      this.onprogress != null || this._listeners.has('progress');
    const requestId = nextRequestId;
    nextRequestId += 1;
    this.__didCreateRequest(requestId);
    if (this._timeout > 0) this._startTimeout(requestId);
    // The text of a response nothing watches, delivered when it completes.
    let bufferedText = '';

    // Like a browser, the upload fires events only if something listened to
    // it when send() was called.
    this._uploadTotal = -1;
    if (data != null && this.upload._isObserved()) {
      let size: number | undefined;
      try {
        size = bodySize(data);
      } catch {
        // The size is then unknown; the body is still sent.
      }
      this._uploadTotal = size ?? -2;
    }
    if (this.onloadstart != null || this._listeners.has('loadstart')) {
      this._dispatch('loadstart');
      // A loadstart listener may have aborted the request, or sent another.
      if (requestId !== this._requestId) return;
    }
    if (this._uploadTotal !== -1) {
      const total = Math.max(this._uploadTotal, 0);
      this.upload.dispatchProgress('loadstart', {
        lengthComputable: total > 0,
        total,
      });
      if (requestId !== this._requestId) return;
    }

    this._requestHandle = sendXMLHttpRequest(
      {
        body: data,
        headers: this._headers,
        incremental: incrementalEvents,
        method,
        observesProgress,
        responseType: this._responseType,
        url,
        withCredentials: this.withCredentials,
      },
      {
        onChunk: (chunk, loaded) => {
          if (requestId !== this._requestId) return;
          this._loaded = loaded;
          const receivesText =
            this._responseType !== 'arraybuffer' &&
            this._responseType !== 'blob';
          if (!receivesText) {
            this._chunks.push(chunk);
            this.__didReceiveDataProgress(requestId, loaded, this._total);
          } else if (incrementalEvents) {
            this.__didReceiveIncrementalData(
              requestId,
              this._decodeText(chunk),
              loaded,
              this._total
            );
          } else {
            bufferedText += this._decodeText(chunk);
            this.__didReceiveDataProgress(requestId, loaded, this._total);
          }
        },
        onComplete: (error) => {
          if (requestId !== this._requestId) return;
          if (!error) {
            const receivesText =
              this._responseType !== 'arraybuffer' &&
              this._responseType !== 'blob';
            if (receivesText) {
              const responseText = this._decodeText(null);
              if (this.readyState < this.LOADING) {
                this.__didReceiveData(requestId, bufferedText + responseText);
              } else {
                this._response += responseText;
              }
            } else if (this.readyState < this.LOADING) {
              this.setReadyState(this.LOADING);
            }
          }
          this.__didCompleteResponse(requestId, error, false);
        },
        onProgress: (loaded) => {
          // A binary body counts its own bytes as they arrive.
          if (
            this._responseType !== 'arraybuffer' &&
            this._responseType !== 'blob'
          ) {
            this._loaded = loaded;
          }
          this.__didReceiveDataProgress(requestId, loaded, this._total);
        },
        onResponse: (status, headers, responseURL) => {
          this.__didReceiveResponse(requestId, status, headers, responseURL);
        },
        onText: (text) => {
          // The load and loadend events report the bytes received, which a
          // text body does not count. Native counts them for a progress
          // listener.
          if (!observesProgress && this._observesEnd()) {
            this._loaded = this._textLength(text);
          }
          this.__didReceiveData(requestId, text);
        },
      }
    );
  }

  abort(): void {
    this._terminate();
    // Before send() the request stays OPENED, and send() still works.
    if (
      !(
        this.readyState === this.UNSENT ||
        (this.readyState === this.OPENED && !this._sent) ||
        this.readyState === this.DONE
      )
    ) {
      this._aborted = true;
      this._sent = false;
      this._reset();
      this.setReadyState(this.DONE);
    }
    if (this.readyState === this.DONE) {
      this.readyState = this.UNSENT;
      this._reset();
    }
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
    // Read before the listeners run, since one may call open().
    const aborted = this._aborted;
    const hasError = this._hasError;
    const timedOut = this._timedOut;
    // An upload still due at DONE failed with the request. Taken now, since a
    // listener may send another request with its own upload.
    const uploadFailed = this._uploadTotal !== -1 && newState === this.DONE;
    if (uploadFailed) this._uploadTotal = -1;
    this.readyState = newState;
    this._dispatch('readystatechange');
    if (newState !== this.DONE) return;
    // A failed request ends its upload first and reports no bytes.
    let progress = NO_PROGRESS;
    if (aborted) {
      if (uploadFailed) this._failUpload('abort');
      this._dispatch('abort');
    } else if (hasError) {
      const type = timedOut ? 'timeout' : 'error';
      if (uploadFailed) this._failUpload(type);
      if (timedOut) {
        this._dispatch(type);
      } else {
        const target = this as unknown as EventTarget;
        const event = new NitroProgressEvent(target, 'error');
        event.nitroError = this._errorMessage;
        this.dispatchEvent(event as unknown as Event);
      }
    } else {
      // Like Chromium, a listener that called open() or abort() ends the
      // request without load and loadend.
      if (this.readyState !== this.DONE) return;
      if (this._observesEnd()) {
        progress = {
          lengthComputable: this._total > 0,
          loaded: this._loaded,
          total: this._total,
        };
      }
      this._dispatch('load', progress);
    }
    this._dispatch('loadend', progress);
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

  // Decodes the next chunk of a UTF-8 body, or with null the bytes left at
  // the end. A sequence cut at a chunk boundary waits for the rest, so every
  // byte is decoded once.
  private _decodeText(chunk: Uint8Array | null): string {
    let bytes = chunk ?? new Uint8Array(0);
    const pending = this._pendingText;
    if (pending != null) {
      bytes = new Uint8Array(pending.byteLength + (chunk?.byteLength ?? 0));
      bytes.set(pending);
      if (chunk != null) bytes.set(chunk, pending.byteLength);
    }
    const end = chunk == null ? bytes.byteLength : completeUTF8Length(bytes);
    this._pendingText = end < bytes.byteLength ? bytes.slice(end) : null;
    // utf8ToString drops a leading byte order mark. That is only right at the
    // start of the body, where these bytes are all that has been received.
    let start = 0;
    let marks = '';
    if (this._loaded !== bytes.byteLength) {
      while (
        end - start >= 3 &&
        bytes[start] === 0xef &&
        bytes[start + 1] === 0xbb &&
        bytes[start + 2] === 0xbf
      ) {
        start += 3;
        marks += '\ufeff';
      }
    }
    if (start === end) return marks;
    return marks + utf8ToString(bytes.subarray(start, end));
  }

  // Stops the native request. Its callbacks are ignored from here on.
  private _terminate(): void {
    const requestHandle = this._requestHandle;
    this._requestHandle = null;
    this._requestId = null;
    this._clearTimeout();
    requestHandle?.abort();
  }

  private _startTimeout(requestId: number): void {
    this._clearTimeout();
    if (!(this._timeout > 0)) return;
    const delay = Math.max(0, this._sendTime + this._timeout - Date.now());
    this._timeoutTimer = setTimeout(() => {
      this._timeoutTimer = null;
      if (requestId !== this._requestId) return;
      const requestHandle = this._requestHandle;
      this._requestHandle = null;
      requestHandle?.abort();
      this.__didCompleteResponse(requestId, 'Request timed out', true);
    }, delay);
  }

  private _clearTimeout(): void {
    if (this._timeoutTimer == null) return;
    clearTimeout(this._timeoutTimer);
    this._timeoutTimer = null;
  }

  // The request body has been sent once the response starts. Neither native
  // client reports upload progress, so a body of known size is reported at
  // once. A listener that aborts the request stops the upload's events.
  private _completeUpload(requestId: number): void {
    const size = this._uploadTotal;
    this._uploadTotal = -1;
    const total = Math.max(size, 0);
    const progress = { lengthComputable: total > 0, loaded: total, total };
    if (size !== -2) {
      this.upload.dispatchProgress('progress', progress);
      if (requestId !== this._requestId) return;
    }
    this.upload.dispatchProgress('load', progress);
    if (requestId !== this._requestId) return;
    this.upload.dispatchProgress('loadend', progress);
  }

  private _failUpload(type: string): void {
    this.upload.dispatchProgress(type);
    this.upload.dispatchProgress('loadend');
  }

  // Whether anything listens for the end of the request, which reports the
  // bytes received.
  private _observesEnd(): boolean {
    return (
      this.onload != null ||
      this.onloadend != null ||
      this._listeners.has('load') ||
      this._listeners.has('loadend')
    );
  }

  // The bytes of a text body that arrived whole. The Content-Length gives them
  // when it is exact.
  private _textLength(text: string): number {
    if (text.length === 0) return 0;
    return this._total > 0 ? this._total : utf8Length(text);
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
