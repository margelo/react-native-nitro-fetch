package com.margelo.nitro.nitrofetch

import android.app.Application
import org.json.JSONArray
import org.json.JSONObject
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

        // Use the NitroFetchClient's prefetch method which handles caching properly
        try {
          val engine = NitroFetch.getEngine()
          val executor = NitroFetch.ioExecutor
          val client = NitroFetchClient(engine, executor)
          client.prefetch(req)
        } catch (_: Throwable) {
          // Ignore prefetch errors - best effort
        }
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
