package com.margelo.nitro.nitrofetch

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.ArrayBuffer
import org.chromium.net.CronetEngine
import org.chromium.net.UrlRequest as CronetUrlRequest
import org.chromium.net.UrlResponseInfo as CronetUrlResponseInfo
import org.chromium.net.CronetException as CronetNativeException
import java.nio.ByteBuffer
import java.util.UUID

@DoNotStrip
class HybridUrlRequestBuilder(
  private val engine: CronetEngine,
  private val url: String,
  private val executor: CronetSerialExecutor
) : HybridUrlRequestBuilderSpec() {

  // Callbacks stored as optionals and set via setter methods
  private var onRedirectReceivedCallback: ((info: UrlResponseInfo, newLocationUrl: String) -> Unit)? = null
  private var onNativeResponseStartedCallback: ((timestampMs: Double) -> Unit)? = null
  private var onNativeReadCallback: ((timestampMs: Double) -> Unit)? = null
  private var onNativeCompletedCallback: ((timestampMs: Double) -> Unit)? = null
  private var onResponseStartedCallback: ((info: UrlResponseInfo) -> Unit)? = null
  private var onReadCompletedCallback: ((info: UrlResponseInfo, byteBuffer: ArrayBuffer, bytesRead: Double) -> Unit)? = null
  private var onSucceededCallback: ((info: UrlResponseInfo) -> Unit)? = null
  private var onFailedCallback: ((info: UrlResponseInfo?, error: RequestException) -> Unit)? = null
  private var onCanceledCallback: ((info: UrlResponseInfo?) -> Unit)? = null

  private val builder: CronetUrlRequest.Builder
  private val readController = CronetReadController(
    executor,
    ::onRequestOperationFailed
  )
  private var terminalCallbackDelivered = false
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
        emitNativeTimestamp(onNativeResponseStartedCallback)
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
        onResponseStartedCallback?.let { callback ->
          val nitroInfo = info.toNitro()
          callback(nitroInfo)
        }
      }

      override fun onReadCompleted(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo,
        receivedBuffer: ByteBuffer
      ) {
        emitNativeTimestamp(onNativeReadCallback)
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
        val completedBuffer = readController.completeRead(receivedBuffer)
        if (completedBuffer == null) return
        onReadCompletedCallback?.let { callback ->
          val nitroInfo = info.toNitro()
          callback(nitroInfo, completedBuffer, bytesRead.toDouble())
        }
      }

      override fun onSucceeded(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo
      ) {
        if (!beginTerminalCallback()) return
        emitNativeTimestamp(onNativeCompletedCallback)
        readController.finish()
        if (devToolsEnabled) {
          DevToolsReporter.reportResponseEnd(devToolsRequestId, devToolsBytes.toLong())
        }
        onSucceededCallback?.let { callback ->
          val nitroInfo = info.toNitro()
          callback(nitroInfo)
        }
      }

      override fun onFailed(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo?,
        error: CronetNativeException
      ) {
        if (!beginTerminalCallback()) return
        readController.finish()
        if (devToolsEnabled) {
          DevToolsReporter.reportRequestFailed(devToolsRequestId, false)
        }
        onFailedCallback?.let { callback ->
          val nitroInfo = info?.toNitro()
          val nitroError = error.toNitro(url)
          callback(nitroInfo, nitroError)
        }
      }

      override fun onCanceled(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo?
      ) {
        if (!beginTerminalCallback()) return
        readController.finish()
        if (devToolsEnabled) {
          DevToolsReporter.reportRequestFailed(devToolsRequestId, true)
        }
        onCanceledCallback?.let { callback ->
          val nitroInfo = info?.toNitro()
          callback(nitroInfo)
        }
      }
    }

    builder = engine.newUrlRequestBuilder(url, cronetCallback, executor)
  }

  private fun beginTerminalCallback(): Boolean {
    if (terminalCallbackDelivered) return false
    terminalCallbackDelivered = true
    return true
  }

  private fun emitNativeTimestamp(callback: ((timestampMs: Double) -> Unit)?) {
    if (callback == null) return
    val timestampMs = System.currentTimeMillis()
    val timestamp = timestampMs.toDouble()
    callback(timestamp)
  }

  private fun onRequestOperationFailed(error: Throwable) {
    if (!beginTerminalCallback()) return
    if (devToolsEnabled) {
      DevToolsReporter.reportRequestFailed(devToolsRequestId, false)
    }
    val callback = onFailedCallback
    if (callback != null) {
      val message = error.toString()
      val nitroError = RequestException(message = message)
      callback(null, nitroError)
    }
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

  override fun onNativeResponseStarted(callback: (timestampMs: Double) -> Unit) {
    this.onNativeResponseStartedCallback = callback
  }

  override fun onNativeRead(callback: (timestampMs: Double) -> Unit) {
    this.onNativeReadCallback = callback
  }

  override fun onNativeCompleted(callback: (timestampMs: Double) -> Unit) {
    this.onNativeCompletedCallback = callback
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
    return HybridUrlRequest(cronetRequest, readController)
  }
}
