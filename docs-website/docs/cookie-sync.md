---
id: cookie-sync
title: Cookie Sync (Android)
sidebar_position: 12
---

# Cookie Sync (Android)

Bridges Android's WebView [`CookieManager`](https://developer.android.com/reference/android/webkit/CookieManager) with `nitro-fetch`'s Cronet client and the cold-start token-refresh path. Useful when your auth flow stores the session cookie in the WebView cookie jar (e.g. SAML, OAuth login pages rendered in a WebView) and you need subsequent native fetches to send it.

When enabled:

- **Outbound requests**: if the request has no `Cookie` header, the matching cookies from `CookieManager` are attached for the request URL.
- **Inbound responses**: any `Set-Cookie` headers (including those returned during redirects) are stored back into `CookieManager`. Persistence is flushed once per request after the final response.

User-set `Cookie` headers are always respected — sync never overwrites them.

## Enable

Cookie sync is **opt-in** and disabled by default. Enable it once from your `Application.onCreate()` (or any code path that runs before the first fetch / auto-prefetch):

```kotlin
// android/app/src/main/java/.../MainApplication.kt
import com.margelo.nitro.nitrofetch.NitroCookieSync

class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    NitroCookieSync.enableCookieSync()
    // ...rest of your onCreate
  }
}
```

That's it — both the Cronet client (`fetch`) and the `HttpURLConnection` token-refresh path will start syncing cookies on the next request.

## Notes

- **Android only.** iOS `URLSession` already shares cookies with `WKWebView` via `HTTPCookieStorage` and needs no opt-in. To turn that sharing off, see [Disable cookies (iOS)](#disable-cookies-ios).
- **Token-refresh redirects**: `HttpURLConnection` follows redirects internally and only the final response's `Set-Cookie` headers are visible. If your refresh endpoint sets cookies on a 3xx hop, point it directly at the final URL.

## Disable cookies (iOS)

On iOS every `nitro-fetch` request uses `HTTPCookieStorage.shared`, the jar `WKWebView` also writes to. A cookie a web page sets in an in-app browser is then sent on your API requests, and a `Set-Cookie` from your API lands in the browser. `credentials: 'omit'` turns this off per request, but it can't reach the auto-prefetch and token-refresh requests that run natively before JS starts.

Set `NitroFetchDisableCookies` to turn cookies off for every request `nitro-fetch` makes: no stored cookie is sent and no `Set-Cookie` is saved. A `Cookie` header you set yourself is still sent.

**Expo:**

```json
{
  "plugins": [
    ["react-native-nitro-fetch", { "disableCookies": true }]
  ]
}
```

**Bare React Native:** add the key to `ios/<YourApp>/Info.plist`:

```xml
<key>NitroFetchDisableCookies</key>
<true/>
```

The key is read once, when the first session is created, so it takes effect on the next app launch. Android only syncs cookies when you call `NitroCookieSync.enableCookieSync()`, so it needs no equivalent.
