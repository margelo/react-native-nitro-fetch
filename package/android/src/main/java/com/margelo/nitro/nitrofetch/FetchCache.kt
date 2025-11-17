package com.margelo.nitro.nitrofetch

import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap

data class CachedEntry(val response: NitroResponse, val timestampMs: Long)

object FetchCache {
  private val pending = ConcurrentHashMap<String, CompletableFuture<NitroResponse>>()
  private val results = ConcurrentHashMap<String, CachedEntry>()

  fun getPending(key: String): CompletableFuture<NitroResponse>? = pending[key]

  fun setPending(key: String, future: CompletableFuture<NitroResponse>) {
    pending[key] = future
    // Cleanup: remove pending entry when completed
    future.whenComplete { _, _ ->
      pending.remove(key)
    }
  }

  fun complete(key: String, value: NitroResponse) {
    results[key] = CachedEntry(value, System.currentTimeMillis())
    pending[key]?.complete(value)
    pending.remove(key)
  }

  fun completeExceptionally(key: String, t: Throwable) {
    pending[key]?.completeExceptionally(t)
    pending.remove(key)
  }

  fun getResult(key: String): NitroResponse? {
    val entry = results.remove(key) ?: return null
    return entry.response
  }

  fun getResultIfFresh(key: String, maxAgeMs: Long): NitroResponse? {
    val entry = results.remove(key) ?: return null
    val age = System.currentTimeMillis() - entry.timestampMs
    return if (age <= maxAgeMs) entry.response else null
  }

  /**
   * Check if a fresh result exists WITHOUT consuming it.
   * Used to check if we should skip starting a new prefetch.
   */
  fun hasFreshResult(key: String, maxAgeMs: Long): Boolean {
    val entry = results[key] ?: return false
    val age = System.currentTimeMillis() - entry.timestampMs
    return age <= maxAgeMs
  }

  fun clear() {
    pending.clear()
    results.clear()
  }
}