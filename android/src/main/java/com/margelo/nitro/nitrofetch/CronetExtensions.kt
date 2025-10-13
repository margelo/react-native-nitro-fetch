package com.margelo.nitro.nitrofetch

import org.chromium.net.UrlResponseInfo as CronetUrlResponseInfo
import org.chromium.net.CronetException as CronetNativeException

/**
 * Extension functions to convert between Cronet native types and Nitro types.
 */

/**
 * Convert Cronet's native UrlResponseInfo to Nitro's UrlResponseInfo.
 */
fun CronetUrlResponseInfo.toNitro(): UrlResponseInfo {
  val headersMap = mutableMapOf<String, String>()
  val headersList = mutableListOf<HttpHeader>()

  allHeadersAsList.forEach { header ->
    headersMap[header.key] = header.value
    headersList.add(HttpHeader(key = header.key, value = header.value))
  }

  return UrlResponseInfo(
    url = url,
    httpStatusCode = httpStatusCode.toDouble(),
    httpStatusText = httpStatusText ?: "",
    allHeaders = headersMap,
    allHeadersAsList = headersList.toTypedArray(),
    urlChain = urlChain.toTypedArray(),
    negotiatedProtocol = negotiatedProtocol,
    proxyServer = proxyServer,
    receivedByteCount = receivedByteCount.toDouble(),
    wasCached = wasCached()
  )
}

/**
 * Convert Cronet's native CronetException to Nitro's CronetException.
 */
fun CronetNativeException.toNitro(): CronetException {
  return CronetException(
    message = message ?: "Unknown Cronet error"
  )
}
