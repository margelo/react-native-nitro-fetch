package com.margelo.nitro.nitrofetch

import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap

data class CachedEntry(val response: NitroResponse, val timestampMs: Long)

object FetchCache {
  private val pending = ConcurrentHashMap<String, CompletableFuture<NitroResponse>>()
  private val results = ConcurrentHashMap<String, CachedEntry>()

  fun getPending(key: String): CompletableFuture<NitroResponse>? = pending[key]

  /** Atomically registers a prefetch. Returns the already-pending future if one exists. */
  fun beginPending(key: String, future: CompletableFuture<NitroResponse>): CompletableFuture<NitroResponse>? {
    val existing = pending.putIfAbsent(key, future)
    if (existing == null) {
      future.whenComplete { _, _ -> pending.remove(key, future) }
    }
    return existing
  }

  fun complete(key: String, value: NitroResponse) {
    results[key] = CachedEntry(value, System.nanoTime() / 1_000_000)
    pending.remove(key)?.complete(value)
  }

  fun completeExceptionally(key: String, t: Throwable) {
    pending.remove(key)?.completeExceptionally(t)
  }

  fun getResult(key: String): NitroResponse? {
    val entry = results.remove(key) ?: return null
    return entry.response
  }

  fun getResultIfFresh(key: String, maxAgeMs: Long): NitroResponse? {
    val entry = results.remove(key) ?: return null
    val age = System.nanoTime() / 1_000_000 - entry.timestampMs
    return if (maxAgeMs > 0 && age <= maxAgeMs) entry.response else null
  }

  /**
   * Check if a fresh result exists WITHOUT consuming it.
   * Used to check if we should skip starting a new prefetch.
   */
  fun hasFreshResult(key: String, maxAgeMs: Long): Boolean {
    val entry = results[key] ?: return false
    val age = System.nanoTime() / 1_000_000 - entry.timestampMs
    if (maxAgeMs > 0 && age <= maxAgeMs) return true
    results.remove(key, entry)
    return false
  }

  fun clear() {
    pending.clear()
    results.clear()
  }
}
