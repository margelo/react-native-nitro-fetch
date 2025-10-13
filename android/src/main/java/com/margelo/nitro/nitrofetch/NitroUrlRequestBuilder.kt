package com.margelo.nitro.nitrofetch

import android.util.Log
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.ArrayBuffer
import org.chromium.net.CronetEngine
import org.chromium.net.UrlRequest as CronetUrlRequest
import org.chromium.net.UrlResponseInfo as CronetUrlResponseInfo
import org.chromium.net.CronetException as CronetNativeException
import java.nio.ByteBuffer
import java.util.concurrent.Executor as JavaExecutor

/**
 * Nitro wrapper for Cronet's UrlRequest.Builder.
 */
@DoNotStrip
class NitroUrlRequestBuilder(
  private val engine: CronetEngine,
  private val url: String,
  private val callback: UrlRequestCallback,
  private val executor: JavaExecutor
) : HybridUrlRequestBuilderSpec() {

  private val builder: CronetUrlRequest.Builder

  init {
    // Create the Cronet callback wrapper
    val cronetCallback = object : CronetUrlRequest.Callback() {

      override fun onRedirectReceived(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo,
        newLocationUrl: String
      ) {
        try {
          val nitroInfo = info.toNitro()
          callback.onRedirectReceived(nitroInfo, newLocationUrl)
        } catch (t: Throwable) {
          Log.e(TAG, "Error in onRedirectReceived", t)
        }
      }

      override fun onResponseStarted(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo
      ) {
        try {
          val nitroInfo = info.toNitro()
          callback.onResponseStarted(nitroInfo)
        } catch (t: Throwable) {
          Log.e(TAG, "Error in onResponseStarted", t)
        }
      }

      override fun onReadCompleted(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo,
        byteBuffer: ByteBuffer
      ) {
        try {
          byteBuffer.flip()
          val size = byteBuffer.remaining()

          // Create a new direct ByteBuffer and copy the data
          val directBuffer = ByteBuffer.allocateDirect(size)
          directBuffer.put(byteBuffer)
          directBuffer.flip()

          // Create ArrayBuffer from the direct ByteBuffer
          val arrayBuffer = ArrayBuffer(directBuffer)
          val nitroInfo = info.toNitro()

          callback.onReadCompleted(nitroInfo, arrayBuffer)

          byteBuffer.clear()
        } catch (t: Throwable) {
          Log.e(TAG, "Error in onReadCompleted", t)
        }
      }

      override fun onSucceeded(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo
      ) {
        try {
          val nitroInfo = info.toNitro()
          callback.onSucceeded(nitroInfo)
        } catch (t: Throwable) {
          Log.e(TAG, "Error in onSucceeded", t)
        }
      }

      override fun onFailed(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo?,
        error: CronetNativeException
      ) {
        try {
          val nitroInfo = info?.toNitro()
          val nitroError = error.toNitro()
          callback.onFailed(nitroInfo, nitroError)
        } catch (t: Throwable) {
          Log.e(TAG, "Error in onFailed", t)
        }
      }

      override fun onCanceled(
        request: CronetUrlRequest,
        info: CronetUrlResponseInfo?
      ) {
        try {
          val nitroInfo = info?.toNitro()
          callback.onCanceled(nitroInfo)
        } catch (t: Throwable) {
          Log.e(TAG, "Error in onCanceled", t)
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

  companion object {
    private const val TAG = "NitroUrlRequestBuilder"
  }
}
