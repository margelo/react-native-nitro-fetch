import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {

    // Use the extended selector with a long TTL so the harness can hit the
    // cached prefetch well past the 5-second default.
    // Points at the local httpbin-compatible Express server (test-server/) that
    // CI starts on the host; the iOS Simulator reaches it via 127.0.0.1. Must
    // match NP_URL in the harness so the first JS fetch lands a cache hit.
    NitroAutoPrefetcher.registerPrefetch(
      withURL: "http://127.0.0.1:9876/anything/native-prefetch-test",
      prefetchKey: "harness-native-prefetch",
      headers: ["Accept": "application/json"],
      method: nil,
      bodyString: nil,
      bodyBytes: nil,
      bodyFormData: nil,
      timeoutMs: nil,
      followRedirects: nil,
      prefetchCacheTtlMs: NSNumber(value: 300_000)
    )

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "NitroFetchExample",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
