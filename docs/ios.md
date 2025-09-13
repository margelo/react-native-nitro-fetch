# iOS

- Current status: native `URLSession` client is used for requests and `prefetch()` (with an in‑memory cache for fresh results). Auto‑prefetch on app start is Android‑only.
- Auto‑prefetch on app start is available if your app includes MMKV. Call `NitroAutoPrefetcher.prefetchOnStart()` from `AppDelegate` to trigger it.
- Cronet integration is planned; once available, the iOS client will switch to Cronet for parity with Android.
- `nitroFetchOnWorklet` runs the mapper on the JS thread on iOS (off‑thread mapping requires Android worklets runtime).

See also: `docs/cronet-ios.md` for high-level Cronet iOS integration notes.
## Auto‑Prefetch on App Start

If your app includes `react-native-mmkv` (which links MMKV on iOS), you can prefetch queued URLs at startup.

1) Schedule from JS at runtime (same as Android):

```ts
import { prefetchOnAppStart } from 'react-native-nitro-fetch';
await prefetchOnAppStart('https://httpbin.org/uuid', { prefetchKey: 'uuid' });
```

2) Trigger native prefetch on app start in `AppDelegate.swift`:

```swift
import NitroFetch

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    NitroAutoPrefetcher.prefetchOnStart()
    return true
  }
}
```

Notes

- Prefetch is best‑effort. If MMKV is not present, the call is a no‑op.
- Responses served shortly after prefetch include header `nitroPrefetched: true`.
