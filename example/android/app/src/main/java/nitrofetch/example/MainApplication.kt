package nitrofetch.example

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.margelo.nitro.nitrofetch.AutoPrefetcher

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here, for example:
              // add(MyReactNativePackage())
            }

        override fun getJSMainModuleName(): String = "index"

        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    android.util.Log.i("MainApplication", "========================================")
    android.util.Log.i("MainApplication", "onCreate() called - about to call AutoPrefetcher")
    android.util.Log.i("MainApplication", "========================================")
    // Best-effort auto prefetch when app starts
    try {
      AutoPrefetcher.prefetchOnStart(this)
    } catch (e: Throwable) {
      android.util.Log.e("MainApplication", "AutoPrefetcher failed!", e)
    }
    android.util.Log.i("MainApplication", "Calling loadReactNative...")
    loadReactNative(this)
  }
}
