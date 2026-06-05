package com.margelo.nitro.nitrofetch

import java.lang.reflect.Method


internal class DevToolsReporterImpl : DevToolsReporter.Impl {
  private val cls = Class.forName("com.facebook.react.modules.network.InspectorNetworkReporter")

  private fun m(name: String): Method = cls.methods.first { it.name == name }

  // All targets are `public static final` on the reporter object — invoke with a null receiver.
  private val mIsDebuggingEnabled = m("isDebuggingEnabled")
  private val mReportRequestStart = m("reportRequestStart")
  private val mReportConnectionTiming = m("reportConnectionTiming")
  private val mReportResponseStart = m("reportResponseStart")
  private val mReportDataReceivedImpl = m("reportDataReceivedImpl")
  private val mReportResponseEnd = m("reportResponseEnd")
  private val mReportRequestFailed = m("reportRequestFailed")
  private val mMaybeStoreResponseBody = m("maybeStoreResponseBody")
  private val mMaybeStoreResponseBodyIncremental = m("maybeStoreResponseBodyIncremental")

  override fun isDebuggingEnabled(): Boolean = mIsDebuggingEnabled.invoke(null) as Boolean

  override fun reportRequestStart(
    requestId: String, url: String, method: String,
    headers: Map<String, String>, body: String, encodedDataLength: Long
  ) {
    mReportRequestStart.invoke(null, requestId, url, method, headers, body, encodedDataLength)
    mReportConnectionTiming.invoke(null, requestId, headers)
  }

  override fun reportResponseStart(
    requestId: String, url: String, statusCode: Int,
    headers: Map<String, String>, expectedDataLength: Long
  ) {
    mReportResponseStart.invoke(null, requestId, url, statusCode, headers, expectedDataLength)
  }

  override fun reportDataReceived(requestId: String, length: Int) {
    mReportDataReceivedImpl.invoke(null, requestId, length)
  }

  override fun reportResponseEnd(requestId: String, encodedDataLength: Long) {
    mReportResponseEnd.invoke(null, requestId, encodedDataLength)
  }

  override fun reportRequestFailed(requestId: String, cancelled: Boolean) {
    mReportRequestFailed.invoke(null, requestId, cancelled)
  }

  override fun storeResponseBody(requestId: String, body: String, base64Encoded: Boolean) {
    mMaybeStoreResponseBody.invoke(null, requestId, body, base64Encoded)
  }

  override fun storeResponseBodyIncremental(requestId: String, data: String) {
    mMaybeStoreResponseBodyIncremental.invoke(null, requestId, data)
  }
}
