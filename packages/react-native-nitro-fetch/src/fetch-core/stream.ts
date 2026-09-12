import { NitroCronetSingleton } from '../NitroInstances';
import { NitroHeaders } from '../Headers';
import { NitroResponse } from '../Response';
import type { RequestCache } from '../Request';
import { NetworkInspector } from '../NetworkInspector';
import {
  applyDefaultContentType,
  applyCacheHeaders,
  headersToPairs,
} from './headers';
import { normalizeBody } from './body';
import { getUrlString } from './url';
import { createAbortError } from './errors';

export async function nitroStreamFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const signal = init?.signal as AbortSignal | undefined | null;
  if (signal?.aborted) {
    throw createAbortError();
  }

  const url = getUrlString(input);
  const src = input as { method?: string; headers?: HeadersInit };
  const method = (init?.method ?? src?.method)?.toUpperCase() ?? 'GET';
  const headers = headersToPairs(init?.headers ?? src?.headers) ?? [];
  const normalized = normalizeBody(init?.body);
  applyDefaultContentType(headers, normalized?.contentType);
  applyCacheHeaders(headers, init?.cache as RequestCache | undefined);

  // Inspector: record start
  let inspectorId: string | undefined;
  if (NetworkInspector.isEnabled()) {
    inspectorId = String(Date.now()) + '-' + String(Math.random()).slice(2, 8);
    NetworkInspector._recordStart(
      inspectorId,
      url,
      method,
      headers,
      normalized?.bodyString
    );
  }

  const builder = NitroCronetSingleton.newUrlRequestBuilder(url);
  builder.setHttpMethod(method);
  if (init?.credentials === 'omit') builder.disableCookies();
  // prefetchKey is an internal cache key, never sent on the server
  headers.forEach((h) => {
    if (h.key.toLowerCase() === 'prefetchkey') return;
    builder.addHeader(h.key, h.value);
  });

  if (normalized?.bodyBytes) builder.setUploadBody(normalized.bodyBytes);
  else if (normalized?.bodyString != null)
    builder.setUploadBody(normalized.bodyString);

  return new Promise((resolveResponse, rejectResponse) => {
    let streamController: ReadableStreamDefaultController<
      Uint8Array<ArrayBuffer>
    >;
    let abortListener: (() => void) | undefined;

    const cleanupAbortListener = () => {
      if (!signal || !abortListener) return;
      signal.removeEventListener('abort', abortListener);
      abortListener = undefined;
    };

    let streamCancelled = false;
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        streamCancelled = true;
        cleanupAbortListener();
        try {
          request.cancel();
        } catch {
          return;
        }
      },
    });

    let responseResolved = false;
    let streamBytesReceived = 0;

    let abortSettled = false;
    const settleAborted = () => {
      if (abortSettled) return;
      abortSettled = true;
      cleanupAbortListener();
      if (inspectorId) {
        NetworkInspector._recordEnd(
          inspectorId,
          0,
          '',
          [],
          0,
          'Request aborted'
        );
      }
      const err = createAbortError();
      if (!responseResolved) {
        responseResolved = true;
        rejectResponse(err);
      } else {
        streamController.error(err);
      }
    };

    builder.onResponseStarted((info) => {
      if (responseResolved || signal?.aborted) return;
      responseResolved = true;
      const status = info.httpStatusCode;
      const responseHeaders = new NitroHeaders(
        Object.entries(info.allHeaders).map(([key, value]) => ({ key, value }))
      );
      const response = new NitroResponse({
        url: info.url,
        ok: status >= 200 && status < 300,
        status,
        statusText: info.httpStatusText,
        headers: responseHeaders,
        redirected: false,
        body: stream,
      });
      resolveResponse(response as unknown as Response);
      // Android/Cronet: kick off the first buffer read.
      // iOS/URLSession handles reading automatically so this is a no-op there.
      request.read();
    });

    builder.onReadCompleted((_info, byteBuffer, bytesRead) => {
      // A cancelled stream can still receive an in-flight native read.
      if (streamCancelled || signal?.aborted) return;
      const chunk = new Uint8Array(byteBuffer, 0, bytesRead).slice();
      streamBytesReceived += bytesRead;
      streamController.enqueue(chunk);
      if (!request.isDone()) {
        request.read();
      }
    });

    builder.onSucceeded((_info) => {
      cleanupAbortListener();
      if (streamCancelled || signal?.aborted) return;
      streamController.close();
      if (inspectorId) {
        const info = _info as any;
        const status = info?.httpStatusCode ?? 0;
        const hdrs = info?.allHeadersAsList ?? [];
        NetworkInspector._recordEnd(
          inspectorId,
          status,
          info?.httpStatusText ?? '',
          hdrs,
          streamBytesReceived
        );
      }
    });

    builder.onFailed((_info, error) => {
      if (signal?.aborted) return settleAborted();
      cleanupAbortListener();
      const err = new Error(error.message);
      if (inspectorId) {
        NetworkInspector._recordEnd(inspectorId, 0, '', [], 0, error.message);
      }
      if (!responseResolved) {
        responseResolved = true;
        rejectResponse(err);
      } else {
        streamController.error(err);
      }
    });

    builder.onCanceled(() => settleAborted());

    const request = builder.build();
    if (signal) {
      abortListener = () => {
        try {
          request.cancel();
        } catch {}
        settleAborted();
      };
      signal.addEventListener('abort', abortListener, { once: true });
    }
    request.start();
  });
}
