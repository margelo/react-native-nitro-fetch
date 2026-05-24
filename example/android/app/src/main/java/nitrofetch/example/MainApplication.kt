package nitrofetch.example

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.margelo.nitro.nitrofetch.AutoPrefetcher
import com.margelo.nitro.nitrofetchwebsockets.NitroWebSocketAutoPrewarmer

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    NitroWebSocketAutoPrewarmer.prewarmOnStart(this)
    // Native-side prefetch registration — fires on the very first cold launch.
    try {
      AutoPrefetcher.registerPrefetch(
        context = this,
        url = "https://httpbin.org/anything/native-prefetch-test",
        prefetchKey = "harness-native-prefetch",
        headers = mapOf("Accept" to "application/json"),
        // Long TTL so the harness can hit the cache long after launch.
        prefetchCacheTtlMs = 300_000.0
      )
    } catch (_: Throwable) {}
    // Best-effort auto prefetch when engine initializes (app start)
    try { AutoPrefetcher.prefetchOnStart(this) } catch (_: Throwable) {}
    loadReactNative(this)
  }
}
