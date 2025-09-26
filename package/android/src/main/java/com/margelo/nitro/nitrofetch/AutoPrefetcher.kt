package com.margelo.nitro.nitrofetch

import android.app.Application
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CompletableFuture
import com.tencent.mmkv.MMKV;


object AutoPrefetcher {
  @Volatile private var initialized = false

  fun prefetchOnStart(app: Application) {
    if (initialized) return
    initialized = true
    try {
      val mmkv = getMMKV(app) ?: return
      val raw = invokeMMKVDecodeString(mmkv, KEY_QUEUE) ?: return
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
        if (FetchCache.getPending(prefetchKey) != null) {
          continue
        }
        if (FetchCache.getResultIfFresh(prefetchKey, 5_000L) != null) {
          continue
        }

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

  private const val KEY_QUEUE = "nitrofetch_autoprefetch_queue"

  private fun getMMKV(app: Application): Any? {
    return try {
      MMKV.initialize(app);

      return MMKV.defaultMMKV()
    } catch (_: Throwable) {
      null
    }
  }

  private fun invokeMMKVDecodeString(mmkv: Any, key: String): String? {
    return try {
      val m = mmkv.javaClass.getMethod("decodeString", String::class.java, String::class.java)
      m.invoke(mmkv, key, null) as? String
    } catch (_: Throwable) { null }
  }
}
