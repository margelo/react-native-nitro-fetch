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

@DoNotStrip
class NitroUrlRequestBuilder(
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
  private val byteBuffer: ByteBuffer
  private val devToolsRequestId: String = UUID.randomUUID().toString()
  // BuildConfig.DEBUG short-circuits in release so R8 strips DevTools paths.
  private val devToolsEnabled: Boolean = BuildConfig.DEBUG && DevToolsReporter.isDebuggingEnabled()
  private var devToolsBytes: Int = 0
  private var devToolsTextual: Boolean = false
  private var httpMethod: String = "GET"
  private val requestHeaders: LinkedHashMap<String, String> = LinkedHashMap()
  private var uploadBodyString: String = ""
  private var uploadBodyLength: Long = 0L

  init {
    // Allocate ONE reusable owning buffer for all reads (64KB)
    val reusableBuffer = ArrayBuffer.allocate(65536)
    byteBuffer = reusableBuffer.getBuffer(false)

    val cronetCallback = object : CronetUrlRequest.Callback() {

      override fun onRedirectReceived(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo,
        newLocationUrl: String
      ) {
        onRedirectReceivedCallback?.let { callback ->
          val nitroInfo = info.toNitro()
          callback(nitroInfo, newLocationUrl)
        }
      }

      override fun onResponseStarted(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo
      ) {
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
        onReadCompletedCallback?.let { callback ->
          val nitroInfo = info.toNitro()
          callback(nitroInfo, reusableBuffer, bytesRead.toDouble())
        }
      }

      override fun onSucceeded(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo
      ) {
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
        if (devToolsEnabled) {
          DevToolsReporter.reportRequestFailed(devToolsRequestId, false)
        }
        onFailedCallback?.let { callback ->
          val nitroInfo = info?.toNitro()
          val nitroError = error.toNitro()
          callback(nitroInfo, nitroError)
        }
      }

      override fun onCanceled(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo?
      ) {
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
    return NitroUrlRequest(cronetRequest, byteBuffer)
  }
}
