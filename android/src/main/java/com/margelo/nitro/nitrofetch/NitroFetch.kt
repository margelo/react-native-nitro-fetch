package com.margelo.nitro.nitrofetch

import android.app.Application
import android.util.Log
import com.facebook.proguard.annotations.DoNotStrip
import org.chromium.net.CronetEngine
import org.chromium.net.CronetProvider
import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.Executors

@DoNotStrip
class NitroFetch : HybridNitroFetchSpec() {
  // Generated base may expect env-less createClient.
  override fun createClient(): NitroFetchClient {
    return NitroFetchClient(getEngine(), ioExecutor)
  }

  companion object {
    @Volatile private var engineRef: CronetEngine? = null

    // Simpler & safer for callbacks than a pool (avoid reentrancy races in glue code).
    val ioExecutor: Executor by lazy {
      Executors.newSingleThreadExecutor { r ->
        Thread(r, "NitroCronet-io").apply { isDaemon = true }
      }
    }

    private fun getEngine(): CronetEngine {
      engineRef?.let { return it }
      synchronized(this) {
        engineRef?.let { return it }

        val app = currentApplication() ?: initialApplication()
        ?: throw IllegalStateException("NitroFetch: Application not available")

        // Log available providers and prefer the Native one (avoids Play-Services DNS quirks)
        val providers = CronetProvider.getAllProviders(app)
        providers.forEach { Log.i("NitroFetch", "Cronet provider: ${it.name} v=${it.version}") }
        val nativeProvider = providers.firstOrNull { it.name.contains("Native", ignoreCase = true) }

        val cacheDir = File(app.cacheDir, "nitrofetch_cronet_cache").apply { mkdirs() }
        val builder = (nativeProvider?.createBuilder() ?: CronetEngine.Builder(app))
          .enableHttp2(true)
          .enableQuic(true)
          .enableBrotli(true)
          .setStoragePath(cacheDir.absolutePath)
          .enableHttpCache(CronetEngine.Builder.HTTP_CACHE_DISK, 50 * 1024 * 1024)
          .setUserAgent("NitroFetch/0.1")

        // --- Optional debugging knobs (uncomment temporarily) ---
        // Enable NetLog-like tracing in NetworkService:
        // builder.setExperimentalOptions("""{"NetworkService":{"enable_network_logging":true}}""")
        //
        // Prove DNS issues by mapping a host (TESTING ONLY, remove in prod):
        // builder.setExperimentalOptions("""{"HostResolverRules":{"host_resolver_rules":"MAP httpbin.org 54.167.17.38"}}""")

        val engine = builder.build()
        Log.i("NitroFetch", "CronetEngine initialized. Provider=${nativeProvider?.name ?: "Default"} Cache=${cacheDir.absolutePath}")
        engineRef = engine
        return engine
      }
    }

    fun shutdown() {
      synchronized(this) {
        try {
          engineRef?.shutdown()
        } catch (_: Throwable) {
          // ignore – shutdown is best-effort
        } finally {
          engineRef = null
        }
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
