package com.margelo.nitro.nitrofetch

import com.margelo.nitro.nitrofetch.exceptions.NitroRequestException
import org.chromium.net.UrlResponseInfo as CronetUrlResponseInfo
import org.chromium.net.CronetException as CronetNativeException
import org.chromium.net.NetworkException as CronetNetworkException
import org.chromium.net.QuicException as CronetQuicException
import org.chromium.net.CallbackException as CronetCallbackException
import org.chromium.net.InlineExecutionProhibitedException as CronetInlineExecutionProhibitedException

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

fun CronetNativeException.toNitro(): HybridRequestExceptionSpec {
  val internalErrorCode = try {
    val field = CronetNativeException::class.java.getDeclaredField("mCronetInternalErrorCode")
    field.isAccessible = true
    (field.get(this) as? Int)?.toDouble() ?: 0.0
  } catch (e: Exception) {
    0.0
  }

  return when (this) {
    is CronetNetworkException -> {
      NitroRequestException.network(
        message = message ?: "Network error",
        internalErrorCode = internalErrorCode,
        networkErrorCode = errorCode.toDouble()
      )
    }
    is CronetQuicException -> {
      NitroRequestException.quic(
        message = message ?: "QUIC error",
        internalErrorCode = internalErrorCode,
        quicErrorCode = quicDetailedErrorCode.toDouble()
      )
    }
    is CronetCallbackException -> {
      NitroRequestException.callback(
        message = message ?: "Callback error",
        internalErrorCode = internalErrorCode,
        causeMessage = cause?.message
      )
    }
    is CronetInlineExecutionProhibitedException -> {
      NitroRequestException.inlineExecution(
        message = message ?: "Inline execution prohibited",
        internalErrorCode = internalErrorCode
      )
    }
    else -> {
      NitroRequestException.cronet(
        message = message ?: "Unknown Cronet error",
        internalErrorCode = internalErrorCode
      )
    }
  }
}
