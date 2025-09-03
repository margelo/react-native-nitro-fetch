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
    if (app == null) {
      Log.e("NitroFetch", "createCronetEngine: Application not available")
      return false
    }
    val dirPath = cacheDir ?: app.cacheDir.absolutePath
    val dir = File(dirPath)
    if (!dir.exists()) {
      val created = dir.mkdirs()
      Log.i("NitroFetch", "createCronetEngine: ensure cacheDir exists '${dir.absolutePath}', created=$created")
    } else {
      Log.i("NitroFetch", "createCronetEngine: using cacheDir '${dir.absolutePath}'")
    }

    val engine: CronetEngine = try {
      Log.i("NitroFetch", "createCronetEngine: building CronetEngine (QUIC+HTTP2, DISK cache 50MB)")
      CronetEngine.Builder(app)
        .enableHttp2(true)
        .enableQuic(true)
        .setStoragePath(dir.absolutePath)
        .enableHttpCache(CronetEngine.Builder.HTTP_CACHE_DISK, 50 * 1024 * 1024)
        .build()
    } catch (t: Throwable) {
      Log.e("NitroFetch", "createCronetEngine: CronetEngine.Builder().build() failed: ${t.message}", t)
      return false
    }

    val ptr: Long = try {
      // Try public method first
      val m = engine.javaClass.getMethod("getUrlRequestContextAdapter")
      val p = (m.invoke(engine) as? Long) ?: 0L
      Log.i("NitroFetch", "createCronetEngine: obtained native ptr via public method = $p")
      p
    } catch (pubErr: Throwable) {
      try {
        // Try declared (hidden) method
        val m = engine.javaClass.getDeclaredMethod("getUrlRequestContextAdapter")
        m.isAccessible = true
        val p = (m.invoke(engine) as? Long) ?: 0L
        Log.i("NitroFetch", "createCronetEngine: obtained native ptr via declared method = $p")
        p
      } catch (declErr: Throwable) {
        Log.e("NitroFetch", "createCronetEngine: failed to obtain native ptr: ${declErr.message}", declErr)
        0L
      }
    }

    if (ptr == 0L) {
      Log.e("NitroFetch", "createCronetEngine: native ptr is 0; cannot adopt engine")
      return false
    }
    val adopted = CronetBootstrap.nativeAdoptCronetEngine(ptr)
    Log.i("NitroFetch", "createCronetEngine: nativeAdoptCronetEngine returned $adopted")
    return adopted
  }
}
