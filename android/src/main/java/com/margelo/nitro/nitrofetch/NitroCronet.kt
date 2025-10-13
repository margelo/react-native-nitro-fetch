package com.margelo.nitro.nitrofetch

import android.app.Application
import android.util.Log
import com.facebook.proguard.annotations.DoNotStrip
import org.chromium.net.CronetEngine
import org.chromium.net.CronetProvider
import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.Executors

/**
 * Main Nitro Cronet factory class.
 * Provides singleton engine access and engine creation.
 */
@DoNotStrip
class NitroCronet : HybridNitroCronetSpec() {

  override fun getEngine(): HybridCronetEngineSpec {
    return NitroCronetEngine(
      engine = getOrCreateCronetEngine(),
      defaultExecutor = ioExecutor
    )
  }

  override fun createEngine(): HybridCronetEngineSpec {
    // For now, return the singleton engine
    // Could be extended to support multiple engines with different configs
    return getEngine()
  }

  override fun shutdownAll() {
    synchronized(this) {
      try {
        engineRef?.shutdown()
      } catch (t: Throwable) {
        Log.e(TAG, "Error shutting down engine", t)
      } finally {
        engineRef = null
      }
    }
  }

  companion object {
    private const val TAG = "NitroCronet"

    @Volatile
    private var engineRef: CronetEngine? = null

    /**
     * Shared I/O executor for Cronet operations.
     */
    val ioExecutor: Executor by lazy {
      val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(2)
      Executors.newFixedThreadPool(cores) { r ->
        Thread(r, "NitroCronet-io").apply {
          isDaemon = true
          priority = Thread.NORM_PRIORITY
        }
      }
    }

    /**
     * Get or create the singleton Cronet engine.
     */
    fun getOrCreateCronetEngine(): CronetEngine {
      engineRef?.let { return it }
      synchronized(this) {
        engineRef?.let { return it }

        val app = currentApplication() ?: initialApplication()
          ?: throw IllegalStateException("NitroCronet: Application not available")

        // Log available providers and prefer the Native one
        val providers = CronetProvider.getAllProviders(app)
        providers.forEach {
          Log.i(TAG, "Cronet provider: ${it.name} v=${it.version}")
        }
        val nativeProvider = providers.firstOrNull {
          it.name.contains("Native", ignoreCase = true)
        }

        val cacheDir = File(app.cacheDir, "nitro_cronet_cache").apply { mkdirs() }
        val builder = (nativeProvider?.createBuilder() ?: CronetEngine.Builder(app))
          .enableHttp2(true)
          .enableQuic(true)
          .enableBrotli(true)
          .setStoragePath(cacheDir.absolutePath)
          .enableHttpCache(CronetEngine.Builder.HTTP_CACHE_DISK, 50 * 1024 * 1024)
          .setUserAgent("NitroCronet/1.0")

        val engine = builder.build()
        Log.i(TAG, "CronetEngine initialized. Provider=${nativeProvider?.name ?: "Default"} Cache=${cacheDir.absolutePath}")
        engineRef = engine
        return engine
      }
    }

    private fun currentApplication(): Application? = try {
      val cls = Class.forName("android.app.ActivityThread")
      val m = cls.getMethod("currentApplication")
      m.invoke(null) as? Application
    } catch (_: Throwable) {
      null
    }

    private fun initialApplication(): Application? = try {
      val cls = Class.forName("android.app.AppGlobals")
      val m = cls.getMethod("getInitialApplication")
      m.invoke(null) as? Application
    } catch (_: Throwable) {
      null
    }
  }
}
