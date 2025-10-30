package com.margelo.nitro.nitrofetch

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.ArrayBuffer
import org.chromium.net.UrlRequest as CronetUrlRequest

@DoNotStrip
class NitroUrlRequest(
  private val cronetRequest: CronetUrlRequest
) : HybridUrlRequestSpec() {

  // Store the current read buffer so callback can access it
  var currentReadBuffer: ArrayBuffer? = null

  override fun start() {
    cronetRequest.start()
  }

  override fun followRedirect() {
    cronetRequest.followRedirect()
  }

  override fun read(buffer: ArrayBuffer) {
    // Store the original ArrayBuffer so we can return it in the callback
    currentReadBuffer = buffer
    // Get the ByteBuffer from JS-allocated ArrayBuffer
    val byteBuffer = buffer.getBuffer(copyIfNeeded = false)
    // Ensure it's ready for writing
    byteBuffer.clear()
    // Pass to Cronet to fill
    cronetRequest.read(byteBuffer)
  }

  override fun cancel() {
    cronetRequest.cancel()
  }

  override fun isDone(): Boolean {
    return cronetRequest.isDone
  }
}
