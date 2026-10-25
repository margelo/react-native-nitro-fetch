package com.margelo.nitro.nitrofetch

import android.net.Uri
import android.os.SystemClock
import android.os.Trace
import android.util.Log
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import com.margelo.nitro.nitrofetch.UrlResponseInfo as NitroUrlResponseInfo
import org.chromium.net.CronetEngine
import org.chromium.net.CronetException
import org.chromium.net.UrlRequest
import org.chromium.net.UrlResponseInfo
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

fun ByteBuffer.toByteArray(): ByteArray {
  // duplicate to avoid modifying the original buffer's position
  val dup = this.duplicate()
  dup.clear() // sets position=0, limit=capacity
  val arr = ByteArray(dup.remaining())
  dup.get(arr)
  return arr
}

private val charsetParam = Regex("charset=\"?([A-Za-z0-9_\\-:.]+)", RegexOption.IGNORE_CASE)
private val charsetsByContentType = ConcurrentHashMap<String, Charset>()

private fun charsetOf(contentType: String): Charset {
  charsetsByContentType[contentType]?.let { return it }
  val m = charsetParam.find(contentType)
  val charset = try {
    if (m != null) Charset.forName(m.groupValues[1]) else Charsets.UTF_8
  } catch (_: Throwable) {
    Charsets.UTF_8
  }
  if (charsetsByContentType.size < 64) charsetsByContentType[contentType] = charset
  return charset
}

private fun decodeText(bytes: ByteArray, length: Int, charset: Charset): String? {
  if (charset != Charsets.UTF_8) {
    return charset.newDecoder()
      .onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT)
      .decode(ByteBuffer.wrap(bytes, 0, length))
      .toString()
  }
  val ascii = asciiPrefixLength(bytes, 0, length)
  if (ascii == length) return String(bytes, 0, length, Charsets.ISO_8859_1)
  return if (isWellFormedUtf8(bytes, ascii, length)) String(bytes, 0, length, Charsets.UTF_8) else null
}

private fun asciiPrefixLength(bytes: ByteArray, from: Int, length: Int): Int {
  var i = from
  val end = length - 8
  while (i <= end) {
    if ((bytes[i].toInt() or bytes[i + 1].toInt() or bytes[i + 2].toInt() or bytes[i + 3].toInt() or
        bytes[i + 4].toInt() or bytes[i + 5].toInt() or bytes[i + 6].toInt() or bytes[i + 7].toInt()) < 0
    ) break
    i += 8
  }
  while (i < length && bytes[i] >= 0) i++
  return i
}

private fun isWellFormedUtf8(bytes: ByteArray, from: Int, length: Int): Boolean {
  var i = from
  while (i < length) {
    val b0 = bytes[i].toInt() and 0xFF
    if (b0 < 0x80) {
      i++
      if (i < length && bytes[i] >= 0) i = asciiPrefixLength(bytes, i + 1, length)
      continue
    }
    if (b0 < 0xE0) {
      if (b0 < 0xC2 || i + 1 >= length || (bytes[i + 1].toInt() and 0xC0) != 0x80) return false
      i += 2
      continue
    }
    if (b0 < 0xF0) {
      if (i + 2 >= length) return false
      val b1 = bytes[i + 1].toInt() and 0xFF
      if ((bytes[i + 2].toInt() and 0xC0) != 0x80) return false
      if (b0 == 0xE0) {
        if (b1 < 0xA0 || b1 > 0xBF) return false
      } else if (b0 == 0xED) {
        if (b1 < 0x80 || b1 > 0x9F) return false
      } else if ((b1 and 0xC0) != 0x80) {
        return false
      }
      i += 3
      continue
    }
    if (b0 > 0xF4 || i + 3 >= length) return false
    val b1 = bytes[i + 1].toInt() and 0xFF
    if (b0 == 0xF0) {
      if (b1 < 0x90 || b1 > 0xBF) return false
    } else if (b0 == 0xF4) {
      if (b1 < 0x80 || b1 > 0x8F) return false
    } else if ((b1 and 0xC0) != 0x80) {
      return false
    }
    if ((bytes[i + 2].toInt() and 0xC0) != 0x80 || (bytes[i + 3].toInt() and 0xC0) != 0x80) return false
    i += 4
  }
  return true
}

// Wrap raw bytes into a Nitro ArrayBuffer for zero-base64 bridging to JS.
private fun ByteArray.toArrayBuffer(length: Int = size): ArrayBuffer {
  val ab = ArrayBuffer.allocate(length)
  ab.getBuffer(false).put(this, 0, length)
  return ab
}

private class ResponseBody(capacity: Int) {
  var bytes = ByteArray(capacity)
    private set
  var size = 0
    private set

  fun append(src: ByteBuffer) {
    val n = src.remaining()
    val needed = size.toLong() + n
    if (needed > bytes.size) {
      if (needed > MAX_ARRAY_SIZE) throw OutOfMemoryError("Response body too large")
      bytes = bytes.copyOf(maxOf(needed, minOf(bytes.size * 2L, MAX_ARRAY_SIZE.toLong())).toInt())
    }
    src.get(bytes, size, n)
    size += n
  }

  companion object {
    private const val MAX_PRESIZE = 1024 * 1024
    private const val MAX_ARRAY_SIZE = Int.MAX_VALUE - 8

    fun forResponse(info: UrlResponseInfo, isHead: Boolean): ResponseBody {
      val status = info.httpStatusCode
      if (isHead || status == 204 || status == 205 || status == 304) return ResponseBody(0)
      for (header in info.allHeadersAsList) {
        if (header.key.equals("Content-Length", ignoreCase = true)) {
          val declared = header.value.trim().toLongOrNull()
          if (declared != null && declared >= 0) return ResponseBody(minOf(declared, MAX_PRESIZE.toLong()).toInt())
          break
        }
      }
      return ResponseBody(0)
    }
  }
}

