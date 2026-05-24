package com.margelo.nitro.nitrofetch

import android.app.Application
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CompletableFuture


object AutoPrefetcher {
  @Volatile private var initialized = false
  private const val KEY_QUEUE = "nitrofetch_autoprefetch_queue"
  private const val KEY_TOKEN_REFRESH = "nitro_token_refresh_fetch"
  private const val KEY_TOKEN_CACHE = "nitro_token_refresh_fetch_cache"
  private const val PREFS_NAME = NitroFetchSecureAtRest.PREFS_NAME

  /**
   * Register a URL to prefetch on app start. Call from `Application.onCreate()`
   * BEFORE `prefetchOnStart(this)`. Writes to the same persistent queue used by
   * the JS `prefetchOnAppStart` API; entries are deduped by `prefetchKey`.
   *
   * If called after `prefetchOnStart` already ran (late registration), the
   * entry is also kicked immediately via `NitroFetchClient.fetch` so the
   * current session benefits without waiting for the next cold launch.
   */
  @JvmStatic
  @JvmOverloads
  fun registerPrefetch(
    context: Context,
    url: String,
    prefetchKey: String,
    headers: Map<String, String> = emptyMap(),
    method: String? = null,
    bodyString: String? = null,
    bodyBytes: String? = null,
    bodyFormData: List<Map<String, String?>>? = null,
    timeoutMs: Double? = null,
    followRedirects: Boolean? = null,
    prefetchCacheTtlMs: Double? = null,
  ) {
    if (url.isEmpty() || prefetchKey.isEmpty()) return
    val entry = buildEntryJson(
      url, prefetchKey, headers,
      method, bodyString, bodyBytes, bodyFormData, timeoutMs, followRedirects,
      prefetchCacheTtlMs
    )
    try {
      val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val raw = prefs.getString(KEY_QUEUE, null) ?: ""
      val arr = if (raw.isEmpty()) JSONArray() else try { JSONArray(raw) } catch (_: Throwable) { JSONArray() }

      val next = JSONArray()
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        if (o.optString("prefetchKey", "") == prefetchKey) continue
        next.put(o)
      }
      next.put(entry)
      prefs.edit().putString(KEY_QUEUE, next.toString()).apply()
    } catch (_: Throwable) {
      // best-effort
    }

