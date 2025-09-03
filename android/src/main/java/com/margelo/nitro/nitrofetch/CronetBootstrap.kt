package com.margelo.nitro.nitrofetch

import android.app.Application
import android.os.Handler
import android.os.Looper
import org.chromium.net.CronetEngine
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

object CronetBootstrap {
  @JvmStatic
  fun ensureInitialized(cachePath: String): Boolean {
    val latch = CountDownLatch(1)
    var ok = false
    val runnable = Runnable {
      // Initialize Cronet via Java APIs on main thread and adopt in native
      val app = currentApplication()
      if (app != null) {
        try {
          val cacheDir = File(cachePath)
          if (!cacheDir.exists()) cacheDir.mkdirs()
          val engine = CronetEngine.Builder(app)
            .enableHttp2(true)
            .enableQuic(true)
            .setStoragePath(cacheDir.absolutePath)
            .enableHttpCache(CronetEngine.Builder.HTTP_CACHE_DISK, 50 * 1024 * 1024)
            .build()
          val ptr = try {
            // Reflection: Impl.getUrlRequestContextAdapter() returns long
            val m = engine.javaClass.getMethod("getUrlRequestContextAdapter")
            (m.invoke(engine) as? Long) ?: 0L
          } catch (_: Throwable) { 0L }
          if (ptr != 0L) {
            ok = nativeAdoptCronetEngine(ptr)
          }
        } catch (_: Throwable) {
          // Will fallback to native path below
        }
      }
      latch.countDown()
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      runnable.run()
    } else {
      Handler(Looper.getMainLooper()).post(runnable)
    }
    // Wait up to 5s to initialize
    latch.await(5, TimeUnit.SECONDS)
    return ok
  }

  private fun currentApplication(): Application? = try {
    val cls = Class.forName("android.app.ActivityThread")
    val method = cls.getMethod("currentApplication")
    method.invoke(null) as? Application
  } catch (_: Throwable) { null }

  @JvmStatic
  external fun nativeAdoptCronetEngine(nativePtr: Long): Boolean
}
