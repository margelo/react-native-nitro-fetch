package com.margelo.nitro.nitrofetch

import android.app.Application
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.chromium.net.CronetEngine
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

object CronetBootstrap {
  @JvmStatic external fun nativeInitAfterJavaBootstrap(storagePath: String?): Boolean

  @Volatile private var engine: CronetEngine? = null

  @JvmStatic
  fun ensureInitialized(cachePath: String): Boolean {
    val latch = CountDownLatch(1)
    var ok = false
    val r = Runnable {
      val app = currentApplication()
      if (app != null) {
        try {
          val dir = File(cachePath).apply { if (!exists()) mkdirs() }
          // Java build boots the lib and JVM
          val e = engine ?: CronetEngine.Builder(app)
            .enableHttp2(true)
            .enableQuic(true)
            .setStoragePath(dir.absolutePath)
            .enableHttpCache(CronetEngine.Builder.HTTP_CACHE_DISK, 50 * 1024 * 1024)
            .build()
            .also { engine = it }
          Log.i("NitroFetch", "Java Cronet version: ${e.versionString}")
          // Now let native create its own C-API engine
          ok = nativeInitAfterJavaBootstrap(dir.absolutePath)
        } catch (t: Throwable) {
          Log.e("NitroFetch", "ensureInitialized failed: ${t.message}", t)
        }
      }
      latch.countDown()
    }
    if (Looper.myLooper() == Looper.getMainLooper()) r.run() else Handler(Looper.getMainLooper()).post(r)
    latch.await(5, TimeUnit.SECONDS)
    return ok
  }

  private fun currentApplication(): Application? = try {
    val c = Class.forName("android.app.ActivityThread")
    c.getMethod("currentApplication").invoke(null) as? Application
  } catch (_: Throwable) { null }
}