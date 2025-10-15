package com.margelo.nitro.nitrofetch

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.ArrayBuffer
import org.chromium.net.UrlRequest as CronetUrlRequest

@DoNotStrip
class NitroUrlRequest(
  private val cronetRequest: CronetUrlRequest
) : HybridUrlRequestSpec() {

  override fun start() {
    cronetRequest.start()
  }

  override fun followRedirect() {
    cronetRequest.followRedirect()
  }

  override fun read(buffer: ArrayBuffer) {
    val byteBuffer = buffer.getBuffer(copyIfNeeded = false)
    cronetRequest.read(byteBuffer)
  }

  override fun cancel() {
    cronetRequest.cancel()
  }

  override fun isDone(): Boolean {
    return cronetRequest.isDone
  }
}
