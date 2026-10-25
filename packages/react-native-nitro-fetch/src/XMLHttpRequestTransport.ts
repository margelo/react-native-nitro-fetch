import { isFormData } from './fetch-core/body';
import { nitroFetch } from './fetch-core/fetch';
import type { NitroStreamInit } from './fetch-core/stream';
import type { NitroRequestMethod } from './NitroFetch.nitro';

export type XMLHttpRequestTransportRequest = {
  body: Document | XMLHttpRequestBodyInit | null;
  headers: Record<string, string>;
  // The caller observes the response before it completes, like React Native's
  // incrementalUpdates.
  incremental: boolean;
  method: string;
  responseType: XMLHttpRequestResponseType;
  url: string;
  withCredentials: boolean;
};

export type XMLHttpRequestTransportCallbacks = {
  onChunk(chunk: Uint8Array<ArrayBuffer>, loaded: number, total: number): void;
  onComplete(error: string): void;
  onResponse(
    status: number,
    headers: Record<string, string>,
    responseURL: string
  ): void;
  onUploadProgress(loaded: number, total: number): void;
};

export type XMLHttpRequestTransportHandle = {
  abort(): void;
};

type NitroRequestInit = NitroStreamInit & { stream?: boolean };

function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return headers;
}

function responseLength(response: Response): number {
  const contentLength = response.headers.get('content-length');
  if (contentLength == null) return -1;
  const parsedLength = Number(contentLength);
  return Number.isFinite(parsedLength) ? parsedLength : -1;
}

function bodySize(
  body: Document | XMLHttpRequestBodyInit | null
): number | undefined {
  if (body == null) return 0;
  if (typeof body === 'string') {
    return new Blob([body]).size;
  }
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size;
  if (
    typeof URLSearchParams !== 'undefined' &&
    body instanceof URLSearchParams
  ) {
    const serialized = body.toString();
    return new Blob([serialized]).size;
  }
  return undefined;
}

const BUFFERED_METHODS = new Set<string>([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
] satisfies NitroRequestMethod[]);

// A text response nobody watches arrives in one native-to-JS hop on the
// buffered client. Everything else streams: the caller watches the body
// arrive, the buffered client would hand binary bodies back decoded as text
// and hold them whole on the Java heap, or it cannot send the method.
function shouldStream(request: XMLHttpRequestTransportRequest): boolean {
  if (isFormData(request.body)) return false;
  return (
    request.incremental ||
    request.responseType === 'arraybuffer' ||
    request.responseType === 'blob' ||
    // fetch-core sends the method upper-cased on either client.
    !BUFFERED_METHODS.has(request.method.toUpperCase())
  );
}

const EVENT_STREAM = /(?:^|,)\s*text\/event-stream\s*(?:[;,]|$)/i;

// Streamed XHRs run on the default client's engine, sharing its connections
// and HTTP cache: whether the server streams is only known from the response
// headers, after the engine is picked. A request for an event stream
// (EventSource clients send this Accept header by spec) keeps the stream
// client's own engine, so long-lived streams can't hold the default client's
// connections.
function acceptsEventStream(headers: Record<string, string>): boolean {
  return Object.entries(headers).some(
    ([name, value]) =>
      name.toLowerCase() === 'accept' && EVENT_STREAM.test(value)
  );
}

/**
 * Adapts Nitro Fetch to the callback boundary used by React Native's
 * XMLHttpRequest implementation. XHR behavior stays in the copied state
 * machine while this module owns Nitro-specific request details.
 */
export function sendXMLHttpRequest(
  request: XMLHttpRequestTransportRequest,
  callbacks: XMLHttpRequestTransportCallbacks
): XMLHttpRequestTransportHandle {
  const abortController = new AbortController();
  let completed = false;

  const complete = (error: string) => {
    if (completed) return;
    completed = true;
    callbacks.onComplete(error);
  };

  const performRequest = async () => {
    try {
      const stream = shouldStream(request);
      const credentials: RequestCredentials = request.withCredentials
        ? 'include'
        : 'same-origin';
      const init: NitroRequestInit = {
        body: request.body as BodyInit | null,
        credentials,
        headers: request.headers,
        method: request.method,
        signal: abortController.signal,
        stream,
        _useDefaultClient: stream && !acceptsEventStream(request.headers),
      };
      const response = await nitroFetch(request.url, init);
      if (completed) return;

      const headers = responseHeaders(response);
      callbacks.onResponse(response.status, headers, response.url);
      if (completed) return;

      const uploadSize = bodySize(request.body);
      if (uploadSize != null && uploadSize > 0) {
        callbacks.onUploadProgress(uploadSize, uploadSize);
      }
      if (completed) return;

      const total = responseLength(response);
      const body = response.body;
      if (body != null) {
        const reader = body.getReader();
        let loaded = 0;
        while (true) {
          const result = await reader.read();
          if (completed) return;
          if (result.done) break;
          if (result.value == null) continue;
          const chunk = result.value.slice();
          loaded += chunk.byteLength;
          callbacks.onChunk(chunk, loaded, total);
        }
      }

      complete('');
    } catch (error) {
      if (completed) return;
      const message = error instanceof Error ? error.message : String(error);
      complete(message);
    }
  };

  performRequest();

  return {
    abort() {
      if (completed) return;
      completed = true;
      abortController.abort();
    },
  };
}
