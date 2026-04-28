package com.margelo.nitro.nitrofetch

/**
 * Thin facade over React Native's `com.facebook.react.modules.network.InspectorNetworkReporter`.
 *
 * The reporter is `internal` in RN and may be missing entirely on older versions or stripped
 * distributions. To stay both safe (no [NoClassDefFoundError]) and fast (no per-call reflection
 * once the class is known to exist), we use the **isolation-class pattern**:
 *
 *  - This facade has *no* compile-time reference to `InspectorNetworkReporter`. It can always
 *    be loaded and verified by ART, even when the reporter is absent.
 *  - All direct calls live in [DevToolsReporterImpl], which is loaded reflectively *once* via
 *    `Class.forName`. If verification fails (missing class), we catch and stay in no-op mode.
 *  - On success, we hold an [Impl] interface reference and dispatch through it on every call —
 *    a single null check + a virtual call (likely devirtualized by the JIT). No reflection,
 *    no boxing, no method-handle lookups on the hot path.
 */
internal object DevToolsReporter {

  /** Stable interface in *our* package — Impl implements it; no foreign types here. */
  internal interface Impl {
    fun isDebuggingEnabled(): Boolean
    fun reportRequestStart(
      requestId: String, url: String, method: String,
      headers: Map<String, String>, body: String, encodedDataLength: Long
    )
    fun reportResponseStart(
      requestId: String, url: String, statusCode: Int,
      headers: Map<String, String>, expectedDataLength: Long
    )
    fun reportDataReceived(requestId: String, length: Int)
    fun reportResponseEnd(requestId: String, encodedDataLength: Long)
    fun reportRequestFailed(requestId: String, cancelled: Boolean)
    fun storeResponseBody(requestId: String, body: String, base64Encoded: Boolean)
    fun storeResponseBodyIncremental(requestId: String, data: String)
  }

  @Volatile private var impl: Impl? = null
  // We deliberately do NOT latch failure: cold-start prefetch can run before
  // RN classes are realized, and we want a later request to recover. The
  // probe is cheap (Class.forName has its own internal cache).
  private fun resolve(): Impl? {
    val cached = impl
    if (cached != null) return cached

    if (!isSoLoaderInitialized()) return null
    return try {
      val cls = Class.forName("com.margelo.nitro.nitrofetch.DevToolsReporterImpl")
  
      val created = cls.getDeclaredConstructor().newInstance() as Impl
      impl = created
      created
    } catch (_: Throwable) {
      null
    }
  }

  private fun isSoLoaderInitialized(): Boolean = try {
    com.facebook.soloader.SoLoader.isInitialized()
  } catch (_: Throwable) {
    false
  }

  // --- Hot path: one null check + interface call. JIT will devirtualize. ---

  fun isDebuggingEnabled(): Boolean = resolve()?.isDebuggingEnabled() ?: false

  fun reportRequestStart(
    requestId: String, url: String, method: String,
    headers: Map<String, String>, body: String, encodedDataLength: Long
  ) {
    impl?.reportRequestStart(requestId, url, method, headers, body, encodedDataLength)
  }

  fun reportResponseStart(
    requestId: String, url: String, statusCode: Int,
    headers: Map<String, String>, expectedDataLength: Long
  ) {
    impl?.reportResponseStart(requestId, url, statusCode, headers, expectedDataLength)
  }

  fun reportDataReceived(requestId: String, length: Int) {
    impl?.reportDataReceived(requestId, length)
  }

  fun reportResponseEnd(requestId: String, encodedDataLength: Long) {
    impl?.reportResponseEnd(requestId, encodedDataLength)
  }

  fun reportRequestFailed(requestId: String, cancelled: Boolean) {
    impl?.reportRequestFailed(requestId, cancelled)
  }

  fun storeResponseBody(requestId: String, body: String, base64Encoded: Boolean) {
    impl?.storeResponseBody(requestId, body, base64Encoded)
  }

  fun storeResponseBodyIncremental(requestId: String, data: String) {
    impl?.storeResponseBodyIncremental(requestId, data)
  }

  // --- Pure helpers, no reporter dependency. ---

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
