package com.margelo.nitro.nitrofetch

import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap

data class CachedEntry(val response: NitroResponse, val timestampMs: Long)

object FetchCache {
  private val pending = ConcurrentHashMap<String, CompletableFuture<NitroResponse>>()
  private val results = ConcurrentHashMap<String, CachedEntry>()

  fun getPending(key: String): CompletableFuture<NitroResponse>? = pending[key]

  /** Atomically registers a prefetch. Returns the already-pending future if one exists. */
  @Synchronized
  fun beginPending(key: String, future: CompletableFuture<NitroResponse>): CompletableFuture<NitroResponse>? {
    val existing = pending.putIfAbsent(key, future)
    if (existing == null) {
      future.whenComplete { _, _ -> pending.remove(key, future) }
    }
    return existing
  }

  fun complete(key: String, value: NitroResponse, future: CompletableFuture<NitroResponse>) {
    synchronized(this) {
      // A cleared request must not populate the cache or complete a newer request with the same key.
      if (!pending.remove(key, future)) return
      results[key] = CachedEntry(value, System.currentTimeMillis())
    }
    future.complete(value)
  }

  fun completeExceptionally(key: String, t: Throwable, future: CompletableFuture<NitroResponse>) {
    if (pending.remove(key, future)) future.completeExceptionally(t)
  }

  fun getResult(key: String): NitroResponse? {
    val entry = results.remove(key) ?: return null
    return entry.response
  }

  /** Reads a fresh result without consuming the response reserved for JavaScript. */
  fun peekResultIfFresh(key: String, maxAgeMs: Long): NitroResponse? =
    results[key]?.takeIf {
      maxAgeMs > 0 && System.currentTimeMillis() - it.timestampMs <= maxAgeMs
    }?.response

  fun getResultIfFresh(key: String, maxAgeMs: Long): NitroResponse? {
    val entry = results.remove(key) ?: return null
    val age = System.currentTimeMillis() - entry.timestampMs
    return if (maxAgeMs > 0 && age <= maxAgeMs) entry.response else null
  }

  /**
   * Check if a fresh result exists WITHOUT consuming it.
   * Used to check if we should skip starting a new prefetch.
   */
  fun hasFreshResult(key: String, maxAgeMs: Long): Boolean {
    val entry = results[key] ?: return false
    val age = System.currentTimeMillis() - entry.timestampMs
    return maxAgeMs > 0 && age <= maxAgeMs
  }

  fun clear() {
    val discarded = synchronized(this) {
      val futures = pending.values.toList()
      pending.clear()
      results.clear()
      futures
    }
    discarded.forEach { it.cancel(false) }
  }
}