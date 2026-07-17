# Cronet on Android

Android uses Google's **embedded Cronet** through the Java `CronetEngine` API, called from Kotlin. There is no custom C/JNI Cronet wrapper — the library talks to Cronet via `org.chromium.net.*`.

## Dependency

`org.chromium.net:cronet-embedded` is declared in `packages/react-native-nitro-fetch/android/build.gradle`:

```groovy
api "org.chromium.net:cronet-embedded:${cronetVersion}"
```

`cronetVersion` defaults to `143.7445.0` and can be overridden with a `NitroFetch_cronetVersion` gradle property. The embedded variant bundles the native Chromium net stack, so no Play Services dependency is required.

> **Note:** `143.7445.0` is the minimum version required to build with Android Gradle Plugin 9+. Earlier Cronet artifacts shared the `org.chromium.net` namespace across modules, which trips AGP 9's unique-namespace enforcement during manifest merge. Fixed upstream in [crbug 406926302](https://issues.chromium.org/issues/406926302).

## Engine

A single `CronetEngine` is created lazily and shared for the process lifetime (`HybridNitroFetch.kt`, `getEngine()`):

- Logs every available `CronetProvider` and prefers the one whose name contains `"Native"` (avoids Play-Services DNS quirks); falls back to the default provider.
- Built with `enableHttp2(true)`, `enableQuic(true)` (HTTP/3), and `enableBrotli(true)`.
- Disk cache: `HTTP_CACHE_DISK`, 50 MB, at `<cacheDir>/nitrofetch_cronet_cache`.
- User-Agent: `NitroFetch/1.0`.
- Callbacks run on a fixed-size `NitroCronet-io` thread pool.

`NitroFetch.shutdown()` tears the engine down (best-effort).

## Request paths

- **Buffered** (`HybridNitroFetchClient.kt`): `request()` (async `Promise`) and `requestSync()` (used by worklets) build a `UrlRequest`, accumulate the body, and resolve a `NitroResponse`. Cancellation is wired through `cancelRequest(requestId)`.
- **Streaming** (`HybridNitroCronet.kt`): `newUrlRequestBuilder(url)` exposes a `HybridUrlRequestBuilder` whose `onResponseStarted` / `onReadCompleted` callbacks drive a `ReadableStream` (used by `fetch(url, { stream: true })`).
- **Prefetch / auto-prefetch** (`AutoPrefetcher.kt`, `HybridNitroFetchClient.kt`): results are kept in `FetchCache` and served with a `nitroPrefetched: true` header.
