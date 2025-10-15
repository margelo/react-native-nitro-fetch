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
  private val callback: UrlRequestCallback,
  private val executor: JavaExecutor
) : HybridUrlRequestBuilderSpec() {

  private val builder: CronetUrlRequest.Builder

  init {
    val cronetCallback = object : CronetUrlRequest.Callback() {

      override fun onRedirectReceived(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo,
        newLocationUrl: String
      ) {
        val nitroInfo = info.toNitro()
        callback.onRedirectReceived(nitroInfo, newLocationUrl)
      }

      override fun onResponseStarted(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo
      ) {
        val nitroInfo = info.toNitro()
        callback.onResponseStarted(nitroInfo)
      }

      override fun onReadCompleted(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo,
        byteBuffer: ByteBuffer
      ) {
        byteBuffer.flip()
        val size = byteBuffer.remaining()

        val directBuffer = ByteBuffer.allocateDirect(size)
        directBuffer.put(byteBuffer)
        directBuffer.flip()

        val arrayBuffer = ArrayBuffer(directBuffer)
        val nitroInfo = info.toNitro()

        callback.onReadCompleted(nitroInfo, arrayBuffer)

        byteBuffer.clear()
      }

      override fun onSucceeded(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo
      ) {
        val nitroInfo = info.toNitro()
        callback.onSucceeded(nitroInfo)
      }

      override fun onFailed(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo?,
        error: CronetNativeException
      ) {
        val nitroInfo = info?.toNitro()
        val nitroError = error.toNitro()
        callback.onFailed(nitroInfo, nitroError)
      }

      override fun onCanceled(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo?
      ) {
        val nitroInfo = info?.toNitro()
        callback.onCanceled(nitroInfo)
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

  override fun build(): HybridUrlRequestSpec {
    val cronetRequest = builder.build()
    return NitroUrlRequest(cronetRequest)
  }
}
