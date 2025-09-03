package com.margelo.nitro.nitrofetch

import android.app.Application
import com.facebook.proguard.annotations.DoNotStrip
import org.chromium.net.CronetEngine
import java.io.File
import android.util.Log

@DoNotStrip
class NitroEnv : HybridNitroEnvSpec() {
  override fun getCacheDir(): String {
    // Try to obtain Application via Android internals to avoid RN dependency here
    val app = tryCurrentApplication() ?: tryInitialApplication()
    if (app != null) return app.cacheDir.absolutePath
    // Last resort: use app-specific path environment if available (rare)
    throw IllegalStateException("NitroEnv.getCacheDir: Application not available")
  }

  private fun tryCurrentApplication(): Application? = try {
    val cls = Class.forName("android.app.ActivityThread")
    val method = cls.getMethod("currentApplication")
    method.invoke(null) as? Application
  } catch (_: Throwable) { null }

  private fun tryInitialApplication(): Application? = try {
    val cls = Class.forName("android.app.AppGlobals")
    val method = cls.getMethod("getInitialApplication")
    method.invoke(null) as? Application
  } catch (_: Throwable) { null }

  override fun createCronetEngine(cacheDir: String?): Boolean {
    val app = tryCurrentApplication() ?: tryInitialApplication()
    if (app == null) return false
    val dir = File(cacheDir ?: app.cacheDir.absolutePath)
    return CronetBootstrap.ensureInitialized(dir.absolutePath)
  }
}
