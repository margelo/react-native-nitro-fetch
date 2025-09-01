package com.margelo.nitro.nitrofetch
  
import com.facebook.proguard.annotations.DoNotStrip

@DoNotStrip
class NitroFetch : HybridNitroFetchSpec() {
  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }
}
