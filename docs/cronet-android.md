# Cronet on Android

Android uses Google's **embedded Cronet** through the Java `CronetEngine` API, called from Kotlin. There is no custom C/JNI Cronet wrapper — the library talks to Cronet via `org.chromium.net.*`.

## Dependency

`org.chromium.net:cronet-embedded` is declared in `packages/react-native-nitro-fetch/android/build.gradle`:

```groovy
api "org.chromium.net:cronet-embedded:${cronetVersion}"
```

`cronetVersion` defaults to `141.7340.3` and can be overridden with a `NitroFetch_cronetVersion` gradle property. The embedded variant bundles the native Chromium net stack, so no Play Services dependency is required.

## Engine

A single `CronetEngine` is created lazily and shared for the process lifetime (`NitroFetch.kt`, `getEngine()`):

- Logs every available `CronetProvider` and prefers the one whose name contains `"Native"` (avoids Play-Services DNS quirks); falls back to the default provider.
- Built with `enableHttp2(true)`, `enableQuic(true)` (HTTP/3), and `enableBrotli(true)`.
- Disk cache: `HTTP_CACHE_DISK`, 50 MB, at `<cacheDir>/nitrofetch_cronet_cache`.
- User-Agent: `NitroFetch/1.0`.
- Callbacks run on a fixed-size `NitroCronet-io` thread pool.

`NitroFetch.shutdown()` tears the engine down (best-effort).

## Request paths

- **Buffered** (`NitroFetchClient.kt`): `request()` (async `Promise`) and `requestSync()` (used by worklets) build a `UrlRequest`, accumulate the body, and resolve a `NitroResponse`. Cancellation is wired through `cancelRequest(requestId)`.
- **Streaming** (`NitroCronet.kt`): `newUrlRequestBuilder(url)` exposes a `UrlRequestBuilder` whose `onResponseStarted` / `onReadCompleted` callbacks drive a `ReadableStream` (used by `fetch(url, { stream: true })`).
- **Prefetch / auto-prefetch** (`AutoPrefetcher.kt`, `NitroFetchClient.kt`): results are kept in `FetchCache` and served with a `nitroPrefetched: true` header.
