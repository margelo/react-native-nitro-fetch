package com.margelo.nitro.nitrofetchwebsockets

import android.app.Application
import android.content.Context
import org.json.JSONArray

/**
 * Reads the WebSocket prewarm queue from SharedPreferences and fires
 * [NitroWebSocketPrewarmer.preWarm] for each entry.
 *
 * Call [prewarmOnStart] from `Application.onCreate()` — a single line replaces
 * per-URL manual setup:
 *
 * ```kotlin
 * override fun onCreate() {
 *   super.onCreate()
 *   NitroWebSocketAutoPrewarmer.prewarmOnStart(this)
 * }
 * ```
 *
 * The prewarm queue is written by the JS `prewarmOnAppStart()` helper from
 * `react-native-nitro-websockets`.
 */
object NitroWebSocketAutoPrewarmer {
  @Volatile private var initialized = false
  private const val PREFS_NAME = "nitro_fetch_storage"
  private const val KEY_QUEUE = "nitro_ws_prewarm_queue"

  @JvmStatic
  fun prewarmOnStart(app: Application) {
    if (initialized) return
    initialized = true
    try {
      val prefs = app.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val raw = prefs.getString(KEY_QUEUE, null) ?: return
      val arr = JSONArray(raw)
      android.util.Log.d("NitroWS", "Auto-prewarmer starting — ${arr.length()} URL(s) in queue")
      for (i in 0 until arr.length()) {
        val obj = arr.optJSONObject(i) ?: continue
        val url = obj.optString("url", null) ?: continue
        android.util.Log.d("NitroWS", "Pre-warming $url")
        val protocols = mutableListOf<String>()
        val protocolsArr = obj.optJSONArray("protocols")
        if (protocolsArr != null) {
          for (j in 0 until protocolsArr.length()) {
            protocolsArr.optString(j, null)?.let { protocols.add(it) }
          }
        }
        val headers = mutableMapOf<String, String>()
        val headersObj = obj.optJSONObject("headers")
        if (headersObj != null) {
          headersObj.keys().forEachRemaining { k ->
            headers[k] = headersObj.optString(k, "")
          }
        }
        NitroWebSocketPrewarmer.preWarm(url, protocols, headers)
      }
    } catch (_: Throwable) {
      // Best-effort — never crash the app
    }
  }
}
