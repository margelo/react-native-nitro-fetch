package com.margelo.nitro.nitrofetch

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.ArrayBuffer
import org.chromium.net.CronetEngine
import org.chromium.net.UrlRequest as CronetUrlRequest
import org.chromium.net.UrlResponseInfo as CronetUrlResponseInfo
import org.chromium.net.CronetException as CronetNativeException
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.Executor as JavaExecutor

private const val BUFFER_SIZE = 65536
// Chunks JS can have queued before native stops reading.
private const val MAX_QUEUED_CHUNKS = 16
// Chunk buffers kept for reuse after JS has copied them.
private const val POOL_SIZE = 2

@DoNotStrip
class HybridUrlRequestBuilder(
  private val engine: CronetEngine,
  private val url: String,
  private val executor: JavaExecutor
) : HybridUrlRequestBuilderSpec() {

  // Callbacks stored as optionals and set via setter methods
  private var onRedirectReceivedCallback: ((info: UrlResponseInfo, newLocationUrl: String) -> Unit)? = null
  private var onResponseStartedCallback: ((info: UrlResponseInfo) -> Unit)? = null
  private var onReadCompletedCallback: ((info: UrlResponseInfo, byteBuffer: ArrayBuffer, bytesRead: Double) -> Unit)? = null
  private var onSucceededCallback: ((info: UrlResponseInfo) -> Unit)? = null
  private var onFailedCallback: ((info: UrlResponseInfo?, error: RequestException) -> Unit)? = null
  private var onCanceledCallback: ((info: UrlResponseInfo?) -> Unit)? = null

  private val builder: CronetUrlRequest.Builder
  // BuildConfig.DEBUG short-circuits in release so R8 strips DevTools paths.
  // UUID generation is gated too so SecureRandom isn't touched in release.
  // Opt out via `NitroFetch_disableDevToolsReporting=true` in gradle.properties
  //  Avoids double-logging with expo-dev-client
  private val devToolsEnabled: Boolean = BuildConfig.DEBUG &&
    !BuildConfig.NITRO_FETCH_DISABLE_DEVTOOLS_REPORTING &&
    DevToolsReporter.isDebuggingEnabled()
  private val devToolsRequestId: String = if (devToolsEnabled) UUID.randomUUID().toString() else ""
  private var devToolsBytes: Int = 0
  private var devToolsTextual: Boolean = false
  private var httpMethod: String = "GET"
  private val requestHeaders: LinkedHashMap<String, String> = LinkedHashMap()
  private var cookiesEnabled: Boolean = true
  private var uploadBodyString: String = ""
  private var uploadBodyLength: Long = 0L

  // Native reads the body without waiting for JS: each JS callback waits in
  // React Native's task queue, so a read per callback would add a wait per
  // chunk. Every Cronet read lands in readBuffer and is copied into a chunk.
  // A chunk goes to JS once JS has handled the earlier ones, once it is full,
  // or when the body ends, so reads add up into full chunks while JS is busy.
  // JS calls read() after each chunk, which hands the chunk back.
  // bodyLock guards this state: Cronet calls back on a thread pool and read()
  // comes from the JS thread. Chunks are sent under it, so JS gets them in order.
  private class Chunk {
    val arrayBuffer: ArrayBuffer = ArrayBuffer.allocate(BUFFER_SIZE)
    val bytes: ByteBuffer = arrayBuffer.getBuffer(false)
  }
  private val bodyLock = Any()
  private var readBuffer: ByteBuffer? = null
  private var filling: Chunk? = null
  private val queued = ArrayDeque<Chunk>()
  private val pool = ArrayList<Chunk>(POOL_SIZE)
  private var stoppedRequest: CronetUrlRequest? = null
  private var resumePosted = false
  private var settled = false
  private var bodyInfo: UrlResponseInfo? = null

  private fun takeChunk(): Chunk {
    val chunk = pool.removeLastOrNull() ?: Chunk()
    chunk.bytes.clear()
    return chunk
  }

  // Under bodyLock.
  private fun send(chunk: Chunk) {
    queued.addLast(chunk)
    onReadCompletedCallback?.invoke(bodyInfo!!, chunk.arrayBuffer, chunk.bytes.position().toDouble())
  }

  // Under bodyLock. Whether the filling chunk should go to JS now.
  private fun fillingIsDue(): Boolean {
    val bytes = filling?.bytes ?: return false
    if (bytes.position() == 0) return false
    return queued.isEmpty() || (!bytes.hasRemaining() && queued.size < MAX_QUEUED_CHUNKS)
  }

  // Under bodyLock.
  private fun sendFilling() {
    val chunk = filling ?: return
    if (chunk.bytes.position() == 0) return
    filling = null
    send(chunk)
  }

  // Under bodyLock. Starts the next read, or stops reading until JS hands a
  // chunk back. With every chunk slot taken, a read only gets the room left
  // in the filling chunk.
  private fun readNext(request: CronetUrlRequest) {
    val room = if (queued.size < MAX_QUEUED_CHUNKS) BUFFER_SIZE else filling?.bytes?.remaining() ?: BUFFER_SIZE
    if (room == 0) {
      stoppedRequest = request
      return
    }
    val buffer = readBuffer!!
    buffer.clear()
    buffer.limit(room)
    request.read(buffer)
  }

  // Under bodyLock. Copies a read into chunks, sending each chunk it fills.
  private fun append(read: ByteBuffer) {
    while (read.hasRemaining()) {
      val chunk = filling ?: takeChunk().also { filling = it }
      val bytes = chunk.bytes
      val end = read.limit()
      read.limit(read.position() + minOf(read.remaining(), bytes.remaining()))
      bytes.put(read)
      read.limit(end)
      // readNext sizes reads so that bytes never remain once every slot is taken.
      if (!bytes.hasRemaining() && (queued.size < MAX_QUEUED_CHUNKS || read.hasRemaining())) {
        filling = null
        send(chunk)
      }
    }
  }

  // Runs on the Cronet executor after JS hands a chunk back.
  private val resume = Runnable {
    synchronized(bodyLock) {
      resumePosted = false
      if (settled) return@Runnable
      if (fillingIsDue()) sendFilling()
      val request = stoppedRequest ?: return@Runnable
      stoppedRequest = null
      readNext(request)
    }
  }

  private fun onChunkHandled() {
    synchronized(bodyLock) {
      if (settled) return
      val chunk = queued.removeFirstOrNull() ?: return
      if (pool.size < POOL_SIZE) pool.add(chunk)
      if (!resumePosted && (stoppedRequest != null || fillingIsDue())) {
        resumePosted = true
        executor.execute(resume)
      }
    }
  }

  // Under bodyLock. Once the request settles nothing reads the buffers again;
  // JS has its own reference to every chunk it was sent.
  private fun settle() {
    settled = true
    readBuffer = null
    filling = null
    queued.clear()
    pool.clear()
    stoppedRequest = null
    bodyInfo = null
  }

  init {
    if (hostHasWhitespace(url)) throw invalidUrlException(url)

    val cronetCallback = object : CronetUrlRequest.Callback() {

      override fun onRedirectReceived(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo,
        newLocationUrl: String
      ) {
       if (cookiesEnabled) {
         NitroCookieSync.storeSetCookieFromUrlResponseInfo(info.url, info, flush = true)
       }
        onRedirectReceivedCallback?.let { callback ->
          val nitroInfo = info.toNitro()
          callback(nitroInfo, newLocationUrl)
        }
      }

      override fun onResponseStarted(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo
      ) {
        if (cookiesEnabled) {
          // Streams can remain open indefinitely; persist cookies when headers arrive.
          NitroCookieSync.storeSetCookieFromUrlResponseInfo(info.url, info, flush = true)
        }
        if (devToolsEnabled) {
          val headersMap = LinkedHashMap<String, String>()
          info.allHeadersAsList.forEach { headersMap[it.key] = it.value }
          val ct = headersMap["Content-Type"] ?: headersMap["content-type"]
          devToolsTextual = DevToolsReporter.isTextualContentType(ct)
          DevToolsReporter.reportResponseStart(
            devToolsRequestId,
            info.url,
            info.httpStatusCode,
            headersMap,
            -1L
          )
        }
        val nitroInfo = info.toNitro()
        synchronized(bodyLock) {
          if (settled) return
          // Converted once: every chunk is sent with the same info.
          bodyInfo = nitroInfo
          readBuffer = ByteBuffer.allocateDirect(BUFFER_SIZE)
          onResponseStartedCallback?.invoke(nitroInfo)
          readNext(request)
        }
      }

      override fun onReadCompleted(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo,
        receivedBuffer: ByteBuffer
      ) {
        val bytesRead = receivedBuffer.position()
        if (devToolsEnabled && bytesRead > 0) {
          devToolsBytes += bytesRead
          DevToolsReporter.reportDataReceived(devToolsRequestId, bytesRead)
          if (devToolsTextual) {
            val dup = receivedBuffer.duplicate()
            dup.flip()
            val arr = ByteArray(dup.remaining())
            dup.get(arr)
            DevToolsReporter.storeResponseBodyIncremental(devToolsRequestId, String(arr, Charsets.UTF_8))
          }
        }
        synchronized(bodyLock) {
          if (settled) return
          receivedBuffer.flip()
          append(receivedBuffer)
          if (queued.isEmpty()) sendFilling()
          readNext(request)
        }
      }

      override fun onSucceeded(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo
      ) {
        if (devToolsEnabled) {
          DevToolsReporter.reportResponseEnd(devToolsRequestId, devToolsBytes.toLong())
        }
        val nitroInfo = info.toNitro()
        synchronized(bodyLock) {
          if (settled) return
          sendFilling()
          onSucceededCallback?.invoke(nitroInfo)
          settle()
        }
      }

      override fun onFailed(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo?,
        error: CronetNativeException
      ) {
        if (devToolsEnabled) {
          DevToolsReporter.reportRequestFailed(devToolsRequestId, false)
        }
        val nitroInfo = info?.toNitro()
        val nitroError = error.toNitro(url)
        synchronized(bodyLock) {
          if (settled) return
          sendFilling()
          onFailedCallback?.invoke(nitroInfo, nitroError)
          settle()
        }
      }

      override fun onCanceled(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo?
      ) {
        if (devToolsEnabled) {
          DevToolsReporter.reportRequestFailed(devToolsRequestId, true)
        }
        val nitroInfo = info?.toNitro()
        synchronized(bodyLock) {
          if (settled) return
          onCanceledCallback?.invoke(nitroInfo)
          settle()
        }
      }
    }

    builder = engine.newUrlRequestBuilder(url, cronetCallback, executor)
  }

  override fun setHttpMethod(httpMethod: String) {
    this.httpMethod = httpMethod
    builder.setHttpMethod(httpMethod)
  }

  override fun addHeader(name: String, value: String) {
    requestHeaders[name] = value
    builder.addHeader(name, value)
  }

  override fun setUploadBody(body: Variant_ArrayBuffer_String) {
    val bodyBytes: ByteArray = when (body) {
      is Variant_ArrayBuffer_String.First -> {
        val buffer = body.value.getBuffer(true)
        val bytes = ByteArray(buffer.remaining())
        buffer.get(bytes)
        bytes
      }
      is Variant_ArrayBuffer_String.Second -> {
        uploadBodyString = body.value
        body.value.toByteArray(Charsets.UTF_8)
      }
    }
    uploadBodyLength = bodyBytes.size.toLong()

    val provider = object : org.chromium.net.UploadDataProvider() {
      private var position = 0

      override fun getLength(): Long = bodyBytes.size.toLong()

      override fun read(uploadDataSink: org.chromium.net.UploadDataSink, byteBuffer: ByteBuffer) {
        val remaining = bodyBytes.size - position
        val toWrite = minOf(byteBuffer.remaining(), remaining)
        if (toWrite > 0) {
          byteBuffer.put(bodyBytes, position, toWrite)
          position += toWrite
        }
        uploadDataSink.onReadSucceeded(false)
      }

      override fun rewind(uploadDataSink: org.chromium.net.UploadDataSink) {
        position = 0
        uploadDataSink.onRewindSucceeded()
      }
    }

    builder.setUploadDataProvider(provider, executor)
  }

  override fun disableCache() {
    builder.disableCache()
  }

  override fun disableCookies() {
    cookiesEnabled = false
  }

  override fun setPriority(priority: NitroRequestPriority) {
    builder.setPriority(priority.cronetPriority)
  }

  override fun onSucceeded(callback: (info: UrlResponseInfo) -> Unit) {
    this.onSucceededCallback = callback
  }

  override fun onFailed(callback: (info: UrlResponseInfo?, error: RequestException) -> Unit) {
    this.onFailedCallback = callback
  }

  override fun onCanceled(callback: (info: UrlResponseInfo?) -> Unit) {
    this.onCanceledCallback = callback
  }

  override fun onRedirectReceived(callback: (info: UrlResponseInfo, newLocationUrl: String) -> Unit) {
    this.onRedirectReceivedCallback = callback
  }

  override fun onResponseStarted(callback: (info: UrlResponseInfo) -> Unit) {
    this.onResponseStartedCallback = callback
  }

  override fun onReadCompleted(callback: (info: UrlResponseInfo, byteBuffer: ArrayBuffer, bytesRead: Double) -> Unit) {
    this.onReadCompletedCallback = callback
  }

  override fun build(): HybridUrlRequestSpec {
    if (cookiesEnabled) {
      // Cronet does not share the WebView session jar without the opt-in bridge.
      NitroCookieSync.attachCookieFromManagerIfMissing(
        url,
        requestHeaders.keys.any { it.equals("Cookie", ignoreCase = true) }
      ) { name, value -> addHeader(name, value) }
    }
    val cronetRequest = builder.build()
    if (devToolsEnabled) {
      DevToolsReporter.reportRequestStart(
        devToolsRequestId,
        url,
        httpMethod,
        requestHeaders,
        uploadBodyString,
        uploadBodyLength
      )
    }
    return HybridUrlRequest(cronetRequest, ::onChunkHandled)
  }
}
