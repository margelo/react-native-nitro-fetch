package com.margelo.nitro.nitrofetch

import com.facebook.proguard.annotations.DoNotStrip
import org.chromium.net.CronetEngine as CronetEngineNative
import java.util.concurrent.Executor as JavaExecutor

@DoNotStrip
class NitroCronetEngine(
  private val engine: CronetEngineNative,
  private val defaultExecutor: JavaExecutor
) : HybridCronetEngineSpec() {

  override fun newUrlRequestBuilder(
    url: String,
    callback: UrlRequestCallback
  ): HybridUrlRequestBuilderSpec {
    return NitroUrlRequestBuilder(
      engine = engine,
      url = url,
      callback = callback,
      executor = defaultExecutor
    )
  }

  override fun shutdown() {
    engine.shutdown()
  }

  override fun getVersionString(): String {
    return engine.versionString
  }

  override fun startNetLogToFile(fileName: String, logAll: Boolean) {
    engine.startNetLogToFile(fileName, logAll)
  }

  override fun stopNetLog() {
    engine.stopNetLog()
  }
}
