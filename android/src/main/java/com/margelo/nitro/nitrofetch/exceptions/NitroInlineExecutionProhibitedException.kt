package com.margelo.nitro.nitrofetch.exceptions

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.nitrofetch.HybridInlineExecutionProhibitedExceptionSpec

/**
 * Inline execution prohibited exception.
 * Thrown when executor attempts to run callback on network thread.
 */
@DoNotStrip
class NitroInlineExecutionProhibitedException(
  private val msg: String,
  private val internalErrCode: Double
) : HybridInlineExecutionProhibitedExceptionSpec() {

  override val message: String
    get() = msg

  override val internalErrorCode: Double
    get() = internalErrCode
}
