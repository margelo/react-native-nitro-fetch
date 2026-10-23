import { NitroCronetSingleton } from '../NitroInstances';
import { NitroHeaders } from '../Headers';
import { NitroResponse } from '../Response';
import type { RequestCache } from '../Request';
import { NetworkInspector } from '../NetworkInspector';
import type { UrlResponseInfo } from '../NitroCronet.nitro';
import {
  applyDefaultContentType,
  applyCacheHeaders,
  headersToPairs,
  normalizeAndValidateHeaders,
} from './headers';
import { assertBodyAllowed, normalizeBody } from './body';
import { getUrlString } from './url';
import { createAbortError } from './errors';

const noop = () => {};

export async function nitroStreamFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const signal = init?.signal as AbortSignal | undefined | null;
  if (signal?.aborted) {
    throw createAbortError(signal);
  }

  const url = getUrlString(input);
  const src = input as { method?: string; headers?: HeadersInit };
  const method = (init?.method ?? src?.method)?.toUpperCase() ?? 'GET';
  const headers = headersToPairs(init?.headers ?? src?.headers) ?? [];
  assertBodyAllowed(method, init?.body);
  const normalized = normalizeBody(init?.body);
  applyDefaultContentType(headers, normalized?.contentType);
  applyCacheHeaders(headers, init?.cache as RequestCache | undefined);
  normalizeAndValidateHeaders(headers);

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
  if (init?.priority === 'high' || init?.priority === 'low')
    builder.setPriority(init.priority);
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
    const pendingChunks: Uint8Array<ArrayBuffer>[] = [];
    let nativeSucceeded = false;
    let nativeSuccessInfo: UrlResponseInfo;
    let readBufferWindowSize = 0;

    const cleanupAbortListener = () => {
      if (!signal || !abortListener) return;
      signal.removeEventListener('abort', abortListener);
      abortListener = undefined;
    };

    const acknowledgeReadIfNeeded = () => {
      if (readBufferWindowSize <= 0) return;
      request.acknowledgeRead();
    };

    const releasePendingChunks = () => {
      const pendingCount = pendingChunks.length;
      pendingChunks.length = 0;
      for (let index = 0; index < pendingCount; index++) {
        acknowledgeReadIfNeeded();
      }
    };

    let streamCancelled = false;
    let streamClosed = false;
    const closeCompletedStream = () => {
      if (!nativeSucceeded || pendingChunks.length > 0 || streamClosed) return;
      streamClosed = true;
      streamController.close();
      if (inspectorId) {
        const info = nativeSuccessInfo;
        NetworkInspector._recordEnd(
          inspectorId,
          info.httpStatusCode,
          info.httpStatusText,
          info.allHeadersAsList,
          streamBytesReceived
        );
      }
    };

    const drainPendingChunks = () => {
      while (pendingChunks.length > 0) {
        const desiredSize = streamController.desiredSize;
        if (desiredSize == null || desiredSize <= 0) break;
        const chunk = pendingChunks.shift();
        if (chunk == null) throw new Error('Missing pending stream chunk');
        streamController.enqueue(chunk);
        // Releasing a native slot follows stream demand, not callback delivery.
        acknowledgeReadIfNeeded();
      }
      closeCompletedStream();
    };

    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        streamController = controller;
      },
      pull() {
        drainPendingChunks();
      },
      cancel() {
        streamCancelled = true;
        cleanupAbortListener();
        try {
          request.cancel();
        } catch {
          // The request may already have reached a terminal callback.
        }
        releasePendingChunks();
      },
    });

    let responseResolved = false;
    let streamBytesReceived = 0;

    const release = () => {
      builder.onRedirectReceived(noop);
      builder.onResponseStarted(noop);
      builder.onReadCompleted(noop);
      builder.onSucceeded(noop);
      builder.onFailed(noop);
      builder.onCanceled(noop);
      builder.onNativeResponseStarted(noop);
      builder.onNativeRead(noop);
      builder.onNativeCompleted(noop);
    };

    let abortSettled = false;
    const settleAborted = () => {
      if (abortSettled) return;
      abortSettled = true;
      release();
      cleanupAbortListener();
      releasePendingChunks();
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
      const err = createAbortError(signal);
      if (!responseResolved) {
        responseResolved = true;
        rejectResponse(err);
      } else {
        streamController.error(err);
      }
    };

    if (inspectorId) {
      builder.onNativeResponseStarted((timestampMs) => {
        NetworkInspector._recordNativeEvent(
          inspectorId,
          'response-started',
          timestampMs
        );
      });
      builder.onNativeRead((timestampMs) => {
        NetworkInspector._recordNativeEvent(inspectorId, 'read', timestampMs);
      });
      builder.onNativeCompleted((timestampMs) => {
        NetworkInspector._recordNativeEvent(
          inspectorId,
          'completed',
          timestampMs
        );
      });
    }

    let redirected = false;
    const resolveWith = (info: UrlResponseInfo) => {
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
        redirected,
        body: stream,
      });
      resolveResponse(response as unknown as Response);
    };

    let stoppedAtRedirect = false;
    builder.onRedirectReceived((info, newLocationUrl) => {
      if (responseResolved) return;
      if (init?.redirect !== 'error' && init?.redirect !== 'manual') {
        redirected = true;
        request.followRedirect();
        return;
      }
      stoppedAtRedirect = true;
      release();
      cleanupAbortListener();
      if (init.redirect === 'manual') {
        resolveWith(info);
        streamController.close();
        if (inspectorId) {
          NetworkInspector._recordEnd(
            inspectorId,
            info.httpStatusCode,
            info.httpStatusText,
            info.allHeadersAsList,
            0
          );
        }
      } else {
        const err = new TypeError(
          `redirect mode is "error": redirected request to "${newLocationUrl}"`
        );
        if (inspectorId) {
          NetworkInspector._recordEnd(inspectorId, 0, '', [], 0, err.message);
        }
        responseResolved = true;
        rejectResponse(err);
      }
      try {
        request.cancel();
      } catch {}
    });

    builder.onResponseStarted((info) => {
      if (responseResolved || signal?.aborted) return;
      resolveWith(info);
    });

    builder.onReadCompleted((_info, byteBuffer, bytesRead) => {
      // A cancelled stream can still receive an in-flight native read.
      if (streamCancelled || stoppedAtRedirect || signal?.aborted) {
        acknowledgeReadIfNeeded();
        return;
      }
      const chunkView = new Uint8Array(byteBuffer, 0, bytesRead);
      const chunk = chunkView.slice();
      streamBytesReceived += bytesRead;
      pendingChunks.push(chunk);
      if (
        readBufferWindowSize > 0 &&
        pendingChunks.length > readBufferWindowSize
      ) {
        throw new Error('Native stream read window exceeded');
      }
      drainPendingChunks();
    });

    builder.onSucceeded((info) => {
      release();
      cleanupAbortListener();
      if (streamCancelled || stoppedAtRedirect || signal?.aborted) return;
      nativeSucceeded = true;
      nativeSuccessInfo = info;
      drainPendingChunks();
    });

    builder.onFailed((_info, error) => {
      if (signal?.aborted) return settleAborted();
      release();
      cleanupAbortListener();
      releasePendingChunks();
      if (streamCancelled) return;
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

    builder.onCanceled(() => {
      if (!stoppedAtRedirect) settleAborted();
    });

    const request = builder.build();
    readBufferWindowSize = request.getReadBufferWindowSize();
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
