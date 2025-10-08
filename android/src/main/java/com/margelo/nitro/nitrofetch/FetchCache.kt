package com.margelo.nitro.nitrofetch

import com.margelo.nitro.core.ArrayBuffer
import org.chromium.net.UrlResponseInfo
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor

/**
 * Cached response data - stores the raw bytes and metadata, not the NitroResponse object
 * (since NitroResponse contains function callbacks that can't be cached)
 */
data class CachedResponseData(
  val url: String,
  val status: Int,
  val statusText: String,
  val ok: Boolean,
  val redirected: Boolean,
  val headers: Array<NitroHeader>,
  val bodyBytes: ByteArray,
  val timestampMs: Long
)

object FetchCache {
  private val pending = ConcurrentHashMap<String, CompletableFuture<CachedResponseData>>()
  private val results = ConcurrentHashMap<String, CachedResponseData>()

  fun getPending(key: String): CompletableFuture<CachedResponseData>? = pending[key]

  fun setPending(key: String, future: CompletableFuture<CachedResponseData>) {
    pending[key] = future
    // Cleanup: remove pending entry when completed
    future.whenComplete { _, _ ->
      pending.remove(key)
    }
  }

  fun complete(key: String, value: CachedResponseData) {
    results[key] = value
    pending[key]?.complete(value)
    pending.remove(key)
  }

  fun completeExceptionally(key: String, t: Throwable) {
    pending[key]?.completeExceptionally(t)
    pending.remove(key)
  }

  fun getResult(key: String): CachedResponseData? {
    return results.remove(key)
  }

  fun getResultIfFresh(key: String, maxAgeMs: Long): CachedResponseData? {
    val entry = results[key] ?: return null
    val age = System.currentTimeMillis() - entry.timestampMs
    return if (age <= maxAgeMs) {
      results.remove(key) // Remove after use
      entry
    } else {
      results.remove(key) // Remove stale entry
      null
    }
  }

  fun clear() {
    pending.clear()
    results.clear()
  }
}
