package com.margelo.nitro.nitrofetch

import android.util.Log
import android.webkit.CookieManager
import org.json.JSONObject
import org.chromium.net.UrlResponseInfo
import java.net.HttpURLConnection

/**
 * Shared [CookieManager] bridging for Cronet and [HttpURLConnection] token refresh.
 * - Attaches `Cookie` from the jar when the request has no `Cookie` header.
 * - Persists `Set-Cookie` responses; [flush] is applied only when at least one cookie was stored.
 */
internal object NitroCookieSync {
  private const val LOG_TAG = "NitroCookieSync"

  fun hasCookieHeaderInNitroRequest(headers: Array<NitroHeader>?): Boolean {
    return headers?.any { it.key.equals("Cookie", ignoreCase = true) } == true
  }

  fun hasCookieHeaderInJson(reqHeaders: JSONObject?): Boolean {
    if (reqHeaders == null) return false
    return reqHeaders.keys().asSequence().any { it.equals("Cookie", ignoreCase = true) }
  }

  /**
   * If [hasCookieHeader] is false, adds `Cookie` from [CookieManager] for [url] via [addHeader].
   */
  fun attachCookieFromManagerIfMissing(
    url: String,
    hasCookieHeader: Boolean,
    addHeader: (String, String) -> Unit
  ) {
    if (hasCookieHeader) return
    try {
      val jar = CookieManager.getInstance()
      val cookieHeader = jar.getCookie(url)
      if (!cookieHeader.isNullOrEmpty()) {
        addHeader("Cookie", cookieHeader)
      }
    } catch (exception: Exception) {
      Log.w(LOG_TAG, "Failed to attach cookie header", exception)
    }
  }

  /**
   * Applies `Set-Cookie` headers from a Cronet [UrlResponseInfo] into [CookieManager].
   * @param flush If true, [CookieManager.flush] runs only when at least one cookie was applied.
   * Use `flush = false` on redirects so persistence happens once on the final response.
   * @return true if at least one `Set-Cookie` was stored.
   */
  fun storeSetCookieFromUrlResponseInfo(
    responseUrl: String,
    info: UrlResponseInfo,
    flush: Boolean
  ): Boolean {
    return try {
      val cookieManager = CookieManager.getInstance()
      val setCookieHeaders = info.allHeadersAsList.filter {
        it.key.equals("Set-Cookie", ignoreCase = true)
      }
      if (setCookieHeaders.isEmpty()) return false
      for (header in setCookieHeaders) {
        cookieManager.setCookie(responseUrl, header.value)
      }
      if (flush) {
        cookieManager.flush()
      }
      true
    } catch (exception: Exception) {
      Log.w(LOG_TAG, "Failed to store response cookies", exception)
      false
    }
  }

  /**
   * Applies `Set-Cookie` from an [HttpURLConnection] response into [CookieManager].
   * @param flush If true, [CookieManager.flush] runs only when at least one cookie was applied.
   */
  fun storeSetCookieFromHttpURLConnection(
    urlStr: String,
    conn: HttpURLConnection,
    flush: Boolean
  ): Boolean {
    return try {
      val cookieManager = CookieManager.getInstance()
      var anySet = false
      conn.headerFields?.forEach { (key, values) ->
        if (key?.equals("Set-Cookie", ignoreCase = true) == true) {
          values.forEach { cookieValue ->
            cookieManager.setCookie(urlStr, cookieValue)
            anySet = true
          }
        }
      }
      if (anySet && flush) {
        cookieManager.flush()
      }
      anySet
    } catch (exception: Exception) {
      Log.w(LOG_TAG, "Failed to store response cookies (HttpURLConnection)", exception)
      false
    }
  }

  /** Persists in-memory cookie updates to disk (call after a successful request when any `Set-Cookie` was applied). */
  fun flushCookieManager() {
    try {
      CookieManager.getInstance().flush()
    } catch (exception: Exception) {
      Log.w(LOG_TAG, "Failed to flush CookieManager", exception)
    }
  }
}
