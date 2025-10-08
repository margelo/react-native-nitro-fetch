package com.margelo.nitro.nitrofetch

import android.util.Log
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import org.chromium.net.CronetEngine
import org.chromium.net.CronetException
import org.chromium.net.UrlRequest
import org.chromium.net.UrlResponseInfo
import java.nio.ByteBuffer
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

fun ByteBuffer.toByteArray(): ByteArray {
  val dup = this.duplicate()
  // Don't call clear()! We want to preserve the position and limit
  // that were set by flip() to get only the actual data read
  val arr = ByteArray(dup.remaining())
  dup.get(arr)
  return arr
}

@DoNotStrip
class NitroFetchClient(private val engine: CronetEngine, private val executor: Executor) : HybridNitroFetchClientSpec() {

  companion object {
    private const val TAG = "NitroFetchClient"
    private const val BUFFER_SIZE = 64 * 1024

    @JvmStatic
    fun fetch(
      req: NitroRequest,
      onSuccess: (NitroResponse) -> Unit,
      onFail: (Throwable) -> Unit
    ) {
      try {
        val engine = NitroFetch.getEngine()
        val executor = NitroFetch.ioExecutor
        startCronet(engine, executor, req, onSuccess, onFail)
      } catch (t: Throwable) {
        onFail(t)
      }
    }

    private fun startCronet(
      engine: CronetEngine,
      executor: Executor,
      req: NitroRequest,
      onSuccess: (NitroResponse) -> Unit,
      onFail: (Throwable) -> Unit
    ) {
      val url = req.url

      // Streaming state
      var streamCallbacks: StreamCallbacks? = null
      val streamingStarted = AtomicBoolean(false)
      val cancelled = AtomicBoolean(false)
      var urlRequest: UrlRequest? = null

      val callback = object : UrlRequest.Callback() {
        private val buffer = ByteBuffer.allocateDirect(BUFFER_SIZE)
        private var responseInfo: UrlResponseInfo? = null

        override fun onRedirectReceived(
          request: UrlRequest,
          info: UrlResponseInfo,
          newLocationUrl: String
        ) {
          if (req.followRedirects == false) {
            request.cancel()
          } else {
            request.followRedirect()
          }
        }

        override fun onResponseStarted(request: UrlRequest, info: UrlResponseInfo) {
          responseInfo = info

          // Convert headers
          val headers = info.allHeadersAsList.map { entry ->
            NitroHeader(entry.key, entry.value)
          }.toTypedArray()

          // Create the response object immediately with streaming capabilities
          val response = NitroResponse(
            url = info.url,
            status = info.httpStatusCode.toDouble(),
            statusText = info.httpStatusText ?: "",
            ok = info.httpStatusCode in 200..299,
            redirected = info.urlChain.size > 1,
            headers = headers,
            stream = { callbacks ->
              if (streamingStarted.getAndSet(true)) {
                callbacks.onError("Stream already started")
                return@NitroResponse
              }

              streamCallbacks = callbacks

              // Start reading if not cancelled
              if (!cancelled.get()) {
                buffer.clear()
                request.read(buffer)
              }
            },
            cancel = {
              if (cancelled.compareAndSet(false, true)) {
                request.cancel()
                streamCallbacks?.onError("Request cancelled")
              }
            }
          )

          // Return response immediately (before body is read)
          // NOTE: We don't start reading here - we wait for JS to call stream()
          onSuccess(response)
        }

        override fun onReadCompleted(
          request: UrlRequest,
          info: UrlResponseInfo,
          byteBuffer: ByteBuffer
        ) {
          if (cancelled.get()) {
            return
          }

          val callbacks = streamCallbacks
          if (callbacks == null) {
            // This can happen if Cronet tries to read before JS has called stream()
            // We shouldn't have started reading yet, but handle it gracefully
            Log.e(TAG, "onReadCompleted called but stream() hasn't been called yet - this shouldn't happen!")
            request.cancel()
            return
          }

          try {
            // Flip to set limit to current position and position to 0
            byteBuffer.flip()

            if (byteBuffer.hasRemaining()) {
              // Copy data efficiently: allocate new buffer of exact size and use bulk put
              val size = byteBuffer.remaining()
              val copy = ByteBuffer.allocateDirect(size)
              copy.put(byteBuffer)
              copy.flip()

              // Wrap in ArrayBuffer
              val arrayBuffer = ArrayBuffer(copy)
              callbacks.onData(arrayBuffer)
            }

            // Reuse the same buffer for next read
            byteBuffer.clear()
            request.read(byteBuffer)
          } catch (t: Throwable) {
            Log.e(TAG, "Error processing chunk", t)
            callbacks.onError(t.message ?: "Unknown error")
          }
        }

        override fun onSucceeded(request: UrlRequest, info: UrlResponseInfo) {
          val callbacks = streamCallbacks
          if (callbacks != null) {
            // Streaming mode - notify completion
            callbacks.onComplete()
          } else {
            // No streaming was initiated - this shouldn't normally happen
            // since we call stream() in the JS side, but handle it gracefully
            Log.w(TAG, "Request completed without streaming being started")
          }
        }

        override fun onFailed(
          request: UrlRequest,
          info: UrlResponseInfo?,
          error: CronetException
        ) {
          Log.e(TAG, "Request failed: ${error.message}", error)

          val callbacks = streamCallbacks
          if (callbacks != null) {
            callbacks.onError(error.message ?: "Request failed")
          } else {
            onFail(error)
          }
        }

        override fun onCanceled(request: UrlRequest, info: UrlResponseInfo?) {
          Log.d(TAG, "Request canceled")

          val callbacks = streamCallbacks
          if (callbacks != null) {
            callbacks.onError("Request canceled")
          } else {
            onFail(Exception("Request canceled"))
          }
        }
      }

      val builder = engine.newUrlRequestBuilder(url, callback, executor)
      val method = req.method?.name ?: "GET"
      builder.setHttpMethod(method)

      // Add headers
      req.headers?.forEach { header ->
        builder.addHeader(header.key, header.value)
      }

      urlRequest = builder.build()
      urlRequest?.start()
    }
  }

  override fun request(req: NitroRequest): Promise<NitroResponse> {
    val promise = Promise<NitroResponse>()
    fetch(
      req,
      onSuccess = { promise.resolve(it) },
      onFail = { promise.reject(it) }
    )
    return promise
  }

  override fun prefetch(req: NitroRequest): Promise<Unit> {
    val promise = Promise<Unit>()
    // Prefetch: just make the request and discard the body
    fetch(
      req,
      onSuccess = { response ->
        // Start streaming but don't process chunks
        response.stream(StreamCallbacks(
          onData = { chunk ->
            // Discard chunks for prefetch
          },
          onComplete = {
            promise.resolve(Unit)
          },
          onError = { error ->
            Log.e(TAG, "Prefetch error: $error")
            promise.reject(Exception(error))
          }
        ))
      },
      onFail = { error ->
        promise.reject(error)
      }
    )
    return promise
  }
}