private fun headerValue(info: UrlResponseInfo, name: String): String? =
  info.allHeadersAsList.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value

// The declared body length, or -1. Cronet decodes gzip and Brotli bodies, so
// the length is only exact for identity-encoded ones.
private fun contentLength(info: UrlResponseInfo): Long =
  headerValue(info, "Content-Length")?.trim()?.toLongOrNull()?.takeIf { it >= 0 } ?: -1L

private fun isIdentityEncoded(info: UrlResponseInfo): Boolean =
  headerValue(info, "Content-Encoding")?.trim()?.equals("identity", ignoreCase = true) ?: true

private val streamingContentTypes =
  setOf("text/event-stream", "application/x-ndjson", "application/jsonl", "multipart/x-mixed-replace")

private fun mimeType(info: UrlResponseInfo): String? =
  headerValue(info, "Content-Type")?.substringBefore(';')?.trim()?.lowercase()

// The Content-Type is a format whose body arrives over time: server-sent
// events, newline-delimited JSON, or a multipart stream.
private fun startsStreaming(info: UrlResponseInfo): Boolean =
  mimeType(info) in streamingContentTypes

/**
 * A body returned as bytes, in a direct buffer that becomes the ArrayBuffer. With an exact
 * Content-Length, Cronet can read straight into it, so the body is never copied.
 */
private class ResponseBytes(capacity: Int, private val declared: Long) {
  private var buffer: ByteBuffer = ByteBuffer.allocateDirect(capacity)
  val size: Int get() = buffer.position()

  // Where the next read goes: this buffer while it has room, otherwise [scratch].
  fun readTarget(scratch: ByteBuffer): ByteBuffer = if (buffer.hasRemaining()) buffer else scratch

  fun isReadTarget(target: ByteBuffer): Boolean = target === buffer

  // Grows by doubling, but not past an exact declared length.
  fun append(src: ByteBuffer) {
    val n = src.remaining()
    val needed = buffer.position().toLong() + n
    if (needed > buffer.capacity()) {
      if (needed > MAX_ARRAY_SIZE) throw OutOfMemoryError("Response body too large")
      var capacity = maxOf(needed, minOf(buffer.capacity() * 2L, MAX_ARRAY_SIZE.toLong()))
      if (declared >= needed) capacity = minOf(capacity, declared)
      val grown = ByteBuffer.allocateDirect(capacity.toInt())
      buffer.flip()
      grown.put(buffer)
      buffer = grown
    }
    buffer.put(src)
  }

  // A buffer much larger than its bytes is trimmed, so the ArrayBuffer does not
  // keep the spare capacity alive.
  fun toArrayBuffer(): ArrayBuffer? {
    val size = buffer.position()
    if (size == 0) return null
    buffer.flip()
    if (buffer.capacity() - size > size / 2) {
      val trimmed = ByteBuffer.allocateDirect(size)
      trimmed.put(buffer)
      return ArrayBuffer.wrap(trimmed)
    }
    return ArrayBuffer.wrap(buffer.slice())
  }

  companion object {
    private const val MAX_PRESIZE = 32 * 1024 * 1024
    private const val MAX_ARRAY_SIZE = Int.MAX_VALUE - 8

    fun forResponse(info: UrlResponseInfo, isHead: Boolean): ResponseBytes {
      val status = info.httpStatusCode
      if (isHead || status == 204 || status == 205 || status == 304) return ResponseBytes(0, 0)
      val declared = if (isIdentityEncoded(info)) contentLength(info) else -1L
      if (declared in 0..MAX_PRESIZE) return ResponseBytes(declared.toInt(), declared)
      return ResponseBytes(64 * 1024, declared)
    }
  }
}

/**
 * Idle timeout for one Cronet request. It matches URLRequest.timeoutInterval on iOS: the
 * request fails after [timeoutMs] without a callback from Cronet, and the timer restarts
 * whenever data arrives. Cronet has no per-request timeout, so this cancels the request
 * and reports the cancel as a failure.
 */
