import { isFormData } from './fetch-core/body';
import { nitroFetch } from './fetch-core/fetch';

export type XMLHttpRequestTransportRequest = {
  body: Document | XMLHttpRequestBodyInit | null;
  headers: Record<string, string>;
  method: string;
  timeout: number;
  url: string;
  withCredentials: boolean;
};

export type XMLHttpRequestTransportCallbacks = {
  onChunk(chunk: Uint8Array<ArrayBuffer>, loaded: number, total: number): void;
  onComplete(error: string, timedOut: boolean): void;
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

type NitroRequestInit = RequestInit & { stream?: boolean };

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
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timeoutTimer == null) return;
    clearTimeout(timeoutTimer);
    timeoutTimer = null;
  };

  const complete = (error: string, timedOut: boolean) => {
    if (completed) return;
    completed = true;
    clearTimer();
    callbacks.onComplete(error, timedOut);
  };

  const performRequest = async () => {
    try {
      const stream = !isFormData(request.body);
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

      complete('', false);
    } catch (error) {
      if (completed) return;
      const message = error instanceof Error ? error.message : String(error);
      complete(message, false);
    }
  };

  if (request.timeout > 0) {
    timeoutTimer = setTimeout(() => {
      if (completed) return;
      abortController.abort();
      complete('Request timed out', true);
    }, request.timeout);
  }

  performRequest();

  return {
    abort() {
      if (completed) return;
      completed = true;
      clearTimer();
      abortController.abort();
    },
  };
}
