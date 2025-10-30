package com.margelo.nitro.nitrofetch

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.ArrayBuffer
import org.chromium.net.CronetEngine
import org.chromium.net.UrlRequest as CronetUrlRequest
import org.chromium.net.UrlResponseInfo as CronetUrlResponseInfo
import org.chromium.net.CronetException as CronetNativeException
import java.nio.ByteBuffer
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

  init {
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
        onResponseStartedCallback?.let { callback ->
          val nitroInfo = info.toNitro()
          callback(nitroInfo)
        }
      }

      override fun onReadCompleted(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo,
        byteBuffer: ByteBuffer
      ) {
        onReadCompletedCallback?.let { callback ->
          // After Cronet writes, buffer position is at the end of written data
          val bytesRead = byteBuffer.position()

          // Don't create a new ArrayBuffer - just pass back the original one!
          // JS will create a view of the correct size using bytesRead
          byteBuffer.rewind()
          val arrayBuffer = ArrayBuffer(byteBuffer)
          val nitroInfo = info.toNitro()

          callback(nitroInfo, arrayBuffer, bytesRead.toDouble())
        }

      }

      override fun onSucceeded(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo
      ) {
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
        onCanceledCallback?.let { callback ->
          val nitroInfo = info?.toNitro()
          callback(nitroInfo)
        }
      }
    }

    builder = engine.newUrlRequestBuilder(url, cronetCallback, executor)
  }

  override fun setHttpMethod(httpMethod: String) {
    builder.setHttpMethod(httpMethod)
  }

  override fun addHeader(name: String, value: String) {
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
      is Variant_ArrayBuffer_String.Second -> body.value.toByteArray(Charsets.UTF_8)
    }

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

        // Always pass false - Cronet determines completion by comparing uploaded bytes with getLength()
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

  override fun setPriority(priority: Double) {
    val cronetPriority = when (priority.toInt()) {
      0 -> CronetUrlRequest.Builder.REQUEST_PRIORITY_IDLE
      1 -> CronetUrlRequest.Builder.REQUEST_PRIORITY_LOWEST
      2 -> CronetUrlRequest.Builder.REQUEST_PRIORITY_LOW
      3 -> CronetUrlRequest.Builder.REQUEST_PRIORITY_MEDIUM
      4 -> CronetUrlRequest.Builder.REQUEST_PRIORITY_HIGHEST
      else -> CronetUrlRequest.Builder.REQUEST_PRIORITY_MEDIUM
    }
    builder.setPriority(cronetPriority)
  }

  override fun allowDirectExecutor() {
    builder.allowDirectExecutor()
  }

  // MARK: - Callback Setters
  // Each setter takes only 1 callback to avoid Swift compiler bug (crashes with 4+ callbacks)

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
    return NitroUrlRequest(cronetRequest)
  }
}
