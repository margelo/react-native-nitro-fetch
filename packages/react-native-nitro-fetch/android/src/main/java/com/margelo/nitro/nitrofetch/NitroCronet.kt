package com.margelo.nitro.nitrofetch

import android.app.Application
import com.facebook.proguard.annotations.DoNotStrip
import org.chromium.net.CronetEngine
import org.chromium.net.CronetProvider
import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.Executors

/**
 * Streaming-focused Nitro Cronet client.
 * Manages the Cronet engine and provides URL request building for streaming.
 */
@DoNotStrip
class NitroCronet : HybridNitroCronetSpec() {

  override fun newUrlRequestBuilder(url: String): HybridUrlRequestBuilderSpec {
    return NitroUrlRequestBuilder(
      engine = getOrCreateCronetEngine(),
      url = url,
      executor = ioExecutor
    )
  }

  companion object {
    @Volatile
    private var engineRef: CronetEngine? = null

    val ioExecutor: Executor by lazy {
      val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(2)
      Executors.newFixedThreadPool(cores) { r ->
        Thread(r, "NitroCronet-io").apply {
          isDaemon = true
          priority = Thread.NORM_PRIORITY
        }
      }
    }

    fun getOrCreateCronetEngine(): CronetEngine {
      engineRef?.let { return it }
      synchronized(this) {
        engineRef?.let { return it }

        val app = currentApplication() ?: initialApplication()
          ?: throw IllegalStateException("NitroCronet: Application not available")

        val providers = CronetProvider.getAllProviders(app)

        val nativeProvider = providers.firstOrNull {
          it.name.contains("Native", ignoreCase = true)
        }

        val cacheDir = File(app.cacheDir, "nitro_cronet_cache").apply { mkdirs() }
        val builder = (nativeProvider?.createBuilder() ?: CronetEngine.Builder(app))
          .enableHttp2(true)
          .enableQuic(true)
          .enableBrotli(true)
          .setStoragePath(cacheDir.absolutePath)
          .setUserAgent("NitroCronet/1.0")

        builder.enableHttpCache(
          CronetEngine.Builder.HTTP_CACHE_DISK,
          (50 * 1024 * 1024).toLong()
        )

        val engine = builder.build()
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
