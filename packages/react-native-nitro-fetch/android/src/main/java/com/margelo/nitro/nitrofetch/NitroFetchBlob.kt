package com.margelo.nitro.nitrofetch

import android.util.Base64
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.blob.BlobModule

// Plain RN native module whose only job is to reach RN's BlobModule from a place RN
// gives a ReactApplicationContext. Not codegen-backed: this library doesn't run RN
// codegen (see android/build.gradle), so the spec base class isn't on its classpath.
// Reached from JS via the New-Arch legacy interop. TODO: drop once nitrogen can expose
// the RN module registry to Nitro HybridObjects directly.
class NitroFetchBlob(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun createBlobId(base64: String): String {
    return try {
      val data = Base64.decode(base64, Base64.NO_WRAP)
      val blob = reactApplicationContext.getNativeModule(BlobModule::class.java) ?: return ""
      blob.store(data)
    } catch (_: Throwable) {
      ""
    }
  }

  companion object {
    const val NAME = "NitroFetchBlob"
  }
}
