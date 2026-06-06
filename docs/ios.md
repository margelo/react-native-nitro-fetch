# iOS

- The iOS client is built on native `URLSession`. It handles requests, `prefetch()` (with an in‑memory cache for fresh results), streaming (`{ stream: true }`), and auto‑prefetch on app start.
- Auto‑prefetch on app start fires automatically after launch via the linked pod — no manual call is required (see below).
- `nitroFetchOnWorklet` runs the mapper on a worklet runtime (requires `react-native-worklets`), falling back to the JS thread when it isn't installed.

See also: `docs/cronet-ios.md` for notes on the iOS networking stack.
## Auto‑Prefetch on App Start



1) Schedule from JS at runtime (same as Android):

```ts
import { prefetchOnAppStart } from 'react-native-nitro-fetch';
await prefetchOnAppStart('https://httpbin.org/uuid', { prefetchKey: 'uuid' });
```

2) (Optional) The prefetch already fires automatically on launch. You can also trigger it explicitly from `AppDelegate.swift` — the call is a no-op if it has already run:

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

- Prefetch is best‑effort.
- Responses served shortly after prefetch include header `nitroPrefetched: true`.
