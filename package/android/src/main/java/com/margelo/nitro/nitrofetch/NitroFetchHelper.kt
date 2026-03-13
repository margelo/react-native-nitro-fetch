package com.margelo.nitro.nitrofetch

import org.chromium.net.CronetEngine
import org.chromium.net.CronetException
import org.chromium.net.UrlRequest
import org.chromium.net.UrlResponseInfo
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.concurrent.CompletableFuture

/**
 * Helper class for simple, non-streaming fetch operations.
 * Used primarily for prefetch functionality where we need complete responses.
 */
object NitroFetchHelper {
  private const val BUFFER_SIZE = 32 * 1024 // 32KB

  /**
   * Perform a simple fetch that accumulates the entire response body.
   * This is suitable for prefetch operations where we need the complete response.
   */
  fun simpleFetch(
    url: String,
    method: String = "GET",
    headers: Map<String, String>? = null,
    body: ByteArray? = null,
    maxAgeMs: Long = 5_000L, // Default 5 seconds
    onSuccess: (CachedResponse) -> Unit,
    onFail: (Throwable) -> Unit
  ) {
    try {
      val engine = NitroCronet.getOrCreateCronetEngine()
      val executor = NitroCronet.ioExecutor

      val callback = SimpleFetchCallback(
        url = url,
        maxAgeMs = maxAgeMs,
        onSuccess = onSuccess,
        onFail = onFail
      )

      val builder = engine.newUrlRequestBuilder(url, callback, executor)
      builder.setHttpMethod(method)

      headers?.forEach { (key, value) ->
        builder.addHeader(key, value)
      }

      if (body != null && body.isNotEmpty()) {
        val provider = SimpleUploadDataProvider(body)
        builder.setUploadDataProvider(provider, executor)
      }

      val request = builder.build()
      request.start()
    } catch (e: Throwable) {
      onFail(e)
    }
  }

  /**
   * Perform a prefetch with a specific prefetch key.
   * Returns a future that completes when the prefetch is done.
   */
  fun prefetch(
    url: String,
    method: String = "GET",
    headers: Map<String, String>? = null,
    body: ByteArray? = null,
    prefetchKey: String,
    maxAgeMs: Long = 5_000L // Default 5 seconds
  ): CompletableFuture<CachedResponse> {
    val future = CompletableFuture<CachedResponse>()

    // Check if already have a fresh result
    FetchCache.getResultIfFresh(prefetchKey, maxAgeMs)?.let {
      future.complete(it)
      return future
    }

    // Check if already pending
    FetchCache.getPending(prefetchKey)?.let {
      return it
    }

    // Add prefetchKey to headers
    val allHeaders = (headers?.toMutableMap() ?: mutableMapOf()).apply {
      put("prefetchKey", prefetchKey)
    }

    // Start new prefetch
    FetchCache.setPending(prefetchKey, future)

    simpleFetch(
      url = url,
      method = method,
      headers = allHeaders,
      body = body,
      maxAgeMs = maxAgeMs,
      onSuccess = { response ->
        try {
          FetchCache.complete(prefetchKey, response)
          future.complete(response)
        } catch (t: Throwable) {
          FetchCache.completeExceptionally(prefetchKey, t)
          future.completeExceptionally(t)
        }
      },
      onFail = { error ->
        FetchCache.completeExceptionally(prefetchKey, error)
        future.completeExceptionally(error)
      }
    )

    return future
  }

  private class SimpleFetchCallback(
    private val url: String,
    private val maxAgeMs: Long,
    private val onSuccess: (CachedResponse) -> Unit,
    private val onFail: (Throwable) -> Unit
  ) : UrlRequest.Callback() {
    private val buffer = ByteBuffer.allocateDirect(BUFFER_SIZE)
    private val output = ByteArrayOutputStream()
    private var responseInfo: UrlResponseInfo? = null

    override fun onRedirectReceived(
      request: UrlRequest,
      info: UrlResponseInfo,
      newLocationUrl: String
    ) {
      request.followRedirect()
    }

    override fun onResponseStarted(request: UrlRequest, info: UrlResponseInfo) {
      responseInfo = info
      buffer.clear()
      request.read(buffer)
    }

    override fun onReadCompleted(
      request: UrlRequest,
      info: UrlResponseInfo,
      byteBuffer: ByteBuffer
    ) {
      byteBuffer.flip()
      val bytes = ByteArray(byteBuffer.remaining())
      byteBuffer.get(bytes)
      output.write(bytes)
      byteBuffer.clear()
      request.read(byteBuffer)
    }

    override fun onSucceeded(request: UrlRequest, info: UrlResponseInfo) {
      try {
        val headers = mutableMapOf<String, String>()
        info.allHeadersAsList.forEach { header ->
          headers[header.key] = header.value
        }

        val bodyBytes = output.toByteArray()

        val response = CachedResponse(
          url = info.url,
          statusCode = info.httpStatusCode,
          statusText = info.httpStatusText ?: "",
          headers = headers,
          body = bodyBytes,
          timestampMs = System.currentTimeMillis(),
          maxAgeMs = maxAgeMs
        )

        onSuccess(response)
      } catch (t: Throwable) {
        onFail(t)
      }
    }

    override fun onFailed(
      request: UrlRequest,
      info: UrlResponseInfo?,
      error: CronetException
    ) {
      onFail(RuntimeException("Cronet request failed: ${error.message}", error))
    }

    override fun onCanceled(request: UrlRequest, info: UrlResponseInfo?) {
      onFail(RuntimeException("Request canceled"))
    }
  }

  private class SimpleUploadDataProvider(
    private val body: ByteArray
  ) : org.chromium.net.UploadDataProvider() {
    private var position = 0

    override fun getLength(): Long = body.size.toLong()

    override fun read(
      uploadDataSink: org.chromium.net.UploadDataSink,
      byteBuffer: ByteBuffer
    ) {
      val remaining = body.size - position
      val toWrite = minOf(byteBuffer.remaining(), remaining)
      byteBuffer.put(body, position, toWrite)
      position += toWrite
      uploadDataSink.onReadSucceeded(false)
    }

    override fun rewind(uploadDataSink: org.chromium.net.UploadDataSink) {
      position = 0
      uploadDataSink.onRewindSucceeded()
    }
  }
}