    if (initialized) {
      // late path — kick a single immediate prefetch with cached token headers
      try {
        val prefs = context.applicationContext
          .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val cacheRaw = NitroFetchSecureAtRest.getDecryptedForPrefs(prefs, KEY_TOKEN_CACHE)
        val tokenHeaders: Map<String, String> = if (!cacheRaw.isNullOrEmpty()) {
          try {
            val co = JSONObject(cacheRaw)
            co.keys().asSequence().associateWith { k -> co.optString(k, "") }
          } catch (_: Throwable) { emptyMap() }
        } else emptyMap()

        val single = JSONArray().apply { put(entry) }
        startPrefetches(single, tokenHeaders)
      } catch (_: Throwable) {}
    }
  }

  fun prefetchOnStart(app: Application) {
    if (initialized) return
    initialized = true
    try {
      val prefs = app.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val raw = prefs.getString(KEY_QUEUE, null) ?: ""
      if (raw.isEmpty()) return
      val arr = JSONArray(raw)

      val refreshRaw = NitroFetchSecureAtRest.getDecryptedForPrefs(prefs, KEY_TOKEN_REFRESH)

      if (!refreshRaw.isNullOrEmpty()) {
        // Token refresh requires a network call — run everything on a background thread
        Thread {
          try {
            val refreshConfig = JSONObject(refreshRaw)
            val onFailure = refreshConfig.optString("onFailure", "useStoredHeaders")
            val refreshURL = refreshConfig.optString("url", "(unknown)")
            android.util.Log.d("NitroFetch", "[TokenRefresh] Calling refresh endpoint: $refreshURL")

            val refreshed = callTokenRefreshSync(refreshConfig)

            val tokenHeaders: Map<String, String> = if (refreshed != null) {
              android.util.Log.d("NitroFetch", "[TokenRefresh] ✅ Success — got ${refreshed.size} header(s)")
              refreshed.forEach { (k, v) -> android.util.Log.d("NitroFetch", "[TokenRefresh]   $k: $v") }
              // Cache fresh token headers for useStoredHeaders fallback on next cold start
              val cacheJson = JSONObject()
              refreshed.forEach { (k, v) -> cacheJson.put(k, v) }
              NitroFetchSecureAtRest.putEncrypted(prefs, KEY_TOKEN_CACHE, cacheJson.toString())
              refreshed
            } else {
              android.util.Log.d("NitroFetch", "[TokenRefresh] ❌ Refresh failed — onFailure: $onFailure")
              if (onFailure == "skip") {
                android.util.Log.d("NitroFetch", "[TokenRefresh] Skipping all prefetches")
                return@Thread
              }
              // Use last cached token headers (or empty map if none cached yet)
              val cacheRaw = NitroFetchSecureAtRest.getDecryptedForPrefs(prefs, KEY_TOKEN_CACHE)
              val cached = if (cacheRaw != null) {
                try {
                  val co = JSONObject(cacheRaw)
                  co.keys().asSequence().associateWith { k -> co.optString(k, "") }
                } catch (_: Throwable) { emptyMap() }
              } else {
                emptyMap()
              }
              android.util.Log.d("NitroFetch", "[TokenRefresh] Using cached headers (${cached.size} header(s))")
              cached
            }

            android.util.Log.d("NitroFetch", "[TokenRefresh] Injecting token headers into ${arr.length()} prefetch URL(s)")
            startPrefetches(arr, tokenHeaders)
          } catch (_: Throwable) {
            // Best-effort — never crash the app
          }
        }.start()
      } else {
        // No token refresh config — proceed on current thread (Cronet is async)
        startPrefetches(arr, emptyMap())
      }
    } catch (_: Throwable) {
      // ignore – prefetch-on-start is best-effort
    }
  }

  private fun startPrefetches(arr: JSONArray, tokenHeaders: Map<String, String>) {
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      val url = o.optString("url", null) ?: continue
      val prefetchKey = o.optString("prefetchKey", null) ?: continue
      val headersObj = o.optJSONObject("headers") ?: JSONObject()

      // Merge: static headers first, token headers override
      val merged = mutableMapOf<String, String>()
      headersObj.keys().forEachRemaining { k ->
        merged[k] = headersObj.optString(k, "")
      }
      tokenHeaders.forEach { (k, v) -> merged[k] = v }
      merged["prefetchKey"] = prefetchKey

      android.util.Log.d("NitroFetch", "[TokenRefresh] Prefetching $url with ${merged.size} header(s)")
      merged.forEach { (k, v) -> android.util.Log.d("NitroFetch", "[TokenRefresh]   $k: $v") }
      val req = buildNitroRequestFromEntry(url, merged, o)

      if (FetchCache.getPending(prefetchKey) != null) continue
      val entryTtlMs = if (o.has("prefetchCacheTtlMs") && !o.isNull("prefetchCacheTtlMs")) {
        o.optDouble("prefetchCacheTtlMs").toLong()
      } else 5_000L
      if (FetchCache.hasFreshResult(prefetchKey, entryTtlMs)) continue

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
  }

  private fun buildEntryJson(
    url: String,
    prefetchKey: String,
    headers: Map<String, String>,
    method: String?,
    bodyString: String?,
    bodyBytes: String?,
    bodyFormData: List<Map<String, String?>>?,
    timeoutMs: Double?,
    followRedirects: Boolean?,
    prefetchCacheTtlMs: Double? = null,
  ): JSONObject {
    val headersObj = JSONObject()
    headers.forEach { (k, v) -> headersObj.put(k, v) }
    return JSONObject().apply {
      put("url", url)
      put("prefetchKey", prefetchKey)
      put("headers", headersObj)
      if (method != null && method.isNotEmpty() && method != "GET") put("method", method)
      if (bodyString != null) put("bodyString", bodyString)
      if (bodyBytes != null) put("bodyBytes", bodyBytes)
      if (!bodyFormData.isNullOrEmpty()) {
        val arr = JSONArray()
        bodyFormData.forEach { part ->
          val obj = JSONObject()
          part["name"]?.let { obj.put("name", it) }
          part["value"]?.let { obj.put("value", it) }
          part["fileUri"]?.let { obj.put("fileUri", it) }
          part["fileName"]?.let { obj.put("fileName", it) }
          part["mimeType"]?.let { obj.put("mimeType", it) }
          arr.put(obj)
        }
        put("bodyFormData", arr)
      }
      if (timeoutMs != null) put("timeoutMs", timeoutMs)
      if (followRedirects == false) put("followRedirects", false)
      if (prefetchCacheTtlMs != null) put("prefetchCacheTtlMs", prefetchCacheTtlMs)
    }
  }

  private fun buildNitroRequestFromEntry(
    url: String,
    mergedHeaders: Map<String, String>,
    entry: JSONObject?,
  ): NitroRequest {
    val headerObjs = mergedHeaders.map { (k, v) -> NitroHeader(k, v) }.toTypedArray()

    val methodStr = entry?.optString("method", "")?.takeIf { it.isNotEmpty() }
    val method: NitroRequestMethod? = methodStr?.let {
      runCatching { NitroRequestMethod.valueOf(it) }.getOrNull()
    }
    val bodyString = entry
      ?.takeIf { it.has("bodyString") && !it.isNull("bodyString") }
      ?.optString("bodyString")
    val bodyBytes = entry
      ?.takeIf { it.has("bodyBytes") && !it.isNull("bodyBytes") }
      ?.optString("bodyBytes")
    val timeoutMs = entry
      ?.takeIf { it.has("timeoutMs") && !it.isNull("timeoutMs") }
      ?.optDouble("timeoutMs")
    val followRedirects = entry
      ?.takeIf { it.has("followRedirects") && !it.isNull("followRedirects") }
      ?.optBoolean("followRedirects")
    val prefetchCacheTtlMs = entry
      ?.takeIf { it.has("prefetchCacheTtlMs") && !it.isNull("prefetchCacheTtlMs") }
      ?.optDouble("prefetchCacheTtlMs")

    val formArr = entry?.optJSONArray("bodyFormData")
    val bodyFormData: Array<NitroFormDataPart>? = formArr?.let { ja ->
      Array(ja.length()) { i ->
        val p = ja.optJSONObject(i) ?: JSONObject()
        NitroFormDataPart(
          name = p.optString("name", ""),
          value = if (p.has("value") && !p.isNull("value")) p.optString("value") else null,
          fileUri = if (p.has("fileUri") && !p.isNull("fileUri")) p.optString("fileUri") else null,
          fileName = if (p.has("fileName") && !p.isNull("fileName")) p.optString("fileName") else null,
          mimeType = if (p.has("mimeType") && !p.isNull("mimeType")) p.optString("mimeType") else null
        )
      }
    }

    return NitroRequest(
      url = url,
      method = method,
      headers = headerObjs,
      bodyString = bodyString,
      bodyBytes = bodyBytes,
      bodyFormData = bodyFormData,
      timeoutMs = timeoutMs,
      followRedirects = followRedirects,
      prefetchCacheTtlMs = prefetchCacheTtlMs,
      requestId = null
    )
  }

  // MARK: - Token refresh (synchronous, runs on background thread)

  private fun callTokenRefreshSync(config: JSONObject): Map<String, String>? {
    return try {
      val urlStr = config.optString("url", null) ?: return null
      val method = config.optString("method", "POST")
      val reqHeaders = config.optJSONObject("headers")
      val body = config.optString("body", null)
      val responseType = config.optString("responseType", "json")

      val conn = URL(urlStr).openConnection() as HttpURLConnection
      conn.requestMethod = method
      conn.connectTimeout = 10_000
      conn.readTimeout = 10_000
      conn.doInput = true
      if (body != null) conn.doOutput = true

      reqHeaders?.keys()?.forEachRemaining { k ->
        conn.setRequestProperty(k, reqHeaders.optString(k, ""))
      }

      NitroCookieSync.attachCookieFromManagerIfMissing(
        urlStr,
        NitroCookieSync.hasCookieHeaderInJson(reqHeaders)
      ) { key, value -> conn.setRequestProperty(key, value) }

      if (body != null) {
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      }

      val status = conn.responseCode
      if (status !in 200..299) {
        android.util.Log.d("NitroFetch", "[TokenRefresh] Refresh endpoint returned HTTP $status")
        return null
      }

      NitroCookieSync.storeSetCookieFromHttpURLConnection(conn.url.toString(), conn, flush = true)

      val responseBody = conn.inputStream.use { it.bufferedReader(Charsets.UTF_8).readText() }

      parseTokenResponse(responseBody, responseType, config)
    } catch (_: Throwable) {
      null
    }
  }

  private fun parseTokenResponse(
    body: String,
    responseType: String,
    config: JSONObject
  ): Map<String, String> {
    val result = mutableMapOf<String, String>()

    if (responseType == "text") {
      val textHeader = config.optString("textHeader", null)
      if (textHeader != null) {
        val textTemplate = config.optString("textTemplate", null)
        result[textHeader] = textTemplate?.replace("{{value}}", body) ?: body
      }
      return result
    }

    // JSON
    val json = try { JSONObject(body) } catch (_: Throwable) { return result }

    val mappings = config.optJSONArray("mappings")
    if (mappings != null) {
      for (i in 0 until mappings.length()) {
        val m = mappings.optJSONObject(i) ?: continue
        val jsonPath = m.optString("jsonPath", null) ?: continue
        val header = m.optString("header", null) ?: continue
        val value = getNestedField(json, jsonPath) ?: continue
        val tmpl = m.optString("valueTemplate", null)
        result[header] = tmpl?.replace("{{value}}", value) ?: value
      }
    }

    val compositeHeaders = config.optJSONArray("compositeHeaders")
    if (compositeHeaders != null) {
      for (i in 0 until compositeHeaders.length()) {
        val comp = compositeHeaders.optJSONObject(i) ?: continue
        val header = comp.optString("header", null) ?: continue
        val template = comp.optString("template", null) ?: continue
        val paths = comp.optJSONObject("paths") ?: continue
        var built = template
        paths.keys().forEachRemaining { ph ->
          val val2 = getNestedField(json, paths.optString(ph, ""))
          built = built.replace("{{$ph}}", val2 ?: "")
        }
        result[header] = built
      }
    }

    return result
  }

  private fun getNestedField(obj: JSONObject, dotPath: String): String? {
    val parts = dotPath.split(".")
    var current: Any = obj
    for (part in parts) {
      if (current !is JSONObject) return null
      current = current.opt(part) ?: return null
    }
    return current.toString()
  }
}
