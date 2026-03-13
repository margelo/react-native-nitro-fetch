package com.margelo.nitro.nitrofetch.exceptions

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.nitrofetch.ErrorType
import com.margelo.nitro.nitrofetch.ExceptionPlatform
import com.margelo.nitro.nitrofetch.RequestException

/**
 * Factory for creating RequestException instances on Android.
 * This object provides convenient factory methods for creating RequestException instances
 * with Android-specific details for different error types (network, QUIC, callback, etc.).
 */
@DoNotStrip
object NitroRequestException {
  /**
   * Create a Cronet base exception
   */
  fun cronet(
      message: String,
      internalErrorCode: Double
    ): RequestException {
      return RequestException(
        platform = ExceptionPlatform.ANDROID_PLATFORM,
        message = message,
        code = internalErrorCode,
        errorType = ErrorType.CRONET,
        internalErrorCode = internalErrorCode,
        networkErrorCode = null,
        quicErrorCode = null,
        stackTrace = null,
        errorDomain = null,
        localizedDescription = null,
        underlyingError = null,
        failingURL = null,
        causeMessage = null
      )
    }

    /**
     * Create a network exception with detailed network error code
     */
    fun network(
      message: String,
      internalErrorCode: Double,
      networkErrorCode: Double
    ): RequestException {
      return RequestException(
        platform = ExceptionPlatform.ANDROID_PLATFORM,
        message = message,
        code = networkErrorCode,
        errorType = ErrorType.NETWORK,
        internalErrorCode = internalErrorCode,
        networkErrorCode = networkErrorCode,
        quicErrorCode = null,
        stackTrace = null,
        errorDomain = null,
        localizedDescription = null,
        underlyingError = null,
        failingURL = null,
        causeMessage = null
      )
    }

    /**
     * Create a QUIC exception with QUIC-specific error details
     */
    fun quic(
      message: String,
      internalErrorCode: Double,
      quicErrorCode: Double
    ): RequestException {
      return RequestException(
        platform = ExceptionPlatform.ANDROID_PLATFORM,
        message = message,
        code = quicErrorCode,
        errorType = ErrorType.QUIC,
        internalErrorCode = internalErrorCode,
        networkErrorCode = null,
        quicErrorCode = quicErrorCode,
        stackTrace = null,
        errorDomain = null,
        localizedDescription = null,
        underlyingError = null,
        failingURL = null,
        causeMessage = null
      )
    }

    /**
     * Create a callback exception (error in user callback code)
     */
    fun callback(
      message: String,
      internalErrorCode: Double,
      causeMessage: String?
    ): RequestException {
      return RequestException(
        platform = ExceptionPlatform.ANDROID_PLATFORM,
        message = message,
        code = internalErrorCode,
        errorType = ErrorType.CALLBACK,
        internalErrorCode = internalErrorCode,
        networkErrorCode = null,
        quicErrorCode = null,
        stackTrace = null,
        errorDomain = null,
        localizedDescription = null,
        underlyingError = null,
        failingURL = null,
        causeMessage = causeMessage
      )
    }

    /**
     * Create a security exception (SSL/TLS errors)
     */
    fun security(
      message: String,
      internalErrorCode: Double
    ): RequestException {
      return RequestException(
        platform = ExceptionPlatform.ANDROID_PLATFORM,
        message = message,
        code = internalErrorCode,
        errorType = ErrorType.SECURITY,
        internalErrorCode = internalErrorCode,
        networkErrorCode = null,
        quicErrorCode = null,
        stackTrace = null,
        errorDomain = null,
        localizedDescription = null,
        underlyingError = null,
        failingURL = null,
        causeMessage = null
      )
    }

    /**
     * Create an inline execution prohibited exception
     */
    fun inlineExecution(
      message: String,
      internalErrorCode: Double
    ): RequestException {
      return RequestException(
        platform = ExceptionPlatform.ANDROID_PLATFORM,
        message = message,
        code = internalErrorCode,
        errorType = ErrorType.INLINEEXECUTION,
        internalErrorCode = internalErrorCode,
        networkErrorCode = null,
        quicErrorCode = null,
        stackTrace = null,
        errorDomain = null,
        localizedDescription = null,
        underlyingError = null,
        failingURL = null,
        causeMessage = null
      )
    }

    /**
     * Create a generic exception with optional stack trace
     */
    fun other(
      message: String,
      errorCode: Double,
      throwable: Throwable? = null
    ): RequestException {
      return RequestException(
        platform = ExceptionPlatform.ANDROID_PLATFORM,
        message = message,
        code = errorCode,
        errorType = ErrorType.OTHER,
        internalErrorCode = null,
        networkErrorCode = null,
        quicErrorCode = null,
        stackTrace = throwable?.stackTraceToString(),
        errorDomain = null,
        localizedDescription = null,
        underlyingError = null,
        failingURL = null,
        causeMessage = throwable?.message
      )
    }

    /**
     * Create an exception from a Throwable
     */
    fun from(throwable: Throwable): RequestException {
      return other(
        message = throwable.message ?: "Unknown error",
        errorCode = -1.0,
        throwable = throwable
      )
    }
}
