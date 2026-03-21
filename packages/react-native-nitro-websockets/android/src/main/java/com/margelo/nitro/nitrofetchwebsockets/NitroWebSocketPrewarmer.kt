package com.margelo.nitro.nitrofetchwebsockets

/**
 * Pre-warms a WebSocket connection before React Native / Nitro is initialized.
 *
 * Call [preWarm] from your `Application.onCreate()` with the WebSocket URL
 * your app will connect to. By the time the JS layer boots and creates a
 * `NitroWebSocket` for the same URL, the TLS handshake will already be done
 * and the connection will be instantly adopted (OPEN state).
 *
 * Example (MainApplication.kt):
 * ```
 * override fun onCreate() {
 *   super.onCreate()
 *   NitroWebSocketPrewarmer.preWarm("wss://api.example.com")
 *   // ... rest of setup
 * }
 * ```
 */
object NitroWebSocketPrewarmer {

  /**
   * Eagerly open a WebSocket connection to [url] before React Native starts.
   *
   * @param url       The WebSocket URL (ws:// or wss://)
   * @param protocols Optional list of subprotocols
   */
  @JvmStatic
  fun preWarm(url: String, protocols: List<String> = emptyList()) {
    // Load the native library if it hasn't been loaded yet.
    // System.loadLibrary is idempotent — safe to call multiple times.
    try {
      System.loadLibrary("NitroFetchWebsockets")
    } catch (_: UnsatisfiedLinkError) {
      // Already loaded — ignore.
    }
    nativePreWarm(url, protocols.toTypedArray())
  }

  @JvmStatic
  private external fun nativePreWarm(url: String, protocols: Array<String>)
}
