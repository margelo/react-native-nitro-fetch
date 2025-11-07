package com.margelo.nitro.nitrofetch

import android.app.Application
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CompletableFuture


object AutoPrefetcher {
  @Volatile private var initialized = false
  private const val KEY_QUEUE = "nitrofetch_autoprefetch_queue"
  private const val PREFS_NAME = "nitro_fetch_storage"

  fun prefetchOnStart(app: Application) {
    if (initialized) return
    initialized = true
    try {
      val prefs = app.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val raw = prefs.getString(KEY_QUEUE, null) ?: ""
      if (raw.isEmpty()) return
      val arr = JSONArray(raw)
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val url = o.optString("url", null) ?: continue
        val prefetchKey = o.optString("prefetchKey", null) ?: continue
        val headersObj = o.optJSONObject("headers") ?: JSONObject()
        val headersList = mutableListOf<Pair<String, String>>()
        headersObj.keys().forEachRemaining { k ->
          headersList.add(k to headersObj.optString(k, ""))
        }
        // Ensure prefetchKey header is present
        headersList.add("prefetchKey" to prefetchKey)

        val headerObjs = headersList.map { (k, v) -> NitroHeader(k, v) }.toTypedArray()
        val req = NitroRequest(
          url = url,
          method = null,
          headers = headerObjs,
          bodyString = null,
          bodyBytes = null,
          timeoutMs = null,
          followRedirects = null
        )

        // If already pending or fresh, skip starting a new one
        if (FetchCache.getPending(prefetchKey) != null) continue
        if (FetchCache.hasFreshResult(prefetchKey, 5_000L)) continue

        val future = CompletableFuture<NitroResponse>()
        FetchCache.setPending(prefetchKey, future)
        NitroFetchClient.fetch(req,
          onSuccess = { res ->
            try {
              FetchCache.complete(prefetchKey, res)
              future.complete(res)
            } catch (t: Throwable) {
              FetchCache.completeExceptionally(prefetchKey, t)
              future.completeExceptionally(t)
            }
          },
          onFail = { err ->
            FetchCache.completeExceptionally(prefetchKey, err)
            future.completeExceptionally(err)
          }
        )
      }
    } catch (_: Throwable) {
      // ignore – prefetch-on-start is best-effort
    }
  }
}
