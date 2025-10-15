package com.margelo.nitro.nitrofetch.exceptions

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.nitrofetch.HybridCronetExceptionSpec

/**
 * Base Cronet exception HybridObject.
 */
@DoNotStrip
open class NitroCronetException(
  private val msg: String,
  private val internalErrCode: Double
) : HybridCronetExceptionSpec() {

  override val message: String
    get() = msg

  override val internalErrorCode: Double
    get() = internalErrCode
}
