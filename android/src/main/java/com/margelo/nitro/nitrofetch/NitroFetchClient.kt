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
import java.util.concurrent.atomic.AtomicReference

// Response state management
private enum class StreamState {
  NOT_STARTED,    // Initial state
  BUFFERING,      // Response received, accumulating data in sink
  STREAMING,      // JS called stream(), actively sending chunks
  COMPLETED,      // All data received
  CANCELLED,      // Stream cancelled
  ERROR           // Error occurred
}

@DoNotStrip
class NitroFetchClient(private val engine: CronetEngine, private val executor: Executor) : HybridNitroFetchClientSpec() {

  companion object {
    private const val TAG = "NitroFetchClient"
    private const val BUFFER_SIZE = 16 * 1024

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

      val sink = ResponseSink()
      var streamCallbacks: StreamCallbacks? = null
      val streamState = AtomicReference(StreamState.NOT_STARTED)
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
          streamState.set(StreamState.BUFFERING)

          // Convert headers
          val headers = info.allHeadersAsList.map { entry ->
            NitroHeader(entry.key, entry.value)
          }.toTypedArray()

          // Start reading immediately BEFORE returning response
          // This ensures we're always in BUFFERING state for the first chunks
          if (!cancelled.get()) {
            buffer.clear()
            request.read(buffer)
          }

          // Create the response object with streaming capabilities
          val response = NitroResponse(
            url = info.url,
            status = info.httpStatusCode.toDouble(),
            statusText = info.httpStatusText ?: "",
            ok = info.httpStatusCode in 200..299,
            redirected = info.urlChain.size > 1,
            headers = headers,
            stream = { callbacks ->
              synchronized(this) {
                if (streamState.get() == StreamState.STREAMING) {
                  callbacks.onError("Stream already started")
                  return@NitroResponse
                }

                streamCallbacks = callbacks

                // Flush any buffered data from the sink
                val bufferedData = sink.finalize()
                if (bufferedData != null && bufferedData.isNotEmpty()) {
                  Log.d(TAG, "Flushing ${bufferedData.size} bytes from sink")
                  val directBuffer = ByteBuffer.allocateDirect(bufferedData.size)
                  directBuffer.put(bufferedData)
                  directBuffer.flip()
                  val arrayBuffer = ArrayBuffer(directBuffer)
                  callbacks.onData(arrayBuffer)
                }

                // Check if we already completed while buffering
                when (streamState.get()) {
                  StreamState.COMPLETED -> {
                    Log.d(TAG, "Stream started but already completed")
                    callbacks.onComplete()
                    return@NitroResponse
                  }
                  StreamState.ERROR -> {
                    callbacks.onError("Request failed")
                    return@NitroResponse
                  }
                  StreamState.CANCELLED -> {
                    callbacks.onError("Request cancelled")
                    return@NitroResponse
                  }
                  else -> {
                    // Transition to streaming mode
                    streamState.set(StreamState.STREAMING)
                    // Reads are already happening in the background
                  }
                }
              }
            },
            cancel = {
              if (cancelled.compareAndSet(false, true)) {
                streamState.set(StreamState.CANCELLED)
                request.cancel()
                streamCallbacks?.onError("Request cancelled")
              }
            }
          )

          // Return response to JS (now reads are already in progress)
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

          synchronized(this) {
            try {
              byteBuffer.flip()

              if (!byteBuffer.hasRemaining()) {
                // No data, continue reading
                byteBuffer.clear()
                request.read(byteBuffer)
                return
              }

              // Convert to byte array once
              val data = ByteArray(byteBuffer.remaining())
              byteBuffer.get(data)

              when (streamState.get()) {
                StreamState.BUFFERING -> {
                  // JS hasn't started streaming yet - buffer the data
                  sink.appendBufferBody(data)
                  Log.v(TAG, "Buffered ${data.size} bytes (total: ${sink.getQueuedSize()})")
                }

                StreamState.STREAMING -> {
                  // Streaming active - send directly to JS
                  val callbacks = streamCallbacks
                  if (callbacks != null) {
                    // Create a direct ByteBuffer for ArrayBuffer
                    val directBuffer = ByteBuffer.allocateDirect(data.size)
                    directBuffer.put(data)
                    directBuffer.flip()
                    val arrayBuffer = ArrayBuffer(directBuffer)
                    callbacks.onData(arrayBuffer)
                  } else {
                    Log.e(TAG, "Streaming state but no callbacks!")
                  }
                }

                StreamState.CANCELLED, StreamState.ERROR, StreamState.COMPLETED -> {
                  // Don't process more data
                  return
                }

                StreamState.NOT_STARTED -> {
                  Log.e(TAG, "Received data in NOT_STARTED state - shouldn't happen")
                }
              }

              // Continue reading
              byteBuffer.clear()
              request.read(byteBuffer)
            } catch (t: Throwable) {
              Log.e(TAG, "Error processing chunk", t)
              streamState.set(StreamState.ERROR)
              streamCallbacks?.onError(t.message ?: "Unknown error")
            }
          }
        }

        override fun onSucceeded(request: UrlRequest, info: UrlResponseInfo) {
          synchronized(this) {
            Log.d(TAG, "Request succeeded in state: ${streamState.get()}")

            when (streamState.get()) {
              StreamState.STREAMING -> {
                // Actively streaming - notify completion
                streamCallbacks?.onComplete()
              }
              StreamState.BUFFERING -> {
                // JS hasn't started streaming yet - mark as completed
                // When JS calls stream(), it will get the buffered data
                // and immediate completion
                Log.d(TAG, "Completed while buffering (${sink.getQueuedSize()} bytes queued)")
              }
              else -> {
                Log.w(TAG, "Request completed in unexpected state: ${streamState.get()}")
              }
            }

            streamState.set(StreamState.COMPLETED)
          }
        }

        override fun onFailed(
          request: UrlRequest,
          info: UrlResponseInfo?,
          error: CronetException
        ) {
          synchronized(this) {
            Log.e(TAG, "Request failed: ${error.message}", error)
            streamState.set(StreamState.ERROR)

            val callbacks = streamCallbacks
            if (callbacks != null) {
              callbacks.onError(error.message ?: "Request failed")
            } else {
              onFail(error)
            }
          }
        }

        override fun onCanceled(request: UrlRequest, info: UrlResponseInfo?) {
          synchronized(this) {
            Log.d(TAG, "Request canceled")
            streamState.set(StreamState.CANCELLED)

            val callbacks = streamCallbacks
            if (callbacks != null) {
              callbacks.onError("Request canceled")
            } else {
              onFail(Exception("Request canceled"))
            }
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
