package com.margelo.nitro.nitrofetch

/**
 * Direct-dispatch backend for [DevToolsReporter]. Loaded reflectively from the facade
 * via `Class.forName`, so a missing `InspectorNetworkReporter` only prevents *this* class
 * from loading — the facade itself stays intact and degrades to a no-op.
 *
 * Once loaded, every call here is a plain JVM static invoke. No reflection, no boxing,
 * no method-handle lookups. The `@Suppress` annotations bypass RN's `internal` visibility
 * (RN has no public surface here) — this is the documented integration point.
 */
@Suppress("INVISIBLE_MEMBER", "INVISIBLE_REFERENCE")
internal class DevToolsReporterImpl : DevToolsReporter.Impl {
  override fun isDebuggingEnabled(): Boolean =
    com.facebook.react.modules.network.InspectorNetworkReporter.isDebuggingEnabled()

  override fun reportRequestStart(
    requestId: String, url: String, method: String,
    headers: Map<String, String>, body: String, encodedDataLength: Long
  ) {
    com.facebook.react.modules.network.InspectorNetworkReporter.reportRequestStart(
      requestId, url, method, headers, body, encodedDataLength
    )
    com.facebook.react.modules.network.InspectorNetworkReporter.reportConnectionTiming(
      requestId, headers
    )
  }

  override fun reportResponseStart(
    requestId: String, url: String, statusCode: Int,
    headers: Map<String, String>, expectedDataLength: Long
  ) {
    com.facebook.react.modules.network.InspectorNetworkReporter.reportResponseStart(
      requestId, url, statusCode, headers, expectedDataLength
    )
  }

  override fun reportDataReceived(requestId: String, length: Int) {
    com.facebook.react.modules.network.InspectorNetworkReporter.reportDataReceivedImpl(
      requestId, length
    )
  }

  override fun reportResponseEnd(requestId: String, encodedDataLength: Long) {
    com.facebook.react.modules.network.InspectorNetworkReporter.reportResponseEnd(
      requestId, encodedDataLength
    )
  }

  override fun reportRequestFailed(requestId: String, cancelled: Boolean) {
    com.facebook.react.modules.network.InspectorNetworkReporter.reportRequestFailed(
      requestId, cancelled
    )
  }

  override fun storeResponseBody(requestId: String, body: String, base64Encoded: Boolean) {
    com.facebook.react.modules.network.InspectorNetworkReporter.maybeStoreResponseBody(
      requestId, body, base64Encoded
    )
  }

  override fun storeResponseBodyIncremental(requestId: String, data: String) {
    com.facebook.react.modules.network.InspectorNetworkReporter.maybeStoreResponseBodyIncremental(
      requestId, data
    )
  }
}
