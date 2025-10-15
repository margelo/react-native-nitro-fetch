package com.margelo.nitro.nitrofetch.exceptions

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.nitrofetch.HybridNetworkExceptionSpec

/**
 * Network exception with detailed error codes.
 *
 * Error codes:
 * - 0: ERROR_HOSTNAME_NOT_RESOLVED
 * - 1: ERROR_INTERNET_DISCONNECTED
 * - 2: ERROR_NETWORK_CHANGED
 * - 3: ERROR_TIMED_OUT
 * - 4: ERROR_CONNECTION_CLOSED
 * - 5: ERROR_CONNECTION_TIMED_OUT
 * - 6: ERROR_CONNECTION_REFUSED
 * - 7: ERROR_CONNECTION_RESET
 * - 8: ERROR_ADDRESS_UNREACHABLE
 * - 9: ERROR_QUIC_PROTOCOL_FAILED
 * - 10: ERROR_OTHER
 */
@DoNotStrip
class NitroNetworkException(
  private val msg: String,
  private val internalErrCode: Double,
  private val errCode: Double
) : HybridNetworkExceptionSpec() {

  override val message: String
    get() = msg

  override val internalErrorCode: Double
    get() = internalErrCode

  override val errorCode: Double
    get() = errCode
}
