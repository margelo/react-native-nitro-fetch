package com.margelo.nitro.nitrofetch

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = NitroFetchBlobStore.NAME)
class NitroFetchBlobStore(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun storeBase64(base64: String, blobId: String, promise: Promise) {
    try {
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      storeInBlobModule(bytes, blobId)
      promise.resolve(bytes.size)
    } catch (error: Throwable) {
      promise.reject("E_BLOB_STORE", error.message, error)
    }
  }

  private fun storeInBlobModule(bytes: ByteArray, blobId: String) {
    val blobModule =
      reactApplicationContext.getNativeModule(
        Class.forName("com.facebook.react.modules.blob.BlobModule")
      ) ?: throw IllegalStateException("BlobModule is not available")

    val storeMethod =
      blobModule.javaClass.getMethod("store", ByteArray::class.java, String::class.java)
    storeMethod.invoke(blobModule, bytes, blobId)
  }

  companion object {
    const val NAME = "NitroFetchBlobStore"
  }
}
