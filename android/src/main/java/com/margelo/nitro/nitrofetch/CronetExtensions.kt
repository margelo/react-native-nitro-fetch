package com.margelo.nitro.nitrofetch

import com.margelo.nitro.nitrofetch.exceptions.NitroCronetException
import com.margelo.nitro.nitrofetch.exceptions.NitroNetworkException
import com.margelo.nitro.nitrofetch.exceptions.NitroQuicException
import com.margelo.nitro.nitrofetch.exceptions.NitroCallbackException
import com.margelo.nitro.nitrofetch.exceptions.NitroInlineExecutionProhibitedException
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

fun CronetNativeException.toNitro(): HybridCronetExceptionSpec {
  val internalErrorCode = try {
    val field = CronetNativeException::class.java.getDeclaredField("mCronetInternalErrorCode")
    field.isAccessible = true
    (field.get(this) as? Int)?.toDouble() ?: 0.0
  } catch (e: Exception) {
    0.0
  }

  return when (this) {
    is CronetNetworkException -> {
      NitroNetworkException(
        msg = message ?: "Network error",
        internalErrCode = internalErrorCode,
        errCode = errorCode.toDouble()
      )
    }
    is CronetQuicException -> {
      NitroQuicException(
        msg = message ?: "QUIC error",
        internalErrCode = internalErrorCode,
        quicErrCode = quicDetailedErrorCode.toDouble()
      )
    }
    is CronetCallbackException -> {
      NitroCallbackException(
        msg = message ?: "Callback error",
        internalErrCode = internalErrorCode,
        causeMsg = cause?.message
      )
    }
    is CronetInlineExecutionProhibitedException -> {
      NitroInlineExecutionProhibitedException(
        msg = message ?: "Inline execution prohibited",
        internalErrCode = internalErrorCode
      )
    }
    else -> {
      NitroCronetException(
        msg = message ?: "Unknown Cronet error",
        internalErrCode = internalErrorCode
      )
    }
  }
}
