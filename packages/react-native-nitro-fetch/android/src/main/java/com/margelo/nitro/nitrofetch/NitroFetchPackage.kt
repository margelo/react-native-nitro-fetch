package com.margelo.nitro.nitrofetch

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class NitroFetchPackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        return if (name == NitroFetchBlob.NAME) NitroFetchBlob(reactContext) else null
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                NitroFetchBlob.NAME to ReactModuleInfo(
                    NitroFetchBlob.NAME,
                    NitroFetchBlob.NAME,
                    false, // canOverrideExistingModule
                    false, // needsEagerInit
                    false, // isCxxModule
                    false // isTurboModule — plain legacy module, reached via NativeModules interop
                )
            )
        }
    }

    companion object {
        init {
            System.loadLibrary("nitrofetch")
        }
    }
}
