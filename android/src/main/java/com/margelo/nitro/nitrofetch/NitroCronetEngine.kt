package com.margelo.nitro.nitrofetch

import android.util.Log
import com.facebook.proguard.annotations.DoNotStrip
import org.chromium.net.CronetEngine as CronetEngineNative
import java.util.concurrent.Executor as JavaExecutor

/**
 * Nitro wrapper for Cronet's engine.
 */
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
    try {
      engine.shutdown()
    } catch (t: Throwable) {
      Log.e(TAG, "Error shutting down engine", t)
    }
  }

  override fun getVersionString(): String {
    return engine.versionString
  }

  override fun startNetLogToFile(fileName: String, logAll: Boolean) {
    try {
      engine.startNetLogToFile(fileName, logAll)
    } catch (t: Throwable) {
      Log.e(TAG, "Error starting NetLog", t)
    }
  }

  override fun stopNetLog() {
    try {
      engine.stopNetLog()
    } catch (t: Throwable) {
      Log.e(TAG, "Error stopping NetLog", t)
    }
  }

  companion object {
    private const val TAG = "NitroCronetEngine"
  }
}
