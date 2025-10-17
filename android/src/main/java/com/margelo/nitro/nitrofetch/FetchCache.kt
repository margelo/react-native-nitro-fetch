package com.margelo.nitro.nitrofetch

import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap

/**
 * Response data that can be cached
 */
data class CachedResponse(
  val url: String,
  val statusCode: Int,
  val statusText: String,
  val headers: Map<String, String>,
  val body: ByteArray,
  val timestampMs: Long,
  val maxAgeMs: Long = 5_000L // Default 5 seconds
) {
  override fun equals(other: Any?): Boolean {
    if (this === other) return true
    if (javaClass != other?.javaClass) return false

    other as CachedResponse

    if (url != other.url) return false
    if (statusCode != other.statusCode) return false
    if (statusText != other.statusText) return false
    if (headers != other.headers) return false
    if (!body.contentEquals(other.body)) return false
    if (timestampMs != other.timestampMs) return false
    if (maxAgeMs != other.maxAgeMs) return false

    return true
  }

  override fun hashCode(): Int {
    var result = url.hashCode()
    result = 31 * result + statusCode
    result = 31 * result + statusText.hashCode()
    result = 31 * result + headers.hashCode()
    result = 31 * result + body.contentHashCode()
    result = 31 * result + timestampMs.hashCode()
    result = 31 * result + maxAgeMs.hashCode()
    return result
  }
}

/**
 * Cache for managing pending and completed fetch requests.
 * Used for prefetch functionality to avoid duplicate requests.
 */
object FetchCache {
  private val pending = ConcurrentHashMap<String, CompletableFuture<CachedResponse>>()
  private val results = ConcurrentHashMap<String, CachedResponse>()

  /**
   * Get a pending future for a given key, if it exists
   */
  fun getPending(key: String): CompletableFuture<CachedResponse>? = pending[key]

  /**
   * Register a pending future for a given key
   */
  fun setPending(key: String, future: CompletableFuture<CachedResponse>) {
    pending[key] = future
    // Cleanup: remove pending entry when completed
    future.whenComplete { _, _ ->
      pending.remove(key)
    }
  }

  /**
   * Complete a pending request successfully and cache the result
   */
  fun complete(key: String, value: CachedResponse) {
    results[key] = value
    pending[key]?.complete(value)
    pending.remove(key)
  }

  /**
   * Complete a pending request with an error
   */
  fun completeExceptionally(key: String, t: Throwable) {
    pending[key]?.completeExceptionally(t)
    pending.remove(key)
  }

  /**
   * Get a cached result and remove it from the cache
   */
  fun getResult(key: String): CachedResponse? {
    return results.remove(key)
  }

  /**
   * Get a cached result if it's still fresh (within maxAgeMs), and remove it from cache
   * Uses the entry's stored maxAge if available, otherwise uses the provided maxAgeMs
   */
  fun getResultIfFresh(key: String, maxAgeMs: Long? = null): CachedResponse? {

    val entry = results.remove(key)
    if (entry == null) {
      return null
    }

    val age = System.currentTimeMillis() - entry.timestampMs
    val effectiveMaxAge = maxAgeMs ?: entry.maxAgeMs

    return if (age <= effectiveMaxAge) {
      entry
    } else {
      null
    }
  }

  /**
   * Clear all cached and pending requests
   */
  fun clear() {
    pending.clear()
    results.clear()
  }
}
