package com.margelo.nitro.nitrofetch.exceptions

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.nitrofetch.ErrorType
import com.margelo.nitro.nitrofetch.ExceptionPlatform
import com.margelo.nitro.nitrofetch.HybridRequestExceptionSpec

/**
 * Unified request exception for Android that implements the HybridRequestExceptionSpec.
 * This class consolidates all error types (network, QUIC, callback, etc.) into a single
 * exception type with Android-specific details.
 */
@DoNotStrip
class NitroRequestException private constructor(
  private val msg: String,
  private val errorCode: Double,
  private val errType: ErrorType,
  private val internalErrCode: Double? = null,
  private val networkErrCode: Double? = null,
  private val quicErrCode: Double? = null,
  private val cause: String? = null,
  private val stackTraceString: String? = null
) : HybridRequestExceptionSpec() {

  override val platform: ExceptionPlatform
    get() = ExceptionPlatform.ANDROID_PLATFORM

  override val message: String
    get() = msg

  override val code: Double
    get() = errorCode

  override val errorType: ErrorType
    get() = errType

  override val internalErrorCode: Double?
    get() = internalErrCode

  override val networkErrorCode: Double?
    get() = networkErrCode

  override val quicErrorCode: Double?
    get() = quicErrCode

  override val causeMessage: String?
    get() = cause

  override val stackTrace: String?
    get() = stackTraceString

  override val errorDomain: Double?
    get() = null

  override val localizedDescription: String?
    get() = null

  override val underlyingError: String?
    get() = null

  override val failingURL: String?
    get() = null

  companion object {
    /**
     * Create a Cronet base exception
     */
    fun cronet(
      message: String,
      internalErrorCode: Double
    ): NitroRequestException {
      return NitroRequestException(
        msg = message,
        errorCode = internalErrorCode,
        errType = ErrorType.CRONET,
        internalErrCode = internalErrorCode
      )
    }

    /**
     * Create a network exception with detailed network error code
     */
    fun network(
      message: String,
      internalErrorCode: Double,
      networkErrorCode: Double
    ): NitroRequestException {
      return NitroRequestException(
        msg = message,
        errorCode = networkErrorCode,
        errType = ErrorType.NETWORK,
        internalErrCode = internalErrorCode,
        networkErrCode = networkErrorCode
      )
    }

    /**
     * Create a QUIC exception with QUIC-specific error details
     */
    fun quic(
      message: String,
      internalErrorCode: Double,
      quicErrorCode: Double
    ): NitroRequestException {
      return NitroRequestException(
        msg = message,
        errorCode = quicErrorCode,
        errType = ErrorType.QUIC,
        internalErrCode = internalErrorCode,
        quicErrCode = quicErrorCode
      )
    }

    /**
     * Create a callback exception (error in user callback code)
     */
    fun callback(
      message: String,
      internalErrorCode: Double,
      causeMessage: String?
    ): NitroRequestException {
      return NitroRequestException(
        msg = message,
        errorCode = internalErrorCode,
        errType = ErrorType.CALLBACK,
        internalErrCode = internalErrorCode,
        cause = causeMessage
      )
    }

    /**
     * Create a security exception (SSL/TLS errors)
     */
    fun security(
      message: String,
      internalErrorCode: Double
    ): NitroRequestException {
      return NitroRequestException(
        msg = message,
        errorCode = internalErrorCode,
        errType = ErrorType.SECURITY,
        internalErrCode = internalErrorCode
      )
    }

    /**
     * Create an inline execution prohibited exception
     */
    fun inlineExecution(
      message: String,
      internalErrorCode: Double
    ): NitroRequestException {
      return NitroRequestException(
        msg = message,
        errorCode = internalErrorCode,
        errType = ErrorType.INLINEEXECUTION,
        internalErrCode = internalErrorCode
      )
    }

    /**
     * Create a generic exception with optional stack trace
     */
    fun other(
      message: String,
      errorCode: Double,
      throwable: Throwable? = null
    ): NitroRequestException {
      return NitroRequestException(
        msg = message,
        errorCode = errorCode,
        errType = ErrorType.OTHER,
        cause = throwable?.message,
        stackTraceString = throwable?.stackTraceToString()
      )
    }

    /**
     * Create an exception from a Throwable
     */
    fun from(throwable: Throwable): NitroRequestException {
      return other(
        message = throwable.message ?: "Unknown error",
        errorCode = -1.0,
        throwable = throwable
      )
    }
  }
}
