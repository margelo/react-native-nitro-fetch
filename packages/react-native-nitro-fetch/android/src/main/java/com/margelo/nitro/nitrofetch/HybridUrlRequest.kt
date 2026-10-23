package com.margelo.nitro.nitrofetch

import com.facebook.proguard.annotations.DoNotStrip
import org.chromium.net.UrlRequest as CronetUrlRequest

@DoNotStrip
class HybridUrlRequest(
  private val cronetRequest: CronetUrlRequest,
  private val readController: CronetReadController
) : HybridUrlRequestSpec() {

  init {
    readController.attach(cronetRequest)
  }

  override fun start() {
    readController.start()
  }

  override fun followRedirect() {
    readController.followRedirect()
  }

  override fun read() {
    readController.requestRead()
  }

  override fun cancel() {
    readController.cancel()
  }

  override fun isDone(): Boolean {
    return readController.isFinished()
  }
}
