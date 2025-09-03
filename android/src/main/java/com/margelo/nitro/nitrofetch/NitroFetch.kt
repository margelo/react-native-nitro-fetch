package com.margelo.nitro.nitrofetch

import android.app.Application
import android.util.Log
import com.facebook.proguard.annotations.DoNotStrip
import org.chromium.net.CronetEngine
import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.Executors

@DoNotStrip
class NitroFetch : HybridNitroFetchSpec() {
  // Generated base may expect envless createClient in your current setup.
  override fun createClient(): NitroFetchClient {
    return NitroFetchClient(getEngine(), ioExecutor)
  }

  companion object {
    @Volatile private var engineRef: CronetEngine? = null
    val ioExecutor: Executor by lazy {
      val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(2)
      Executors.newFixedThreadPool(cores) { r ->
        Thread(r, "NitroCronet-io").apply { isDaemon = true; priority = Thread.NORM_PRIORITY }
      }
    }

    private fun getEngine(): CronetEngine {
      engineRef?.let { return it }
      synchronized(this) {
        engineRef?.let { return it }
        val app = currentApplication() ?: initialApplication()
          ?: throw IllegalStateException("NitroFetch: Application not available")
        val cacheDir = File(app.cacheDir, "nitrofetch_cronet_cache").apply { mkdirs() }
        val builder = CronetEngine.Builder(app)
          .enableHttp2(true)
          .enableQuic(true)
          .enableBrotli(true)
          .setStoragePath(cacheDir.absolutePath)
          .enableHttpCache(CronetEngine.Builder.HTTP_CACHE_DISK, 50 * 1024 * 1024)
          .setUserAgent("NitroFetch/0.1")
        val engine = builder.build()
        Log.i("NitroFetch", "CronetEngine initialized. Cache=${cacheDir.absolutePath}")
        engineRef = engine
        return engine
      }
    }

    private fun currentApplication(): Application? = try {
      val cls = Class.forName("android.app.ActivityThread")
      val m = cls.getMethod("currentApplication")
      m.invoke(null) as? Application
    } catch (_: Throwable) { null }

    private fun initialApplication(): Application? = try {
      val cls = Class.forName("android.app.AppGlobals")
      val m = cls.getMethod("getInitialApplication")
      m.invoke(null) as? Application
    } catch (_: Throwable) { null }
  }
}
