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
  NOT_STARTED,
  BUFFERING,
  STREAMING,
  COMPLETED,
  CANCELLED,
  ERROR
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
      val stateLock = Any() // Shared lock for all state transitions

      fun toArrayBuffer(bytes: ByteArray): ArrayBuffer {
        val directBuffer = ByteBuffer.allocateDirect(bytes.size)
        directBuffer.put(bytes)
        directBuffer.flip()
        return ArrayBuffer(directBuffer)
      }

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

          // Start reading immediately
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
            bodyUsed = sink.bodyUsed,
            stream = { callbacks ->
              synchronized(stateLock) {
                if (streamState.get() == StreamState.STREAMING) {
                  callbacks.onError("Stream already started")
                } else {
                  // ✅ Mark body as used when stream starts
                  sink.markAsUsed()
                  streamCallbacks = callbacks

                  // Transition to STREAMING state BEFORE finalizing sink
                  // This prevents race condition where onReadCompleted tries to append to finalized sink
                  val currentState = streamState.get()
                  if (currentState == StreamState.BUFFERING) {
                    streamState.set(StreamState.STREAMING)
                  }

                  // Flush buffered data
                  val bufferedData = sink.drainAndFinalize()
                  if (bufferedData != null && bufferedData.isNotEmpty()) {
                    Log.d(TAG, "Flushing ${bufferedData.size} bytes from sink")
                    callbacks.onData(toArrayBuffer(bufferedData))
                  }

                  // Check if already completed
                  when (currentState) {
                    StreamState.COMPLETED -> {
                      Log.d(TAG, "Stream started but already completed")
                      callbacks.onComplete()
                    }
                    StreamState.ERROR -> {
                      callbacks.onError("Request failed")
                    }
                    StreamState.CANCELLED -> {
                      callbacks.onError("Request cancelled")
                    }
                    else -> {
                      // State already set above
                    }
                  }
                }
              }
            },
            cancel = {
              if (cancelled.compareAndSet(false, true)) {
                streamState.set(StreamState.CANCELLED)
                sink.clear()
                request.cancel()
                streamCallbacks?.onError("Request cancelled")
              }
            }
          )

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

          synchronized(stateLock) {
            try {
              byteBuffer.flip()

              if (!byteBuffer.hasRemaining()) {
                byteBuffer.clear()
                request.read(byteBuffer)
                return
              }

              val data = ByteArray(byteBuffer.remaining())
              byteBuffer.get(data)

              when (streamState.get()) {
                StreamState.BUFFERING -> {
                  sink.appendBufferBody(data)
                  Log.v(TAG, "Buffered ${data.size} bytes (total: ${sink.getQueuedSize()})")
                }

                StreamState.STREAMING -> {
                  val callbacks = streamCallbacks
                  if (callbacks != null) {
                    callbacks.onData(toArrayBuffer(data))
                  } else {
                    Log.e(TAG, "Streaming state but no callbacks!")
                  }
                }

                StreamState.CANCELLED, StreamState.ERROR, StreamState.COMPLETED -> {
                  return
                }

                StreamState.NOT_STARTED -> {
                  Log.e(TAG, "Received data in NOT_STARTED state")
                }
              }

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
          synchronized(stateLock) {
            Log.d(TAG, "Request succeeded in state: ${streamState.get()}")

            when (streamState.get()) {
              StreamState.STREAMING -> {
                streamState.set(StreamState.COMPLETED)
                streamCallbacks?.onComplete()
              }
              StreamState.BUFFERING -> {
                Log.d(TAG, "Completed while buffering (${sink.getQueuedSize()} bytes queued)")
                streamState.set(StreamState.COMPLETED)
              }
              else -> {
                Log.w(TAG, "Request completed in unexpected state: ${streamState.get()}")
                streamState.set(StreamState.COMPLETED)
              }
            }
          }
        }

        override fun onFailed(
          request: UrlRequest,
          info: UrlResponseInfo?,
          error: CronetException
        ) {
          synchronized(stateLock) {
            Log.e(TAG, "Request failed: ${error.message}", error)
            streamState.set(StreamState.ERROR)
            sink.clear()

            val callbacks = streamCallbacks
            if (callbacks != null) {
              callbacks.onError(error.message ?: "Request failed")
            } else {
              onFail(error)
            }
          }
        }

        override fun onCanceled(request: UrlRequest, info: UrlResponseInfo?) {
          synchronized(stateLock) {
            Log.d(TAG, "Request canceled")
            streamState.set(StreamState.CANCELLED)
            sink.clear()

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

      req.headers?.forEach { header ->
        builder.addHeader(header.key, header.value)
      }

      builder.build().start()
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
