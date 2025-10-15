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

  override fun setUploadBody(body: Variant_String_ArrayBuffer) {
    val bodyBytes: ByteArray = when (body) {
      is Variant_String_ArrayBuffer.First -> body.value.toByteArray(Charsets.UTF_8)
      is Variant_String_ArrayBuffer.Second -> {
        val buffer = body.value.getBuffer(copyIfNeeded = true)
        val bytes = ByteArray(buffer.remaining())
        buffer.get(bytes)
        bytes
      }
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

  override fun setUploadDataProvider(provider: UploadDataProvider) {
    val cronetProvider = object : org.chromium.net.UploadDataProvider() {
      private var uploadedSoFar: Long = 0

      override fun getLength(): Long {
        return provider.length.toLong()
      }

      override fun read(uploadDataSink: org.chromium.net.UploadDataSink, byteBuffer: ByteBuffer) {
        // Calculate how many bytes to write in this chunk
        val remaining = (provider.length - uploadedSoFar).toInt()
        val bufferCapacity = byteBuffer.remaining()
        val bytesToWrite = minOf(bufferCapacity, remaining)

        val nitroSink = UploadDataSink(
          onReadSucceeded = { finalChunk ->
            // Update ByteBuffer position to reflect the data written
            byteBuffer.position(byteBuffer.position() + bytesToWrite)
            uploadedSoFar += bytesToWrite
            uploadDataSink.onReadSucceeded(finalChunk)
          },
          onReadError = { error ->
            uploadDataSink.onReadError(Exception(error))
          },
          onRewindSucceeded = {
            uploadDataSink.onRewindSucceeded()
          },
          onRewindError = { error ->
            uploadDataSink.onRewindError(Exception(error))
          }
        )

        // Create ArrayBuffer from ByteBuffer - this wraps the buffer at current position
        val arrayBuffer = ArrayBuffer(byteBuffer)

        // Call JavaScript provider - it will write data to the ArrayBuffer
        provider.read(nitroSink, arrayBuffer)
      }

      override fun rewind(uploadDataSink: org.chromium.net.UploadDataSink) {
        uploadedSoFar = 0

        val nitroSink = UploadDataSink(
          onReadSucceeded = { finalChunk ->
            uploadDataSink.onRewindSucceeded()
          },
          onReadError = { error ->
            uploadDataSink.onRewindError(Exception(error))
          },
          onRewindSucceeded = {
            uploadDataSink.onRewindSucceeded()
          },
          onRewindError = { error ->
            uploadDataSink.onRewindError(Exception(error))
          }
        )

        provider.rewind(nitroSink)
      }
    }

    builder.setUploadDataProvider(cronetProvider, executor)
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
