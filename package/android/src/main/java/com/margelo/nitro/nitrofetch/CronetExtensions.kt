package com.margelo.nitro.nitrofetch

import org.chromium.net.UrlResponseInfo as CronetUrlResponseInfo
import org.chromium.net.CronetException as CronetNativeException

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

fun CronetNativeException.toNitro(): RequestException {
  return RequestException(message = message ?: "Unknown Cronet error")
}
