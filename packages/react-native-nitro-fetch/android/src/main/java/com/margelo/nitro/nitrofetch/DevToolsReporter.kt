package com.margelo.nitro.nitrofetch

/**
 * Thin facade over React Native's [com.facebook.react.modules.network.InspectorNetworkReporter].
 * All methods are no-ops when the modern CDP debugger is not attached (guarded by
 * `isDebuggingEnabled()` inside RN), so they are safe to call in release builds.
 *
 * The underlying reporter is marked `internal` in RN but is the officially documented
 * Kotlin entry point for third-party networking libraries to surface requests in the
 * Fusebox / RN DevTools Network tab. We intentionally bypass the visibility modifier
 * rather than duplicating the JNI bindings, matching the pattern used by other
 * community HTTP clients. If the class isn't present (RN < 0.76 or a trimmed
 * distribution), every call becomes a no-op.
 */
@Suppress("INVISIBLE_MEMBER", "INVISIBLE_REFERENCE")
internal object DevToolsReporter {
  private val available: Boolean = try {
    Class.forName("com.facebook.react.modules.network.InspectorNetworkReporter")
    true
  } catch (_: Throwable) {
    false
  }

  fun isDebuggingEnabled(): Boolean {
    if (!available) return false
    return try {
      com.facebook.react.modules.network.InspectorNetworkReporter.isDebuggingEnabled()
    } catch (_: Throwable) {
      false
    }
  }

  fun reportRequestStart(
    requestId: String,
    url: String,
    method: String,
    headers: Map<String, String>,
    body: String,
    encodedDataLength: Long
  ) {
    if (!available) return
    try {
      com.facebook.react.modules.network.InspectorNetworkReporter.reportRequestStart(
        requestId, url, method, headers, body, encodedDataLength
      )
      com.facebook.react.modules.network.InspectorNetworkReporter.reportConnectionTiming(requestId, headers)
    } catch (_: Throwable) {
    }
  }

  fun reportResponseStart(
    requestId: String,
    url: String,
    statusCode: Int,
    headers: Map<String, String>,
    expectedDataLength: Long
  ) {
    if (!available) return
    try {
      com.facebook.react.modules.network.InspectorNetworkReporter.reportResponseStart(
        requestId, url, statusCode, headers, expectedDataLength
      )
    } catch (_: Throwable) {
    }
  }

  fun reportDataReceived(requestId: String, length: Int) {
    if (!available) return
    try {
      com.facebook.react.modules.network.InspectorNetworkReporter.reportDataReceivedImpl(requestId, length)
    } catch (_: Throwable) {
    }
  }

  fun reportResponseEnd(requestId: String, encodedDataLength: Long) {
    if (!available) return
    try {
      com.facebook.react.modules.network.InspectorNetworkReporter.reportResponseEnd(requestId, encodedDataLength)
    } catch (_: Throwable) {
    }
  }

  fun reportRequestFailed(requestId: String, cancelled: Boolean) {
    if (!available) return
    try {
      com.facebook.react.modules.network.InspectorNetworkReporter.reportRequestFailed(requestId, cancelled)
    } catch (_: Throwable) {
    }
  }

  fun storeResponseBody(requestId: String, body: String, base64Encoded: Boolean) {
    if (!available) return
    try {
      com.facebook.react.modules.network.InspectorNetworkReporter.maybeStoreResponseBody(
        requestId, body, base64Encoded
      )
    } catch (_: Throwable) {
    }
  }

  fun storeResponseBodyIncremental(requestId: String, data: String) {
    if (!available) return
    try {
      com.facebook.react.modules.network.InspectorNetworkReporter.maybeStoreResponseBodyIncremental(requestId, data)
    } catch (_: Throwable) {
    }
  }

  fun isTextualContentType(contentType: String?): Boolean {
    if (contentType == null) return false
    val ct = contentType.lowercase()
    return ct.startsWith("text/") ||
      ct.contains("application/json") ||
      ct.contains("application/xml") ||
      ct.contains("application/javascript") ||
      ct.contains("+json") ||
      ct.contains("+xml")
  }

  fun headersArrayToMap(headers: Array<NitroHeader>?): Map<String, String> {
    if (headers == null) return emptyMap()
    val map = LinkedHashMap<String, String>(headers.size)
    for (h in headers) map[h.key] = h.value
    return map
  }

  fun headersListToMap(entries: List<Map.Entry<String, String>>): Map<String, String> {
    val map = LinkedHashMap<String, String>(entries.size)
    for (e in entries) map[e.key] = e.value
    return map
  }
}
