package com.margelo.nitro.nitrofetch

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class NitroFetchPackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        if (name == NitroFetchBlobStore.NAME) {
            return NitroFetchBlobStore(reactContext)
        }
        return null
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                NitroFetchBlobStore.NAME to ReactModuleInfo(
                    NitroFetchBlobStore.NAME,
                    NitroFetchBlobStore::class.java.name,
                    false,
                    false,
                    false,
                    false,
                    true,
                ),
            )
        }
    }

    companion object {
        init {
            System.loadLibrary("nitrofetch")
        }
    }
}
