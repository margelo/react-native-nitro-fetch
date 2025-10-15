package com.margelo.nitro.nitrofetch.exceptions

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.nitrofetch.HybridQuicExceptionSpec

/**
 * QUIC protocol exception with QUIC-specific error details.
 */
@DoNotStrip
class NitroQuicException(
  private val msg: String,
  private val internalErrCode: Double,
  private val quicErrCode: Double
) : HybridQuicExceptionSpec() {

  override val message: String
    get() = msg

  override val internalErrorCode: Double
    get() = internalErrCode

  override val quicDetailedErrorCode: Double
    get() = quicErrCode
}
