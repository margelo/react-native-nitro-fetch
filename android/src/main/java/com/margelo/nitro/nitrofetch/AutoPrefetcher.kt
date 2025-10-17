package com.margelo.nitro.nitrofetch

import android.app.Application
import org.json.JSONArray
import org.json.JSONObject
import com.tencent.mmkv.MMKV
import java.util.concurrent.CompletableFuture

/**
 * Handles automatic prefetching of URLs on application startup.
 * Reads prefetch queue from MMKV storage and initiates requests.
 */
object AutoPrefetcher {
  private const val KEY_QUEUE = "nitrofetch_autoprefetch_queue"
  private const val FRESH_CACHE_MS = 5_000L // 5 seconds - default cache lifetime

  @Volatile
  private var initialized = false

  /**
   * Initialize prefetching on app start.
   * Reads the queue from MMKV and starts prefetch requests.
   */
  fun prefetchOnStart(app: Application) {
    if (initialized) {
      return
    }
    initialized = true

    try {
      // Ensure Cronet engine is initialized early
      NitroCronet.getOrCreateCronetEngine()

      val mmkv = getMMKV(app)
      if (mmkv == null) {
        return
      }

      val raw = invokeMMKVDecodeString(mmkv, KEY_QUEUE)
      if (raw == null) {
        return
      }
      if (raw.isEmpty()) {
        return
      }

      val arr = JSONArray(raw)

      var startedCount = 0
      var skippedCount = 0

      for (i in 0 until arr.length()) {
        val obj = arr.optJSONObject(i)
        if (obj == null) {
          continue
        }

        val url = obj.optString("url", null)
        if (url == null) {
          continue
        }

        val prefetchKey = obj.optString("prefetchKey", null)
        if (prefetchKey == null) {
          continue
        }

        val headersObj = obj.optJSONObject("headers") ?: JSONObject()
        val maxAge = obj.optLong("maxAge", FRESH_CACHE_MS)

        // If already pending or fresh, skip starting a new one
        if (FetchCache.getPending(prefetchKey) != null) {
          skippedCount++
          continue
        }
        if (FetchCache.getResultIfFresh(prefetchKey, maxAge) != null) {
          skippedCount++
          continue
        }

        // Build headers map
        val headers = mutableMapOf<String, String>()
        headersObj.keys().forEachRemaining { k ->
          headers[k] = headersObj.optString(k, "")
        }
        headers["prefetchKey"] = prefetchKey

        // Start prefetch request
        startPrefetchRequest(url, headers, prefetchKey, maxAge)
        startedCount++
      }

    } catch (e: Throwable) {
      android.util.Log.e("AutoPrefetcher", "❌ Error during auto-prefetch: ${e.message}", e)
      // ignore – prefetch-on-start is best-effort
    }
  }

  private fun startPrefetchRequest(
    url: String,
    headers: Map<String, String>,
    prefetchKey: String,
    maxAgeMs: Long
  ) {
    val future = CompletableFuture<CachedResponse>()
    FetchCache.setPending(prefetchKey, future)

    try {
      NitroFetchHelper.simpleFetch(
        url = url,
        method = "GET",
        headers = headers,
        body = null,
        maxAgeMs = maxAgeMs,
        onSuccess = { response ->
          try {
            val sizeKB = response.body.size / 1024
            FetchCache.complete(prefetchKey, response)
            future.complete(response)
          } catch (t: Throwable) {
            FetchCache.completeExceptionally(prefetchKey, t)
            future.completeExceptionally(t)
          }
        },
        onFail = { error ->
          FetchCache.completeExceptionally(prefetchKey, error)
          future.completeExceptionally(error)
        }
      )
    } catch (e: Throwable) {
      FetchCache.completeExceptionally(prefetchKey, e)
      future.completeExceptionally(e)
    }
  }

  private fun getMMKV(app: Application): MMKV? {
    return try {
      MMKV.initialize(app)
      MMKV.defaultMMKV()
    } catch (e: Throwable) {
      null
    }
  }

  private fun invokeMMKVDecodeString(mmkv: MMKV, key: String): String? {
    return try {
      mmkv.decodeString(key, null)
    } catch (e: Throwable) {
      null
    }
  }
}
