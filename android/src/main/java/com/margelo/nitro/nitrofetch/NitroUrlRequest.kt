package com.margelo.nitro.nitrofetch

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.ArrayBuffer
import org.chromium.net.UrlRequest as CronetUrlRequest

@DoNotStrip
class NitroUrlRequest(
  private val cronetRequest: CronetUrlRequest
) : HybridUrlRequestSpec() {

  // Allocate ONE reusable owning buffer for all reads
  // This is more efficient than JS allocating 160+ buffers per large file
  val reusableBuffer = ArrayBuffer.allocate(65536) // 64KB
  private val byteBuffer = reusableBuffer.getBuffer(false)

  override fun start() {
    cronetRequest.start()
  }

  override fun followRedirect() {
    cronetRequest.followRedirect()
  }

  override fun read() {
    // Prepare buffer for writing (position=0, limit=capacity)
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
