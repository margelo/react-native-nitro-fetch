import { nitroFetch } from './fetch-core/fetch';
import type { NitroRawInit } from './fetch-core/raw';
import { NitroHeaders } from './Headers';
import type { UrlResponseInfo } from './NitroCronet.nitro';
import type { NitroRequestMethod } from './NitroFetch.nitro';
import { utf8Length } from './utf8';

export type XMLHttpRequestTransportRequest = {
  body: Document | XMLHttpRequestBodyInit | null;
  headers: Record<string, string>;
  // The caller observes the response before it completes, like React Native's
  // incrementalUpdates.
  incremental: boolean;
  method: string;
  // The caller listens for download progress.
  observesProgress: boolean;
  responseType: XMLHttpRequestResponseType;
  url: string;
  withCredentials: boolean;
};

export type XMLHttpRequestTransportCallbacks = {
  onChunk(chunk: Uint8Array<ArrayBuffer>, loaded: number): void;
  onComplete(error: string): void;
  // Bytes received so far, while a buffered body loads.
  onProgress(loaded: number): void;
  onResponse(
    status: number,
    headers: Record<string, string>,
    responseURL: string
  ): void;
  // A buffered text body, decoded natively.
  onText(text: string): void;
};

export type XMLHttpRequestTransportHandle = {
  abort(): void;
};

function responseHeaders(
  headerList: Headers | NitroHeaders
): Record<string, string> {
  const headers: Record<string, string> = {};
  headerList.forEach((value, name) => {
    headers[name] = value;
  });
  return headers;
}

export function bodySize(
  body: Document | XMLHttpRequestBodyInit | null
): number | undefined {
  if (body == null) return 0;
  // React Native's Blob throws on a string with a lone surrogate.
  if (typeof body === 'string') return utf8Length(body);
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size;
  if (
    typeof URLSearchParams !== 'undefined' &&
    body instanceof URLSearchParams
  ) {
    return utf8Length(body.toString());
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

function isBinaryResponse(responseType: XMLHttpRequestResponseType): boolean {
  return responseType === 'arraybuffer' || responseType === 'blob';
}

const EVENT_STREAM = /(?:^|,)\s*text\/event-stream\s*(?:[;,]|$)/i;

// A request for an event stream (EventSource clients send this Accept header
// by spec) runs on the stream client's connections, so long-lived streams
// can't hold the default client's: the engine is picked before the response
// says whether it streams.
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

  const fail = (error: unknown) => {
    if (completed) return;
    const message = error instanceof Error ? error.message : String(error);
    complete(message);
  };

  // The response head comes before the body when native reports it early,
  // otherwise with the body.
  let responded = false;
  const respond = (
    status: number,
    headers: Record<string, string>,
    responseURL: string
  ) => {
    responded = true;
    callbacks.onResponse(status, headers, responseURL);
  };

  // Native calls these while the request loads. A listener that throws fails
  // the request, as it would while the response is handled below.
  const whileLoading =
    <Args extends unknown[]>(handler: (...args: Args) => void) =>
    (...args: Args) => {
      if (completed) return;
      try {
        handler(...args);
      } catch (error) {
        abortController.abort();
        fail(error);
      }
    };

  // Only a caller that watches the request while it loads hears about the
  // head before the body, or gets an event stream as it arrives. Everyone
  // else gets the whole response in one native-to-JS hop.
  const onResponseStarted = whileLoading((info: UrlResponseInfo) => {
    respond(
      info.httpStatusCode,
      responseHeaders(new NitroHeaders(info.allHeadersAsList)),
      info.url
    );
  });

  let streamed = false;
  let loaded = 0;
  const onData = whileLoading((chunk: ArrayBuffer) => {
    streamed = true;
    loaded += chunk.byteLength;
    callbacks.onChunk(new Uint8Array(chunk), loaded);
  });

  // Progress can come before the head when the whole body arrived with it.
  let pendingProgress: number | null = null;
  const onProgress = whileLoading((received: number) => {
    if (!responded) {
      pendingProgress = received;
      return;
    }
    callbacks.onProgress(received);
  });

  const performRequest = async () => {
    try {
      const credentials: RequestCredentials = request.withCredentials
        ? 'include'
        : 'omit';
      const init: NitroRawInit = {
        body: request.body as BodyInit | null,
        credentials,
        headers: request.headers,
        method: request.method,
        signal: abortController.signal,
        _onResponseStarted: request.incremental ? onResponseStarted : undefined,
        _onData: request.incremental ? onData : undefined,
        _onProgress: request.observesProgress ? onProgress : undefined,
        // The buffered client decodes text natively, so it would hand binary
        // bodies back changed.
        _responseBytes: isBinaryResponse(request.responseType),
        _customMethod: BUFFERED_METHODS.has(request.method)
          ? undefined
          : request.method,
        _separateConnections: acceptsEventStream(request.headers),
      };
      const response = await nitroFetch(request.url, init);
      if (completed) return;

      if (!responded) {
        respond(
          response.status,
          responseHeaders(response.headers),
          response.url
        );
        if (completed) return;
      }
      if (pendingProgress != null) {
        callbacks.onProgress(pendingProgress);
        pendingProgress = null;
        if (completed) return;
      }

      if (streamed) {
        // The body already arrived through onData.
        complete('');
        return;
      }
      if (isBinaryResponse(request.responseType)) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (completed) return;
        callbacks.onChunk(bytes, bytes.byteLength);
      } else {
        const text = await response.text();
        if (completed) return;
        callbacks.onText(text);
      }

      complete('');
    } catch (error) {
      fail(error);
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
