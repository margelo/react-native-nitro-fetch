package com.margelo.nitro.nitrofetch

import android.app.Application
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import com.margelo.nitro.nitrofetch.Variant_ArrayBuffer_String
import org.chromium.net.CronetEngine
import org.chromium.net.CronetProvider
import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.Executors

/**
 * Main Nitro Cronet class.
 * Manages Cronet engine internally and provides prefetch + request building capabilities.
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

  override fun prefetch(
    url: String,
    httpMethod: String,
    headers: Map<String, String>,
    body: Variant_ArrayBuffer_String?,
    maxAge: Double
  ): Promise<Unit> {
    val promise = Promise<Unit>()
    val maxAgeMs = maxAge.toLong()

    // Extract prefetchKey from headers
    val prefetchKey = headers.entries.firstOrNull {
      it.key.equals("prefetchKey", ignoreCase = true)
    }?.value

    if (prefetchKey.isNullOrEmpty()) {
      promise.reject(IllegalArgumentException("prefetch requires a 'prefetchKey' header"))
      return promise
    }

    // Check if already have a fresh result
    if (FetchCache.getResultIfFresh(prefetchKey, maxAgeMs) != null) {
      promise.resolve(Unit)
      return promise
    }

    // Check if already pending
    val pending = FetchCache.getPending(prefetchKey)
    if (pending != null) {
      pending.whenComplete { _, error ->
        if (error != null) {
          promise.reject(error)
        } else {
          promise.resolve(Unit)
        }
      }
      return promise
    }

    // Start new prefetch
    val future = java.util.concurrent.CompletableFuture<CachedResponse>()
    FetchCache.setPending(prefetchKey, future)

    // Convert body to ByteArray if needed
    val bodyBytes: ByteArray? = when (body) {
      is Variant_ArrayBuffer_String.First -> {
        val buffer = body.value.getBuffer(true)
        val bytes = ByteArray(buffer.remaining())
        buffer.get(bytes)
        bytes
      }
      is Variant_ArrayBuffer_String.Second -> body.value.toByteArray(Charsets.UTF_8)
      null -> null
    }

    try {
      NitroFetchHelper.simpleFetch(
        url = url,
        method = httpMethod,
        headers = headers,
        body = bodyBytes,
        maxAgeMs = maxAgeMs,
        onSuccess = { response ->
          try {
            FetchCache.complete(prefetchKey, response)
            future.complete(response)
            promise.resolve(Unit)
          } catch (t: Throwable) {
            FetchCache.completeExceptionally(prefetchKey, t)
            future.completeExceptionally(t)
            promise.reject(t)
          }
        },
        onFail = { error ->
          FetchCache.completeExceptionally(prefetchKey, error)
          future.completeExceptionally(error)
          promise.reject(error)
        }
      )
    } catch (e: Throwable) {
      FetchCache.completeExceptionally(prefetchKey, e)
      future.completeExceptionally(e)
      promise.reject(e)
    }

    return promise
  }

  override fun consumeNativePrefetch(prefetchKey: String): Promise<CachedFetchResponse?> {
    val promise = Promise<CachedFetchResponse?>()

    // First, try to get a fresh cached result (non-blocking)
    // Uses the maxAge stored with the cached entry
    val cached = FetchCache.getResultIfFresh(prefetchKey)
    if (cached != null) {
      val headersMap = cached.headers.toMutableMap()
      headersMap["nitroPrefetched"] = "true"

      // Convert ByteArray to ByteBuffer for ArrayBuffer
      val byteBuffer = java.nio.ByteBuffer.allocateDirect(cached.body.size)
      byteBuffer.put(cached.body)
      byteBuffer.flip()

      val arrayBuffer = ArrayBuffer(byteBuffer)
      val result = CachedFetchResponse(
        url = cached.url,
        status = cached.statusCode.toDouble(),
        statusText = cached.statusText,
        headers = headersMap,
        body = arrayBuffer
      )

      promise.resolve(result)
      return promise
    }

    // Check if a prefetch is pending
    val pendingFuture = FetchCache.getPending(prefetchKey)
    if (pendingFuture != null) {
      // Wait for the pending future to complete
      pendingFuture.whenComplete { cached, error ->
        if (error != null) {
          promise.reject(error)
        } else if (cached != null) {
          val headersMap = cached.headers.toMutableMap()
          headersMap["nitroPrefetched"] = "true"

          // Convert ByteArray to ByteBuffer for ArrayBuffer
          val byteBuffer = java.nio.ByteBuffer.allocateDirect(cached.body.size)
          byteBuffer.put(cached.body)
          byteBuffer.flip()

          val arrayBuffer = ArrayBuffer(byteBuffer)
          val result = CachedFetchResponse(
            url = cached.url,
            status = cached.statusCode.toDouble(),
            statusText = cached.statusText,
            headers = headersMap,
            body = arrayBuffer
          )
          promise.resolve(result)
        } else {
          // Pending prefetch returned null - return null for graceful fallback
          promise.resolve(null as CachedFetchResponse?)
        }
      }
      return promise
    }

    // Not found in cache and not pending - return null for graceful fallback
    // This allows the JS layer to automatically fall back to a normal fetch
    promise.resolve(null as CachedFetchResponse?)
    return promise
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

        val cacheDir = File(app.cacheDir, BuildConfig.STORAGE_PATH).apply { mkdirs() }
        val builder = (nativeProvider?.createBuilder() ?: CronetEngine.Builder(app))
          .enableHttp2(BuildConfig.ENABLE_HTTP2)
          .enableQuic(BuildConfig.ENABLE_QUIC)
          .enableBrotli(BuildConfig.ENABLE_BROTLI)
          .setStoragePath(cacheDir.absolutePath)
          .setUserAgent(BuildConfig.USER_AGENT)

        // Configure HTTP cache based on BuildConfig
        if (BuildConfig.HTTP_CACHE_ENABLED) {
          val cacheSizeBytes = BuildConfig.HTTP_CACHE_SIZE_MB * 1024 * 1024
          builder.enableHttpCache(CronetEngine.Builder.HTTP_CACHE_DISK, cacheSizeBytes.toLong())
        } else {
          builder.enableHttpCache(CronetEngine.Builder.HTTP_CACHE_DISABLED, 0)
        }

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
