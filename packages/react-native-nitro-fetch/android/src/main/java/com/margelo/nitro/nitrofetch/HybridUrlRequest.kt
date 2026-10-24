package com.margelo.nitro.nitrofetch

import com.facebook.proguard.annotations.DoNotStrip
import org.chromium.net.UrlRequest as CronetUrlRequest

@DoNotStrip
class HybridUrlRequest(
  private val cronetRequest: CronetUrlRequest,
  private val onChunkHandled: () -> Unit
) : HybridUrlRequestSpec() {

  override fun start() {
    cronetRequest.start()
  }

  override fun followRedirect() {
    cronetRequest.followRedirect()
  }

  override fun read() {
    onChunkHandled()
  }

  override fun cancel() {
    cronetRequest.cancel()
  }

  override fun isDone(): Boolean {
    return cronetRequest.isDone
  }
}
