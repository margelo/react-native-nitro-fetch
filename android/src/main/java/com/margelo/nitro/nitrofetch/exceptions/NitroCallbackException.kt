package com.margelo.nitro.nitrofetch.exceptions

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.nitrofetch.HybridCallbackExceptionSpec

/**
 * Callback exception - error occurred during callback execution.
 * Wraps exceptions thrown by your UrlRequest.Callback methods.
 */
@DoNotStrip
class NitroCallbackException(
  private val msg: String,
  private val internalErrCode: Double,
  private val causeMsg: String?
) : HybridCallbackExceptionSpec() {

  override val message: String
    get() = msg

  override val internalErrorCode: Double
    get() = internalErrCode

  override val cause: String?
    get() = causeMsg
}