private class IdleTimeoutCallback(
  private val inner: UrlRequest.Callback,
  private val timeoutMs: Long
) : UrlRequest.Callback() {
  @Volatile private var timedOut = false
  @Volatile private var task: java.util.concurrent.ScheduledFuture<*>? = null

  fun arm(request: UrlRequest) {
    task?.cancel(false)
    task = scheduler.schedule({
      timedOut = true
      request.cancel()
    }, timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
  }

  override fun onRedirectReceived(request: UrlRequest, info: UrlResponseInfo, newLocationUrl: String) {
    arm(request)
    inner.onRedirectReceived(request, info, newLocationUrl)
  }

  override fun onResponseStarted(request: UrlRequest, info: UrlResponseInfo) {
    arm(request)
    inner.onResponseStarted(request, info)
  }

  override fun onReadCompleted(request: UrlRequest, info: UrlResponseInfo, byteBuffer: ByteBuffer) {
    arm(request)
    inner.onReadCompleted(request, info, byteBuffer)
  }

  override fun onSucceeded(request: UrlRequest, info: UrlResponseInfo) {
    task?.cancel(false)
    inner.onSucceeded(request, info)
  }

  override fun onFailed(request: UrlRequest, info: UrlResponseInfo?, error: CronetException) {
    task?.cancel(false)
    inner.onFailed(request, info, error)
  }

  override fun onCanceled(request: UrlRequest, info: UrlResponseInfo?) {
    task?.cancel(false)
    if (timedOut) {
      inner.onFailed(request, info, RequestTimedOutException())
    } else {
      inner.onCanceled(request, info)
    }
  }

  private class RequestTimedOutException : CronetException("The request timed out.", null)

  companion object {
    private val scheduler = java.util.concurrent.ScheduledThreadPoolExecutor(1) { r ->
      Thread(r, "NitroFetch-timeout").apply { isDaemon = true }
    }.apply { removeOnCancelPolicy = true }
  }
}

@DoNotStrip
class HybridNitroFetchClient(private val engine: CronetEngine, private val executor: Executor) : HybridNitroFetchClientSpec() {
  
  private val activeRequests = ConcurrentHashMap<String, UrlRequest>()

  override fun cancelRequest(requestId: String) {
    // https://developer.android.com/develop/connectivity/cronet/reference/org/chromium/net/UrlRequest#cancel() 
    activeRequests.remove(requestId)?.cancel()
  }

  private fun findPrefetchKey(req: NitroRequest): String? {
    val h = req.headers ?: return null
    for (pair in h) {
      val k = pair.key
      val v = pair.value
      if (k.equals("prefetchKey", ignoreCase = true)) return v
    }
    return null
  }

  companion object {
    private val directExecutor = Executor(Runnable::run)
    private const val PROGRESS_INTERVAL_MS = 50L
    // A body that may still stream is buffered for this long, or up to this size.
    private const val BUFFER_WINDOW_MS = 400L
    private const val BUFFER_WINDOW_BYTES = 8L * 1024 * 1024
    // A watched text body streams past this size, so JS decodes it while it
    // downloads, as React Native does. Smaller ones arrive whole.
    private const val STREAM_TEXT_BYTES = 256L * 1024
    // A body declared larger than this streams from the start.
    private const val MAX_BUFFERED_LENGTH = 32L * 1024 * 1024
    // A streamed body goes to JS in chunks of up to this size, and reading
    // pauses while this many chunks wait for JS, as on the stream client.
    private const val STREAM_CHUNK_SIZE = 64 * 1024
    private const val MAX_PENDING_CHUNKS = 16
    // After a streamed read smaller than this, the next read waits a moment, so
    // a fast body comes in fewer, larger reads. Event streams read at once.
    private const val SMALL_READ = 32 * 1024
    private const val SMALL_READ_DELAY_US = 1000L
    private val streamScheduler = java.util.concurrent.ScheduledThreadPoolExecutor(1) { r ->
      Thread(r, "NitroFetch-stream").apply { isDaemon = true }
    }.apply { removeOnCancelPolicy = true }
    private val requestBodyHeaders = arrayOf("Content-Type", "Content-Encoding", "Content-Language", "Content-Location")

    @JvmStatic
    @JvmOverloads
    fun fetch(
      req: NitroRequest,
      onSuccess: (NitroResponse) -> Unit,
      onFail: (Throwable) -> Unit,
      onRestarted: ((UrlRequest, UrlRequest) -> Unit)? = null,
      options: NitroRequestOptions? = null,
      onResponseStarted: ((NitroUrlResponseInfo) -> Unit)? = null,
      onData: ((ArrayBuffer) -> Promise<Boolean>)? = null,
      onProgress: ((Double, Double) -> Unit)? = null
    ): UrlRequest? {
      return try {
        // Local resources (file://, content://, scheme-less paths) aren't HTTP; read off disk -> 200.
        if (!isHttpURL(req.url)) {
          onSuccess(makeLocalFileResponse(req))
          return null
        }
        if (hostHasWhitespace(req.url)) throw invalidUrlException(req.url)
        val separate = options?.separateConnections == true
        val engine = if (separate) HybridNitroCronet.getOrCreateCronetEngine() else HybridNitroFetch.getEngine()
        val executor = if (separate) HybridNitroCronet.ioExecutor else HybridNitroFetch.ioExecutor
        val formParts = req.bodyFormData
        val multipart = if (formParts != null && formParts.isNotEmpty()) buildMultipartBody(formParts) else null
        startCronet(
          engine, executor, req, multipart?.first ?: uploadBytes(req), multipart?.second,
          onSuccess, onFail, onRestarted, options, onResponseStarted, onData, onProgress
        )
      } catch (t: Throwable) {
        onFail(t)
        null
      }
    }

    private fun originOf(url: String): String? = try {
      val u = java.net.URL(url)
      "${u.protocol}://${u.host.lowercase()}:${if (u.port != -1) u.port else u.defaultPort}"
    } catch (_: Throwable) {
      null
    }

    private fun hasAuthorization(req: NitroRequest): Boolean =
      req.headers?.any { it.key.equals("Authorization", ignoreCase = true) } == true

    private fun crossOriginRedirectWithoutAuthorization(req: NitroRequest, method: String, status: Int, location: String): NitroRequest {
      val dropBody = ((status == 301 || status == 302) && method == "POST") ||
        (status == 303 && method != "GET" && method != "HEAD")
      val headers = req.headers?.filterNot { header ->
        header.key.equals("Authorization", ignoreCase = true) ||
          (dropBody && requestBodyHeaders.any { header.key.equals(it, ignoreCase = true) })
      }?.toTypedArray()
      return if (dropBody) {
        req.copy(url = location, method = NitroRequestMethod.GET, headers = headers, bodyString = null, bodyBytes = null, bodyBytesBase64 = null, bodyFormData = null)
      } else {
        req.copy(url = location, headers = headers)
      }
    }

    private fun startCronet(
      engine: CronetEngine,
      executor: Executor,
      req: NitroRequest,
      uploadBody: ByteArray?,
      uploadContentType: String?,
      onSuccess: (NitroResponse) -> Unit,
      onFail: (Throwable) -> Unit,
      onRestarted: ((UrlRequest, UrlRequest) -> Unit)?,
      options: NitroRequestOptions?,
      onResponseStarted: ((NitroUrlResponseInfo) -> Unit)?,
      onData: ((ArrayBuffer) -> Promise<Boolean>)?,
      onProgress: ((Double, Double) -> Unit)?
    ): UrlRequest {
      val url = req.url
      val shouldFollowRedirects = req.followRedirects ?: true
      val omitCredentials = req.credentials == NitroRequestCredentials.OMIT
      val isHead = req.method == NitroRequestMethod.HEAD
      val traceLabel = if (BuildConfig.NITRO_FETCH_TRACING) {
        "NitroFetch ${req.method?.name ?: "GET"} ${Uri.parse(url).path ?: url}"
      } else ""
      val traceCookie = if (BuildConfig.NITRO_FETCH_TRACING) url.hashCode() else 0
      if (BuildConfig.NITRO_FETCH_TRACING) {
        Trace.beginAsyncSection(traceLabel, traceCookie)
      }
      // BuildConfig.DEBUG short-circuits in release: R8 constant-folds the
      // && so every `if (devToolsEnabled)` block below becomes dead code and
      // the DevToolsReporter classes drop out of the release APK entirely.
      // The UUID generation is gated too so SecureRandom isn't touched in release.
      // Opt out via `NitroFetch_disableDevToolsReporting=true` in gradle.properties
      //  Avoids double-logging with expo-dev-client
      val devToolsEnabled = BuildConfig.DEBUG &&
        !BuildConfig.NITRO_FETCH_DISABLE_DEVTOOLS_REPORTING &&
        DevToolsReporter.isDebuggingEnabled()
      val devToolsRequestId = if (devToolsEnabled) (req.requestId ?: UUID.randomUUID().toString()) else ""
      // A body that may stream is read on the executor, as the stream client
      // reads it. On Cronet's network thread every small read reaches JS alone.
      val inline = !devToolsEnabled && onData == null
      val callbackExecutor = if (inline) directExecutor else executor
      fun complete(block: () -> Unit) {
        if (inline) executor.execute(block) else block()
      }
      val callback = object : UrlRequest.Callback() {
        private val buffer = ByteBuffer.allocateDirect(64 * 1024)
        private var body = ResponseBody(0)
        // Set for responseBytes: the body is returned as received.
        private var bytesBody: ResponseBytes? = null
        // A streamed body goes to onData as it arrives. One that may stream is
        // buffered first, until the window timer or the size threshold ends it.
        // The timer runs on another thread, so these fields and the body are
        // guarded by [lock] from the response on.
        private val lock = Any()
        private var streaming = false
        private var pacesReads = false
        private var mayStream = false
        private var streamAfterBytes = BUFFER_WINDOW_BYTES
        private var finished = false
        private var bufferWindow: java.util.concurrent.ScheduledFuture<*>? = null
        // A streamed body is joined into chunks: one goes to JS once JS has
        // returned from the last, when it is full, or at the end. [filling]
        // is the chunk being joined. A chunk's memory is reused once JS has
        // returned from it, so a body does not allocate one buffer per chunk
        // for the garbage collector to free later. [chunkPool] holds the
        // buffers not in use: at most as many as JS has had at once, which
        // MAX_PENDING_CHUNKS bounds.
        private var filling: ByteBuffer? = null
        private val chunkPool = ArrayList<ByteBuffer>()
        private var pendingChunks = 0
        private var refused = false
        private var pausedRequest: UrlRequest? = null
        private var received = 0L
        private var total = -1L
        private var reportedProgress = -1L
        private var lastProgressAt = 0L
        private val stopped = AtomicBoolean(false)
        private var restarting = false
        /** True if a redirect response applied at least one `Set-Cookie` (in memory, not yet flushed). */
        private var setCookieAppliedOnRedirect = false
        private var devToolsBytes = 0
        private var devToolsTextual = false

        override fun onRedirectReceived(request: UrlRequest, info: UrlResponseInfo, newLocationUrl: String) = complete {
          if (shouldFollowRedirects) {
            // Apply Set-Cookie in-memory; flush once in onSucceeded (avoid flush per hop).
            if (!omitCredentials &&
              NitroCookieSync.storeSetCookieFromUrlResponseInfo(info.url, info, flush = false)
            ) {
              setCookieAppliedOnRedirect = true
            }
            if (hasAuthorization(req) && originOf(info.url).let { it == null || it != originOf(newLocationUrl) }) {
              if (!stopped.compareAndSet(false, true)) return@complete
              restarting = true
              request.cancel()
              val method = options?.customMethod ?: req.method?.name ?: "GET"
              val next = crossOriginRedirectWithoutAuthorization(req, method, info.httpStatusCode, newLocationUrl)
              val keepBody = next.method == req.method
              // A redirect that drops the body becomes a GET, custom method included.
              val nextOptions = if (keepBody) options else options?.copy(customMethod = null)
              try {
                val restarted = startCronet(
                  engine,
                  executor,
                  if (devToolsEnabled) next.copy(requestId = devToolsRequestId) else next,
                  if (keepBody) uploadBody else null,
                  if (keepBody) uploadContentType else null,
                  { res -> onSuccess(res.copy(redirected = true)) },
                  onFail,
                  onRestarted,
                  nextOptions,
                  onResponseStarted,
                  onData,
                  onProgress
                )
                onRestarted?.invoke(request, restarted)
              } catch (t: Throwable) {
                onFail(t)
              }
              if (setCookieAppliedOnRedirect) NitroCookieSync.flushCookieManager()
              return@complete
            }
            request.followRedirect()
          } else {
            // Return the redirect response as-is without following
            if (!stopped.compareAndSet(false, true)) return@complete
            request.cancel()
            try {
              val headersArr = info.allHeadersAsList.map { NitroHeader(it.key, it.value) }.toTypedArray()
              val status = info.httpStatusCode
              val res = NitroResponse(
                url = info.url,
                status = status.toDouble(),
                statusText = info.httpStatusText ?: "",
                ok = false,
                redirected = false,
                headers = headersArr,
                bodyString = "",
                bodyBytes = null
              )
              onSuccess(res)
            } catch (t: Throwable) {
              onFail(t)
            }
          }
        }

        override fun onResponseStarted(request: UrlRequest, info: UrlResponseInfo) {
          if (devToolsEnabled) {
            val headersMap = LinkedHashMap<String, String>()
            info.allHeadersAsList.forEach { headersMap[it.key] = it.value }
            val contentType = headersMap["Content-Type"] ?: headersMap["content-type"]
            devToolsTextual = DevToolsReporter.isTextualContentType(contentType)
            DevToolsReporter.reportResponseStart(
              devToolsRequestId,
              info.url,
              info.httpStatusCode,
              headersMap,
              -1L
            )
          }
          onResponseStarted?.invoke(info.toNitro())
          val exact = isIdentityEncoded(info) && contentLength(info) >= 0
          total = if (exact) contentLength(info) else -1L
          val responseBytes = options?.responseBytes == true
          val next = synchronized(lock) {
            if (responseBytes) {
              bytesBody = ResponseBytes.forResponse(info, isHead)
            } else {
              body = ResponseBody.forResponse(info, isHead)
            }
            if (onData != null) {
              pacesReads = mimeType(info) != "text/event-stream"
              if (!responseBytes) streamAfterBytes = STREAM_TEXT_BYTES
              val streamsAtOnce = startsStreaming(info) ||
                (exact && total > MAX_BUFFERED_LENGTH) ||
                (exact && !responseBytes && total > STREAM_TEXT_BYTES)
              if (streamsAtOnce) {
                startStreaming()
              } else if (!exact || (onProgress != null && !responseBytes)) {
                // The server may be streaming: a body that outlives the window streams.
                mayStream = true
                bufferWindow = streamScheduler.schedule(
                  { synchronized(lock) { startStreaming() } },
                  BUFFER_WINDOW_MS,
                  java.util.concurrent.TimeUnit.MILLISECONDS
                )
              }
            }
            nextReadTarget()
          }
          buffer.clear()
          request.read(next)
        }

        // Cronet reads straight into a bytes body only when it cannot switch to
        // streaming midway.
        private fun nextReadTarget(): ByteBuffer {
          if (streaming || mayStream) return buffer
          return bytesBody?.readTarget(buffer) ?: buffer
        }

        // Hands what was buffered to onData, which then gets the rest as it arrives.
        private fun startStreaming() {
          if (streaming || finished) return
          streaming = true
          val buffered = bytesBody?.toArrayBuffer()
            ?: if (body.size > 0) body.bytes.toArrayBuffer(body.size) else null
          bytesBody = null
          body = ResponseBody(0)
          if (buffered != null) sendChunk(buffered)
        }

        // Under lock. [memory] is the pooled buffer behind [chunk], if any.
        private fun sendChunk(chunk: ArrayBuffer, memory: ByteBuffer? = null) {
          val send = onData
          if (send == null || refused) {
            memory?.let { chunkPool.add(it) }
            return
          }
          pendingChunks++
          // The promise resolves on the JS thread, which must not wait for
          // [lock]: a thread holding it may be waiting on the promise.
          send(chunk)
            .then { wanted -> executor.execute { chunkHandled(wanted, memory) } }
            .catch { executor.execute { chunkHandled(false, memory) } }
        }

        // Runs on the executor once JS has returned from a chunk.
        private fun chunkHandled(wanted: Boolean, memory: ByteBuffer?) {
          synchronized(lock) {
            pendingChunks--
            if (!wanted) refused = true
            memory?.let { chunkPool.add(it) }
            if (finished) return
            if (pendingChunks == 0) sendFilling()
            val request = pausedRequest ?: return
            if (pendingChunks >= MAX_PENDING_CHUNKS) return
            pausedRequest = null
            buffer.clear()
            request.read(buffer)
          }
        }

        // Under lock.
        private fun sendFilling() {
          val bytes = filling ?: return
          if (bytes.position() == 0) return
          filling = null
          bytes.flip()
          // JS reads the memory of the buffer without a copy, and only until it
          // returns from the chunk.
          sendChunk(ArrayBuffer.wrap(bytes.slice()), bytes)
        }

        // Under lock.
        private fun takeChunkBuffer(): ByteBuffer {
          val pooled = chunkPool.removeLastOrNull()
          if (pooled == null) return ByteBuffer.allocateDirect(STREAM_CHUNK_SIZE)
          pooled.clear()
          return pooled
        }

        // Under lock. Copies a streamed read into chunks, sending each one it fills.
        private fun appendStreamed(read: ByteBuffer) {
          while (read.hasRemaining()) {
            val bytes = filling ?: takeChunkBuffer().also { filling = it }
            val end = read.limit()
            read.limit(read.position() + minOf(read.remaining(), bytes.remaining()))
            bytes.put(read)
            read.limit(end)
            if (!bytes.hasRemaining()) sendFilling()
          }
          if (pendingChunks == 0) sendFilling()
        }

        private fun reportProgress(final: Boolean) {
          val callback = onProgress ?: return
          if (received == reportedProgress) return
          val now = SystemClock.elapsedRealtime()
          if (!final && now - lastProgressAt < PROGRESS_INTERVAL_MS) return
          lastProgressAt = now
          reportedProgress = received
          callback(received.toDouble(), total.toDouble())
        }

        override fun onReadCompleted(request: UrlRequest, info: UrlResponseInfo, byteBuffer: ByteBuffer) {
          var waits = false
          val next: ByteBuffer? = try {
            synchronized(lock) {
              val bytes = bytesBody
              val read: Int
              if (bytes != null && bytes.isReadTarget(byteBuffer)) {
                // Cronet wrote straight into the body.
                read = bytes.size - received.toInt()
              } else {
                byteBuffer.flip()
                read = byteBuffer.remaining()
                if (streaming) {
                  waits = pacesReads && read < SMALL_READ
                  appendStreamed(byteBuffer)
                } else if (bytes != null) {
                  bytes.append(byteBuffer)
                } else {
                  val start = body.size
                  body.append(byteBuffer)
                  if (devToolsEnabled && devToolsTextual) {
                    DevToolsReporter.storeResponseBodyIncremental(devToolsRequestId, String(body.bytes, start, read, Charsets.UTF_8))
                  }
                }
                byteBuffer.clear()
              }
              received += read
              if (devToolsEnabled) {
                devToolsBytes += read
                DevToolsReporter.reportDataReceived(devToolsRequestId, read)
              }
              if (mayStream && received > streamAfterBytes) startStreaming()
              if (!streaming) reportProgress(final = false)
              if (streaming && pendingChunks >= MAX_PENDING_CHUNKS) {
                // JS is behind: read again once it catches up.
                pausedRequest = request
                null
              } else {
                nextReadTarget()
              }
            }
          } catch (t: Throwable) {
            // Running out of memory here must fail the request, not take down
            // the process from Cronet's network thread.
            if (stopped.compareAndSet(false, true)) {
              request.cancel()
              complete { onFail(t) }
            }
            return
          }
          if (next == null) return
          if (waits) {
            streamScheduler.schedule({ request.read(next) }, SMALL_READ_DELAY_US, java.util.concurrent.TimeUnit.MICROSECONDS)
          } else {
            request.read(next)
          }
        }

        override fun onSucceeded(request: UrlRequest, info: UrlResponseInfo) = complete {
          if (BuildConfig.NITRO_FETCH_TRACING) {
            Trace.endAsyncSection(traceLabel, traceCookie)
          }
          if (devToolsEnabled) {
            DevToolsReporter.reportResponseEnd(devToolsRequestId, devToolsBytes.toLong())
          }
          synchronized(lock) {
            if (streaming) sendFilling()
            finished = true
            bufferWindow?.cancel(false)
            if (!streaming) reportProgress(final = true)
          }
          try {
            val storedOnFinal = !omitCredentials &&
              NitroCookieSync.storeSetCookieFromUrlResponseInfo(info.url, info, flush = false)
            if (storedOnFinal || setCookieAppliedOnRedirect) {
              NitroCookieSync.flushCookieManager()
            }
            val headersArr: Array<NitroHeader> =
              info.allHeadersAsList.map { NitroHeader(it.key, it.value) }.toTypedArray()
            val status = info.httpStatusCode
            val bytes = body.bytes
            val length = body.size
            val contentType = info.allHeaders["Content-Type"] ?: info.allHeaders["content-type"]
            val charset = charsetOf((contentType ?: "").toString())
            val bytesResult = bytesBody
            // Strict-decode the body as text. If it fails the response is binary,
            // so we bridge the raw bytes as an ArrayBuffer instead — no base64.
            // A request for responseBytes gets the bytes as received, and a
            // streamed body has already gone to onData.
            val bodyStr: String? = if (bytesResult != null) null else try {
              decodeText(bytes, length, charset)
            } catch (_: Throwable) { null }
            val bodyBytesAb: ArrayBuffer? = if (bytesResult != null)
              bytesResult.toArrayBuffer()
            else if (bodyStr == null && length > 0)
              bytes.toArrayBuffer(length)
            else null
            val res = NitroResponse(
              url = info.url,
              status = status.toDouble(),
              statusText = info.httpStatusText ?: "",
              ok = status in 200..299,
              redirected = info.url != url,
              headers = headersArr,
              bodyString = bodyStr,
              bodyBytes = bodyBytesAb
            )
            onSuccess(res)
          } catch (t: Throwable) {
            onFail(t)
          }
        }

        override fun onFailed(request: UrlRequest, info: UrlResponseInfo?, error: CronetException) = complete {
          if (BuildConfig.NITRO_FETCH_TRACING) {
            Trace.endAsyncSection(traceLabel, traceCookie)
          }
          if (devToolsEnabled && !restarting) {
            DevToolsReporter.reportRequestFailed(devToolsRequestId, false)
          }
          synchronized(lock) {
            finished = true
            bufferWindow?.cancel(false)
          }
          if (stopped.compareAndSet(false, true)) {
            onFail(if (error.isInvalidUrl) invalidUrlException(url) else RuntimeException("Cronet failed: ${error.message}", error))
          }
        }

        override fun onCanceled(request: UrlRequest, info: UrlResponseInfo?) = complete {
          if (BuildConfig.NITRO_FETCH_TRACING) {
            Trace.endAsyncSection(traceLabel, traceCookie)
          }
          if (devToolsEnabled && !restarting) {
            DevToolsReporter.reportRequestFailed(devToolsRequestId, true)
          }
          synchronized(lock) {
            finished = true
            bufferWindow?.cancel(false)
          }
          if (stopped.compareAndSet(false, true)) {
            onFail(RuntimeException("Cronet canceled"))
          }
        }
      }

      val timeoutCallback = req.timeoutMs?.toLong()?.takeIf { it > 0 }
        ?.let { IdleTimeoutCallback(callback, it) }
      val builder = engine.newUrlRequestBuilder(url, timeoutCallback ?: callback, callbackExecutor)
      if (inline) builder.allowDirectExecutor()
      val method = options?.customMethod ?: req.method?.name ?: "GET"
      builder.setHttpMethod(method)
      req.priority?.let { builder.setPriority(it.cronetPriority) }
      // prefetchKey is an internal cache key, never sent on the server
      req.headers?.forEach { (k, v) ->
        if (k.equals("prefetchKey", ignoreCase = true)) return@forEach
        builder.addHeader(k, v)
      }

      if (!omitCredentials) {
        NitroCookieSync.attachCookieFromManagerIfMissing(
          url,
          NitroCookieSync.hasCookieHeaderInNitroRequest(req.headers)
        ) { key, value -> builder.addHeader(key, value) }
      }

      if (uploadBody != null) {
        if (uploadContentType != null) builder.addHeader("Content-Type", uploadContentType)
        val provider = createUploadProvider(uploadBody)
        builder.setUploadDataProvider(provider, callbackExecutor)
      }

      val request = builder.build()
      if (devToolsEnabled) {
        val headersMap = DevToolsReporter.headersArrayToMap(req.headers)
        val body = req.bodyString ?: ""
        val encoded = body.toByteArray(Charsets.UTF_8).size.toLong()
        DevToolsReporter.reportRequestStart(
          devToolsRequestId,
          url,
          method,
          headersMap,
          body,
          encoded
        )
      }
      timeoutCallback?.arm(request)
      request.start()
      return request
    }

    // bodyBytesBase64 is the auto-prefetch path: replayed from JSON, never a Nitro ArrayBuffer.
    private fun uploadBytes(req: NitroRequest): ByteArray? {
      req.bodyBytes?.let { ab ->
        val buf = ab.getBuffer(false)
        return ByteArray(buf.remaining()).also { buf.get(it) }
      }
      req.bodyBytesBase64?.takeIf { it.isNotEmpty() }?.let {
        return runCatching { android.util.Base64.decode(it, android.util.Base64.DEFAULT) }.getOrNull()
      }
      return req.bodyString?.takeIf { it.isNotEmpty() }?.toByteArray(Charsets.UTF_8)
    }

    private fun createUploadProvider(body: ByteArray): org.chromium.net.UploadDataProvider {
      return object : org.chromium.net.UploadDataProvider() {
        private var pos = 0
        override fun getLength(): Long = body.size.toLong()
        override fun read(uploadDataSink: org.chromium.net.UploadDataSink, byteBuffer: ByteBuffer) {
          val remaining = body.size - pos
          val toWrite = minOf(byteBuffer.remaining(), remaining)
          byteBuffer.put(body, pos, toWrite)
          pos += toWrite
          uploadDataSink.onReadSucceeded(false)
        }
        override fun rewind(uploadDataSink: org.chromium.net.UploadDataSink) {
          pos = 0
          uploadDataSink.onRewindSucceeded()
        }
      }
    }

    private fun buildMultipartBody(parts: Array<NitroFormDataPart>): Pair<ByteArray, String> {
      val boundary = "NitroFetch-${UUID.randomUUID()}"
      val out = ByteArrayOutputStream()
      val crlf = "\r\n".toByteArray()

      for (part in parts) {
        out.write("--$boundary\r\n".toByteArray())

        val fileUri = part.fileUri
        if (fileUri != null) {
          val fileName = part.fileName ?: "file"
          val mimeType = part.mimeType ?: "application/octet-stream"
          out.write("Content-Disposition: form-data; name=\"${part.name}\"; filename=\"$fileName\"\r\n".toByteArray())
          out.write("Content-Type: $mimeType\r\n\r\n".toByteArray())

          val fileData = readFileBytes(fileUri)
          out.write(fileData)
        } else {
          val value = part.value ?: ""
          out.write("Content-Disposition: form-data; name=\"${part.name}\"\r\n\r\n".toByteArray())
          out.write(value.toByteArray(Charsets.UTF_8))
        }

        out.write(crlf)
      }

      out.write("--$boundary--\r\n".toByteArray())
      return Pair(out.toByteArray(), "multipart/form-data; boundary=$boundary")
    }

    private fun readFileBytes(uri: String): ByteArray {
      if (uri.startsWith("http://") || uri.startsWith("https://")) {
        val connection = java.net.URL(uri).openConnection()
        // The engine is always built before a request reaches here, so the pins are already loaded.
        CertificatePinning.apply(connection, NitroModules.applicationContext)
        return connection.getInputStream().use { it.readBytes() }
      }
      if (uri.startsWith("content://")) {
        val context = NitroModules.applicationContext
          ?: throw IllegalStateException("Cannot read content:// URI - no Android Context")
        val inputStream = context.contentResolver.openInputStream(Uri.parse(uri))
          ?: throw IllegalArgumentException("Cannot open content URI: $uri")
        return inputStream.use { it.readBytes() }
      }
      return File(localPath(uri)).readBytes()
    }

    // file:// paths are percent-encoded; bare paths are already literal.
    private fun localPath(uri: String): String =
      if (uri.startsWith("file://")) Uri.parse(uri).path ?: uri.removePrefix("file://") else uri

    private fun isHttpURL(url: String): Boolean =
      url.startsWith("http://") || url.startsWith("https://")

    private fun guessMime(uri: String): String {
      if (uri.startsWith("content://")) {
        NitroModules.applicationContext?.contentResolver?.getType(Uri.parse(uri))?.let { return it }
      }
      val path = localPath(uri)
      val ext = path.substringAfterLast('.', "").lowercase()
      if (ext.isNotEmpty()) {
        android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)?.let { return it }
      }
      return java.net.URLConnection.guessContentTypeFromName(path) ?: "application/octet-stream"
    }

    // Read a local file -> synthetic 200, mirroring the HTTP path's strict text/bytes choice.
    private fun makeLocalFileResponse(req: NitroRequest): NitroResponse {
      val bytes = readFileBytes(req.url)
      val mime = guessMime(req.url)
      val bodyStr: String? = try {
        decodeText(bytes, bytes.size, Charsets.UTF_8)
      } catch (_: Throwable) { null }
      val bodyBytesAb: ArrayBuffer? = if (bodyStr == null && bytes.isNotEmpty())
        bytes.toArrayBuffer()
      else null
      return NitroResponse(
        url = req.url,
        status = 200.0,
        statusText = "OK",
        ok = true,
        redirected = false,
        headers = arrayOf(
          NitroHeader("Content-Type", mime),
          NitroHeader("Content-Length", bytes.size.toString())
        ),
        bodyString = bodyStr,
        bodyBytes = bodyBytesAb
      )
    }
  }

  // Helper function to add prefetch header to response (reused by both sync/async)
  private fun withPrefetchedHeader(res: NitroResponse): NitroResponse {
    val newHeaders = (res.headers?.toMutableList() ?: mutableListOf())
    newHeaders.add(NitroHeader("nitroPrefetched", "true"))
    return NitroResponse(
      url = res.url,
      status = res.status,
      statusText = res.statusText,
      ok = res.ok,
      redirected = res.redirected,
      headers = newHeaders.toTypedArray(),
      bodyString = res.bodyString,
      bodyBytes = res.bodyBytes
    )
  }

  override fun requestSync(req: NitroRequest): NitroResponse {
    val key = findPrefetchKey(req)
    if (key != null) {
      FetchCache.getPending(key)?.let { fut ->
        return try {
          withPrefetchedHeader(fut.get()) // blocks until complete
        } catch (e: Exception) {
          throw e.cause ?: e
        }
      }
      FetchCache.getResultIfFresh(key, req.prefetchCacheTtlMs?.toLong() ?: 5_000L)?.let { cached ->
        return withPrefetchedHeader(cached)
      }
    }
    val latch = java.util.concurrent.CountDownLatch(1)
    var result: NitroResponse? = null
    var error: Throwable? = null
    
    fetch(
      req,
      onSuccess = { 
        result = it
        latch.countDown()
      },
      onFail = { 
        error = it
        latch.countDown()
      }
    )
    latch.await()
    error?.let { throw it }
    return result!!
  }

  override fun request(req: NitroRequest): Promise<NitroResponse> =
    start(req, null, null, null, null)

  override fun requestWithEvents(
    req: NitroRequest,
    options: NitroRequestOptions,
    onResponseStarted: ((info: NitroUrlResponseInfo) -> Unit)?,
    onData: ((chunk: ArrayBuffer) -> Promise<Boolean>)?,
    onProgress: ((loaded: Double, total: Double) -> Unit)?
  ): Promise<NitroResponse> = start(req, options, onResponseStarted, onData, onProgress)

  private fun start(
    req: NitroRequest,
    options: NitroRequestOptions?,
    onResponseStarted: ((NitroUrlResponseInfo) -> Unit)?,
    onData: ((ArrayBuffer) -> Promise<Boolean>)?,
    onProgress: ((Double, Double) -> Unit)?
  ): Promise<NitroResponse> {
    val promise = Promise<NitroResponse>()
    // Try to serve from prefetch cache/pending first
    val key = findPrefetchKey(req)
    if (key != null) {
      // If a prefetch is currently pending, wait for it
      FetchCache.getPending(key)?.let { fut ->
        fut.whenComplete { res, err ->
          if (err != null) {
            promise.reject(err)
          } else if (res != null) {
            promise.resolve(withPrefetchedHeader(res))
          } else {
            promise.reject(IllegalStateException("Prefetch pending returned null result"))
          }
        }
        return promise
      }
      // If a fresh prefetched result exists, return it immediately
      FetchCache.getResultIfFresh(key, req.prefetchCacheTtlMs?.toLong() ?: 5_000L)?.let { cached ->
        promise.resolve(withPrefetchedHeader(cached))
        return promise
      }
    }
    val requestId = req.requestId
    val finished = AtomicBoolean(false)
    val stored = if (requestId != null) AtomicBoolean(false) else null
    val urlRequest = fetch(
      req,
      onSuccess = { res ->
        finished.set(true)
        if (requestId != null) activeRequests.remove(requestId)
        promise.resolve(res)
      },
      onFail = { err ->
        finished.set(true)
        if (requestId != null) activeRequests.remove(requestId)
        promise.reject(err)
      },
      onRestarted = if (requestId == null || stored == null) null else fun(old: UrlRequest, restarted: UrlRequest) {
        val current = activeRequests.compute(requestId) { _, cur ->
          if (!finished.get() && (cur === old || !stored.get())) restarted else cur
        }
        if (current !== restarted) restarted.cancel()
      },
      options = options,
      onResponseStarted = onResponseStarted,
      onData = onData,
      onProgress = onProgress
    )
    // Store after start() — if cancelRequest races and misses, the JS
    // catch block checks signal.aborted and throws AbortError anyway.
    if (requestId != null && urlRequest != null) {
      activeRequests.putIfAbsent(requestId, urlRequest)
      stored?.set(true)
      if (finished.get()) activeRequests.remove(requestId, urlRequest)
    }
    return promise
  }

  override fun prefetch(req: NitroRequest): Promise<Unit> {
    val promise = Promise<Unit>()
    val key = findPrefetchKey(req)
    if (key.isNullOrEmpty()) {
      promise.reject(IllegalArgumentException("prefetch: missing 'prefetchKey' header"))
      return promise
    }
    // If already have a fresh result, resolve immediately (NON-DESTRUCTIVE CHECK)
    if (FetchCache.hasFreshResult(key, req.prefetchCacheTtlMs?.toLong() ?: 5_000L)) {
      promise.resolve(Unit)
      return promise
    }
    // Atomic begin: if another prefetch won the race, resolve when it's done
    val future = java.util.concurrent.CompletableFuture<NitroResponse>()
    FetchCache.beginPending(key, future)?.let { fut ->
      fut.whenComplete { _, err -> if (err != null) promise.reject(err) else promise.resolve(Unit) }
      return promise
    }
    fetch(
      req,
      onSuccess = { res ->
        try {
          FetchCache.complete(key, res)
          promise.resolve(Unit)
        } catch (t: Throwable) {
          FetchCache.completeExceptionally(key, t)
          promise.reject(t)
        }
      },
      onFail = { err ->
        FetchCache.completeExceptionally(key, err)
        promise.reject(err)
      }
    )
    return promise
  }


}
