# Test cases: fetch and WebSockets

A feature test checklist for `react-native-nitro-fetch`, `react-native-nitro-websockets` and
`react-native-nitro-text-decoder`. Each item is one test.

- `[x]` means an existing test already covers it. The suite is named at the end of the line.
- `[ ]` is a gap. `(partial: X)` means suite X covers part of it (one transport, one platform, or not every assertion).
- **Section 0 is high priority**: prewarming (WebSocket and HTTP) and certificate pinning, checked on iOS and Android
  with log lines that prove each path ran. Run it first.

The list went through 20 review rounds, each from a different angle:

| Round | Angle |
| --- | --- |
| 1 to 4 | WHATWG Fetch, RFC 9110 semantics, RFC 9111 caching, HTTP/1.1, HTTP/2 and HTTP/3 connections |
| 5 to 8 | TLS and pinning, Streams and EventSource, WHATWG XMLHttpRequest, errors, abort and timeouts |
| 9 to 12 | WHATWG WebSockets, RFC 6455, RFC 7692 and Autobahn, the WebSocket source, TextDecoder and library interop |
| 13 to 16 | nitro-fetch source: JS, iOS Swift, Android Kotlin, and the Nitro spec surface |
| 17 to 20 | Existing tests mapped to items, git history regressions, documentation promises, performance and real apps |

## How to read this

### Transports

Unless an item says otherwise, every fetch case runs on each transport that can express it:

| Tag | Transport |
| --- | --- |
| T1 | `fetch(url, init)` (buffered, default client) |
| T2 | `fetch(url, { stream: true })` (streaming client, `response.body` reader) |
| T3 | `XMLHttpRequest` (moved to the default client by `useDefaultClient()`) |
| T4 | `XMLHttpRequest` with `Accept: text/event-stream` (stays on the streaming client) |
| T5 | `nitroFetchOnWorklet(url, init, mapper)` (sync native request on a worklet runtime) |
| T6 | `prefetch()` then `fetch()` with the same `prefetchKey` |
| T7 | `prefetchOnAppStart()` replayed natively on the next cold start |
| T8 | `globalThis.fetch` / `XMLHttpRequest` after global replace |

### Platforms and schemes

- **iOS**: URLSession client. **Android**: Cronet client (plus HttpURLConnection for FormData file parts).
- **Web**: `index.web.tsx` falls back to the browser. Only section 26 targets it.
- Run every network case over **http** and **https**. The local server only speaks http today, so
  https items use public hosts or the local TLS listener proposed in [Infrastructure](#infrastructure-needed).
- An item tagged `(iOS)`, `(Android)`, `(T2)` and so on applies only there.

### Endpoints

`/path` means the local test server (`test-server/server.mjs`):
iOS simulator `http://127.0.0.1:9876`, Android emulator `http://10.0.2.2:9876`. `:9878` is the second
HTTP listener (a different origin), `:9877` is the paused WebSocket server. **NEW** means the endpoint
does not exist yet.

### Suite names

| Short | Suite |
| --- | --- |
| NF | `example/__tests__/nitrofetch.harness.ts` |
| API | `fetch-api-compliance.harness.ts` |
| BIN | `blob-binary.harness.ts` |
| PIN | `certificate-pinning.harness.ts` |
| GR | `global-replace.harness.ts` |
| LU | `local-urls.harness.ts` |
| NI | `network-inspector.harness.ts` |
| TR | `tokenrefresh.harness.ts` |
| TD | `textdecoder.harness.ts` |
| XHR | `xmlhttprequest-superagent.harness.ts` |
| WS | `nitrowebsockets.harness.ts` |
| JX | jest `packages/react-native-nitro-fetch/src/__tests__/XMLHttpRequest.test.ts` (mocked transport) |
| JR | jest `packages/react-native-nitro-fetch/src/__tests__/Response.test.ts` |
| JP | jest `packages/react-native-nitro-fetch/expo/plugins/src/__tests__/withCertificatePinning.test.ts` |


---

# Section 0: high priority

Run these first, on **both iOS and Android**. Each item names the log line that proves the path ran. Items marked
**add log** need that line added to the native code first. Existing logs are debug-only:

- **iOS**: `NitroLogger` uses `print()`. Capture it with `xcrun simctl launch --console-pty <device> <bundle id>`.
- **Android**: `adb logcat -s NitroFetch NitroWS`.

Release-build items check that the behavior still happens without logs.

## 0. Prewarming and pinning

### 0.1 WebSocket prewarm (`prewarmOnAppStart`)

Checked against the code:

- **iOS**: runs automatically at launch (`ios/NitroWSAutoBootstrap.mm`, `NitroWSRunAutoPrewarm`).
- **Android**: opt-in. The app must call `NitroWebSocketAutoPrewarmer.prewarmOnStart(this)` in
  `Application.onCreate`. The example app and the Expo plugin (`expo/plugins/src/withAndroid.ts`) do this.
- **Handoff**: shared C++. `WebSocketPrewarmer::preConnect` keeps the live connection keyed by the exact URL string, and
  `HybridWebSocket::connect` adopts it through `tryGet(url)`.
- **Tests**: no harness or jest test covers prewarm on either platform today.
- **Code gaps these cases will catch**:
  - The queue is written (`src/prewarm.ts`, `setString`) and read (`stringForKey`, `getString`) as plaintext on both
    platforms, including any `Authorization` header in it.
  - An unclaimed socket is never closed.
  - An adopted socket ignores the constructor's protocols and headers.
- **Logs today**: only in the auto-prewarmer, and only in debug builds. There are none in `src/prewarm.ts`,
  `WebSocketPrewarmer::preConnect` / `tryGet`, the adoption branch of `HybridWebSocket::connect`, `cpp-adapter.cpp`
  `nativePreWarm`, `NitroWebSocketPrewarmer.kt` or `prewarm/NitroWebSocketPrewarmer.mm`. Rows marked **add log** need
  that log line first.

- [ ] **P0-WS-01** iOS cold start, one queued `ws://` URL, no token refresh → `Auto-prewarmer starting ... 1 URL(s)`, `No token refresh config`, `Pre-warming <url> with 0 header(s)` each once, before React Native's `Running "<app>"` line. Server logs the upgrade before the bundle loads · `/ws/echo` (server logs connect time)
- [ ] **P0-WS-02** Android cold start through `prewarmOnStart` → `Auto-prewarmer starting ... 1 URL(s)` and `Pre-warming <url>` before the ReactNativeJS `Running` line. **Add log** `No token refresh config` in `NitroWebSocketAutoPrewarmer.prewarmOnStart` to match iOS · `/ws/echo`
- [ ] **P0-WS-03** Android app that never calls `prewarmOnStart` → No prewarm lines, first server connection arrives after JS starts (documents the opt-in) · `/ws/echo`
- [ ] **P0-WS-04** Auto-prewarm runs once per process (iOS arms two triggers, Android `prewarmOnStart` called twice) → Exactly one `Auto-prewarmer starting` line. **Add log** `prewarmOnStart already ran` · `/ws/echo`
- [ ] **P0-WS-05** Handshake completes before JS → **Add log** `prewarm handshake complete <url>` (NWStream `Impl::handshakeReceived`, `WebSocketConnection::handleEstablished`, prewarm-owned only), between `Pre-warming` and the React Native start line · `/ws/echo`
- [ ] **P0-WS-06** First `NitroWebSocket` to the queued URL claims the socket → **Add log** `prewarmed socket claimed <url> state=OPEN` exactly once (adopted branch of `HybridWebSocket::connect`). `onopen` fires through replay, `readyState` is `OPEN` within 50 ms, server sees one connection · `/ws/echo`
- [ ] **P0-WS-07** Second socket to the same URL, and URLs differing only by trailing slash or case → **Add log** `no prewarmed socket for <url>` (miss path in `WebSocketPrewarmer::tryGet`). Fresh connection, server sees 2 · `/ws/echo`
- [ ] **P0-WS-08** Server sends a message before JS claims the socket → `onmessage` gets it once after adoption. **Add log** `claimed with N buffered message(s)` · `/ws/headers`
- [ ] **P0-WS-09** Stored protocols and headers are used for the prewarm → The first `/ws/headers` message shows the queued subprotocols and headers · `/ws/headers`
- [ ] **P0-WS-10** Constructor protocols or headers differ from the queued entry → Not adopted, or the behavior is documented. **Add log** `prewarm skipped: options differ`. Today the socket is adopted and keeps the prewarm headers · `/ws/headers`
- [ ] **P0-WS-11** Prewarm failed at cold start (server down), JS connects once the server is up → JS gets a working fresh connection, not a replayed `onerror` + 1006. **Add logs** `prewarm failed <url>: <error>` and `discarding closed prewarm socket` in `tryGet` · closed port, then `/ws/echo`
- [ ] **P0-WS-12** Server closes the unclaimed socket before the claim → `tryGet` skips the closed entry, opens a fresh connection, logs `discarding closed prewarm socket` · `/ws/close?delay=100`
- [ ] **P0-WS-13** Unclaimed socket timeout → **Add log** `prewarm discarded after timeout <url>` N s after start, server sees close 1001. Needs a timer in `WebSocketPrewarmer` (none exists) · `/ws/echo`
- [ ] **P0-WS-14** Same URL prewarmed twice (manual `preWarm` plus queue) → **Add log** `prewarm replaced <url>` in `preConnect`, server sees the first connection closed with 1001 · `/ws/echo`
- [ ] **P0-WS-15** Manual API from AppDelegate or MainApplication (`NitroWebSocketPrewarmer.preWarm`) → **Add log** `prewarm started <url> protocols=N headers=<names>` in `preConnect` (the manual path bypasses every existing log) · `/ws/echo`
- [ ] **P0-WS-16** Token refresh succeeds (`target: 'websocket'`) → `Calling refresh endpoint`, `Success ... got N header(s)`, `Injecting token headers into N prewarm URL(s)`, `Pre-warming <url> with N header(s)`. `/ws/headers` shows the refreshed `Authorization` · `/token` + `/ws/headers`
- [ ] **P0-WS-17** Token values never appear in logs → No header value in any line. Today `[TokenRefresh]   <k>: <v>` (Android) and `[NitroWS]   <name>: <value>` (iOS) print them · `/token`
- [ ] **P0-WS-18** Refresh fails with `onFailure: 'useStoredHeaders'` → `Refresh failed ... onFailure: useStoredHeaders` and `Using cached headers (1 header(s))`. `/ws/headers` shows the cached token · `/token/fail` + `/ws/headers`
- [ ] **P0-WS-19** Refresh fails with `onFailure: 'skip'` → `Skipping all prewarms`, no `Pre-warming` line, first server connection after JS starts · `/token/fail`
- [ ] **P0-WS-20** Refresh slower than JS startup → JS connects first (`no prewarmed socket`). The late prewarm is never created or is discarded. **Add log** `prewarm dropped: already connected`. No orphan connection on the server · `/delay/5` as the refresh URL
- [ ] **P0-WS-21** Queue missing, `[]`, or emptied by `clearPrewarmQueue` / `removeFromPrewarmQueue` → No `Pre-warming` line. **Add log** `prewarm queue empty` (both platforms return silently today)
- [ ] **P0-WS-22** Malformed queue (not JSON, object instead of array, entry without `url`, non-string headers) → App starts, valid entries still prewarm. **Add logs** `prewarm queue malformed, ignored` and `entry skipped`
- [ ] **P0-WS-23** Queue encrypted at rest → Raw `UserDefaults` / `SharedPreferences` value is not plaintext JSON. Native decrypts it and logs **add log** `prewarm queue decrypted` or `legacy plaintext queue migrated`. Fails today: plaintext on both platforms
- [ ] **P0-WS-24** JS reload after a claim, and reload with an unclaimed entry → After a claim: `no prewarmed socket` and a fresh connection. An unclaimed entry is claimed once by the second JS run · `/ws/echo`
- [ ] **P0-WS-25** Release build → No `[NitroWS]` lines (`NitroLogger` disabled), and the server still sees the pre-JS connection · `/ws/echo`
- [ ] **P0-WS-26** Expo prebuild (`withAndroid.ts`) → Import and `prewarmOnStart(this)` inserted once after `super.onCreate()`, re-running is idempotent, Java `MainApplication` gets valid code or a clear error · n/a (jest)
- [ ] **P0-WS-27** Prewarm on both platforms in one CI run → P0-WS-01 to P0-WS-24 pass on iOS and Android · `/ws/*`

### 0.2 HTTP prewarm (`prefetchOnAppStart` and native `registerPrefetch`)

Checked against the code:

- **iOS**: replays automatically. `NitroBootstrap.mm` `+load` calls `NitroAutoPrefetcher.prefetchOnStart` twice (main
  queue and `didFinishLaunching`), and an `initialized` flag dedupes the calls.
- **Android**: manual. The app must call `AutoPrefetcher.prefetchOnStart(this)` in `Application.onCreate`. The example
  `MainApplication.kt` does this, but `docs/api.md` says the queue replays on both platforms without mentioning the
  call.
- **Handoff**: a process-wide `FetchCache` keyed by `prefetchKey`. iOS keeps the entry for reuse within its TTL, while
  Android removes it on first read.
- **Tests today**: only native-registered entries (NF "serves a cache hit on the first JS fetch", "replays a
  natively-registered binary body byte-exact on cold start"). Nothing replays a JS `prefetchOnAppStart` entry on a
  later launch or checks the 5 s default TTL at cold start, and nothing reads the raw stored value to prove encryption.
  On the iOS CI host the Keychain fails (-34018), so writes fall back to plaintext and the decrypt path never runs.
- **Code gaps these cases will catch**:
  - iOS `prefetchStatic` always follows redirects, which ignores `followRedirects: false`.
  - Custom or lowercase methods in the queue replay as GET.
- **Logs today**: debug builds only. iOS uses `print()`, so check the Xcode console or `simctl launch --console`, not
  `log stream`. Android logs to logcat with tag `NitroFetch`. `[TokenRefresh] Prefetching <url>` is the only line that
  proves replay started. Nothing is logged for queue read, parse, empty queue, migration, decrypt failure, cache hit,
  miss, expiry, join, or replay failure. Token values are printed.

- [ ] **P0-PF-01** Native-registered key replays before JS → `Prefetching <url>` timestamped before React Native's `Running "<app>"`. First JS fetch has `nitroPrefetched: true`, `/cache-report/K` shows 1 request. **Add log** `auto-prefetch started key=K wallMs=T` on both platforms · `/cache/:id` _(partial: NF)_
- [ ] **P0-PF-02** JS `prefetchOnAppStart` entry replays on the next cold start (two launches) → Launch 2 logs **add log** `auto-prefetch queue decrypted, N entries`, then `Prefetching <url>`. First JS fetch with K is prefetched, server count stays 1 · `/cache/:id` + relaunch
- [ ] **P0-PF-03** Android app that never calls `prefetchOnStart` → Queue persists, no `Prefetching` line, nothing replays. Documented as required setup
- [ ] **P0-PF-04** iOS double `prefetchOnStart` is a no-op → Exactly one `Prefetching <url>` per key per launch. **Add log** `prefetchOnStart already ran, skipping`
- [ ] **P0-PF-05** Replayed prefetch served from cache to JS → `nitroPrefetched: true`, server count 1. **Add log** `prefetch K served from cache age=<ms> ttl=<ms>` · `/cache/:id` _(partial: NF)_
- [ ] **P0-PF-06** First JS fetch joins an in-flight replay → Slow registered URL, JS fetch waits and is prefetched, server count 1. **Add log** `JS fetch K joined pending prefetch` · NEW `/delay/3` with a hit counter
- [ ] **P0-PF-07** Default 5 s TTL at cold start → Consumer without `prefetchCacheTtlMs` arriving more than 5 s after replay goes to the network, server count 2. **Add log** `prefetch K expired age=<ms> > ttl=5000, refetching` · `/cache/:id`
- [ ] **P0-PF-08** Consumer TTL wins over entry TTL → Entry 300000 / consumer 1000 after 2 s: miss. Entry 1000 / consumer 300000 after 2 s: hit · `/cache/:id`
- [ ] **P0-PF-09** Android single use vs iOS reuse → Second consumer within TTL: iOS hit, Android network. Documented or unified · `/cache/:id`
- [ ] **P0-PF-10** Queue is ciphertext at rest → `NativeStorage.getString('nitrofetch_autoprefetch_queue')` starts with `nfc1:` on both platforms. Needs a CI host with Keychain access on iOS
- [ ] **P0-PF-11** Legacy plaintext queue migrated → After a plaintext write, `__readAutoPrefetchQueue()` returns the entry and the stored value becomes `nfc1:`. **Add log** `migrated legacy plaintext key=nitrofetch_autoprefetch_queue`
- [ ] **P0-PF-12** Tampered ciphertext (`nfc1:AAAA`) → `__readAutoPrefetchQueue()` returns `[]`, cold start does not crash. **Add log** `queue undecryptable, skipped`
- [ ] **P0-PF-13** Keychain / Keystore unavailable on write → Existing log `Keychain unavailable` / `Keystore unavailable` + `storing "<key>" unencrypted`, entry not lost
- [ ] **P0-PF-14** Malformed queue JSON at cold start → No crash, no `Prefetching` line. **Add log** `auto-prefetch queue JSON invalid, ignored`
- [ ] **P0-PF-15** One invalid entry among valid ones → Queue `[{no url}, K]` gives one `Prefetching` line and K is served
- [ ] **P0-PF-16** Replay failure is visible → Registered URL on a closed port: **add log** `auto-prefetch K failed: <error>`. A joined JS fetch rejects, the next fetch goes to the network · NEW closed port
- [ ] **P0-PF-17** Token refresh applied before replay → `Calling refresh endpoint`, `Success`, then `Prefetching`. Replayed echo shows `Authorization: Bearer tok_abc123` · `/token`, `/anything/*`
- [ ] **P0-PF-18** Refresh fails, `onFailure: 'useStoredHeaders'` (default), token cached by an earlier launch → `Refresh failed`, `onFailure: useStoredHeaders`, `Using cached tokens (1 header(s)`. Replay carries the old token · `/token/fail` + relaunch
- [ ] **P0-PF-19** Refresh fails, `onFailure: 'skip'` → `Refresh failed`, `Skipping all prefetches`, no `Prefetching` line, first JS fetch not prefetched · `/token/fail`
- [ ] **P0-PF-20** Refresh returns 200 with invalid JSON → Falls back on both platforms. Android must not log `Success ... got 0 header(s)` and wipe the cached tokens · NEW `/token/badjson`
- [ ] **P0-PF-21** Slow refresh pushes replay past the first JS fetch → Refresh delayed 3 s: log order `Calling refresh endpoint`, JS fetch, `Prefetching`. Server sees 2 requests for K. Documented, or JS joins a refresh-pending marker · NEW `/token?delay=3`
- [ ] **P0-PF-22** Token values never appear in logs → No header, body-field or form-field value in any line. Today `logTokens` prints them on both platforms · `/token`
- [ ] **P0-PF-23** Header case differs between stored and refreshed (`authorization` vs `Authorization`) → Server sees only the new token, never `old, new` · `/anything/*`
- [ ] **P0-PF-24** `followRedirects: false` in a queue entry → Consumer sees the 302 on both platforms. Fails today on iOS (`prefetchStatic` follows) · `/redirect/1`
- [ ] **P0-PF-25** Custom (`PROPFIND`) or lowercase (`post`) method in a queue entry → Sent verbatim, or rejected with **add log** `unsupported method X for K`. Never silently replayed as GET · `/anything`
- [ ] **P0-PF-26** `credentials: 'omit'` persisted → Replay sends no jar cookie · `/cookies`
- [ ] **P0-PF-27** Late native `registerPrefetch` after `prefetchOnStart` ran → Starts at once with cached tokens. **Add log** `late registerPrefetch K, started now` · `/cache/:id`
- [ ] **P0-PF-28** iOS background launch before first unlock → Replay skipped with `queue undecryptable`, and no write in that state replaces the encrypted queue with plaintext · NEW locked device
- [ ] **P0-PF-29** Cold-start refresh honors pinning and cookies → Pinned refresh host with a mismatching chain counts as a refresh failure. iOS sends jar cookies, Android only with cookie sync on · `/cookies`, www.gstatic.com
- [ ] **P0-PF-30** Release build → No `[TokenRefresh]` lines, replay still happens (server count) · `/cache/:id`
- [ ] **P0-PF-31** Prewarm on both platforms in one CI run → P0-PF-01 to P0-PF-29 pass on iOS and Android

### 0.3 Certificate pinning (`nitro-fetch-pinning.json`)

Where the pin file is enforced today, per platform and request path:

| Path | iOS | Android | Existing test |
| --- | --- | --- | --- |
| T1 `fetch` | Pinned | Pinned (Cronet) | PIN |
| T2 `stream: true` | Pinned | Pinned (Cronet) | PIN |
| T3 `XMLHttpRequest` | Pinned | Pinned | none |
| T5 worklet | Pinned | Pinned | none |
| FormData file part | Pinned | Pinned (HttpURLConnection) | PIN |
| T6 `prefetch` | Pinned | Pinned | PIN (the fetch only joins the prefetch on iOS) |
| T7 cold-start replay | Pinned | Pinned | none |
| Cold-start token refresh (fetch target) | Pinned | Pinned | none |
| JS `callRefreshEndpoint` | **Not pinned** (global fetch) | **Not pinned** (global fetch) | none |
| WebSocket `wss://` | **Not pinned** | **Not pinned** (embedded Mozilla CA bundle) | none |
| WebSocket prewarm and its token refresh | **Not pinned** | **Not pinned** | none |

Logs today, debug builds only:

| Log line | Where |
| --- | --- |
| `Certificate pinning enabled for N host(s)` | Both platforms, once per process |
| `Invalid nitro-fetch-pinning.json: <reason>` | Both platforms |
| `Certificate pinning: no pinned key in the chain for <host>` | Every iOS path. On Android only the HttpURLConnection paths (FormData part, cold-start refresh) |

Android Cronet paths (T1, T2, T3, T5, T6, T7) log nothing on a pin failure. The only trace is
`ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN` in the error. iOS `NitroLogger` uses `print()`, so capture it with
`simctl launch --console-pty`, and Android with `adb logcat -s NitroFetch`.

- [ ] **P0-PIN-01** Pin file loaded → Exactly one `Certificate pinning enabled for N host(s)` per process on both platforms, before the first HTTPS request · any https
- [ ] **P0-PIN-02** Pin file missing → Every host loads. **Add log** `pinning disabled: no nitro-fetch-pinning.json` (`CertificatePinning.swift` `config`, `CertificatePinning.kt` `domains`) · NEW build without the file
- [ ] **P0-PIN-03** Pin file malformed → Existing `Invalid nitro-fetch-pinning.json` line on both platforms. Every https request fails (fail closed). Plain http: iOS keeps working, Android rejects every request. Unify or document · NEW bad-file build variant
- [ ] **P0-PIN-04** Host matched entry → **Add log** `entry gstatic.com applies to www.gstatic.com (includeSubdomains)` and `www.google.com unpinned (exact-only entry google.com)` in `activePins`. Android also logs each entry registered with Cronet in `CertificatePinning.apply(builder)` · www.gstatic.com, www.google.com, docs.aws.amazon.com _(partial: PIN)_
- [ ] **P0-PIN-05** Expired entry falls back to the parent → **Add log** `entry www.amazon.com expired <date>, falling back to amazon.com`, then the pin error · www.amazon.com _(partial: PIN)_
- [ ] **P0-PIN-06** Pin check passed or failed, per path → One pass or fail line per host and path. iOS: **add** a pass line in `handle` and a session label (fetch, stream, shared). Android: **add** a path argument in `apply(connection)` and log Cronet failures with `ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN` in `HybridNitroFetchClient.startCronet` and the `HybridUrlRequestBuilder` failure callback · aws.amazon.com, www.gstatic.com on T1, T2, T3, T5, FormData part
- [ ] **P0-PIN-07** Untrusted chain on a pinned host → Certificate error, not the pin error. **Add log** `chain for <host> untrusted, default handling` in the `guard trusted` branch. No `no pinned key` line · expired.badssl.com _(partial: PIN)_
- [ ] **P0-PIN-08** Caller abort on a pinned host → `AbortError`. **Add log** in `mapFailure` and assert `mapped cancel to pin failure` never appears · aws.amazon.com _(partial: PIN)_
- [ ] **P0-PIN-09** T3 XHR to a pin-mismatch host → Pin error on both platforms, buffered and streamed XHR · www.gstatic.com
- [ ] **P0-PIN-10** T5 worklet to a pin-mismatch host → Pin error on both platforms · www.gstatic.com
- [ ] **P0-PIN-11** T6 fetch that really joins a failing prefetch on Android → Consumer rejects with the pin error on both platforms (today the Android test never joins, because `prefetch()` resolves after the request settles) · www.gstatic.com _(partial: PIN)_
- [ ] **P0-PIN-12** Prefetch and cold-start replay succeed on a pinned host → `prefetch` then `fetch` is a hit (`nitroPrefetched`), cold-start replay is a hit · aws.amazon.com
- [ ] **P0-PIN-13** T7 cold-start replay to a pin-mismatch host → `Prefetching <url>`, then the iOS fail line. Android: **add log** `auto-prefetch <key> failed: <error>` in `startPrefetches` on both platforms. First JS fetch with the key rejects with the pin error · www.gstatic.com queued, relaunch
- [ ] **P0-PIN-14** Cold-start token refresh to a pin-mismatch host → `Calling refresh endpoint`, `no pinned key in the chain for www.gstatic.com`, `Refresh failed`. **Add log** for the swallowed exception (`callTokenRefreshSync` catch, `try?` in `runTokenRefreshAndPrefetch`) · NEW refresh URL https://www.gstatic.com/generate_204, relaunch
- [ ] **P0-PIN-15** JS `callRefreshEndpoint` to a pin-mismatch host → Rejects with the pin error. Fails today: it uses the global fetch. Until fixed, **add** a `console.warn` when the global fetch is not Nitro · https://www.gstatic.com/generate_204
- [ ] **P0-PIN-16** `wss://` to a pinned host whose chain does not match → Fails like HTTPS on both platforms. Fails today: it connects. Until fixed, **add log** `nitro-fetch-pinning.json not enforced on WebSockets` once (`NWStreamWebSocketConnection.mm` `Impl::start`, `WebSocketConnection.cpp` `connect`) · NEW wss host in the pin file
- [ ] **P0-PIN-17** WebSocket prewarm and its token refresh to a pinned host → Pinned like fetch. Fails today on both platforms · NEW wss host + refresh URL in the pin file
- [ ] **P0-PIN-18** Redirect from an unpinned origin to a pinned host → Pin error on T1, T2, T3 · `/redirect-to?url=https://www.gstatic.com/generate_204`
- [ ] **P0-PIN-19** FormData part URL that redirects to a pinned host → Fails clearly on both platforms. Android must not upload the empty 302 body silently · `/redirect-to?url=https://www.gstatic.com/generate_204` as the part URI
- [ ] **P0-PIN-20** Host normalization (`WWW.GSTATIC.COM`, `www.gstatic.com.`) → Still rejected with the pin error · www.gstatic.com
- [ ] **P0-PIN-21** Proxy with a user-installed CA (mitmproxy, Charles) on a pinned host → Pin error, never bypassed · mitmproxy
- [ ] **P0-PIN-22** Unpinned client warms the connection first (React Native fetch, a WebView) → A Nitro request afterwards still rejects · www.gstatic.com
- [ ] **P0-PIN-23** Pin entry expiring today (UTC) → Counted as expired on both platforms · NEW pin-file variant
- [ ] **P0-PIN-24** Pin on the leaf only, the intermediate only, and the root only → All pass (any certificate in the verified chain) · NEW local TLS chain, aws.amazon.com _(partial: PIN)_
- [ ] **P0-PIN-25** Pin file `{}` → Pinning off, https works · NEW variant
- [ ] **P0-PIN-26** Native parser parity → Each bad input fails closed with the same message on both platforms: wildcard, IP, scheme or port in the key, unpadded or base64url hash, empty hashes, string `includeSubdomains`, `2027-02-30`, trailing content, duplicate raw key, key ending in a newline. Today only the Expo validator is tested · NEW pin-file variants _(partial: JP)_
- [ ] **P0-PIN-27** `network_security_config` `<pin-set>` on Android → Documented: Cronet ignores it, the HttpURLConnection paths honor it · NEW app config
- [ ] **P0-PIN-28** Android HttpURLConnection paths and `HttpsURLConnection.setDefaultSSLSocketFactory` → System trust store used, a custom default factory ignored · www.gstatic.com
- [ ] **P0-PIN-29** Expo `certificatePinning` plugin option → Prebuild copies the file to Android assets and the iOS bundle. A malformed file fails prebuild _(partial: JP)_
- [ ] **P0-PIN-30** Release build → Pinning still enforced, no pin log lines · www.gstatic.com
- [ ] **P0-PIN-31** Pinning on both platforms in one CI run → P0-PIN-01 to P0-PIN-28 pass on iOS and Android

---

# Part 1: fetch

## 1. HTTP methods

- [x] **M-01** GET with no init → 200, `json().method === 'GET'`, no request body sent · `/anything` _(NF)_
- [ ] **M-02** GET with query string → `args` echo every key and value, repeated keys kept · `/anything?a=1&a=2&b=`
- [ ] **M-03** HEAD → Status and headers match GET, body is empty, `text()` is `''` · `/get` _(partial: NF)_
- [x] **M-04** HEAD with `Content-Length: 1000000` → Resolves without waiting for 1 MB, body empty · `/not-modified` style _(NF)_
- [x] **M-05** POST with JSON body → Server receives exact JSON, `Content-Type` as set · `/post` _(NF)_
- [ ] **M-06** POST with no body → `Content-Length: 0` or no body, server sees `dataLength === 0` · `/post`
- [x] **M-07** PUT with string body → 200, body echoed · `/put` _(NF)_
- [x] **M-08** PUT with binary body → Byte-exact upload · `/put` _(BIN)_
- [x] **M-09** PATCH with JSON body → 200, body echoed · `/patch` _(NF)_
- [x] **M-10** DELETE without body → 200 · `/delete` _(NF)_
- [ ] **M-11** DELETE with body → Body is sent (allowed by spec) and echoed · `/delete`
- [ ] **M-12** OPTIONS → 200, `method === 'OPTIONS'`, no CORS preflight added by the client · `/anything`
- [ ] **M-13** OPTIONS with body → Body is sent and echoed · `/anything`
- [ ] **M-14** Custom method `PROPFIND` → Sent verbatim, echoed as `PROPFIND` · `/anything`
- [ ] **M-15** Custom method `PURGE`, `LINK`, `UNLINK`, `REPORT`, `MKCOL` → Each sent verbatim · `/anything`
- [ ] **M-16** Lowercase `get`, `post`, `put`, `delete`, `head`, `options` → Normalized to uppercase on the wire · `/anything`
- [ ] **M-17** Lowercase `patch` → Spec keeps `patch` as-is (not normalized). Decide and document whether Nitro matches · `/anything`
- [ ] **M-18** Mixed case `Post` → Normalized to `POST` · `/anything`
- [ ] **M-19** Forbidden method `CONNECT` → Rejects with `TypeError`, nothing sent
- [ ] **M-20** Forbidden method `TRACE` → Rejects with `TypeError`
- [ ] **M-21** Forbidden method `TRACK` → Rejects with `TypeError`
- [ ] **M-22** Method with invalid token chars (`"GE T"`, `"GET\n"`, `""`) → Rejects with `TypeError`
- [x] **M-23** GET with a body → Rejects with `TypeError` (T1, T2) _(API)_
- [x] **M-24** HEAD with a body → Rejects with `TypeError` (T1, T2) _(API)_
- [ ] **M-25** GET with `body: null` and `body: undefined` → Allowed, request succeeds · `/get`
- [x] **M-26** `init.method` overrides `Request.method` → Init wins · `/anything` _(API)_
- [ ] **M-27** Method on XHR `open('PATCH', ...)` → Sent as `PATCH` (T3) · `/patch`
- [ ] **M-28** Method on worklet request (POST with body) → Sent and echoed (T5) · `/post`
- [x] **M-29** Method persisted in `prefetchOnAppStart` → POST and body replayed on cold start (T7) · `/post` _(NF)_
- [ ] **M-30** Every method with `stream: true` → Same results as T1 (T2) · `/anything`
- [ ] **M-31** Lowercase non-standard method `propfind` on T2 and T3 → Sent as `propfind`. Only DELETE, GET, HEAD, OPTIONS, POST, PUT are uppercased · `/anything`

## 2. Status codes

Run every code with **GET**, **POST with a body**, and **HEAD**, on T1, T2, T3, T5. Assert `status`,
`ok`, `statusText`, body handling, and that the promise resolves (never rejects) for any complete
HTTP response. `/status/:code` answers every method with an empty body; **NEW** `?body=1&reason=X`
should add a body and a custom reason phrase.

### 2.1 Per-code expectations

- [ ] **S-100** 100 Continue (ok: n/a) → Interim only. Followed by a final 200 (NEW `/interim/100`), resolves with 200. Never resolves with 100
- [ ] **S-101** 101 Switching Protocols (ok: n/a) → On a plain fetch, rejects with `TypeError` (network error). No hang
- [ ] **S-102** 102 Processing (ok: n/a) → Interim, ignored, final response delivered
- [ ] **S-103** 103 Early Hints (ok: n/a) → Interim, ignored, final response and its headers delivered (hints not merged in)
- [x] **S-200** 200 OK (ok: true) → Body delivered _(NF)_
- [ ] **S-201** 201 Created (ok: true) → Body and `Location` header readable
- [ ] **S-202** 202 Accepted (ok: true) → Body delivered
- [ ] **S-203** 203 Non-Authoritative Information (ok: true) → Body delivered
- [ ] **S-204** 204 No Content (ok: true) → `body === null`, `text()` is `''`, `json()` rejects with `SyntaxError` _(partial: PIN)_
- [ ] **S-205** 205 Reset Content (ok: true) → Null body like 204
- [ ] **S-206** 206 Partial Content (ok: true) → With `Range: bytes=0-9` (NEW `/range`), exactly 10 bytes, `Content-Range` readable
- [ ] **S-207** 207 Multi-Status (ok: true) → XML body delivered as text
- [ ] **S-208** 208 Already Reported (ok: true) → Body delivered
- [ ] **S-226** 226 IM Used (ok: true) → Body delivered
- [ ] **S-300** 300 Multiple Choices (ok: false) → Not followed (no auto redirect for 300), returned as-is
- [ ] **S-301** 301 Moved Permanently (ok: false) → With `Location`: followed (see section 10). Without: returned as-is
- [ ] **S-302** 302 Found (ok: false) → Same as 301 _(partial: NF, API)_
- [ ] **S-303** 303 See Other (ok: false) → Same as 301, method becomes GET
- [x] **S-304** 304 Not Modified (ok: false) → Empty body even with a `Content-Length` _(NF)_
- [ ] **S-305** 305 Use Proxy (ok: false) → Not followed, returned as-is
- [ ] **S-306** 306 (Unused) (ok: false) → Returned as-is
- [ ] **S-307** 307 Temporary Redirect (ok: false) → Followed with method and body kept _(partial: NF)_
- [ ] **S-308** 308 Permanent Redirect (ok: false) → Same as 307
- [ ] **S-400** 400 Bad Request (ok: false) → Resolves, body readable
- [ ] **S-401** 401 Unauthorized (ok: false) → With `WWW-Authenticate: Basic`, resolves with 401. No credential prompt, no hang (iOS auth challenge path)
- [ ] **S-402** 402 Payment Required (ok: false) → Resolves
- [ ] **S-403** 403 Forbidden (ok: false) → Resolves
- [x] **S-404** 404 Not Found (ok: false) → Resolves _(NF)_
- [ ] **S-405** 405 Method Not Allowed (ok: false) → `Allow` header readable
- [ ] **S-406** 406 Not Acceptable (ok: false) → Resolves
- [ ] **S-407** 407 Proxy Authentication Required (ok: false) → From an origin (not a proxy). Document per platform: Cronet may fail with `ERR_UNEXPECTED_PROXY_AUTH`
- [ ] **S-408** 408 Request Timeout (ok: false) → Resolves, no automatic retry that duplicates a POST
- [ ] **S-409** 409 Conflict (ok: false) → Resolves
- [ ] **S-410** 410 Gone (ok: false) → Resolves
- [ ] **S-411** 411 Length Required (ok: false) → Resolves
- [ ] **S-412** 412 Precondition Failed (ok: false) → Resolves
- [ ] **S-413** 413 Content Too Large (ok: false) → Also with a 10 MB upload that the server rejects early: reports 413, not a broken pipe
- [ ] **S-414** 414 URI Too Long (ok: false) → Resolves
- [ ] **S-415** 415 Unsupported Media Type (ok: false) → Resolves
- [ ] **S-416** 416 Range Not Satisfiable (ok: false) → Resolves
- [ ] **S-417** 417 Expectation Failed (ok: false) → Resolves
- [ ] **S-418** 418 I'm a teapot (ok: false) → Resolves, `statusText` from server _(partial: GR)_
- [ ] **S-421** 421 Misdirected Request (ok: false) → Resolves (HTTP/2 clients may retry on a new connection, at most once)
- [ ] **S-422** 422 Unprocessable Content (ok: false) → JSON error body readable
- [ ] **S-423** 423 Locked (ok: false) → Resolves
- [ ] **S-424** 424 Failed Dependency (ok: false) → Resolves
- [ ] **S-425** 425 Too Early (ok: false) → Resolves
- [ ] **S-426** 426 Upgrade Required (ok: false) → `Upgrade` header readable
- [ ] **S-428** 428 Precondition Required (ok: false) → Resolves
- [ ] **S-429** 429 Too Many Requests (ok: false) → `Retry-After` readable, no automatic retry _(partial: XHR)_
- [ ] **S-431** 431 Request Header Fields Too Large (ok: false) → Resolves
- [ ] **S-451** 451 Unavailable For Legal Reasons (ok: false) → Resolves
- [x] **S-500** 500 Internal Server Error (ok: false) → Resolves _(NF)_
- [ ] **S-501** 501 Not Implemented (ok: false) → Resolves
- [ ] **S-502** 502 Bad Gateway (ok: false) → Resolves
- [ ] **S-503** 503 Service Unavailable (ok: false) → `Retry-After` readable
- [ ] **S-504** 504 Gateway Timeout (ok: false) → Resolves
- [ ] **S-505** 505 HTTP Version Not Supported (ok: false) → Resolves
- [ ] **S-506** 506 Variant Also Negotiates (ok: false) → Resolves
- [ ] **S-507** 507 Insufficient Storage (ok: false) → Resolves
- [ ] **S-508** 508 Loop Detected (ok: false) → Resolves
- [ ] **S-510** 510 Not Extended (ok: false) → Resolves
- [ ] **S-511** 511 Network Authentication Required (ok: false) → Resolves
- [ ] **S-52x** 520 to 527 Cloudflare codes (ok: false) → Resolve as plain 5xx


### 2.2 Boundaries and odd codes

- [ ] **S-B01** 199 → Treated as an interim 1xx (RFC 9110): waits for the final response or rejects. Never resolves with 199 · `/status/199`
- [x] **S-B02** 200 → `ok === true` (lower bound) · `/status/200` _(NF)_
- [ ] **S-B03** 299 → `ok === true` (upper bound) · `/status/299`
- [ ] **S-B04** 300 → `ok === false` · `/status/300`
- [ ] **S-B05** 399, 499, 599 → Resolve with that status, `ok === false` · `/status/:code`
- [ ] **S-B06** 600, 999 → Resolve with that status or reject with `TypeError`. Same on every platform and transport · NEW raw socket
- [ ] **S-B07** Status line with no reason phrase (`HTTP/1.1 200`) → `statusText === ''` · NEW raw socket
- [ ] **S-B08** Custom reason phrase (`HTTP/1.1 200 All Good`) → `statusText === 'All Good'` on HTTP/1.1 · NEW `?reason=`
- [ ] **S-B09** HTTP/2 response → `statusText === ''` (HTTP/2 has no reason phrase), or a documented default · https host on h2
- [ ] **S-B10** Malformed status line (`HTTP/1.1 abc OK`) → Rejects with `TypeError` · NEW raw socket
- [ ] **S-B11** Non-2xx with a large body (1 MB error page) → Body fully readable · NEW `?body=`
- [ ] **S-B12** Non-2xx on T2 → Body stream still delivers the error body · `/status/500`
- [ ] **S-B13** Non-2xx on T5 → Mapper receives `status` and `ok === false` · `/status/404`
- [ ] **S-B14** Non-2xx on T6 → Consumed response keeps the original status · `/status/404`
- [ ] **S-B15** XHR status on network error → `status === 0`, `error` event fires (T3) · unreachable host _(partial: JX)_
- [ ] **S-B16** 401 with two `WWW-Authenticate` fields (`Bearer realm="a, b"` and `Basic`), and `Digest`, `NTLM`, `Negotiate` challenges → Resolves with 401, every challenge readable, no platform auth attempt, no hang · NEW `/auth?schemes=`
- [ ] **S-B17** `Range: bytes=-10`, `bytes=990-`, `bytes=5000-` on a 1000-byte resource → 206 last 10 bytes with `Content-Range: bytes 990-999/1000`, 206 tail, 416 with `Content-Range: bytes */1000` · NEW `/range`
- [ ] **S-B18** Multi-range `bytes=0-9,20-29` → 206 `multipart/byteranges` delivered raw and byte-exact, boundary readable · NEW `/range`

## 3. URLs and schemes

- [x] **U-01** `http://` URL → Works (ATS exception on iOS, cleartext allowed on Android in the example app) · `/get` _(NF)_
- [x] **U-02** `https://` URL → Works over TLS · pokeapi.co _(NF)_
- [ ] **U-03** Uppercase scheme and host `HTTP://LOCALHOST:9876/get` → Normalized, works · `/get`
- [ ] **U-04** Explicit default port `:80` / `:443` → Works, `Host` has no port · `/headers`
- [ ] **U-05** Non-default port → `Host` includes the port · `/headers`
- [x] **U-06** IPv4 literal → Works · `127.0.0.1` _(NF)_
- [ ] **U-07** IPv6 literal `http://[::1]:9876/get` → Works where the simulator/emulator has IPv6 loopback · `/get`
- [ ] **U-08** `localhost` → Works · `/get`
- [ ] **U-09** Path with a space → Encoded as `%20`, succeeds (T1, T2) · `/anything/a b` _(partial: NF)_
- [ ] **U-10** Query with unicode (`?q=café`) → Percent-encoded as UTF-8, server echoes `café` · `/anything`
- [ ] **U-11** Path with unicode → Percent-encoded as UTF-8 · `/anything/日本`
- [ ] **U-12** Already percent-encoded URL → Not double-encoded · `/anything/a%2Fb`
- [ ] **U-13** IDN host (`bücher.example`) → Converted to punycode · public IDN host
- [ ] **U-14** Fragment `#frag` → Not sent to the server, `response.url` has no fragment · `/anything`
- [ ] **U-15** Credentials in URL `http://user:pass@host` → Rejects with `TypeError` (spec) or documented behavior · `/headers`
- [ ] **U-16** URL object as input → Works like the string · `/get`
- [x] **U-17** `Request` object as input → Works · `/get` _(API)_
- [ ] **U-18** Relative URL `/get` → Rejects with `TypeError` (no base URL in React Native)
- [ ] **U-19** Unparseable URL `http://` → Rejects with `TypeError` (Invalid URL) _(partial: NF)_
- [ ] **U-20** Non-string input (`123`, `{}`, `null`, `undefined`) → Rejects with `TypeError`, no native crash
- [ ] **U-21** Object with `toString()` returning a URL → Stringified and fetched · `/get`
- [ ] **U-22** Unsupported scheme `ftp:`, `ws:`, `javascript:`, `about:blank` → Rejects with `TypeError`
- [x] **U-23** `data:` URL → Decoded locally _(LU)_
- [x] **U-24** `file://` URL → Read locally _(LU)_
- [x] **U-25** `blob:` URL → Rejects with `TypeError` _(LU)_
- [ ] **U-26** 8 KB URL → Works · `/anything?x=...`
- [ ] **U-27** 64 KB URL → Works, or a 414 from the server. No client crash · `/anything?x=...`
- [ ] **U-28** 2 MB URL → Rejects or 414, no crash, no OOM · `/anything?x=...`
- [ ] **U-29** Trailing dot host `localhost.` → Resolves or fails consistently on both platforms · `/get`
- [ ] **U-30** `response.url` → Equals the final URL, without fragment · `/get`
- [ ] **U-31** Chromium-restricted ports (`:6000`, `:10080`, `:25`) → Same result on both platforms, or documented (Cronet fails with `ERR_UNSAFE_PORT`, URLSession connects) · NEW listener on a restricted port
- [ ] **U-32** URLs the platform canonicalizes (`HTTP://LOCALHOST:9876/get`, `http://127.0.0.1:9876` with no path, `/anything/a b`) → `redirected === false`, `response.url` is the canonical form · `/get` _(partial: NF)_
- [ ] **U-33** Host containing whitespace (`http://exa mple.com/get`) on T1 and T2 → Rejects with `TypeError` before any request

## 4. Request headers

- [x] **H-01** Plain object headers → Sent · `/headers` _(NF)_
- [ ] **H-02** Array of tuples → Sent · `/headers` _(partial: API)_
- [ ] **H-03** `Headers` instance → Sent · `/headers` _(partial: API)_
- [ ] **H-04** Header names are case-insensitive → `X-A` and `x-a` merge · `/headers` _(partial: API)_
- [ ] **H-05** `append()` twice → Server sees `a, b` · `/headers` _(partial: API)_
- [ ] **H-06** Empty value → Sent as an empty header · `/headers`
- [ ] **H-07** Leading and trailing whitespace in a value → Trimmed · `/headers`
- [x] **H-08** Invalid name (`"bad header"`, `"a:b"`, `""`) → Rejects with `TypeError` (T1, T2) _(API)_
- [x] **H-09** Value with CR or LF (header injection) → Rejects with `TypeError` _(API)_
- [x] **H-10** Value with NUL → Rejects with `TypeError` _(API)_
- [ ] **H-11** Latin-1 byte value (`é` as 0xE9) → Sent as that byte, or rejected consistently · `/headers`
- [ ] **H-12** Value with emoji → Rejects with `TypeError` (not a ByteString), or documented
- [ ] **H-13** 8 KB header value → Sent · `/headers`
- [ ] **H-14** 64 KB header value → 431 from server or a client error. No crash · `/headers`
- [ ] **H-15** 200 headers → All sent · `/headers`
- [ ] **H-16** Custom `User-Agent` → Overrides the default (`NitroFetch/1.0` on Android) · `/user-agent`
- [ ] **H-17** Default `User-Agent` → Present and stable per platform · `/user-agent`
- [ ] **H-18** Default `Accept` → `*/*` when not set · `/headers`
- [ ] **H-19** `Accept-Encoding` → Client advertises gzip (and br on Android). Body decoded transparently · `/headers`
- [ ] **H-20** Custom `Accept-Encoding: identity` → Server sends uncompressed, body correct · `/text?gzip=1`
- [ ] **H-21** User-set `Content-Length` → Ignored or overwritten with the real length. Never a mismatched request · `/post`
- [ ] **H-22** User-set `Host` → Ignored or rejected. Never sent to the wrong host · `/headers`
- [ ] **H-23** User-set `Connection: close` → Request still works · `/headers`
- [ ] **H-24** User-set `Transfer-Encoding` → Ignored or rejected · `/post`
- [ ] **H-25** `Authorization: Bearer` → Sent · `/headers`
- [ ] **H-26** Manual `Cookie` header → Sent, merged with or replacing jar cookies (document which) · `/cookies`
- [ ] **H-27** `Origin` and `Referer` → Sent only if set. Client adds none by itself · `/headers`
- [x] **H-28** `prefetchKey` header → Never reaches the server on any transport · `/headers` _(NF)_
- [ ] **H-29** `Content-Type` with charset → Sent verbatim · `/post` _(partial: BIN)_
- [ ] **H-30** Headers on T5 (worklet) → Sent · `/headers`
- [ ] **H-31** Headers persisted in T7 queue → Replayed, stored encrypted · `/headers` _(partial: NF)_
- [ ] **H-32** Headers on XHR `setRequestHeader` twice → Combined `a, b` (T3) · `/headers`
- [ ] **H-33** Same header with different case set twice in a plain object → One header, last write or combined (document which) · `/headers`
- [ ] **H-34** Forbidden and hop-by-hop headers: `Upgrade`, `TE`, `Trailer`, `Keep-Alive`, `Proxy-Connection`, `Proxy-Authorization`, `Accept-Charset`, `Date`, `Via` → Each sent or dropped the same way on T1, T2, iOS and Android. Never a native exception · `/headers`
- [ ] **H-35** `fetch(new GlobalRequest(url, {headers:{a:'1'}}), {headers:{b:'2'}})` on T1 and T2 → Only `b` is sent (init headers replace the Request's), same on both transports · `/headers`
- [ ] **H-36** Default `Accept-Language`, and a caller-set `Accept-Language: fr` → Default documented per platform (URLSession adds the device locale, Cronet none). Caller's value sent alone · `/headers`
- [ ] **H-37** Caller-set connection headers (`Connection`, `Keep-Alive`, `Transfer-Encoding`, `Upgrade`, `TE: gzip`) on an h2 or h3 request → Stripped by the client, request succeeds, no `PROTOCOL_ERROR` · NEW local TLS h2
- [ ] **H-38** Array of `{key, value}` objects as headers → Sent (undocumented shape) or `TypeError`. Documented · `/headers`
- [ ] **H-39** Plain-object header value `undefined` or `null` → `undefined` omitted, `null` sent as `"null"` · `/headers`
- [ ] **H-40** Header value with only a trailing CRLF (`'abc\r\n'`) → Trimmed to `abc` and sent, not rejected · `/headers`
- [ ] **H-41** Duplicate names through a tuple array (`[['X-A','1'],['X-A','2']]`) → Server sees `1, 2` on every transport and both platforms · `/headers`
- [ ] **H-42** Default `User-Agent` per transport on Android → T1 `NitroFetch/1.0`, T2 `NitroCronet/1.0`. Documented or unified · `/user-agent`
- [ ] **H-43** `prefetchKey` header in any case (`prefetchkey`, `PrefetchKey`) → Recognized for prefetch and consume, stripped from the wire · `/headers`

## 5. Request bodies

- [x] **B-01** String → UTF-8, default `text/plain;charset=UTF-8` · `/post` _(NF, BIN)_
- [ ] **B-02** String with emoji and CJK → Byte-exact UTF-8 · `/post`
- [ ] **B-03** String with a lone surrogate (`'\uD800'`) → Encoded as U+FFFD (EF BF BD) · `/post`
- [ ] **B-04** Empty string → `dataLength === 0` · `/post`
- [x] **B-05** JSON via `JSON.stringify` → Parsed by server · `/post` _(NF)_
- [x] **B-06** `URLSearchParams` → Default form-urlencoded type, fields parsed · `/post` _(NF, BIN)_
- [ ] **B-07** `URLSearchParams` with `+`, `&`, `=` and unicode → Round-trips exactly · `/post`
- [x] **B-08** `FormData` text fields → Multipart, fields parsed · `/post` _(NF)_
- [ ] **B-09** `FormData` repeated field name → All values kept in order · `/post`
- [ ] **B-10** `FormData` file part with `file://` URI → File uploaded byte-exact with name and type · `/post`
- [ ] **B-11** `FormData` file part with `content://` URI (Android) → Uploaded · `/post`
- [x] **B-12** `FormData` file part with `http(s)://` URI → Fetched and uploaded · `/post` _(NF, XHR, PIN)_
- [ ] **B-13** `FormData` file part with `ph://` / `assets-library://` (iOS) → Uploaded or rejected with a clear error · `/post`
- [ ] **B-14** `FormData` with a `Blob` part → Uploaded · `/post`
- [ ] **B-15** `FormData` with 20 files → All uploaded · `/post`
- [ ] **B-16** `FormData` with a missing file URI → Rejects with `TypeError`, no crash · `/post`
- [ ] **B-17** `FormData` with a unicode filename → Filename preserved · `/post`
- [ ] **B-18** User-set multipart `Content-Type` without boundary → Client sets its own boundary (document) · `/post`
- [ ] **B-19** `Blob` → Byte-exact, Blob type used as `Content-Type` · `/post` _(partial: BIN)_
- [ ] **B-20** `File` → Byte-exact · `/post` _(partial: BIN)_
- [x] **B-21** `ArrayBuffer` → Byte-exact · `/post` _(BIN)_
- [x] **B-22** Empty `ArrayBuffer` → No bytes sent · `/post` _(BIN)_
- [x] **B-23** `Uint8Array` → Byte-exact · `/post` _(BIN)_
- [x] **B-24** Typed array view with `byteOffset` → Only the view bytes · `/post` _(BIN)_
- [x] **B-25** `DataView` → Byte-exact · `/post` _(BIN)_
- [ ] **B-26** `Int16Array`, `Float32Array`, `BigInt64Array` → Raw underlying bytes · `/post`
- [ ] **B-27** All 256 byte values → Byte-exact (`dataBase64`) · `/post` _(partial: BIN)_
- [ ] **B-28** 10 MB body → Byte-exact · `/post` _(partial: BIN)_
- [ ] **B-29** 100 MB body → Uploads or fails cleanly, memory stays bounded · `/post`
- [ ] **B-30** `ReadableStream` body with `duplex: 'half'` → Streams the upload, or rejects with `TypeError` (document) · `/post`
- [ ] **B-31** `ReadableStream` body without `duplex` → Rejects with `TypeError` (spec)
- [ ] **B-32** Body from a `Request` whose body was already read → Rejects with `TypeError`
- [x] **B-33** `Request` body used by fetch when `init.body` is absent → Body sent · `/post` _(API)_
- [x] **B-34** `init.body` overrides the `Request` body → Init wins · `/post` _(API)_
- [ ] **B-35** Unsupported body type (plain object, number) → Stringified per spec (`[object Object]`, `"1"`) · `/post`
- [x] **B-36** Body on T2 → Same bytes as T1 · `/post` _(BIN)_
- [ ] **B-37** Body on T3 (`xhr.send(...)`) for each body type → Same bytes as T1 · `/post` _(partial: XHR)_
- [ ] **B-38** Body on T5 (`bodyString`, `bodyBytes`) → Same bytes · `/post`
- [x] **B-39** Body persisted on T7 (string, JSON, FormData, ArrayBuffer as base64) → Replayed byte-exact · `/post` _(NF)_
- [x] **B-40** Explicit `Content-Type` → Never overridden · `/post` _(BIN)_
- [ ] **B-41** `Expect: 100-continue` with a 5 MB body → Upload proceeds after 100, or works without it · NEW
- [ ] **B-42** `fetch(req)` where `req` has a body, then `req.bodyUsed` and `fetch(req)` again → `bodyUsed === true`, second fetch rejects with `TypeError`. `fetch(req.clone())` first works · `/post`
- [ ] **B-43** React Native global `Request` with a `FormData` body passed to fetch → Multipart body sent with every field, never dropped silently · `/post` _(partial: API)_
- [ ] **B-44** Pre-compressed upload with `Content-Encoding: gzip` → Header and compressed bytes reach the server unchanged · `/post`
- [ ] **B-45** FormData body with `stream: true` → Multipart uploaded like T1, or `TypeError`. Never an empty body · `/post`
- [ ] **B-46** FormData file part given only `{uri}` → Filename `file`, `Content-Type: application/octet-stream` · `/post`
- [ ] **B-47** Empty FormData → Valid empty multipart with a boundary `Content-Type` · `/post`
- [ ] **B-48** Foreign Request with an ArrayBuffer or Blob body and no `init.body` → Byte-exact upload · `/post` _(partial: BIN)_
- [ ] **B-49** `new Request(foreignRequest)` then fetch → Source body carried over · `/post`
- [ ] **B-50** FormData field name or filename with `"`, CR or LF, value with a bare LF, MIME type with CRLF → Name and filename escaped (`%22`, `%0D%0A`), value normalized to CRLF, CRLF in the type rejects with `TypeError`. No injected part · `/post`
- [ ] **B-51** FormData `http(s)` file part whose URL returns 404 or stalls → Rejects with `TypeError` (the 404 body is never uploaded as the file). Abort works, JS thread stays free · `/status/404`
- [ ] **B-52** FormData with a 200 MB file part → Bounded memory or a clean failure · `/post`
- [ ] **B-53** `request()` called directly with `bodyString` + `bodyBytes` + `bodyBytesBase64`, and invalid base64 → Same precedence and same invalid-base64 handling on both platforms · `/post`
- [ ] **B-54** T7 FormData file URI gone by the next launch → Entry skipped, other entries replay, no crash · `/post`

## 6. Response reading

- [x] **R-01** `text()` → Full body · `/get` _(NF)_
- [ ] **R-02** `json()` → Parsed object · `/get` _(partial: NF)_
- [ ] **R-03** `json()` on invalid JSON → Rejects with `SyntaxError` · `/text?phrase=x`
- [ ] **R-04** `json()` on empty body → Rejects with `SyntaxError` · `/status/204`
- [x] **R-05** `arrayBuffer()` → Exact bytes · `/bytes/1024` _(API)_
- [ ] **R-06** `bytes()` → `Uint8Array` with exact bytes · `/bytes/1024` _(partial: API)_
- [ ] **R-07** `blob()` → Size matches, `type` from `Content-Type` · `/image/png` _(partial: API, BIN)_
- [x] **R-08** `formData()` on urlencoded → Parsed · `/form` _(API)_
- [x] **R-09** `formData()` on multipart → Rejects with `TypeError` (documented) · `/post` _(API)_
- [x] **R-10** `body` getter → `ReadableStream` of `Uint8Array` chunks · `/get` _(API)_
- [ ] **R-11** `body` is `null` for 204, 205, 304 and HEAD → Null · `/status/204`
- [ ] **R-12** `bodyUsed` before and after each reader → False then true · `/get` _(partial: API)_
- [x] **R-13** Second read after `text()` → Rejects with `TypeError` · `/get` _(API)_
- [x] **R-14** `clone()` then read both → Both get the full body · `/get` _(API)_
- [x] **R-15** `clone()` after a read → Throws `TypeError` · `/get` _(API)_
- [ ] **R-16** `clone()` of a 5 MB binary body, read both in parallel → Both byte-exact · `/bytes/5242880` _(partial: API)_
- [ ] **R-17** `clone()` on T2, read one branch slowly → Other branch is not blocked forever (tee) · `/drip`
- [x] **R-18** `headers.get()` is case-insensitive → Works · `/get` _(NF)_
- [ ] **R-19** Duplicate response headers → Combined with `, ` · NEW
- [ ] **R-20** Multiple `Set-Cookie` → `getSetCookie()` returns each one · `/cookies/set?a=1&b=2` _(partial: API)_
- [ ] **R-21** Response headers are immutable → `headers.set()` throws `TypeError` (spec guard) · `/get`
- [x] **R-22** Header names iterate lowercase and sorted → Yes · `/get` _(API)_
- [x] **R-23** `response.type` → `'basic'` for network responses · `/get` _(API)_
- [ ] **R-24** `response.redirected` → False without redirect, true after one · `/redirect/1` _(partial: NF)_
- [ ] **R-25** `response.url` after redirect → Final URL · `/redirect/2`
- [ ] **R-26** `statusText` → Matches server · `/status/418`
- [ ] **R-27** Fetch resolves at headers, before the body ends → `fetch()` resolves while `/drip` still sends (T2). T1 resolves when buffered · `/drip?duration=3`
- [x] **R-28** Body larger than 1 MB → Byte-exact · `/bytes/:n` _(NF)_
- [ ] **R-29** 50 MB body on T1 → Byte-exact, memory returns to baseline after GC · `/bytes/52428800`
- [ ] **R-30** Reading the body after a long delay (10 s after resolve) → Still readable · `/get`
- [ ] **R-31** Response with `Content-Type` missing → `blob().type === ''`, `text()` works · NEW
- [ ] **R-32** `res.body === res.body` on T1, then drain `res.body`, check `bodyUsed`, call `text()` → Same stream object both times, `bodyUsed === true`, `text()` rejects with `TypeError` · `/get` _(partial: API)_
- [ ] **R-33** Response header with non-ASCII bytes (UTF-8 `café`, Latin-1 `0xE9`) and an empty-valued header → `headers.get()` maps each byte to one code unit (ByteString) on both platforms, empty value is `''` · NEW raw header bytes
- [ ] **R-34** Response with `Content-Location: /other` → Header readable, `response.url` and `redirected` unchanged · NEW `/content-location`
- [ ] **R-35** Mutate a clone (`clone().headers.set()`, write into a clone's `arrayBuffer()`) → Original unchanged · `/bytes/1024`
- [ ] **R-36** `formData()` edge input (`a+b=%zz&c&&d=`) → `+` becomes space, invalid `%` kept, bare key maps to `''` · NEW `/form?raw=` _(partial: API)_
- [ ] **R-37** `blob()` on an empty 200 body → Size 0, type from `Content-Type` · `/status/200`
- [ ] **R-38** `blob()` without the `NitroFetchBlob` native module → Exact bytes or a documented error, never a UTF-8 string Blob · `/image/png`
- [x] **R-39** Body shape from `NitroFetch.createClient().request()` → Valid UTF-8: `bodyString` set. Invalid UTF-8: `bodyBytes` byte-exact · `/text?invalid=eda080` _(NF)_

## 7. Encoding, charset and compression

- [x] **E-01** gzip body → Decoded, length larger than `Content-Length` · `/text?gzip=1` _(NF)_
- [ ] **E-02** Brotli (`br`) body → Decoded (Android Cronet has Brotli, iOS URLSession too) · NEW `/brotli`
- [ ] **E-03** `deflate` body → Decoded · NEW
- [ ] **E-04** `zstd` body → Decoded or passed through. Document per platform · NEW
- [ ] **E-05** Corrupt gzip → Rejects with `TypeError`, no crash · NEW
- [ ] **E-06** `Content-Encoding` the client did not ask for → Handled or rejected consistently · NEW
- [x] **E-07** Chunked transfer, no `Content-Length` → Full body · `/text?chunked=1` _(NF)_
- [ ] **E-08** Body shorter than `Content-Length` (connection closed early) → Rejects with `TypeError` · NEW
- [ ] **E-09** Body longer than `Content-Length` → Truncated to the declared length · NEW
- [ ] **E-10** No length, no chunking, `Connection: close` → Read until close · NEW raw socket
- [x] **E-11** `charset=utf-8` text → Decoded · `/charset/utf-8` _(NF)_
- [x] **E-12** `charset=iso-8859-1` → `café crème` decoded correctly · `/charset/iso-8859-1` _(NF)_
- [ ] **E-13** `charset=utf-16le` with BOM → Decoded · NEW
- [ ] **E-14** `charset=windows-1252`, `shift_jis` → Decoded or documented fallback to UTF-8 · `/charset/:value`
- [ ] **E-15** Unknown charset → Falls back to UTF-8 · `/charset/bogus`
- [x] **E-16** Invalid UTF-8 in a UTF-8 body → `text()` replaces with U+FFFD, `arrayBuffer()` keeps bytes · `/text?invalid=ff` _(NF)_
- [ ] **E-17** UTF-8 BOM at the start → `text()` strips it (spec), bytes keep it · NEW
- [x] **E-18** CJK and emoji body → Decoded natively · `/text?phrase=日本` _(NF)_
- [ ] **E-19** Multi-byte char split across chunks on T2 + `TextDecoder({stream:true})` → Reassembled · `/text?chunked=1` _(partial: TD)_
- [ ] **E-20** `arrayBuffer()`, `bytes()`, `blob()` on a body declared `charset=iso-8859-1`, `windows-1252`, `shift_jis` → Original wire bytes (`0xE9` for é), not a UTF-8 re-encoding of decoded text · `/charset/iso-8859-1` _(partial: NF)_
- [ ] **E-21** `Content-Type: text/plain; charset="ISO-8859-1"; format=flowed` and `CHARSET=iso-8859-1` → Decoded as Latin-1 on both platforms (quotes and trailing parameters handled) · `/charset/:value` _(partial: NF)_
- [ ] **E-22** Duplicate `Content-Length` (`5, 5` and `5, 6`), and values `+5`, `-1`, `05` → Identical duplicates accepted. Conflicting or invalid values reject with `TypeError` on both platforms · NEW raw socket
- [ ] **E-23** `Range` request to a server that gzips → Client sends `Accept-Encoding: identity`, or the 206 bytes match the identity offsets. Never decoded twice · NEW `/range?gzip=1`
- [ ] **E-24** Chunked body with chunk extensions (`5;x=y`), trailers, `Transfer-Encoding: gzip, chunked`, and an h2 trailing HEADERS frame → Body byte-exact, no error. Trailers not exposed (documented) · NEW raw socket
- [ ] **E-25** Chunked body cut off before the final `0` chunk, then the connection closes → T1 rejects with `TypeError`, T2 reader errors. Never a truncated success · NEW raw socket
- [ ] **E-26** Both `Transfer-Encoding: chunked` and `Content-Length` → Chunked wins or the response is rejected, same on both platforms, connection not reused · NEW raw socket
- [ ] **E-27** Non-UTF-8 charset body with an invalid byte (`shift_jis`) → `text()` decodes with the declared charset, replacing the bad byte · NEW `/charset/shift_jis?invalid=1`

## 8. Streaming (`stream: true` and `response.body`)

- [x] **ST-01** Read `/drip` byte by byte → Each piece arrives before the body ends · `/drip` _(NF)_
- [x] **ST-02** Total streamed length → Equals `numbytes` · `/drip` _(NF)_
- [x] **ST-03** NDJSON lines → Every line parses · `/stream/5` _(NF)_
- [ ] **ST-04** 1000 NDJSON lines → All arrive in order · `/stream/1000`
- [ ] **ST-05** Time to first chunk → First read resolves well before the last byte is sent · `/drip?duration=5`
- [ ] **ST-06** Slow reader with multi-MB body → Byte-exact, backpressure keeps memory bounded · `/bytes/:n` _(partial: NF)_
- [ ] **ST-07** 100 MB stream → Byte-exact, memory stays bounded · `/bytes/104857600`
- [ ] **ST-08** Long-lived stream (5 minutes of drip) → No idle timeout kills it · `/drip?duration=300`
- [x] **ST-09** `reader.cancel()` → Native request disconnects (server reports `disconnected`) · `/drip-report/:id` _(NF)_
- [x] **ST-10** `body.cancel()` before the first read → Disconnects · `/drip` _(NF)_
- [x] **ST-11** Abort mid-stream → Next read rejects with `AbortError` or `signal.reason` · `/drip` _(NF)_
- [x] **ST-12** Abort while native waits for JS → Disconnects · `/drip` _(NF)_
- [x] **ST-13** Abort after the body finished → Settles, no hang · `/get` _(NF)_
- [ ] **ST-14** Server drops the connection mid-body → Read rejects with `TypeError` (not `AbortError`) · `/drip?fail=1` _(partial: NF)_
- [ ] **ST-15** Reading after `done` → Keeps returning `{ done: true }` · `/get`
- [ ] **ST-16** `getReader()` twice → Second throws `TypeError` (locked) · `/get`
- [ ] **ST-17** `releaseLock()` then `getReader()` → Continues from where it stopped · `/stream/10`
- [ ] **ST-18** `text()` while a reader holds the lock → Rejects with `TypeError` · `/get`
- [ ] **ST-19** `for await (const chunk of res.body)` → Works if the engine supports async iteration of streams, or documented · `/stream/5`
- [ ] **ST-20** `pipeThrough(new TextDecoderStream())` → Works if available, or documented · `/stream/5`
- [ ] **ST-21** `res.body.tee()` → Both branches byte-exact · `/bytes/65536`
- [ ] **ST-22** Chunk type → Every chunk is a `Uint8Array`, never empty · `/drip`
- [ ] **ST-23** gzip stream → Decoded incrementally · `/text?gzip=1`
- [x] **ST-24** Redirect on T2 → Followed, `redirected === true` · `/redirect/2` _(NF)_
- [x] **ST-25** `redirect: 'error'` on T2 → Rejects with `TypeError` · `/redirect/1` _(NF)_
- [x] **ST-26** `redirect: 'manual'` on T2 → Returns the 3xx · `/redirect/1` _(NF)_
- [ ] **ST-27** 20 concurrent streams → Each gets its own bytes · `/drip`
- [x] **ST-28** Stream GC → Native request freed after settle · `/get` _(NF)_
- [x] **ST-29** Stream while JS thread is blocked → Native keeps reading · `/bytes/:n` _(NF)_
- [x] **ST-30** Repeated mid-stream cancels → Client stays usable · `/drip` _(NF)_
- [ ] **ST-31** `timeoutMs` on T2 → Ignored (documented). Use an AbortController timer · `/delay/3`
- [ ] **ST-32** AbortController timer on an idle stream → Aborts · `/drip?delay=10`
- [x] **ST-33** Upload a binary body on T2 → Byte-exact · `/post` _(BIN)_
- [ ] **ST-34** HTTP/2 multiplexed streams → Concurrent streams share a connection, all complete · https h2 host
- [ ] **ST-35** Stream on Android uses the second Cronet engine → Separate connections and cache from T1 (document) · `/cache/:id`
- [x] **ST-36** Stream with `cache: 'no-store'` → Not cached · `/cache/:id` _(API)_
- [ ] **ST-37** Resume a download: abort T2 after N bytes, then request `Range: bytes=N-` → The two parts concatenate byte-exact · NEW `/range`
- [ ] **ST-38** iOS content sniffing on T2 → `text/plain` under 512 bytes may be held until 512 B. With `nosniff`, `text/event-stream`, `application/json`, `application/x-ndjson`, `application/octet-stream`, chunks arrive at once · NEW `/drip?type=&nosniff=`
- [ ] **ST-39** `UrlRequestBuilder.disableCache()` → Second identical request reaches the server despite `max-age` · `/cache/:id?maxAge=60`
- [ ] **ST-40** `UrlRequest.isDone()` → False before start and mid-body, true after succeeded, failed, canceled · `/drip`
- [ ] **ST-41** `start()` twice, `cancel()` before `start()`, `cancel()` twice → No crash, second start is a no-op, `onCanceled` once · `/get`
- [ ] **ST-42** `followRedirect()` with no redirect pending → No-op on both platforms · `/get`
- [ ] **ST-43** Builder without `onRedirectReceived` on a redirecting URL → Same behavior on both platforms, or documented · `/redirect/1`
- [ ] **ST-44** `setUploadBody` with no `Content-Type` → Same on both platforms (no throw at `build()`) · `/post`
- [ ] **ST-45** `build()` twice on one builder, setters after `build()` → Independent requests or a throw. Late setters have no effect · `/get`
- [ ] **ST-46** `onReadCompleted` buffer contract → Consumers slice by `bytesRead` and copy before the next `read()` (pooled buffer on Android) · `/bytes/200000`
- [ ] **ST-47** `UrlResponseInfo` fields per platform (`urlChain`, `negotiatedProtocol`, `wasCached`, `receivedByteCount`, `proxyServer`) → Correct values, or the iOS differences documented · `/redirect/2`
- [ ] **ST-48** `allHeaders` vs `allHeadersAsList` with duplicate response headers → `allHeadersAsList` keeps each `Set-Cookie`. T2 `Response.headers` keeps all values · `/cookies/set?a=1&b=2`
- [ ] **ST-49** `onFailed` info argument and `RequestException.message` → Info undefined before headers, populated mid-body. Message `Invalid URL: <url>` for a bad URL · `/drip?fail=1`
- [ ] **ST-50** Abort while a T2 redirect waits for JS to call `followRedirect` (JS blocked) → Prompt `AbortError`, no hang, `Location` never requested · `/redirect/1`
- [ ] **ST-51** Partial read, `releaseLock()`, then `text()` (T1, T2) → Rejects with `TypeError` (disturbed), `bodyUsed === true` · `/stream/10`
- [ ] **ST-52** BYOB reader `getReader({mode:'byob'})` → Fills a 1 KB view, or throws `TypeError`. Documented · `/bytes/65536`
- [ ] **ST-53** `reader.cancel(reason)` → Resolves, `reader.closed` resolves, later reads give `{done:true}`, no `AbortError`, inspector does not record an abort · `/drip`
- [ ] **ST-54** Pending `read()` when abort fires → The pending promise and `reader.closed` reject with `AbortError` or `signal.reason` · `/drip?delay=5`
- [ ] **ST-55** `body.cancel()` while a reader holds the lock → Rejects with `TypeError`, the request keeps streaming · `/drip`
- [ ] **ST-56** `tee()` cancel and abort → Cancelling one branch leaves the other byte-exact. Cancelling both disconnects. Abort errors both branches · `/drip-report/:id`
- [ ] **ST-57** `pipeTo` and `pipeThrough` → Byte-exact. `pipeTo(ws, {signal})` abort disconnects. An erroring writable cancels the source · `/drip-report/:id`
- [ ] **ST-58** `break` out of `for await` → Cancels the body and disconnects natively · `/drip-report/:id`
- [ ] **ST-59** Consumer stops reading while JS is idle → Native stops pulling (server `sent` count stalls), memory bounded · `/drip?numbytes=800&chunk=65536&duration=4&id=`
- [ ] **ST-60** Chunk ownership → Each chunk has `byteOffset 0` and its own buffer. Chunks kept from earlier reads never change · `/bytes/1048576`

### 8.1 Server-Sent Events

- [ ] **SSE-01** `text/event-stream` via T2 → Events parsed as they arrive · NEW `/sse`
- [x] **SSE-02** `text/event-stream` via T4 (XHR, streaming client) → `onprogress` / `responseText` grows as events arrive · `/drip` _(NF)_
- [x] **SSE-03** T4 does not hold the default client's connections → Other T1 requests are not starved · `/drip` _(NF)_
- [ ] **SSE-04** `react-native-sse` library on top of XHR → Receives `open`, `message`, custom events · NEW `/sse`
- [ ] **SSE-05** Event with `id:` and `retry:` → Fields parsed by the library · NEW `/sse`
- [ ] **SSE-06** Comment lines (`: keepalive`) every 15 s for 5 minutes → Connection stays open · NEW `/sse`
- [ ] **SSE-07** Server closes the event stream → Library sees end or error, can reconnect · NEW `/sse`
- [ ] **SSE-08** Event split across TCP packets → Reassembled · NEW `/sse?split=1`
- [ ] **SSE-09** Multi-byte UTF-8 in events split across chunks → Decoded correctly · NEW `/sse`
- [ ] **SSE-10** `Last-Event-ID` on reconnect → Reconnect sends the last `id:` (T2 and T4). An empty `id:` resets it · NEW `/sse?close=1`
- [ ] **SSE-11** Event stream answered with 204, non-2xx or a wrong `Content-Type` → The library stops. Status visible before any body · NEW `/sse?status=204`
- [ ] **SSE-12** EventSource `close()` → Disconnects natively (T2 abort, T4 `xhr.abort()`) · `/drip-report/:id`
- [ ] **SSE-13** Small first event, then idle → A 20-byte event arrives within 1 s on both platforms for `text/event-stream`, `text/plain` and no `Content-Type` · NEW `/sse?first=20&idle=10`

## 9. Timeouts and cancellation

- [x] **T-01** Pre-aborted signal → Rejects with `AbortError`, nothing sent · `/delay/3` _(NF)_
- [x] **T-02** Pre-aborted signal with a reason → Rejects with `signal.reason` · `/delay/3` _(NF)_
- [x] **T-03** Abort mid-flight → Rejects quickly, server sees disconnect · `/delay/5` _(NF)_
- [x] **T-04** Abort after native finished → Still rejects with `AbortError` or reason · `/get` _(NF)_
- [ ] **T-05** `AbortSignal.timeout(500)` → Rejects with `TimeoutError` · `/delay/3`
- [ ] **T-06** `AbortSignal.any([a, b])` → Aborts with the first reason · `/delay/3`
- [ ] **T-07** Non-Error reason (`'stop'`, `42`, `undefined`) → Rejects with exactly that reason, or `AbortError` for `undefined` · `/delay/3`
- [ ] **T-08** One signal shared by 10 requests → All reject on abort · `/delay/3`
- [ ] **T-09** Abort during DNS lookup → Rejects with `AbortError` · slow DNS host
- [ ] **T-10** Abort during TLS handshake → Rejects with `AbortError` · NEW slow TLS
- [ ] **T-11** Abort during a 50 MB upload → Upload stops, rejects with `AbortError` · `/post`
- [ ] **T-12** Abort after resolve, before reading the body (T1) → Body read rejects with `AbortError` · `/bytes/:n`
- [ ] **T-13** Abort on T3 (`xhr.abort()`) → `abort` event, `readyState` 4 then 0, no `load` · `/delay/3` _(partial: XHR, JX)_
- [ ] **T-14** Abort on T5 → Rejects, mapper never runs · `/delay/3`
- [ ] **T-15** Abort a fetch that joined a pending prefetch (T6) → That fetch rejects, prefetch cache unaffected · `/delay/3`
- [x] **T-16** `timeoutMs` shorter than the response → Rejects with a timeout error · `/delay/3` _(NF)_
- [x] **T-17** `timeoutMs` longer than the response → Succeeds · `/delay/1` _(NF)_
- [ ] **T-18** `timeoutMs` restarts on each chunk → A 10 s drip with chunks every 0.5 s and `timeoutMs: 2000` succeeds · `/drip?duration=10`
- [ ] **T-19** `timeoutMs` stall after headers → Rejects after the idle window · `/drip?delay=0&duration=20`
- [ ] **T-20** `timeoutMs: 0` and negative → No timeout, or rejects with `TypeError`. Document · `/delay/1`
- [x] **T-21** `timeoutMs` on T5 → Applied · `/delay/3` _(NF)_
- [x] **T-22** `timeoutMs` persisted on T7 → Replayed with timeout · `/delay/3` _(NF)_
- [ ] **T-23** iOS default timeout (needs `/delay/:n` above its 60 s cap) → 60 s when none passed · `/delay/61`
- [ ] **T-24** Android without `timeoutMs` → No client timeout, waits for server · `/delay/60`
- [x] **T-25** XHR `timeout` property → `timeout` event, `status === 0` (T3) · `/delay/3` _(JX)_
- [ ] **T-26** Cancelling 1000 requests in a loop → No crash, no leaked native requests · `/delay/5`
- [ ] **T-27** `fetch(new Request(url, {signal}))` then `abort()`, for the Nitro and the global `Request` → Rejects with `AbortError`, server sees a disconnect · `/delay/5`
- [ ] **T-28** Abort during a cross-origin redirect that carries `Authorization` (Android restarts the request at that hop) → Rejects with `AbortError`, the restarted native request is cancelled, second origin sees a disconnect · `/redirect-to?url=<host>:9878/delay/5`
- [ ] **T-29** Slow upload (10 MB at 200 KB/s) with `timeoutMs: 5000`, and a server that stops reading mid-upload → Slow upload completes on both platforms (upload progress re-arms the idle timer). Stalled upload times out · NEW `/post?readRate=`
- [ ] **T-30** Abort during a large `file://` read → Rejects with `AbortError` · NEW 50 MB file fixture
- [ ] **T-31** React Native `AbortController` without reason support → `abort(reason)` rejects with `AbortError`, stream too · `/delay/3`
- [ ] **T-32** Abort or `timeoutMs` during a cross-origin 307/308 restart (Android) → Settles once, restarted request cancelled, cookies from the hop kept · `/redirect-to?status=307&url=:9878/delay/3`
- [ ] **T-33** Abort while JS resolves a Blob or Request body (T1, T3) → Rejects with `AbortError` within 500 ms, nothing sent · `/delay/3` with a 5 MB Blob
- [ ] **T-34** Abort latency when native cannot cancel (fetch joined to a pending prefetch, Android FormData part still downloading) → Rejects within 200 ms · `/delay/5`
- [ ] **T-35** FormData `http(s)` part honors `timeoutMs` and does not block the JS thread → Times out, JS stays responsive · `/delay/10` as the part URI
- [ ] **T-36** Abort at random times across a 5-hop redirect (T1, T2, T3) → `AbortError`, next hop cancelled, nothing leaks · `/redirect/5`
- [ ] **T-37** `timeoutMs` during a stalled TLS handshake → Rejects with the timeout error · NEW TCP listener that never answers ClientHello
- [ ] **T-38** Mid-body failure through every T2 body reader → `text()`, `arrayBuffer()`, `blob()`, `json()`, `bytes()`, `formData()` reject with the reader's `TypeError`, `bodyUsed === true` · `/drip?fail=1`
- [ ] **T-39** No double settle (timeout equal to the delay plus a same-tick abort, XHR timeout at load time, abort after `reader.cancel()`, abort after a timeout) → Exactly one rejection or terminal XHR event, no unhandled rejection · `/delay/1`
- [ ] **T-40** Long-lived shared AbortSignal over 10,000 completed requests → Listener count and memory flat, a later abort does not touch completed responses · `/get`
- [ ] **T-41** Unread T2 response dropped mid-stream → After GC the native request is cancelled, or the leak documented · `/drip-report/:id`
- [ ] **T-42** Worklet (T5) against a hung server with no `timeoutMs` → Only that runtime blocks, JS and other runtimes unaffected. Documented that abort cannot interrupt · `/delay/60`

## 10. Redirects

- [x] **RD-01** One 302 hop → `redirected`, final 200 · `/redirect/1` _(NF)_
- [ ] **RD-02** 5 hops → Final 200 · `/redirect/5`
- [ ] **RD-03** Exactly 20 hops → Final 200 · `/redirect/20`
- [ ] **RD-04** 21 hops → Rejects with `TypeError` · `/redirect/21`
- [ ] **RD-05** Redirect loop → Rejects with `TypeError`, no hang · `/redirect-to?url=/redirect-to...`
- [ ] **RD-06** 301 / 302 on POST → Becomes GET, body dropped, `Content-Type` dropped · `/redirect-to?status=301&url=/anything`
- [ ] **RD-07** 303 on PUT / DELETE → Becomes GET · `/redirect-to?status=303`
- [ ] **RD-08** 303 on HEAD → Stays HEAD · `/redirect-to?status=303`
- [ ] **RD-09** 307 on POST → Method and body kept · `/redirect-to?status=307` _(partial: NF)_
- [ ] **RD-10** 308 on PUT with binary body → Method and bytes kept · `/redirect-to?status=308`
- [ ] **RD-11** Relative `Location` → Resolved against the current URL · `/redirect/2`
- [ ] **RD-12** `Location` with a query and fragment → Query kept. `response.url` never contains a fragment (spec excludes it) · `/redirect-to`
- [ ] **RD-13** `Location` with non-ASCII characters → Percent-encoded · `/redirect-to`
- [x] **RD-14** 3xx without `Location` → Returned as-is · `/status/302` _(API)_
- [x] **RD-15** `redirect: 'error'` → Rejects with `TypeError` · `/redirect/1` _(API)_
- [x] **RD-16** `redirect: 'error'` with 304 → Returned (304 is not a redirect) · `/not-modified` _(API)_
- [x] **RD-17** `redirect: 'manual'` → 3xx with `Location` readable · `/redirect/1` _(API)_
- [x] **RD-18** Cross-origin redirect drops `Authorization` → Not sent to the new origin · `:9878` _(NF)_
- [x] **RD-19** Cross-origin 307 keeps the body, drops `Authorization` → Yes · `:9878` _(NF)_
- [ ] **RD-20** Same-origin redirect keeps `Authorization` → Sent · `/redirect/1` _(partial: NF)_
- [ ] **RD-21** Cross-origin redirect drops `Cookie` for the old host → Only cookies for the new host are sent · `:9878`
- [ ] **RD-22** https to http downgrade → Followed or blocked per platform policy (ATS, cleartext config). Document · public
- [ ] **RD-23** http to https upgrade → Followed · public
- [ ] **RD-24** Redirect to a `data:` or `file:` URL → Rejects with `TypeError` · `/redirect-to?url=data:...`
- [ ] **RD-25** Redirect on T3 → `responseURL` is final, status 200 · `/redirect/2`
- [ ] **RD-26** Redirect on T5 with `followRedirects: false` → Mapper sees the 3xx · `/redirect/1`
- [x] **RD-27** `redirect: 'error'` persisted on T7 → `followRedirects: false` in queue · `/redirect/1` _(NF)_
- [ ] **RD-28** `Set-Cookie` on a redirect response → Stored and sent on the next hop · NEW
- [ ] **RD-29** 21 redirects where hop 1 crosses origin with `Authorization` set → Rejects with `TypeError`. The Android restart at the cross-origin hop must not reset the 20-hop count · `/redirect-to?url=<host>:9878/redirect/20` _(partial: NF)_
- [ ] **RD-30** 301 or 302 on PUT, DELETE or PATCH with a body → Method and body kept (only POST becomes GET) · `/redirect-to?status=302&url=/anything`
- [ ] **RD-31** Unparseable `Location` (`http://[::1`, `http://a b/`) → Rejects with `TypeError` · `/redirect-to?url=http%3A%2F%2F%5B%3A%3A1`
- [ ] **RD-32** `redirect: 'manual'` on a 3xx that has a body → Body readable and identical on iOS and Android · NEW `/redirect-to?body=1` _(partial: API)_
- [ ] **RD-33** Cross-origin 301/302 on POST and 303 on PUT with `Authorization` (Android restart path) → Becomes GET, body and content headers dropped, `Authorization` dropped, `redirected === true` · `:9878`
- [ ] **RD-34** Cross-origin redirect ping-pong with `Authorization` → Rejects with `TypeError` after 20 hops (restart must not reset the count) · NEW `/redirect-to` between `:9876` and `:9878`
- [x] **RD-35** Same-origin redirect target with `\ → ` in the query keeps `Authorization` (Android) · `Authorization` sent _(`/redirect-to?url=/headers?q=a\)_

## 11. HTTPS and TLS

Public hosts from badssl.com unless noted. Assert the error is a `TypeError` with a platform-specific
cause, and that a caller abort still reports `AbortError`.

- [x] **TLS-01** Valid certificate → Works · pokeapi.co _(NF)_
- [ ] **TLS-02** Expired certificate → Rejects (certificate error) · expired.badssl.com _(partial: PIN)_
- [ ] **TLS-03** Wrong host → Rejects · wrong.host.badssl.com
- [ ] **TLS-04** Self-signed → Rejects · self-signed.badssl.com
- [ ] **TLS-05** Untrusted root → Rejects · untrusted-root.badssl.com
- [ ] **TLS-06** Revoked → Rejects where the platform checks revocation. Document · revoked.badssl.com
- [ ] **TLS-07** Incomplete chain → Works if the platform fetches intermediates (AIA), else rejects. Document · incomplete-chain.badssl.com
- [ ] **TLS-08** SHA-1 intermediate → Rejects · sha1-intermediate.badssl.com
- [ ] **TLS-09** TLS 1.0 only → Rejects · tls-v1-0.badssl.com:1010
- [ ] **TLS-10** TLS 1.1 only → Rejects · tls-v1-1.badssl.com:1011
- [ ] **TLS-11** TLS 1.2 only → Works · tls-v1-2.badssl.com:1012
- [ ] **TLS-12** TLS 1.3 → Works · a TLS 1.3 host
- [ ] **TLS-13** RC4, 3DES, NULL ciphers → Reject · rc4.badssl.com, 3des.badssl.com, null.badssl.com
- [ ] **TLS-14** Weak DH (dh480, dh512) → Reject · dh480.badssl.com
- [ ] **TLS-15** ECC and RSA-8192 certificates → Work · ecc256.badssl.com, rsa8192.badssl.com
- [ ] **TLS-16** HSTS host requested over http → Upgraded to https on the second request (Cronet honors HSTS). Document iOS · hsts.badssl.com
- [ ] **TLS-17** SNI → Correct certificate for a multi-host IP · public
- [ ] **TLS-18** ALPN negotiates h2 → Request uses HTTP/2 · public h2 host
- [ ] **TLS-19** User-installed CA (Android) → Trusted only if `network_security_config` allows user CAs · local TLS
- [ ] **TLS-20** Client certificate (mTLS) required → Rejects with a clear error, or documented as unsupported · client.badssl.com
- [x] **TLS-21** Pinned host, chain matches → Works (T1, T2, FormData part) · aws.amazon.com _(PIN)_
- [x] **TLS-22** Pinned host, chain mismatch → Rejects with `ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN` (T1, T2, FormData part) · www.gstatic.com _(PIN)_
- [x] **TLS-23** Pin mismatch on T2 is a failure, not an abort → Yes · www.gstatic.com _(PIN)_
- [ ] **TLS-24** Fetch joining a failed prefetch on a pinned host → Rejects · www.gstatic.com _(partial: PIN)_
- [x] **TLS-25** Exact-host pin does not apply to subdomains → Works · www.google.com _(PIN)_
- [x] **TLS-26** Exact-only entry stops parent lookup → Works · docs.aws.amazon.com _(PIN)_
- [x] **TLS-27** Expired pin entry falls back to parent → Rejects · www.amazon.com _(PIN)_
- [x] **TLS-28** Expired certificate on a pinned host → Certificate error, not pin error · expired.badssl.com _(PIN)_
- [ ] **TLS-29** Pinning on T3 and T5 → Same results as T1 (see P0-PIN-09, P0-PIN-10) · aws.amazon.com
- [ ] **TLS-30** Pinning on T7 cold start → Pin file loaded before the auto-prefetch runs (see P0-PIN-13) · www.gstatic.com
- [ ] **TLS-31** Malformed pin file → App starts, error logged, every https request fails (fail closed). See P0-PIN-03 for the platform difference on plain http · NEW
- [ ] **TLS-32** ATS blocks plain http without an exception (iOS) → Rejects with `TypeError` · app without ATS exception
- [ ] **TLS-33** Cleartext blocked by `network_security_config` (Android) → Rejects with `TypeError` · app without cleartext
- [ ] **TLS-34** Local TLS server with a CA installed in the simulator/emulator → Works (enables every section over https locally) · NEW local TLS
- [ ] **TLS-35** Wildcard certificate `*.example.test` → `a.example.test` works, `a.b.example.test` and bare `example.test` reject · NEW local TLS wildcard cert
- [ ] **TLS-36** IP SAN certificate → `https://127.0.0.1` and `https://10.0.2.2` work. A name not in the SAN rejects. IP only in the CN rejects · NEW local TLS
- [ ] **TLS-37** CN-only certificate (no subjectAltName) → Rejects on both platforms · NEW local TLS
- [ ] **TLS-38** Not-yet-valid leaf, expired intermediate → Reject with a certificate error · NEW local TLS
- [ ] **TLS-39** Chain out of order, root included, extra unrelated certs → Works · NEW local TLS
- [ ] **TLS-40** Publicly trusted certificate without SCTs → iOS rejects (CT policy). Android behavior per path and API level documented · no-sct.badssl.com
- [ ] **TLS-41** Stapled OCSP "revoked", and a must-staple cert without a staple → Rejects on iOS, Android documented · NEW local TLS with OCSP stapling
- [ ] **TLS-42** Local-CA cert breaking iOS rules (no serverAuth EKU, over 825 days, RSA 1024) → iOS rejects even with the CA trusted, Android documented · NEW local TLS
- [ ] **TLS-43** TLS session resumption → Second connection resumes (server logs a reused session) on T1, T2, T3 · NEW local TLS with session logging
- [ ] **TLS-44** TLS 1.3 0-RTT → A POST is never sent as early data. A 425 is retried after the handshake · NEW local TLS 1.3
- [ ] **TLS-45** ATS `NSExceptionDomains` with `NSExceptionAllowsInsecureHTTPLoads`, no `NSAllowsArbitraryLoads` → That host works over http, others reject on T1, T2, T3 and the FormData part · NEW app config
- [ ] **TLS-46** ATS minimum TLS: default 1.2, `NSExceptionMinimumTLSVersion` TLSv1.0 for one host → The TLS 1.0 host loads only with the exception · tls-v1-0.badssl.com:1010
- [ ] **TLS-47** ATS `NSAllowsLocalNetworking` only → Local http works, public http blocked · `/get`
- [ ] **TLS-48** Android cleartext per domain (base false, one domain true) → Allowed domain works over http, others reject on T1, T2, T3 and the FormData part · NEW app config
- [ ] **TLS-49** Android `<trust-anchors>` with a bundled CA for one domain → Local TLS host trusted on T1, T2 and the FormData part, other hosts do not trust that CA · NEW local TLS + config
- [ ] **TLS-50** Android `<debug-overrides>` trust anchors → Applied in debug builds, ignored in release · NEW local TLS

## 12. Protocol versions and connections

- [ ] **P-01** HTTP/1.1 keep-alive → 10 sequential requests reuse one connection (server counts sockets) · NEW `/conn-id`
- [ ] **P-02** HTTP/1.0 server response → Read until close · NEW raw socket
- [ ] **P-03** Server sends `Connection: close` each time → Every request still succeeds · NEW
- [ ] **P-04** HTTP/2 multiplexing → 100 concurrent requests on one connection · public h2 host
- [ ] **P-05** HTTP/3 over QUIC (Android, Cronet `enableQuic`) → Second request uses h3 after `Alt-Svc` · cloudflare-quic.com
- [ ] **P-06** HTTP/3 on iOS → Uses h3 where the OS supports it. Document · cloudflare-quic.com
- [ ] **P-07** QUIC blocked (UDP dropped) → Falls back to h2/h1 without failing the request · network conditioner
- [ ] **P-08** Server closes an idle keep-alive connection → Next request retries on a new connection transparently (idempotent only) · NEW
- [ ] **P-09** Server resets the connection (RST) before the response → Rejects with `TypeError` · NEW `/reset`
- [ ] **P-10** Server resets mid-body → Rejects with `TypeError` · NEW `/reset?after=100`
- [ ] **P-11** Server sends headers then hangs forever → `timeoutMs` or abort ends it · `/drip?delay=600`
- [ ] **P-12** Garbage instead of an HTTP response → Rejects with `TypeError` · NEW raw socket
- [ ] **P-13** POST on a reused keep-alive socket that the server closes after reading the request, before responding → Not resent (server count stays 1), rejects with `TypeError`. A GET may retry once. Document Cronet's resend rule · NEW `/count-and-drop`
- [ ] **P-14** Malformed header lines: obs-fold, space before the colon, no colon, bare LF line endings → Unfolded or rejected with `TypeError`, same on both platforms, no header injection · NEW raw socket
- [ ] **P-15** 204, 304 or HEAD followed by stray body bytes on a keep-alive socket, then a second request → Second response parses correctly, never corrupted · NEW raw socket
- [ ] **P-16** 20 concurrent HTTP/1.1 requests to one origin → No more sockets than the per-host limit (Cronet 6, URLSession `httpMaximumConnectionsPerHost`), no pipelining, all complete · NEW `/conn-id` _(partial: NF)_
- [ ] **P-17** 10 T2 responses never read or cancelled, then a T1 request to the same origin → T1 completes (no pool starvation), or documented that unread bodies hold sockets until GC · `/bytes/10485760` _(partial: NF)_
- [ ] **P-18** h2 GOAWAY with last-stream-id below in-flight streams, and graceful GOAWAY during a long T2 stream → Unprocessed streams retried on a new connection, processed ones complete · NEW local TLS h2 with fault injection
- [ ] **P-19** h2 RST_STREAM `REFUSED_STREAM`, `CANCEL`, `INTERNAL_ERROR`, h3 `H3_REQUEST_REJECTED` → REFUSED and REJECTED retried. Others reject on T1 or error the T2 reader. Sibling streams unaffected · NEW local h2/h3
- [ ] **P-20** h2 flow control: a stalled T2 reader with 10 MB pending plus other requests on the connection, and a 10 MB upload over h2 → Other streams complete, upload completes · NEW local TLS h2
- [ ] **P-21** h2 `SETTINGS_MAX_CONCURRENT_STREAMS=1` with 20 concurrent requests → All complete · NEW local TLS h2
- [ ] **P-22** h2 server push (PUSH_PROMISE) → Refused or ignored, never delivered as a response, no crash · NEW local TLS h2
- [ ] **P-23** 128 KB response header block, one 64 KB header, 1000 small headers over h1, h2 (HPACK, CONTINUATION) and h3 (QPACK) → Delivered intact, or a consistent `TypeError` above the platform limit · NEW raw socket and local h2
- [ ] **P-24** HTTP/3 0-RTT on a resumed QUIC session with a GET and a POST → GET may use early data. POST is not sent in 0-RTT, or a 425 is retried once · NEW local h3
- [ ] **P-25** `Alt-Svc` lifecycle: kept across cold start, `ma=` expiry, `Alt-Svc: clear`, another port, Alt-Svc over plain http → Documented first-request protocol after restart. `clear` and expiry stop h3. Alt-Svc from http ignored · NEW local h3
- [ ] **P-26** Connection coalescing: two hostnames on one IP with a certificate for both, one pinned → Second host reuses the connection where supported. No reuse when the cert does not cover it. Pins still enforced on the shared connection · NEW local TLS h2 with a SAN certificate
- [ ] **P-27** HTTP/1.1 per-host limit: 7 concurrent slow requests to one host → 7th waits for a free connection, requests to `:9878` unaffected · `/delay/3`

## 13. HTTP cache

- [x] **C-01** Fresh `max-age` response → Second request served from cache (server count stays 1) · `/cache/:id?maxAge=60` _(NF)_
- [x] **C-02** ETag revalidation → `If-None-Match` sent, 304 reuses cached body · `/cache/:id` _(NF)_
- [ ] **C-03** `Last-Modified` revalidation → `If-Modified-Since` sent · NEW
- [ ] **C-04** `Cache-Control: no-store` response → Never cached · NEW
- [ ] **C-05** `Vary: Accept-Language` → Different header values get different entries · NEW
- [ ] **C-06** `cache: 'no-store'` → Adds `Cache-Control: no-cache` and `Pragma: no-cache` when absent (spec), bypasses the cache. Existing test asserts `no-store` · `/headers` _(partial: API)_
- [ ] **C-07** `cache: 'no-cache'` → Adds `Cache-Control: max-age=0` when absent (spec), revalidates. Existing test asserts `no-cache` · `/headers` _(partial: API)_
- [ ] **C-08** `cache: 'reload'` → Sends `Cache-Control` and `Pragma`, refreshes the entry · `/headers` _(partial: API)_
- [ ] **C-09** `cache: 'force-cache'` → Uses a stale entry without revalidation · `/cache/:id`
- [ ] **C-10** `cache: 'only-if-cached'` → Returns cached, or rejects with `TypeError` when absent · `/cache/:id`
- [ ] **C-11** `cache: 'default'` → Normal HTTP caching · `/cache/:id`
- [ ] **C-12** POST is not cached → Second POST hits the server · `/post`
- [ ] **C-13** Cache survives an app restart (disk cache) → Hit after relaunch · `/cache/:id?maxAge=600`
- [ ] **C-14** Android cache size 0 (`NitroFetch_httpCacheSizeMB=0`) → Nothing cached · `/cache/:id`
- [x] **C-15** XHR and T1 share the default cache → Each is served from what the other cached · `/cache/:id` _(NF)_
- [ ] **C-16** T2 cache on Android is separate from T1 → T1 entry is not a T2 hit (document) · `/cache/:id`
- [ ] **C-17** `stale-while-revalidate` → Stale served, background revalidation · NEW
- [ ] **C-18** Authorization responses with `private` → Cached per platform rules. Document · NEW
- [ ] **C-19** `cache: 'only-if-cached'` without `mode: 'same-origin'` → Throws `TypeError` (spec), or the deviation is documented
- [ ] **C-20** Caller sets `If-None-Match` or `If-Modified-Since` on a URL with a cached entry → JS gets the raw 304 with an empty body, the cache neither merges nor updates · `/cache/:id?maxAge=60`
- [ ] **C-21** `cache: 'reload'`, `'no-cache'`, `'no-store'` with a caller-set `Cache-Control` or `Pragma` → Caller's header kept, nothing appended (one `Cache-Control` on the wire) · `/headers` _(partial: API)_
- [ ] **C-22** Caller-set `If-Match` (mismatch), `If-Unmodified-Since` (past), `If-None-Match: *` on PUT, `If-Range` strong and weak → 412 or 200 returned unchanged, not retried. Strong matching `If-Range` gives 206, weak or mismatched gives 200 · NEW `/conditional`
- [ ] **C-23** Heuristic freshness: `Last-Modified` 10 days old, no `Cache-Control`, no `Expires` → Second GET within about a day served from cache, or documented per platform · NEW `/cache/:id?lm=`
- [ ] **C-24** `Expires` future, past, invalid (`0`), RFC 850 and asctime formats, `max-age=0` with a future `Expires` → Future fresh, past and invalid stale, both old formats parsed, `max-age` wins · NEW `/cache/:id?expires=&cc=`
- [ ] **C-25** `max-age=60` with `Age: 50`, with `Age: 100`, and `Date` one hour ahead of the device clock → Age 50 fresh about 10 s, Age 100 stale at once. Freshness uses Age and Date · NEW `/cache/:id?age=&date=`
- [ ] **C-26** Stale entry with `must-revalidate`, origin returns 500 or is down → Stale body never served. JS gets the 500, a `TypeError` or 504 · NEW `/cache/:id?cc=`
- [ ] **C-27** Stale entry with `stale-if-error=600`, origin returns 500 or is down → Stale body served, or 500 or `TypeError`. Documented per platform · NEW `/cache/:id?cc=`
- [ ] **C-28** Response with `Cache-Control: no-cache`, and one with `max-age=0` → Stored, every use revalidates, a 304 reuses the body · NEW `/cache/:id?cc=no-cache`
- [ ] **C-29** `s-maxage=600, max-age=0` → Private cache ignores `s-maxage`, entry is stale · NEW `/cache/:id?cc=`
- [ ] **C-30** Unsafe method (POST, PUT, DELETE) to a cached URL with 2xx, with 4xx, and a 2xx whose `Location` names another cached URL → 2xx invalidates the cached GET and the same-origin `Location` target. 4xx and 5xx do not · NEW `app.all('/cache/:id')`
- [ ] **C-31** `Vary: *` → Never served from cache · NEW `/cache/:id?vary=*`
- [ ] **C-32** 301 with no `Cache-Control`, 302 with `max-age=60`, 302 with no freshness, 308 → 301 and 308 reused heuristically, 302 cached only with explicit freshness. Documented per platform · NEW `/redirect-cached`
- [ ] **C-33** 404 and 410 with `max-age=60`, 404 with only `Last-Modified`, 500 with `max-age=60` → 404 and 410 reused. Document whether the 500 is reused · NEW `/cache/:id?status=`
- [ ] **C-34** Full GET after a cached 206, and a Range GET after a cached 200 → Full GET returns the whole body as 200, never the partial. Range GET returns a correct 206 · NEW `/range`
- [ ] **C-35** 304 carrying a new `Cache-Control: max-age=600` and a new header → Stored headers updated: next GET within 600 s not sent, new header visible · NEW `/cache/:id` _(partial: NF)_
- [ ] **C-36** HEAD then GET to the same cacheable URL → GET gets the full body. A HEAD response never satisfies a GET · `/cache/:id?maxAge=60`
- [ ] **C-37** Caller request directives `Cache-Control: max-age=0`, `max-stale=600`, `min-fresh=30`, `only-if-cached` → Honored per RFC 9111 or documented. An `only-if-cached` miss gives 504 · `/cache/:id`
- [ ] **C-38** Invalid or conflicting directives `max-age=abc`, `max-age=10, max-age=600`, `max-age="60"` → Invalid means stale, duplicates use the most restrictive, same on both platforms · NEW `/cache/:id?cc=`
- [ ] **C-39** iOS T1 then T2 for the same cacheable URL → T2 served from the shared `NitroURLCache`, server count 1 · `/cache/:id?maxAge=60`
- [ ] **C-40** iOS cacheable response over 5 MB → Not stored (5% of 100 MB rule), documented · NEW `/cache/:id?bytes=6000000`
- [ ] **C-41** Custom `NitroFetch_httpCacheSizeMB` and the 50 MB default (Android) → An entry larger than the cap is not cached · NEW cacheable `/bytes/:n`

## 14. Cookies and credentials

- [ ] **CK-01** `Set-Cookie` then a request → Cookie sent on the next request (default credentials) · `/cookies/set`, `/cookies` _(partial: API  (iOS))_
- [ ] **CK-02** Same on Android → Cookie sent, or documented that Cronet has no jar · `/cookies`
- [ ] **CK-03** `credentials: 'omit'` → Stored cookies not sent · `/cookies` _(partial: API)_
- [ ] **CK-04** `credentials: 'omit'` → Response cookies not stored · `/cookies/set` _(partial: API)_
- [ ] **CK-05** `credentials: 'include'` and `'same-origin'` → Accepted, cookies sent · `/cookies` _(partial: API)_
- [ ] **CK-06** `credentials` from a `Request` → Honored · `/cookies` _(partial: API)_
- [ ] **CK-07** `Secure` cookie over http → Not sent · NEW
- [ ] **CK-08** `HttpOnly` cookie → Stored and sent (no document in RN) · NEW
- [ ] **CK-09** `Path` and `Domain` scoping → Sent only on matching paths and hosts · NEW
- [ ] **CK-10** Expired cookie (`Max-Age=0`) → Deleted · NEW
- [ ] **CK-11** Cookies persist across app restart → Persistent cookies kept, session cookies dropped · `/cookies`
- [ ] **CK-12** Cookies shared with React Native's built-in networking and WebView → Shared jar (iOS `HTTPCookieStorage`, Android `CookieManager`) or documented · `/cookies`
- [ ] **CK-13** `withCredentials = false` on XHR → Cookies not sent (T3) · `/cookies`
- [ ] **CK-14** Cookies on T7 cold start → Jar cookies sent · `/cookies`
- [ ] **CK-15** 50 cookies, 4 KB each → All handled per platform limits · NEW
- [ ] **CK-16** Android cookies with and without `NitroCookieSync.enableCookieSync()` → Off (default): no `Set-Cookie` stored, no `Cookie` attached on any transport. On: stored from redirects and final responses, attached when the request has no `Cookie`, never overwrites a user `Cookie` · `/cookies`
- [ ] **CK-17** Long T2 stream with cookie sync on → `Set-Cookie` visible to a parallel T1 request before the stream ends · NEW `/drip` with `Set-Cookie`

## 15. Network conditions and reliability

Use Network Link Conditioner (iOS), emulator network settings (Android), or a proxy such as mitmproxy.

- [ ] **N-01** Airplane mode → Rejects with `TypeError` quickly
- [ ] **N-02** DNS failure (`nonexistent.invalid`) → Rejects with `TypeError`
- [ ] **N-03** Connection refused (closed port) → Rejects with `TypeError`
- [ ] **N-04** Unroutable IP (`10.255.255.1`) → Times out per `timeoutMs`, no hang beyond it
- [ ] **N-05** 3G profile, 1 MB download → Completes
- [ ] **N-06** 100% packet loss mid-download → Times out or rejects
- [ ] **N-07** Wi-Fi to cellular switch mid-request → Completes or rejects cleanly. Cronet may migrate QUIC connections
- [ ] **N-08** App backgrounded during a 30 s request → Completes or rejects cleanly on resume. Document per platform
- [ ] **N-09** App backgrounded for 10 minutes with a stream open → Stream errors or resumes, no crash on foreground
- [ ] **N-10** System HTTP proxy configured → Requests go through the proxy (Charles/mitmproxy sees them)
- [ ] **N-11** Proxy requiring auth → 407 surfaced or documented
- [ ] **N-12** VPN on → Works
- [ ] **N-13** IPv6-only network (NAT64) → Works for IPv4-only hosts via NAT64
- [ ] **N-14** Captive portal → Returns the portal response or fails. No crash
- [ ] **N-15** Android Doze → Requests after wake succeed
- [ ] **N-16** JS bundle reload with 20 requests in flight → No crash, stale callbacks dropped
- [ ] **N-17** Fast Refresh with a stream open → No crash
- [x] **N-18** 50 concurrent requests → Each gets its own body _(NF)_
- [ ] **N-19** 500 concurrent requests → All complete, none mixed up
- [ ] **N-20** 10,000 sequential requests → Memory and native handles stay flat
- [ ] **N-21** 1000 requests with 1 MB bodies → Memory returns to baseline after GC
- [x] **N-22** Request while JS is blocked for 2 s → Native keeps reading (T1, T2, T3) _(NF)_
- [ ] **N-23** Response callbacks arrive on the JS thread → No calls on a background thread into JS
- [ ] **N-24** Low-memory warning during a 100 MB download → No crash
- [ ] **N-25** Happy eyeballs: black-holed IPv6, `localhost` resolving to `::1` first with an IPv4-only server, several A records with the first unreachable (NEW dual-stack host) → Connects over the working address within about 300 ms, not after a TCP timeout
- [ ] **N-26** DNS: a record changing with a 5 s TTL, NXDOMAIN then added, Android Private DNS and iOS encrypted DNS profiles (NEW local DNS server) → New connections use the new IP after the TTL, negative answers cached briefly, system DNS setting honored
- [ ] **N-27** 20,000 requests carrying a never-aborted signal finishing at once (`/get`) → No stale native task entries, memory flat
- [ ] **N-28** Latency vs the built-in fetch, release build, benchmark suite (`/get`) → Nitro median not slower. Record the % (docs claim 15 to 25%)
- [ ] **N-29** Download throughput, 50 MB on T1, T2, T3 vs built-in (`/bytes/52428800`) → MB/s at least the built-in's
- [ ] **N-30** Upload throughput, 50 MB ArrayBuffer and FormData file vs built-in (`/post`) → At least the built-in's, memory bounded
- [ ] **N-31** JS-thread time: 1 MB JSON and 1000 tiny GETs vs built-in (`/bytes/1048576`) → JS busy time not higher
- [ ] **N-32** Android buffered read and UTF-8 decode of 5 MB and 50 MB bodies (`/bytes/:n`) → No slower than the release baseline
- [ ] **N-33** Tiny-request suite (600 rounds of small GETs on T1, T2, with a signal) (`/get`) → Per-request overhead within 0.05 ms of baseline
- [ ] **N-34** Memory with 1000 prefetches never consumed (`/bytes/100000`) → Bounded, or growth documented
- [ ] **N-35** Native leaks across all suites (Instruments Leaks, Android heap dump) (all) → No leaked tasks, requests or lws contexts
- [ ] **N-36** StrictMode (Android) and Main Thread Checker (iOS) during all suites (all) → No violations from nitro packages
- [ ] **N-37** Idle cost: 10 minutes with no requests or sockets → No CPU wakeups from Cronet, NitroCronet-io or WS threads
- [ ] **N-38** Scenario: 5 MB photo upload with progress (`content://`, `ph://`, `file://`) via FormData and axios `onUploadProgress` (`/post`) → Byte-exact, progress as documented
- [ ] **N-39** Scenario: 200 MB download to disk through a T2 reader, resumed with `Range` after a kill (NEW `/range`) → Hash matches, memory bounded, resume works
- [ ] **N-40** Scenario: 50 sequential cursor-paginated pages (NEW `/page?cursor=`) → All correct, keep-alive reused, handle count flat
- [ ] **N-41** Scenario: infinite scroll, 100 rapid loads each aborting the previous (`/delay/1`) → Only the last resolves, no stale data, no leaks
- [ ] **N-42** Scenario: 10 concurrent 401s, one refresh, retry (NEW `/auth/protected`) → Single refresh, all retried with bodies re-sent, refresh failure rejects all
- [ ] **N-43** Scenario: offline queue (`/post`) → Fast `TypeError` offline, app-side replay on reconnect with no duplicate POSTs

## 16. Errors

- [ ] **ER-01** Every network failure → Rejects with `TypeError` (spec) _(partial: NF, PIN)_
- [x] **ER-02** Abort → `DOMException` named `AbortError`, or `signal.reason` _(NF)_
- [ ] **ER-03** `AbortSignal.timeout` → `TimeoutError`
- [x] **ER-04** Certificate errors are distinguishable from pin errors → Different message or code _(PIN)_
- [ ] **ER-05** Error message includes the platform error (`NSURLErrorDomain` code, Cronet `ERR_*`) → Present for debugging _(partial: NF, PIN)_
- [ ] **ER-06** No unhandled promise rejections → None logged for any case in this file
- [ ] **ER-07** No native crash on invalid input → `fetch()`, `fetch(null)`, `fetch(url, null)`, `fetch(url, 5)`
- [ ] **ER-08** Native client unavailable → Clear error or documented fallback
- [ ] **ER-09** Errors on T5 → Promise rejects with the same error type
- [x] **ER-10** Errors on T3 → `error` event, `status === 0`, `readyState === 4` _(JX)_
- [ ] **ER-11** `cancelRequest` with an unknown id, after completion, or on a second `createClient()` (`/delay/3`) → No throw, no effect
- [ ] **ER-12** Two in-flight `request()` calls with the same `requestId`, then `cancelRequest` (`/delay/3`) → Which one is cancelled is documented and the same on both platforms

## 17. Fetch API objects

- [x] **API-01** `new Headers()` from object, tuples, `Headers` → Works _(API)_
- [x] **API-02** Headers mutation and iteration order → Sorted, lowercase _(API)_
- [x] **API-03** `Headers.getSetCookie()` → Array _(API)_
- [x] **API-04** `Headers.forEach` with `thisArg` → Bound _(GR)_
- [x] **API-05** `new Request()` defaults → `method` GET, `redirect` follow _(API)_
- [ ] **API-06** `Request.signal`, `cache`, `credentials`, `mode`, `referrer`, `integrity`, `keepalive` → Present with spec defaults
- [x] **API-07** `Request.clone()` → Works before use _(API)_
- [x] **API-08** `Request.text()`, `json()`, `formData()`, `blob()`, `arrayBuffer()` → Work _(API, BIN)_
- [x] **API-09** `new Response()` → Empty 200 _(API)_
- [ ] **API-10** `new Response(body, init)` for string, Blob, ArrayBuffer, FormData, URLSearchParams, ReadableStream → Each readable _(partial: API)_
- [ ] **API-11** `new Response(null, { status })` for 200 to 599 → Works _(partial: API)_
- [ ] **API-12** `new Response(null, { status: 0 })`, `199`, `600` → Throws `RangeError`
- [ ] **API-13** Body with null-body status (`new Response('x', { status: 204 })`) → Throws `TypeError`
- [ ] **API-14** Invalid `statusText` (`'\n'`) → Throws `TypeError`
- [x] **API-15** `Response.error()` → Status 0, type `error` _(API)_
- [x] **API-16** `Response.json(data, init)` → JSON body, `Content-Type` set _(API)_
- [ ] **API-17** `Response.json()` with a BigInt or cycle → Throws `TypeError`
- [x] **API-18** `Response.redirect(url, status)` → `Location` set, invalid status throws `RangeError` _(API)_
- [ ] **API-19** `integrity` option (SRI) → Enforced, or documented as unsupported
- [ ] **API-20** `keepalive: true` → Accepted, request completes
- [ ] **API-21** `mode: 'cors'`, `'no-cors'`, `'same-origin'` → Accepted, no CORS enforcement (native client). Document
- [ ] **API-22** `referrerPolicy` → Accepted
- [x] **API-23** `priority: 'high'`, `'low'`, `'auto'` → Complete on T1, T2, T5, T6 _(NF)_
- [x] **API-24** `priority` persisted on T7 → High and low saved, auto omitted _(NF)_
- [ ] **API-25** Unknown init keys → Ignored
- [ ] **API-26** `new Headers({'bad name':'x'})`, `append('x','a\r\nb')`, `set('', 'v')`, `get('bad name')` → Each throws `TypeError` at the call, not later inside fetch. `new Headers({a:' v\t'}).get('a') === 'v'`
- [ ] **API-27** `new Headers([['a']])` and `new Headers([['a','b','c']])` → Both throw `TypeError` (each pair needs exactly 2 items)
- [ ] **API-28** Iterate a `Headers` holding two `Set-Cookie` values (`for...of`, `entries()`, `forEach`) (`/cookies/set?a=1&b=2`) → Two separate `set-cookie` entries, never one joined value. `get('set-cookie')` is joined _(partial: API)_
- [ ] **API-29** `new Request(url, {method:'GET', body:'x'})`, `{method:'CONNECT'}`, `{method:'GE T'}` → The constructor throws `TypeError` (not only fetch)
- [ ] **API-30** `new Request('/rel')`, `new Request('http://u:p@host/')`, `new Request('http://')` → Each throws `TypeError`
- [ ] **API-31** `new Request('HTTP://EXAMPLE.com/a b#f').url` → `http://example.com/a%20b#f` (parsed and serialized, not `String(input)`)
- [ ] **API-32** `redirect` and `cache` set on a global `Request` passed to fetch (`/redirect/1`) → Both honored (`redirect:'error'` rejects, `cache:'no-store'` applied)
- [ ] **API-33** Default `Content-Type` on the objects: `new Request(u,{method:'POST',body:'x'}).headers`, `new Response('x').headers`, `new Response(new Blob([],{type:'image/png'})).headers` → `text/plain;charset=UTF-8`, `text/plain;charset=UTF-8`, `image/png`. URLSearchParams gives form-urlencoded, bytes give none _(partial: BIN)_
- [ ] **API-34** `Request.text()`, `arrayBuffer()`, `blob()` and `body` for URLSearchParams, Blob and FormData bodies → Return `'a=1'` or the exact bytes, `body` is a stream
- [ ] **API-35** `new Response({url:'x', status:500, ok:true})` (a plain object body) → Status 200, `text()` is `'[object Object]'`. Never mistaken for an internal init
- [ ] **API-36** `clone()` of `new Response(stream)` and `new Response(blob)`, then mutate `clone.headers` → Both branches read the full body, the original's headers do not change _(partial: API)_
- [ ] **API-37** `Response.redirect('http://')` and `Response.redirect('/rel')` → Throws `TypeError` (invalid URL). A valid URL is serialized into `Location`

## 18. XMLHttpRequest

- [ ] **X-01** `readyState` sequence → 0, 1, 2, 3, 4 with `onreadystatechange` for each _(partial: XHR, JX)_
- [ ] **X-02** Event order → `loadstart`, `progress`, `load`, `loadend` _(partial: XHR)_
- [x] **X-03** Network error events → `error`, `loadend`, `status === 0` _(JX)_
- [ ] **X-04** `abort()` → `abort`, `loadend`, `readyState` ends at 0 _(partial: XHR, JX)_
- [ ] **X-05** `abort()` after `DONE` → No events
- [x] **X-06** `timeout` → `timeout` event _(JX)_
- [ ] **X-07** `responseType = ''` and `'text'` → `responseText` is the body _(partial: JX)_
- [ ] **X-08** `responseType = 'json'` → Parsed object, `null` on invalid JSON _(partial: JX)_
- [ ] **X-09** `responseType = 'arraybuffer'` → Exact bytes
- [ ] **X-10** `responseType = 'blob'` → Blob with the right size and type _(partial: XHR)_
- [ ] **X-11** `responseType = 'document'` → Unsupported, documented
- [ ] **X-12** `responseText` with a non-text `responseType` → Throws `InvalidStateError`
- [ ] **X-13** `getAllResponseHeaders()` → Lowercase names, CRLF separated _(partial: JX)_
- [ ] **X-14** `getResponseHeader()` → Case-insensitive, `null` when missing _(partial: JX)_
- [ ] **X-15** `setRequestHeader()` before `open()` or after `send()` → Throws `InvalidStateError`
- [ ] **X-16** `open()` twice → Resets state
- [ ] **X-17** `send()` twice → Throws `InvalidStateError`
- [ ] **X-18** Synchronous `open(method, url, false)` → Unsupported in React Native, documented
- [ ] **X-19** Upload progress (`upload.onprogress`) on a 10 MB upload → Events with increasing `loaded`
- [ ] **X-20** Download progress with `lengthComputable` → `total` from `Content-Length` _(partial: XHR)_
- [ ] **X-21** `responseURL` after redirect → Final URL
- [ ] **X-22** `overrideMimeType()` → No-op or applied. Document
- [ ] **X-23** `withCredentials` → Default true in RN, cookies follow it _(partial: JX)_
- [x] **X-24** SuperAgent lifecycle, query, JSON, files, deadline → Works _(XHR)_
- [ ] **X-25** axios default XHR adapter (GET, POST, interceptors, cancel token, `onUploadProgress`, `onDownloadProgress`) → Works
- [x] **X-26** `readystatechange` listener while JS is busy → Body still read _(NF)_
- [x] **X-27** Body while JS is busy → Read _(NF)_
- [ ] **X-28** XHR uses the default client (`useDefaultClient()`) → Shares connections and cache with T1 _(partial: NF)_
- [x] **X-29** XHR with `Accept: text/event-stream` stays on the streaming client → Streams (T4) _(NF, JX)_
- [ ] **X-30** `addEventListener` and `removeEventListener` → Removed listeners do not fire
- [x] **X-31** XHR transport choice → Buffered for unobserved `''`/`text`/`json` and FormData uploads. Streamed when `onreadystatechange`, `onprogress`, arraybuffer/blob, or a custom method is used _(JX)_
- [x] **X-32** XHR `Accept` matching for event streams (`Text/Event-Stream`, with charset, in a q-list) → Those go to the streaming client. `text/event-streams` and `*/*` stay on the default client _(JX)_
- [x] **X-33** Setting `responseType` after `send()` → Throws _(JX)_
- [ ] **X-34** XHR FormData upload progress (`/post`) → Fires at completion only (documented), file URIs work
- [ ] **X-35** `xhr.upload` events during a 5 MB upload (`/post`) → `loadstart`, `progress`, `load`, `loadend` during the upload, none without a body
- [ ] **X-36** Upload terminal events (`/delay/3`) → Abort mid-upload fires `upload.onabort` and `upload.onloadend`. Error fires `upload.onerror`. Timeout fires `upload.ontimeout`
- [ ] **X-37** `load`, `loadend`, `abort` ProgressEvent fields (`/bytes/1024`) → `loaded` equals body bytes, `total` and `lengthComputable` from `Content-Length`
- [ ] **X-38** `statusText` (`/status/404`) → Reason phrase after HEADERS_RECEIVED, `''` before and after an error _(partial: JX)_
- [ ] **X-39** Getters after error, timeout, abort and a mid-body failure (`/drip?fail=1`) → `status 0`, `statusText ''`, `responseText ''`, `getAllResponseHeaders() ''`, `getResponseHeader()` null, `responseURL ''`
- [ ] **X-40** `Set-Cookie` filtering (`/cookies/set?a=1&b=2`) → `getResponseHeader('set-cookie')` is null and `getAllResponseHeaders()` omits it, or React Native behavior documented
- [ ] **X-41** `responseXML` (`/get`) → Exists, null for `''` and `text`, throws `InvalidStateError` for other types
- [ ] **X-42** `responseType` set after `send()` (`/drip`) → Allowed until LOADING, throws `InvalidStateError` at LOADING and DONE _(partial: JX)_
- [ ] **X-43** `timeout` changed after `send()` (`/delay/3`) → New value applies from send start, 0 cancels the timer
- [ ] **X-44** `abort()` inside handlers (readystatechange 2 and 3, progress, onload) (`/drip`) → One `abort`, then `loadend`, no `load`. In onload: no `abort`, `loadend` once
- [ ] **X-45** `abort()` after `open()`, before `send()` (`/get`) → No events, state stays OPENED, `send()` still works
- [ ] **X-46** `open()` while LOADING, and reuse after DONE (`/drip-report/:id`) → Stops the native request without events, back to OPENED. Reuse works
- [ ] **X-47** Synchronous validation → `CONNECT`, `TRACE`, `TRACK` throw `SecurityError` at `open()`. Bad method or URL throws `SyntaxError`. Bad header name or CR/LF throws `SyntaxError` at once
- [ ] **X-48** `send(body)` on GET and HEAD (`/get`) → Body dropped, request succeeds
- [ ] **X-49** Listener throws (`/drip`) → Other listeners run, `load` and `loadend` still fire, no synthetic `error`
- [ ] **X-50** Download progress on gzip (`/text?gzip=1&phrase=a&repeat=200000`) → `loaded` vs compressed `total` consistent, or `lengthComputable` false
- [ ] **X-51** Incremental `responseText` on a 20 MB body (`/text?chunked=1&phrase=abcdefghij&repeat=2000000`) → Grows monotonically, finishes in linear time
- [ ] **X-52** Blob response interop (`/bytes/256`) → All 256 byte values byte-exact via FileReader, re-send through `xhr.send(blob)` and fetch byte-exact, `URL.createObjectURL` works _(partial: XHR)_

## 19. Worklets

- [x] **WK-01** GET with a string mapper → Mapped result _(NF)_
- [ ] **WK-02** POST with a body → Sent, mapper sees response
- [ ] **WK-03** Custom headers → Sent
- [ ] **WK-04** `preferBytes: true` → Mapper gets `bodyBytes`
- [ ] **WK-05** `preferBytes: false` → Mapper gets `bodyString` _(partial: NF)_
- [ ] **WK-06** Payload fields → `url`, `status`, `statusText`, `ok`, `redirected`, `headers` correct
- [ ] **WK-07** Non-2xx → Resolves, `ok === false`
- [ ] **WK-08** Mapper throws → Promise rejects with that error
- [ ] **WK-09** Mapper returns a non-serializable value → Rejects with a clear error
- [ ] **WK-10** `react-native-worklets` not installed → Falls back to the JS thread
- [ ] **WK-11** `runtimeName` → Runtime created with that name, reused across calls
- [ ] **WK-12** 20 concurrent worklet requests → All complete
- [x] **WK-13** `timeoutMs` → Applied _(NF)_
- [x] **WK-14** `priority` → Accepted _(NF)_
- [ ] **WK-15** JS thread stays responsive during a 5 MB parse → Frame drops measured, JS not blocked
- [ ] **WK-16** Network error → Rejects
- [ ] **WK-17** Worklet with a `Request` object as input (`/post`) → Method, headers and body taken from the Request
- [ ] **WK-18** Worklet with a FormData or Blob body (`/post`) → Rejects with a clear error, mapper never runs
- [ ] **WK-19** Second worklet call with a different `runtimeName` → Uses the new name, or documented that the first sticks
- [ ] **WK-20** Worklet with a `data:` URL → Decoded like T1
- [ ] **WK-21** `requestSync()` on the JS thread, and while a prefetch for its key is pending (`/delay/2`) → Returns a response. Document that it blocks and cannot be cancelled
- [ ] **WK-22** Worklet request carrying a `prefetchKey` after `prefetch()` (`/cache/:id`) → Mapper gets the cached response, server count 1
- [x] **WK-23** Mapper runs on a worker runtime (`/get`) → `getRuntimeKind() === RuntimeKind.Worker` inside the mapper _(NF)_
- [ ] **WK-24** Requests from the JS runtime and 2 worklet runtimes at once (`/delay/1`) → No deadlock, each gets its own response
- [ ] **WK-25** Expo SDK 54+ default template (worklets babel plugin) (`/get`) → `nitroFetchOnWorklet` runs on the worker runtime

## 20. Prefetch and auto-prefetch

- [x] **PF-01** `prefetch()` without a key → Throws _(NF)_
- [x] **PF-02** Key in headers or `init.prefetchKey` → Resolves _(NF)_
- [ ] **PF-03** Consume after the prefetch completed → Response has `nitroPrefetched: true`, no second network request _(partial: NF)_
- [ ] **PF-04** Consume while the prefetch is pending → Joins the in-flight request
- [ ] **PF-05** Consume after the 5 s default TTL → New network request
- [x] **PF-06** Custom `prefetchCacheTtlMs` → Kept fresh past 5 s _(NF)_
- [ ] **PF-07** Consume twice → Second fetch goes to the network (or document single-use)
- [ ] **PF-08** Same key, different URL → No cross-serving
- [ ] **PF-09** Prefetch fails → Joined fetch rejects _(partial: PIN)_
- [ ] **PF-10** Prefetch returns 404 → Consumer sees 404
- [x] **PF-11** Prefetch with POST body → Replayed correctly _(NF)_
- [x] **PF-12** Prefetch with priority → Served from cache _(NF)_
- [x] **PF-13** `prefetchKey` never sent to the server → Yes _(NF)_
- [ ] **PF-14** `prefetchOnAppStart` replay on cold start (iOS, Android) → Request starts before JS, first JS fetch is a hit _(partial: NF)_
- [x] **PF-15** Binary body replay → Byte-exact _(NF)_
- [x] **PF-16** `removeFromAutoPrefetch(key)` → Entry gone _(NF)_
- [ ] **PF-17** `removeAllFromAutoprefetch()` → Queue empty
- [ ] **PF-18** Same key queued twice → Deduped, last write wins
- [ ] **PF-19** Queue encrypted at rest → Raw `SharedPreferences` / `UserDefaults` value is not plaintext JSON
- [ ] **PF-20** Plaintext queue from an older version → Read back and re-written encrypted
- [ ] **PF-21** Keystore/Keychain unavailable → Falls back to plaintext, entry not lost
- [ ] **PF-22** Malformed queue JSON → App starts, queue ignored, no crash
- [ ] **PF-23** 100 queued entries → All replayed, startup not blocked
- [ ] **PF-24** `NitroAutoPrefetcher.prefetchOnStart()` called twice (iOS) → Second call is a no-op
- [x] **PF-25** Native `registerPrefetch` first-run → First JS fetch is a hit _(NF)_
- [ ] **PF-26** Token refresh runs before auto-prefetch → Refreshed header used _(partial: TR)_
- [ ] **PF-27** `fetch` with `stream: true` and the same `prefetchKey` after `prefetch()` (`/cache/:id`) → Goes to the network, the entry is still served to a later T1 fetch
- [ ] **PF-28** `prefetchOnAppStart` with no `prefetchKey` → Throws, queue unchanged
- [ ] **PF-29** `prefetch(url, { signal })` then abort (`/delay/3`) → Documented: signal ignored, prefetch completes and stays consumable
- [ ] **PF-30** `removeFromAutoPrefetch` for the last entry and for an unknown key → Last: storage key removed, queue `[]`. Unknown: queue untouched
- [ ] **PF-31** `prefetch()` promise on a slow or failing request (`/delay/3`) → Same on both platforms, or documented (iOS resolves when scheduled, Android after the response)
- [ ] **PF-32** `prefetch()` with `prefetchKey: ''` (`/get`) → Rejects on both platforms
- [ ] **PF-33** Consume with `prefetchCacheTtlMs` 0, negative, NaN, Infinity, 1e300 (`/cache/:id`) → 0, negative, NaN: miss, no native trap. Infinity: hit
- [ ] **PF-34** Fetch after a prefetch that already failed (not joined) (closed port, then `/get`) → Goes to the network and succeeds, failure not cached
- [ ] **PF-35** `prefetch()` twice for one key while the first is pending (`/cache/:id`) → One network request, both resolve
- [ ] **PF-36** `prefetch(url, { redirect: 'manual' })` then consume (`/redirect/1`) → Consumer sees the 3xx on both platforms
- [ ] **PF-37** 50 concurrent prefetch and consume pairs on the same and different keys, with TTL eviction racing reads (`/delay/1`) → No deadlock, each consumer gets one complete response
- [ ] **PF-38** Native non-persisted prefetch (`AutoPrefetcher.prefetch(req)`, `NitroAutoPrefetcher.prefetch(options:)`) (`/cache/:id`) → JS consumer gets `nitroPrefetched`. One caller cancelling does not cancel the shared request
- [ ] **PF-39** Extended native `registerPrefetch` overloads (method, body, base64, FormData, timeout, redirects, TTL) (`/post`) → Replayed exactly. Android 4-arg call still compiles
- [ ] **PF-40** `NativeStorage` plain API (`getString`, `setString`, `removeString`) → Round-trips, missing key returns `''`, secure keys read as `nfc1:` ciphertext
- [ ] **PF-41** TTL passed on `prefetch` but not on the consuming fetch (`/get`) → Consume applies the 5 s default
- [x] **PF-42** Queue entry defaults omitted (`prefetchCacheTtlMs`, method/body on GET, `followRedirects` on follow) → Fields absent from the stored entry _(NF)_

## 21. Token refresh

- [x] **TK-01** JSON field into a templated header → Header set _(TR)_
- [x] **TK-02** Field without a template → Set verbatim _(TR)_
- [x] **TK-03** Nested dot-path, composite header → Works _(TR)_
- [x] **TK-04** Text response template → Works _(TR)_
- [x] **TK-05** Non-2xx refresh endpoint → Rejects _(TR)_
- [x] **TK-06** Refreshed token reaches the API → Yes _(TR)_
- [x] **TK-07** Refreshed token flows through a prefetch → Yes _(TR)_
- [ ] **TK-08** `bodyMappings` into a JSON body → Key set, only for JSON bodies
- [ ] **TK-09** `formDataMappings` → Field replaced or appended
- [ ] **TK-10** `target: 'fetch'`, `'websocket'`, `'all'` → Applied to the right queues
- [ ] **TK-11** `clearTokenRefresh()` → Config removed
- [ ] **TK-12** `getStoredTokenRefreshConfig()` → Returns what was registered
- [ ] **TK-13** Refresh endpoint times out on cold start → Auto-prefetch proceeds or skips. Documented, no hang
- [ ] **TK-14** Config stored encrypted → Not plaintext at rest
- [ ] **TK-15** `getNestedField('items.0.token')` and `applyTemplate` with two `{{value}}` → Array element resolved natively and in JS. Every `{{value}}` replaced
- [ ] **TK-16** Missing `jsonPath` and a missing composite placeholder (`/token`) → Header omitted (not `"undefined"`), missing placeholder becomes `''`
- [ ] **TK-17** `callRefreshEndpoint` against a 200 with an empty body (NEW `/token/empty`) → Rejects with `SyntaxError`
- [ ] **TK-18** `clearTokenRefresh('fetch')` → Removes the fetch config and its cached tokens, websocket config untouched
- [ ] **TK-19** `bodyTextPath` and `formDataTextField` with a text refresh response (`/token/text`) → Text token written into the JSON body path or form field on replay
- [ ] **TK-20** Native token value types (`true`, `123`) (NEW `/token?shape=typed`) → Injected the same way as JS `callRefreshEndpoint`
- [ ] **TK-21** `bodyMappings` with a nested path and with a non-object JSON body (`/post`) → Intermediate objects created. Arrays and non-JSON bodies untouched
- [ ] **TK-22** `formDataMappings` targeting an existing file part (`/post`) → Documented (part becomes a text field)
- [ ] **TK-23** Android cold-start refresh fails 100 times (non-2xx, exception, timeout) (`/token/fail`) → No leaked `HttpURLConnection` or socket

## 22. Network inspector and curl

- [x] **NI-01** Disabled by default, captures nothing → Yes _(NI)_
- [x] **NI-02** Captures entries when enabled → Yes _(NI)_
- [x] **NI-03** Entry has a curl command → Yes _(NI)_
- [x] **NI-04** POST body captured → Yes _(NI)_
- [x] **NI-05** `onEntry`, `clear()`, `maxEntries` → Work _(NI)_
- [ ] **NI-06** Streaming (T2) requests captured → Entry completes when the stream ends
- [ ] **NI-07** Failed and aborted requests captured → Error recorded
- [ ] **NI-08** Timing fields → Start and end present and ordered _(partial: NI)_
- [ ] **NI-09** Binary bodies → Shown as a size, not garbage text
- [ ] **NI-10** XHR requests captured → Yes
- [ ] **NI-11** Real WebSocket traffic captured (not only `_record*`) → Open, messages, close, error
- [x] **NI-12** `generateCurl` escaping → Quotes and special characters escaped _(NI)_
- [ ] **NI-13** Inspector on a socket with no handlers assigned (`/ws/echo`) → Connected, messages and close still recorded
- [ ] **NI-14** Inspector size for sent text `'é'.repeat(10)` (`/ws/echo`) → 20 bytes, not 10
- [ ] **NI-15** `enable({ maxBodyCapture: 10 })` and the defaults (4096, 500 entries) (`/post`) → Bodies truncated, sizes report the full length
- [ ] **NI-16** Body sizes for multi-byte text and binary bodies (`/bytes/1024`) → Reported in bytes
- [ ] **NI-17** `getEntry(id)`, `onEntry` unsubscribe, a throwing listener (`/get`) → Filters correct, unsubscribed listener silent, throwing listener swallowed
- [ ] **NI-18** `disable()` while a request is in flight (`/delay/2`) → Entry completed, or documented
- [ ] **NI-19** `maxEntries` lowered while holding more entries (`/get`) → Trimmed to the new max at once
- [ ] **NI-20** `data:`, `file://` and worklet requests → Captured, or documented as not captured
- [ ] **NI-21** `generateCurl` options → GET omits `-X`, `prefetchKey` omitted, body over 10,000 chars truncated, `verbose` adds `-v`, `compressed` adds `--compressed` _(partial: NI)_
- [ ] **NI-22** `profileFetch` → Returns the result. On Hermes, path of an existing `.cpuprofile`. `fn` throws: profiler stopped, error rethrown _(partial: NI)_
- [ ] **NI-23** React Native DevTools Network panel (debug) (`/get`) → T1 and T2 show start, headers, body and end, failures and cancels marked. Release reports nothing
- [ ] **NI-24** DevTools opt-out (`NitroFetch_disableDevToolsReporting`, `NITROFETCH_DISABLE_DEVTOOLS_REPORTING=1`) (`/get`) → Entries removed, results identical
- [ ] **NI-25** Native HTTP tracing (`NitroFetch_enableTracing`, `NITROFETCH_TRACING=1`) (`/get`) → One section per request ending on success, failure and cancel. Off by default
- [ ] **NI-26** Memory with the inspector on for 10,000 requests with 1 MB bodies (`/bytes/1048576`) → Bounded by `maxEntries` x `maxBodyCapture`
- [ ] **NI-27** React Native XHRInterceptor, Reactotron and the DevTools panel with Nitro XHR (`/post`) → Method, URL, headers, status and body shown

## 23. Global replace and library interop

- [x] **G-01** `globalThis.fetch`, `Headers`, `Request`, `Response` replaced → Work _(GR)_
- [x] **G-02** Restoring originals → Original globals back _(GR)_
- [x] **G-03** axios fetch adapter → GET, query, JSON, headers, non-2xx, `validateStatus`, arraybuffer, interceptors _(GR)_
- [ ] **G-04** axios default XHR adapter after replacing `XMLHttpRequest` → Same suite as G-03
- [ ] **G-05** ky (retry, hooks, timeout, `json()`) → Works
- [ ] **G-06** Apollo `HttpLink` → Query and mutation
- [ ] **G-07** urql → Query
- [ ] **G-08** TanStack Query with nitro fetch → Query, refetch, cancellation via `signal`
- [ ] **G-09** RTK Query `fetchBaseQuery` → Works
- [ ] **G-10** `openapi-fetch` / `ofetch` → Works
- [x] **G-11** SuperAgent → Works _(XHR)_
- [ ] **G-12** Firebase / Supabase JS clients that call `fetch` → Basic calls work
- [ ] **G-13** Libraries reading `response.body` (AI SDK streaming) → Token stream arrives incrementally
- [ ] **G-14** `Object.prototype.toString.call` on Response, Request, Headers → `[object Response]`, `[object Request]`, `[object Headers]` _(partial: JR)_
- [ ] **G-15** axios fetch adapter config (`Request`/`Response` null, progress callbacks, `env.fetch` on axios < 1.12) (`/post`) → Behaves as documented in global-replace.md
- [ ] **G-16** Custom AxiosAdapter recipe from the skill (baseURL, params, timeout, cancel, responseType, validateStatus) (`/get`) → Works as documented
- [ ] **G-17** Same pin file used by react-native-ssl-public-key-pinning (aws.amazon.com) → Both work side by side
- [ ] **G-18** React Native built-in fetch (whatwg-fetch over XHR) with only `XMLHttpRequest` replaced (`/bytes/256`) → `text`, `json`, `arrayBuffer`, `blob` byte-exact, abort works

## 24. Local URLs

- [x] **L-01** `data:` text, base64, JSON, binary, default type → Decoded _(LU)_
- [ ] **L-02** `data:` with `charset=iso-8859-1` → Decoded with that charset
- [ ] **L-03** 10 MB `data:` URL → Works, stays fast
- [x] **L-04** `file://` and scheme-less absolute path → Read _(LU)_
- [x] **L-05** `Content-Type` from extension → Guessed _(LU)_
- [x] **L-06** Missing file → Rejects _(LU)_
- [x] **L-07** Percent-encoded file paths, literal `+` → Decoded correctly _(LU)_
- [ ] **L-08** `content://` (Android) → Read
- [ ] **L-09** Bundled asset (`asset:///`, iOS bundle path) → Read
- [ ] **L-10** `file://` with `stream: true` → Streams or documented
- [x] **L-11** `blob:` URL → Rejects with `TypeError` _(LU)_
- [ ] **L-12** `data:` URL without a comma, and with a malformed percent escape → Rejects with `TypeError` (no `URIError` escapes)
- [ ] **L-13** `data:;base64` carrying non-UTF-8 bytes → `arrayBuffer()` exact, `text()` uses U+FFFD
- [ ] **L-14** `data:` text with no TextDecoder available → One hint logged, `arrayBuffer()` and `bytes()` still work
- [ ] **L-15** `data:` URL with `stream: true` → Falls back to the buffered path
- [x] **L-16** Cost of the `data:` fast path → 2000 small `data:` fetches average under 2 ms each _(LU)_
- [ ] **L-17** `file://` pointing at a directory, and a file with no extension (NEW fixture) → Directory rejects with `TypeError`, no extension gives `application/octet-stream`
- [ ] **L-18** 50 MB `file://` read on Android (NEW fixture) → JS thread stays responsive

## 25. Platform specifics

- [ ] **PL-01** Android picks the Native Cronet provider → Log shows the provider, falls back to default if missing
- [ ] **PL-02** Android `NitroFetch_cronetVersion` override → Builds and runs
- [ ] **PL-03** Android `NitroFetch.shutdown()` then a new request → Engine recreated or clear error
- [ ] **PL-04** Android FormData file part uses HttpURLConnection → Still honors pinning and timeouts _(partial: PIN)_
- [ ] **PL-05** iOS `URLCache` path `nitrofetch_urlcache` → Created and used
- [ ] **PL-06** iOS `NitroBootstrap.mm` triggers auto-prefetch without AppDelegate code → Yes
- [ ] **PL-07** New Architecture, bridgeless → All suites pass
- [ ] **PL-08** Hermes and JSC (if supported) → All suites pass
- [ ] **PL-09** Release build (minified, ProGuard/R8 on Android) → All suites pass, no stripped classes
- [ ] **PL-10** Oldest supported iOS and Android API level → Core suites pass
- [ ] **PL-11** iOS 16+ `URLSessionTask.priority` path → Applied for non-streamed requests
- [ ] **PL-12** `NitroFetch.shutdown()`, then T1 and T2 (`/get`) → T2 keeps working, T1 rebuilds the engine
- [ ] **PL-13** DevTools reporting on vs off (Android executor change) (`/drip`) → Identical results, ordering and timeouts unchanged
- [ ] **PL-14** iOS SDKs that swizzle `URLSessionDelegate` (Sentry, Datadog, Firebase Performance, Pulse) (`/get`) → Requests complete, no crash
- [ ] **PL-15** Android 16 KB page-size device → All `.so` libraries load, suites pass
- [ ] **PL-16** AGP 9 with the default Cronet, and an older `NitroFetch_cronetVersion` → Builds. Older Cronet fails as documented
- [ ] **PL-17** iOS `use_frameworks! :linkage => :static` → Builds, `+load` bootstraps still run auto-prefetch and prewarm
- [ ] **PL-18** Install from npm-packed tarballs outside the monorepo → pod install, Gradle and both Expo plugins work, peer deps resolve
- [ ] **PL-19** Metro with `unstable_enablePackageExports = false` → nitro-fetch and text-decoder bundle
- [ ] **PL-20** Consumer `tsc --noEmit` on documented snippets → No type errors
- [ ] **PL-21** Android `debugOptimized` build type (`/get`) → Requests show in DevTools
- [ ] **PL-22** Expo plugins inject the Android startup hooks → `prefetchOnStart` and `prewarmOnStart` inserted once after `super.onCreate()`, both plugins together compile
- [ ] **PL-23** Android cache directories (`/cache/:id`) → T1 `<cacheDir>/nitrofetch_cronet_cache`, T2 `<cacheDir>/nitro_cronet_cache`
- [ ] **PL-24** Startup main-thread cost of `prefetchOnStart`, `prewarmOnStart`, `NitroBootstrap` with 20 queued entries → A few ms on the main thread, no ANR. First-request latency recorded
- [ ] **PL-25** Expo Go → Clear error, or fallback to built-in fetch (documented)
- [ ] **PL-26** expo-dev-client debug build → All suites pass, dev-launcher swizzling does not break requests
- [ ] **PL-27** `expo prebuild --clean` plus a release build with both plugins → Builds, auto-prefetch and prewarm run on Android with no manual edits
- [ ] **PL-28** Old Architecture (bridge) on supported versions → Works, or documented as unsupported
- [ ] **PL-29** React Native version matrix (documented minimum to current) → Builds, core suites pass
- [ ] **PL-30** Two copies or versions of react-native-nitro-modules or nitro-fetch in a monorepo → One native copy, clear error on mismatch
- [ ] **PL-31** Alongside another Cronet (Play Services, another SDK) → No duplicate classes, Native provider still preferred
- [ ] **PL-32** Alongside native libs that bundle mbedTLS, libwebsockets, simdutf or MMKV → No duplicate symbols
- [ ] **PL-33** Android multi-process (`android:process=":remote"`) (`/get`) → Prefetch and prewarm safe in the second process, shared cache directory does not fail
- [ ] **PL-34** iOS app extension linking NitroFetch (`/get`) → `+load` bootstraps do not crash without `UIApplication`, requests work
- [ ] **PL-35** tvOS build → Builds, core suites pass
- [ ] **PL-36** App size per package (Cronet, libwebsockets + mbedTLS, simdutf) → Recorded per release with a growth threshold
- [ ] **PL-37** Release builds have no nitro logs, DevTools reporter or tracing (`/get`) → None present

## 26. Web

- [ ] **WEB-01** `fetch` export on web → Uses the browser `fetch`
- [ ] **WEB-02** `prefetch`, `nitroFetchOnWorklet` on web → No-op or JS fallback, no crash
- [ ] **WEB-03** `blob.web.ts` → Uses the browser `Blob`
- [ ] **WEB-04** CORS on web → Browser rules apply (unlike native)
- [ ] **WEB-05** Web `fetch(new Request(url, { method: 'POST', body, signal }))` (`/post`) → Unwrapped to browser fetch with body, headers, redirect, cache and signal
- [ ] **WEB-06** Web `registerTokenRefresh`, `getStoredTokenRefreshConfig`, `NitroFetch.createClient` → Warn, return null or no-op, never throw
- [ ] **WEB-07** Web bundle (webpack / Expo web) → Builds with no warnings

---

# Part 2: WebSockets

Endpoints are on the local server unless noted. `wss://` rows need echo.websocket.org or the local
TLS listener. Run each item on iOS and Android, over `ws://` and `wss://`.

## 27. Connection

- [ ] **WS-C01** Connect over `ws://` → `readyState` goes `CONNECTING` then `OPEN`, `onopen` once · `/ws/echo` _(partial: WS)_
- [x] **WS-C02** Connect over `wss://` → Same over TLS · echo.websocket.org _(WS)_
- [ ] **WS-C03** `url` property → Matches the requested URL · `/ws/echo` _(partial: WS)_
- [ ] **WS-C04** Path and query preserved → Server sees them · `/ws/url?a=1` _(partial: WS)_
- [ ] **WS-C05** Space in the URL → Encoded · `/ws/url` _(partial: WS)_
- [x] **WS-C06** Non-default port in `Host` → Included · `/ws/headers` _(WS)_
- [ ] **WS-C07** IPv4 and IPv6 literals → Connect · `/ws/echo`
- [ ] **WS-C08** URL with a fragment → Throws `SyntaxError` (spec) or ignores it. Document
- [ ] **WS-C09** Invalid URL → Throws `SyntaxError`, no native crash
- [ ] **WS-C10** `http://` and `https://` URLs → Mapped to `ws`/`wss` (current spec) or rejected. Document · `/ws/echo`
- [ ] **WS-C11** Unsupported scheme `ftp://` → Throws `SyntaxError`
- [ ] **WS-C12** Unreachable host → `onerror` then `onclose` 1006 · WS
- [ ] **WS-C13** Connection refused → `onerror` then `onclose` 1006 · closed port
- [ ] **WS-C14** DNS failure → `onerror` then `onclose` 1006 · `nonexistent.invalid` _(partial: WS)_
- [ ] **WS-C15** Handshake never completes → Stays `CONNECTING`. A client handshake timeout fires, or `close()` ends it · `/ws/stall` _(partial: WS)_
- [ ] **WS-C16** Server answers 200, 404, 500 instead of 101 → `onerror`, `onclose` 1006, `wasClean === false` · NEW `/ws/status/:code`
- [ ] **WS-C17** Wrong `Sec-WebSocket-Accept` → Fails the connection · NEW `/ws/bad-accept`
- [ ] **WS-C18** Missing `Upgrade` / `Connection` headers in the 101 → Fails the connection · NEW
- [x] **WS-C19** Redirect with a long `Location` (more than 308 bytes) → Followed · `/ws/redirect` _(WS)_
- [x] **WS-C20** Short relative `Location` → Followed · `/ws/redirect` _(WS)_
- [x] **WS-C21** Absolute `Location` without a path → Followed · `/ws/redirect` _(WS)_
- [x] **WS-C22** Too many redirects → One error, one close · `/ws/redirect?n=50` _(WS)_
- [ ] **WS-C23** Redirect to a non-WebSocket location → One error, one close · `/ws/redirect?to=/get` _(partial: WS)_
- [ ] **WS-C24** 50 sockets open at once → All open and echo · `/ws/echo`
- [x] **WS-C25** `connect()` again on an open hybrid object → Replaces it, no events from the old one · `/ws/echo` _(WS)_
- [x] **WS-C26** `connect()` after close → Opens and closes again · `/ws/echo` _(WS)_
- [ ] **WS-C27** Connect, close repeated 100 times during the handshake → No crash or leak · `/ws/stall` _(partial: WS)_
- [ ] **WS-C28** Uppercase scheme and host with an empty path (`WSS://LOCALHOST:9876`) → Connects. `url` returns the serialized form: lowercase scheme and host, trailing `/` · `/ws/url`
- [ ] **WS-C29** URL with userinfo `ws://u:p@host/ws/headers` → Connects without sending credentials, or documented. Same on both platforms · `/ws/headers`
- [ ] **WS-C30** Non-ASCII path and query (`/ws/url/日本?q=café`) → Percent-encoded as UTF-8 in the request line on both platforms · `/ws/url`
- [ ] **WS-C31** IDN host (`bücher.example`) → Punycode for DNS and `Host`, or `SyntaxError`. Same on both platforms · public IDN host
- [ ] **WS-C32** Port 0, 65536, `abc`, leading zeros, and 65535 → Invalid ports raise `SyntaxError` (or async `onerror` + 1006, documented). 65535 accepted
- [ ] **WS-C33** `url` after a followed redirect → Same value on both platforms. Spec says browsers do not follow WebSocket redirects; document that Nitro follows up to 20 · `/ws/redirect?to=/ws/url` _(partial: WS)_
- [ ] **WS-C34** Exactly 20 redirect hops vs 21 → 20 followed and the socket opens. 21 gives one error and one close 1006 · `/ws/redirect?n=20&to=/ws/url`
- [ ] **WS-C35** Cross-origin redirect carrying `Authorization` → Not sent to the new origin. Kept on a same-origin hop. Same on both platforms · NEW WS listener on `:9878`
- [ ] **WS-C36** Redirect statuses 301, 303, 307, 308 with `Location`, and 300 / 304 with `Location` → First four followed, the others fail · NEW `/ws/redirect?status=`
- [ ] **WS-C37** Redirect from `wss://` to `ws://` → Refused with error + 1006 on both platforms · NEW local TLS + `/ws/redirect`
- [ ] **WS-C38** `Location` with an `http://` or `https://` scheme → Mapped to `ws`/`wss` and followed · `/ws/redirect?to=http://...`
- [ ] **WS-C39** Custom headers, protocols and `Set-Cookie` across a redirect hop → Headers and protocols re-sent. Cookie handling documented per platform · `/ws/redirect?to=/ws/headers`
- [ ] **WS-C40** iOS URLSession transport (`NitroWebSocketsUseNetworkFramework=false` in Info.plist) → Sections 27 to 34 pass on the fallback transport too · `/ws/*`
- [ ] **WS-C41** `ws://` in an iOS app without an ATS exception → Network.framework transport connects, URLSession fallback is blocked. Documented · `/ws/echo`
- [ ] **WS-C42** Connect while offline (airplane mode) → Fails promptly with a readable `onerror`, then 1006, on both platforms
- [ ] **WS-C43** Package installed without its text-decoder peer → Clear install or import error, not silent text-frame failure · `/ws/echo`

## 28. Handshake headers and subprotocols

- [x] **WS-H01** No protocols requested → No `Sec-WebSocket-Protocol`, no `Origin` · `/ws/headers` _(WS)_
- [x] **WS-H02** Protocols requested → Offered, negotiated one in `protocol` · `/ws/headers` _(WS)_
- [ ] **WS-H03** Single protocol as a string → Offered · `/ws/headers`
- [ ] **WS-H04** Server picks a protocol that was not offered → Fails the connection · NEW `/ws/protocol?pick=x`
- [ ] **WS-H05** Server picks none when some were offered → Connection opens with `protocol === ''` (browser behavior) or fails. Document · NEW
- [ ] **WS-H06** Duplicate protocols → Throws `SyntaxError` (spec)
- [ ] **WS-H07** Protocol with invalid chars (space, comma, CR/LF) → Throws `SyntaxError` _(partial: WS)_
- [x] **WS-H08** Custom headers → Sent · `/ws/headers` _(WS)_
- [ ] **WS-H09** `Authorization` header → Sent · `/ws/headers`
- [ ] **WS-H10** Custom header with CR/LF → Rejected, not injected · `/ws/raw-headers`
- [x] **WS-H11** Headers too large → Fails promptly · `/ws/headers` _(WS)_
- [ ] **WS-H12** `User-Agent` → Present and stable · `/ws/headers`
- [ ] **WS-H13** Cookies from the HTTP jar → Sent, or documented that the WebSocket client has no jar · `/ws/headers`
- [ ] **WS-H14** `Origin` header set by the caller → Sent · `/ws/headers`
- [ ] **WS-H15** `permessage-deflate` → `extensions` reports what was negotiated. Compressed frames round-trip · NEW deflate server
- [ ] **WS-H16** `Sec-WebSocket-Version: 13` and a fresh `Sec-WebSocket-Key` per connection → Yes · `/ws/raw-headers`
- [ ] **WS-H17** Empty-string protocol, non-ASCII protocol, and `['chat','Chat']` → `''` and non-token names throw `SyntaxError`. Names differing only by case are both offered · `/ws/headers`
- [ ] **WS-H18** `protocol` and `extensions` while `CONNECTING`, inside `onopen`, after close → `''` while connecting, set before `onopen` runs, unchanged after close · `/ws/headers`
- [ ] **WS-H19** 101 with `Connection: keep-alive, Upgrade` and `Upgrade: WebSocket` → Accepted · NEW raw WS variant
- [ ] **WS-H20** Server `Sec-WebSocket-Protocol: chat, superchat` → Connection fails, 1006 · NEW `/ws/protocol?pick=chat,superchat`
- [ ] **WS-H21** Server returns an extension that was not offered, or `x-foo` → Connection fails, 1006 · NEW `/ws/ext?value=`
- [ ] **WS-H22** 101 response carrying 20 to 40 KB of headers → Opens on both platforms (Android lws buffer is 32 KB, iOS 256 KB). Document the limit · NEW `/ws/big-response`
- [ ] **WS-H23** Caller headers named `Host`, `Upgrade`, `Connection`, `Sec-WebSocket-Key`, `Sec-WebSocket-Version`, `Sec-WebSocket-Extensions` → Ignored or rejected, never duplicated, never break the handshake · `/ws/raw-headers`
- [ ] **WS-H24** Caller header names that are empty or contain `:` or a space → Rejected with an error on both platforms · `/ws/raw-headers`
- [ ] **WS-H25** `Set-Cookie` on the 101 response → Stored in the shared jar and sent by the next fetch and handshake, or documented per platform · NEW `/ws/set-cookie`
- [ ] **WS-H26** `Secure` cookie in the jar → Sent over `wss://` only · `/ws/headers`
- [ ] **WS-H27** Negotiated protocol 300 characters long → Reported intact (no fixed 256-byte buffer truncation) · NEW `/ws/protocol?pick=`
- [ ] **WS-H28** permessage-deflate: server sends `client_max_window_bits` that was not offered → Connection fails · NEW deflate server
- [ ] **WS-H29** permessage-deflate invalid params (unknown name, duplicate, bits 7 or 16, `server_no_context_takeover=1`, two entries) → Connection fails, 1006 · NEW deflate server
- [ ] **WS-H30** permessage-deflate `server_no_context_takeover` and `client_no_context_takeover` → 100 compressed messages each inflate independently in both directions · NEW deflate server
- [ ] **WS-H31** permessage-deflate `client_max_window_bits` 8 to 15 and `server_max_window_bits` 8 to 15 → Frames inflate with that window. With 8 the client sends uncompressed · NEW deflate server

## 29. Text messages

- [x] **WS-T01** Echo a short string → Same string, `isBinary === false` · `/ws/echo` _(WS)_
- [x] **WS-T02** JSON string → Same content · `/ws/echo` _(WS)_
- [x] **WS-T03** 1 KB string → Same · `/ws/echo` _(WS)_
- [x] **WS-T04** Sequential messages → Same order · `/ws/echo` _(WS)_
- [ ] **WS-T05** Empty string → Echoed as `''` · `/ws/echo`
- [ ] **WS-T06** Emoji, CJK, RTL, combining marks → Exact round trip · `/ws/echo`
- [ ] **WS-T07** Lone surrogate → Sent as U+FFFD · `/ws/echo`
- [ ] **WS-T08** NUL characters → Preserved · `/ws/echo`
- [ ] **WS-T09** Payload sizes 125, 126, 65535, 65536 bytes → Exact (frame length encodings) · `/ws/echo`
- [ ] **WS-T10** 1 MB string → Exact · `/ws/echo`
- [ ] **WS-T11** 16 MB string → Exact, or a documented max-size close (1009) · `/ws/echo`
- [ ] **WS-T12** Server sends invalid UTF-8 in a text frame → Connection fails, close 1007 (or 1006), `wasClean === false` · NEW `/ws/invalid-utf8`
- [ ] **WS-T13** UTF-8 BOM at the start of a text frame → Preserved as U+FEFF (decoder uses `ignoreBOM: true`) · NEW
- [ ] **WS-T14** 10,000 small messages from the server → All delivered in order · `/ws/burst?count=10000`
- [ ] **WS-T15** Mixed text and binary burst → Order and type kept · `/ws/burst` _(partial: WS)_
- [ ] **WS-T16** Deflate round trip at 1023, 1024, 64 KB and 1 MB in both directions → Byte-exact · NEW deflate server
- [ ] **WS-T17** Deflate context takeover: second message references the first one's window → Decoded correctly · NEW deflate server
- [ ] **WS-T18** Compressed empty message, and a compressed fragmented message (RSV1 on the first frame only) → `''` and the full message delivered · NEW deflate server
- [ ] **WS-T19** Corrupt deflate payload → Connection fails, `onerror` then `onclose` 1006 · NEW deflate raw
- [ ] **WS-T20** Compressed message that inflates past 16 MiB → Fails with 1009, no OOM · NEW deflate raw
- [ ] **WS-T21** Fragmented TEXT message in 2 and 100 frames → One exact string · NEW `/ws/fragments?opcode=1`
- [ ] **WS-T22** Text message made of empty fragments, and an empty first fragment → `''` delivered once · NEW raw WS
- [ ] **WS-T23** Multi-byte code point split across continuation frames at every byte offset → Exact string · NEW raw WS
- [ ] **WS-T24** Invalid UTF-8 in the first fragment, later fragments delayed 2 s → Fails before the final fragment arrives (fail fast), on both platforms · NEW raw WS
- [ ] **WS-T25** Invalid UTF-8 classes: overlong C0/C1, `E0 80 80`, `ED A0 80`, `F4 90 80 80`, `F5`+, stray continuation, truncated at end → Each fails with 1007 on both platforms · NEW `/ws/invalid-utf8?case=`
- [ ] **WS-T26** Noncharacters U+FFFE, U+FFFF, U+10FFFF and a mid-message U+FEFF → Delivered, not rejected · NEW raw WS
- [ ] **WS-T27** Server message of exactly 16 MiB and 16 MiB + 1 → 16 MiB delivered. The +1 message fails with the same events on both platforms · `/ws/fragments?frames=1&size=16777217`
- [ ] **WS-T28** Fragmented message over 16 MB (5 x 4 MB) → Close 1009, no partial message delivered · `/ws/fragments?frames=5&size=4000000`
- [ ] **WS-T29** 4 MiB message as 65536 frames of 64 bytes → Delivered within a time budget, memory bounded · `/ws/fragments?frames=65536&size=64`
- [ ] **WS-T30** iOS URLSession transport: 2 MB server message → Delivered, or the 1 MB `maximumMessageSize` limit documented · `/ws/fragments?frames=1&size=2097152`

## 30. Binary messages

- [x] **WS-B01** Echo an `ArrayBuffer` → `isBinary`, `binaryData` byte-exact · `/ws/echo` _(WS)_
- [x] **WS-B02** Single byte → Exact · `/ws/echo` _(WS)_
- [ ] **WS-B03** Empty `ArrayBuffer` → Echoed as zero bytes, still binary · `/ws/echo`
- [ ] **WS-B04** All 256 byte values → Exact · `/ws/echo`
- [ ] **WS-B05** 1 MB and 10 MB → Exact · `/ws/echo`
- [ ] **WS-B06** `Uint8Array` passed to `send()` → Sends the view bytes, or throws `TypeError`. Document (the API takes `string | ArrayBuffer`) · `/ws/echo`
- [ ] **WS-B07** `Blob` passed to `send()` → Throws `TypeError` or documented unsupported
- [ ] **WS-B08** `binaryData` type → `ArrayBuffer`, `data === ''` · `/ws/echo`
- [x] **WS-B09** Fragmented binary message → Delivered as one message · `/ws/fragments` _(WS)_
- [ ] **WS-B10** `binaryData` read after the socket closed and was collected → Bytes intact · `/ws/fragments`
- [ ] **WS-B11** Native memory held by multi-frame messages kept in JS (5 x 256 KB, 3 x 1 MB) → About the message size, not double · `/ws/fragments?frames=5&size=262144`

## 31. Frames and control frames

- [x] **WS-F01** Fragmented message (frames x size) → One message, byte-exact · `/ws/fragments` _(WS)_
- [ ] **WS-F02** Server ping → Client answers with pong carrying the same payload · NEW `/ws/ping`
- [ ] **WS-F03** Unsolicited pong → Ignored · NEW
- [ ] **WS-F04** Ping between fragments of a message → Pong sent, message still reassembled · NEW
- [ ] **WS-F05** Continuation frame without a start frame → Close 1002 · NEW `/ws/bad-frame?type=continuation`
- [ ] **WS-F06** Control frame larger than 125 bytes → Close 1002 · NEW
- [ ] **WS-F07** Masked frame from the server → Close 1002 · NEW
- [ ] **WS-F08** RSV bits set without an extension → Close 1002 · NEW
- [ ] **WS-F09** Unknown opcode → Close 1002 · NEW
- [ ] **WS-F10** Fragmented control frame → Close 1002 · NEW
- [ ] **WS-F11** Client frames are masked → Server sees masked frames · NEW raw
- [ ] **WS-F12** Server drops the socket after a burst, without close → Every message delivered, then close 1006 · `/ws/burst?end=drop`
- [ ] **WS-F13** Every frame written 1 byte per TCP segment → Reassembled · NEW raw WS `?chop=1`
- [ ] **WS-F14** 64-bit length with the MSB set, and a declared length over 16 MiB with a tiny payload → Fails (1002 or 1009) without allocating · NEW raw WS
- [ ] **WS-F15** Ping with a 125-byte binary payload → Pong echoes the exact bytes · NEW `/ws/ping?size=125`
- [ ] **WS-F16** 10 pings back to back, also chopped → 10 pongs in order · NEW `/ws/ping?count=10`
- [ ] **WS-F17** New text or binary frame while a fragmented message is open → Fails with 1002 · NEW `/ws/bad-frame?type=interleave`
- [ ] **WS-F18** RSV2/RSV3 with deflate negotiated, RSV1 on a continuation or control frame, after a valid message in the same segment → Earlier message delivered, then 1002, `onerror`, `onclose` 1006 · NEW raw WS
- [ ] **WS-F19** Server writes its first frame in the same TCP segment as the 101 → `onopen` before `onmessage`, message not lost · NEW raw WS

## 32. Closing

- [x] **WS-CL01** `close()` → `onclose` 1000, `wasClean`, `CLOSED` · `/ws/echo` _(WS)_
- [x] **WS-CL02** `close()` with sends in flight → No `onerror` · `/ws/echo` _(WS)_
- [x] **WS-CL03** `onclose` fires exactly once → Yes · `/ws/echo` _(WS)_
- [x] **WS-CL04** `close()` when the server stops reading → `onclose` still fires · `:9877` _(WS)_
- [x] **WS-CL05** Server never answers close → `onclose` after a timeout · `:9877` _(WS)_
- [x] **WS-CL06** `close()` while `CONNECTING` → Terminates, `onclose` 1006, `wasClean === false` · `/ws/stall` _(WS)_
- [ ] **WS-CL07** `close(1000, 'bye')` → Server sees 1000 and `bye` · NEW echo-close
- [ ] **WS-CL08** `close(3000)` and `close(4999)` → Allowed · `/ws/echo`
- [ ] **WS-CL09** `close(1001)` to `close(1015)` from the client → Throws `InvalidAccessError` (spec) or documented
- [ ] **WS-CL10** `close(999)`, `close(5000)`, `close(0)` → Throws `InvalidAccessError`
- [ ] **WS-CL11** Reason longer than 123 UTF-8 bytes → Throws `SyntaxError`
- [ ] **WS-CL12** Reason with multi-byte UTF-8 → Round-trips · `/ws/close?reason=é`
- [ ] **WS-CL13** `close()` twice → Second is a no-op · `/ws/echo`
- [ ] **WS-CL14** `close()` while `CLOSING` → No-op · `/ws/echo`
- [x] **WS-CL15** Server close 1011 with a reason → `onclose` has code and reason, no message event · `/ws/close` _(WS)_
- [ ] **WS-CL16** Server close codes 1001, 1002, 1003, 1008, 1009, 1012, 1013, 1014, 4000 → Each reported as sent · `/ws/close?code=`
- [ ] **WS-CL17** Server close frame with no status → `onclose` 1005 · NEW `/ws/close-empty`
- [x] **WS-CL18** Server drops without a close frame → `onclose` 1006, `wasClean === false` · `/ws/kill` _(WS)_
- [ ] **WS-CL19** TLS failure on `wss://` → `onclose` 1006 (or 1015) · local TLS bad cert
- [ ] **WS-CL20** Server close after a burst → All messages, then close 4000 · `/ws/burst?end=close` _(partial: WS)_
- [ ] **WS-CL21** Message echoed before the server close arrives → Delivered · `/ws/close`
- [ ] **WS-CL22** `close()` with no arguments → Spec sends a close frame with no status (server sees 1005, `onclose` 1005). Nitro sends 1000; document · NEW `/ws/echo-close`
- [ ] **WS-CL23** `close(NaN)`, `close('abc')`, `close(Infinity)`, `close(3000.6)` → First three throw `InvalidAccessError`, 3000.6 becomes 3001. No undefined native cast
- [ ] **WS-CL24** `close(1000, reason with a lone surrogate)` → Counted as 3 bytes (U+FFFD) toward the 123-byte limit, server sees `EF BF BD` · NEW `/ws/echo-close`
- [ ] **WS-CL25** Client `close(4000,'a')` answered by server close 4001 `'b'`, or by an empty close frame → `onclose` reports 4001/`'b'`, or 1005 for the empty frame (first close frame received) · NEW `/ws/close-reply?code=`
- [ ] **WS-CL26** Client close answered by TCP FIN without a close frame → `onclose` 1006, `wasClean === false` · NEW `/ws/close-reply?fin=1`
- [ ] **WS-CL27** Message arrives after local `close()`, before the server's close → Not dispatched, same on both platforms · NEW `/ws/close-reply?msgFirst=1`
- [ ] **WS-CL28** `readyState` right after `close()` returns, and during a server close before `onclose` → `'CLOSING'` synchronously · `/ws/echo`
- [ ] **WS-CL29** Server sends two close frames → Second ignored, one `onclose` · NEW raw WS
- [ ] **WS-CL30** Ping or text frame after the server's close frame → No pong, no message event · NEW raw WS
- [ ] **WS-CL31** First fragment, then close, then the remaining fragments → Partial message never delivered · NEW raw WS
- [ ] **WS-CL32** 256 KB message immediately followed by a server close → Message delivered, then `onclose` · NEW `/ws/close?size=262144`
- [ ] **WS-CL33** Close frame with a 1-byte payload → Fails with 1002, `onclose` 1006 · NEW raw WS
- [ ] **WS-CL34** Server close reason with invalid UTF-8 → Fails with 1007, `onclose` 1006, both platforms · NEW raw WS
- [ ] **WS-CL35** Server close codes 0, 999, 1004, 1005, 1006, 1015, 1016, 1100, 2000, 2999, 5000, 65535 → Fails with 1002, `onclose` 1006 · NEW raw WS
- [ ] **WS-CL36** Server-initiated close → Client echoes the same status code · NEW `/ws/close?report=1`
- [ ] **WS-CL37** `close()` with 16 MB queued to a server reading about 1 MB/s, and to a server that stops reading → Slow server gets every byte then close 1000. Stalled server gives 1006 after about 5 s · NEW slow-reading WS server

## 33. Events and handlers

- [ ] **WS-E01** Handlers set after construction (late) → Every message once, in order _(partial: WS)_
- [ ] **WS-E02** Reassigning `onmessage` → Only the new handler fires
- [ ] **WS-E03** Setting a handler to `null` → Delivery stops
- [ ] **WS-E04** Handler throws → Socket keeps working, error surfaced in the console
- [ ] **WS-E05** `onerror` always before `onclose` on failure → Yes _(partial: WS)_
- [ ] **WS-E06** No events after `onclose` → Yes _(partial: WS)_
- [ ] **WS-E07** `onerror` argument → A non-empty string describing the failure
- [ ] **WS-E08** `readyState` inside each handler → `OPEN` in `onopen`, `CLOSED` in `onclose`
- [ ] **WS-E09** `readyState` inside `onerror` and `onmessage` (`/ws/kill`) → `CLOSED` in `onerror`, `OPEN` in `onmessage`
- [ ] **WS-E10** `close()` while `CONNECTING` fires `onerror` (`/ws/stall`) → `onerror` then `onclose` 1006 on both platforms (spec: fail the connection) _(partial: WS)_
- [ ] **WS-E11** Events never fire synchronously inside `close()` or the constructor (invalid URL) (`/ws/stall`) → Dispatched asynchronously
- [ ] **WS-E12** `onerror` text per failure class (DNS, refused, bad certificate, timeout, bad 101) (various) → Distinct non-empty messages on both platforms
- [ ] **WS-E13** `onerror` and `onclose` assigned after the connection already failed (closed port) → Each fires once through replay, in order
- [ ] **WS-E14** `onmessage` set to `null` while the server keeps sending, then reassigned (`/ws/burst`) → Messages sent while it was `null` are not delivered later (no unbounded buffer)

## 34. Sending, buffering and backpressure

- [ ] **WS-BP01** `send()` while `CONNECTING` → Throws `InvalidStateError` (spec), or queues. Document · `/ws/stall`
- [ ] **WS-BP02** `send()` after close → Does not throw, data discarded (spec) · `/ws/echo`
- [ ] **WS-BP03** `bufferedAmount` grows when the server is paused → Increases after each send · `:9877`
- [ ] **WS-BP04** `bufferedAmount` drains to 0 → After the server reads · `/ws/echo`
- [ ] **WS-BP05** Send 100 MB while the server is paused → No OOM, memory bounded or documented · `:9877`
- [ ] **WS-BP06** 10,000 sends in a tight loop → All echoed in order · `/ws/echo`
- [ ] **WS-BP07** Send from inside `onmessage` (ping-pong 10,000 times) → No stack growth, completes · `/ws/echo`
- [ ] **WS-BP08** `send()` after `close()` but before `onclose` → Nothing reaches the server · NEW `/ws/echo-close`
- [ ] **WS-BP09** `bufferedAmount` after `send()` while `CLOSING`/`CLOSED` → Increases by the data size and never resets (spec), same on both platforms · `/ws/echo`
- [ ] **WS-BP10** `bufferedAmount` for multi-byte text (`'é'.repeat(1000)`) → 2000 (UTF-8 bytes) · `:9877`
- [ ] **WS-BP11** `send(42)`, `send({})`, `send(null)`, `send()` → First three stringified (`'42'`, `'[object Object]'`, `'null'`), `send()` throws `TypeError` · `/ws/echo`
- [ ] **WS-BP12** Android `send()` while `CONNECTING` → Queued message reaches the server after open without another send, `bufferedAmount` returns to 0 · NEW `/ws/slow-accept?delay=500`
- [ ] **WS-BP13** WS bursts (400 mixed messages) and multi-frame 1 MB messages → Median latency no worse than baseline on both platforms · `/ws/burst?count=400`

## 35. TLS for `wss://`

- [x] **WS-TLS01** Valid public certificate → Opens _(WS)_
- [ ] **WS-TLS02** Expired certificate → Fails, 1006
- [ ] **WS-TLS03** Self-signed → Fails
- [ ] **WS-TLS04** Wrong host → Fails
- [ ] **WS-TLS05** Untrusted root → Fails
- [ ] **WS-TLS06** TLS 1.2 and 1.3 servers → Open
- [ ] **WS-TLS07** TLS 1.0 / 1.1 only → Fail
- [ ] **WS-TLS08** SNI → Correct certificate chosen
- [ ] **WS-TLS09** Root store used by mbedTLS → System roots, including updates. Document per platform
- [ ] **WS-TLS10** User-installed CA (Android) → Follows `network_security_config`, or documented
- [ ] **WS-TLS11** Pin file applies to `wss://` → Pinned host passes, mismatch fails. Fails today on both platforms (see P0-PIN-16)
- [ ] **WS-TLS12** `wss://` through a system proxy → Works or documented
- [ ] **WS-TLS13** `ws://` to a host blocked by ATS or Android cleartext rules (`/ws/echo`) → Documented: Network.framework and lws are raw sockets, the URLSession fallback follows ATS
- [ ] **WS-TLS14** `wss://` IP literal with an IP SAN, IPv4 and `[::1]` (NEW local TLS wss) → Connects on both platforms (Android IPv6 host check)
- [ ] **WS-TLS15** `wss://` revoked and no-SCT certificates (revoked.badssl.com) → Documented: Android mbedTLS checks neither, iOS follows the system
- [ ] **WS-TLS16** Android `wss://` trust store (NEW local TLS) → Uses the embedded Mozilla CA bundle, so system and user CAs and `network_security_config` are ignored. Documented or aligned with fetch

## 36. Lifecycle and resources

- [x] **WS-L01** GC frees sockets with handlers after close → Yes _(WS)_
- [ ] **WS-L02** App backgrounded with an open socket → Closes cleanly or survives. Document per platform
- [ ] **WS-L03** Network change while open → `onclose` 1006, can reconnect
- [ ] **WS-L04** JS reload with open sockets → Native sockets closed, no crash
- [ ] **WS-L05** Idle connection for 10 minutes → Stays open (server pings)
- [ ] **WS-L06** 1000 open and close cycles → Memory and threads stay flat
- [ ] **WS-L07** Messages arrive while JS is blocked → Delivered in order after JS frees up
- [ ] **WS-L08** Callbacks run on the JS thread → Yes
- [ ] **WS-L09** Unreferenced open socket with `onmessage` set, then GC (NEW `/ws/tick`) → Not collected, keeps delivering (spec)
- [ ] **WS-L10** Unreferenced open socket with no handlers, then GC (NEW `/ws/echo-close`) → Collected, closing handshake sent
- [ ] **WS-L11** Socket with `onmessage`/`onerror` but no `onclose`, closed by the server (`/ws/close?delay=1`) → Freed after close
- [ ] **WS-L12** Fast Refresh or module re-evaluation with open sockets (`/ws/echo`) → No duplicate delivery, no crash
- [ ] **WS-L13** 300 sockets at once (above the iOS 256 fd soft limit) (`/ws/echo`) → Extra sockets fail with `onerror` + 1006, existing ones keep working
- [ ] **WS-L14** 100 Android sockets on one lws service thread while one receives 16 MiB (`/ws/fragments`) → Messages and pongs on the others delayed by less than 1 s
- [ ] **WS-L15** Process exit or swipe-kill with open sockets (`/ws/echo`) → No native crash in static destructors or queues
- [ ] **WS-L16** Socket created on a worklet runtime (`/ws/echo`) → Callbacks run on that runtime, or creation is rejected clearly
- [ ] **WS-L17** Build with `NITRO_WS_TRACING=1` / `NitroFetchWebsockets_enableTracing` (`/ws/echo`) → Builds on both platforms and emits connect, established, send, receive, close, error
- [ ] **WS-L18** tvOS and visionOS builds (`/ws/echo`) → Build and connect
- [ ] **WS-L19** iOS Network.framework idle socket after a network change (network switch) → Stays `OPEN` until the next read/write fails (no keepalive). Documented
- [ ] **WS-L20** `NitroWebSocket` without nitro-fetch installed (`/ws/echo`) → Sockets work, inspector recording skipped

## 37. Prewarm

- [ ] **WS-PW01** `prewarmOnAppStart(url)` → Entry stored in the shared queue
- [ ] **WS-PW02** Same URL twice → Deduped, last write wins
- [ ] **WS-PW03** With protocols and headers → Both stored and used
- [ ] **WS-PW04** `removeFromPrewarmQueue(url)` → Entry removed
- [ ] **WS-PW05** `clearPrewarmQueue()` → Queue empty
- [ ] **WS-PW06** Cold start with a queued URL → Handshake starts before JS. The first `NitroWebSocket` to that URL opens faster
- [ ] **WS-PW07** Android `NitroWebSocketAutoPrewarmer.prewarmOnStart` → Runs from `Application.onCreate`
- [ ] **WS-PW08** iOS automatic prewarm → Runs without AppDelegate code
- [ ] **WS-PW09** Prewarmed socket never claimed → Closed after a timeout, no leak
- [ ] **WS-PW10** Different URL from the prewarmed one → Fresh connection
- [ ] **WS-PW11** Token refresh with `target: 'websocket'` / `'all'` → Prewarm uses refreshed headers
- [ ] **WS-PW12** nitro-fetch not installed → Prewarm helpers fail clearly or no-op
- [ ] **WS-PW13** Prewarm queue encrypted at rest → Headers not stored in plaintext. Fails today: the queue is plaintext on both platforms (see P0-WS-23)

## 38. Browser API parity and interop

- [ ] **WS-API01** `readyState` type → String states differ from the browser's numeric `0..3`. Document, or add `CONNECTING`/`OPEN`/`CLOSING`/`CLOSED` constants
- [ ] **WS-API02** `binaryType` → Absent. Document
- [ ] **WS-API03** `addEventListener` / `removeEventListener` → Absent. Document
- [ ] **WS-API04** `onerror` argument → String, not an `Event`. Document
- [x] **WS-API05** `onmessage` event shape → `data`, `isBinary`, `binaryData` _(WS)_
- [ ] **WS-API06** socket.io-client with a custom WebSocket transport → Connects, emits, receives
- [ ] **WS-API07** graphql-ws → Subscribes, receives
- [ ] **WS-API08** Phoenix channels, ActionCable, STOMP → Basic join and message
- [ ] **WS-API09** React Native style third argument `new WebSocket(url, protocols, { headers })` (`/ws/headers`) → Headers sent, or a clear `TypeError`. Today the object is treated as the header map (documented)
- [ ] **WS-API10** `globalThis.WebSocket` adapter (numeric `readyState`, static constants, `binaryType: 'arraybuffer'`, `addEventListener`) → Libraries that read the global work unchanged
- [ ] **WS-API11** centrifuge-js with `websocket: NitroWebSocket`, JSON and protobuf (NEW centrifugo stub) → Connects, subscribes, receives publications
- [ ] **WS-API12** MQTT.js over WebSocket (subprotocol `mqtt`, binary frames) (NEW aedes over ws) → CONNACK, subscribe and publish round trip
- [ ] **WS-API13** Supabase realtime (`RealtimeClient` transport option) (NEW stub) → Joins a channel, receives broadcasts, heartbeat keeps it open
- [ ] **WS-API14** Firebase RTDB (uses the global WebSocket) (Firebase emulator) → Receives updates with the global replaced, or documented as unsupported
- [ ] **WS-API15** Library reconnect loop (socket.io, graphql-ws) after the server is killed (`/ws/kill`) → Reconnects with no leaked native sockets
- [ ] **WS-API16** iOS transports compared (`NitroWebSocketsUseNetworkFramework`) (`/ws/echo`) → WS suite passes on both. Max message 1 MB on URLSession vs 16 MB on Network.framework

## 39. TextDecoder

- [ ] **TD-01** Defaults, labels, invalid labels → As spec _(partial: TD)_
- [x] **TD-02** `fatal` and `ignoreBOM` → As spec _(TD)_
- [x] **TD-03** ASCII, CJK, emoji → Decoded _(TD)_
- [x] **TD-04** Split multi-byte across `stream: true` chunks → Reassembled _(TD)_
- [x] **TD-05** Flush at end → Pending bytes completed or replaced _(TD)_
- [ ] **TD-06** `SharedArrayBuffer`-backed view → Decoded or documented
- [ ] **TD-07** 50 MB decode → Completes, faster than the JS polyfill
- [x] **TD-08** `utf-16le` label → Supported or `RangeError` _(TD)_
- [ ] **TD-09** Decoding a detached buffer → Throws `TypeError`
- [ ] **TD-10** Labels `unicode-1-1-utf-8`, `unicode11utf8`, `unicode20utf8`, `x-unicode20utf8`, `' UTF-8 '` → Accepted with `encoding === 'utf-8'`
- [ ] **TD-11** `{fatal: 1}`, `{ignoreBOM: 'yes'}`, `decode(x, {stream: 1})` → Coerced to `true` (WebIDL)
- [ ] **TD-12** `decode(null)`, `decode(42)`, `decode('abc')`, `decode([1,2])` → `TypeError` (`decode()` with no argument returns `''`)
- [ ] **TD-13** Duck-typed view with a huge, negative or NaN `byteOffset` → `TypeError`, no out-of-bounds read
- [ ] **TD-14** `DataView`, `Uint16Array`, `Float64Array` with `byteOffset` → Exactly the view's bytes decoded _(partial: TD)_
- [ ] **TD-15** `fatal` + `stream`, invalid byte mid-stream, then `decode(valid)` → `TypeError`, then the next call starts clean
- [ ] **TD-16** BOM split across stream chunks (`EF`, then `BB BF 41`), and a BOM after a flush → Stripped once per stream, again after a flush
- [ ] **TD-17** Replacement counts for `F0 80 80`, `ED A0 80`, `F0 9F 98` at end, `C0 AF` → 3, 3, 1 and 2 U+FFFD (maximal subpart rule) _(partial: TD)_
- [ ] **TD-18** Memory after a 50 MB decode → Back near baseline (no kept 2x scratch buffer)
- [ ] **TD-19** Import side effect on `globalThis` streams → Existing `ReadableStream`/`WritableStream`/`TransformStream` kept, or the polyfill override documented

---

## Bugs found while building this list

Each one was checked against the code. The matching items above will fail until it is fixed.

- [ ] WebSocket prewarm queue is plaintext on both platforms, including any `Authorization` header in it.
  `src/prewarm.ts` writes it with `setString`, and native reads it with `stringForKey` / `getString`. (P0-WS-23, WS-PW13)
- [ ] An unclaimed prewarmed WebSocket is never closed. `WebSocketPrewarmer` has no timeout. (P0-WS-13)
- [ ] An adopted prewarmed WebSocket ignores the constructor's protocols and headers. `HybridWebSocket::connect`
  skips `connect()` when adopting. (P0-WS-10)
- [ ] Debug logs print token values: the WebSocket prewarmer on both platforms, and `logTokens` in the auto-prefetcher
  on both platforms. (P0-WS-17, P0-PF-22)
- [ ] iOS prefetch replay always follows redirects. `prefetchStatic` passes `followRedirects: true`. (P0-PF-24)
- [ ] Android auto-prefetch only runs if the app calls `AutoPrefetcher.prefetchOnStart(this)`, and `docs/api.md`
  does not say so. (P0-PF-03)
- [ ] WebSockets ignore `nitro-fetch-pinning.json` on both platforms. Android `wss://` trusts an embedded Mozilla CA
  bundle instead of the system store. (P0-PIN-16, P0-PIN-17)
- [ ] JS `callRefreshEndpoint` is not pinned, because it calls the global `fetch`. (P0-PIN-15)
- [ ] Android Cronet pin failures write no log line. (P0-PIN-06)
- [ ] `json()` and `bytes()` on a `stream: true` response ignore the stream: `json()` resolves to `{}` and `bytes()`
  is empty. `json()` on an empty body also resolves to `{}` instead of rejecting with `SyntaxError`. (R-02, R-04,
  R-06)

## Infrastructure needed

New local server endpoints (all can live in `test-server/server.mjs`):

- [ ] `/status/:code?body=1&reason=X`: Status codes with a body and a custom reason phrase
- [ ] `/interim/:code`: 1xx interim response followed by a final 200
- [ ] `/range`: `Range` / 206 / 416
- [ ] `/brotli`, `/deflate`, `/zstd`: Compression variants
- [ ] `/length-mismatch?declared=N&actual=M`: Short and long bodies against `Content-Length`
- [ ] `/reset?after=N`: TCP reset after N bytes
- [ ] `/conn-id`: Returns a per-socket id to check keep-alive reuse
- [ ] `/sse`: Event stream with `id`, `retry`, comments and split events
- [ ] `/cookies/advanced`: `Secure`, `HttpOnly`, `Path`, `Domain`, `Max-Age` cookies
- [ ] `/last-modified`, `/vary`, `/no-store`, `/swr`: Cache variants
- [ ] Raw TCP listener: Odd status lines, HTTP/1.0, garbage responses
- [ ] Local TLS listener with a test CA: Run every https and wss row locally. Install the CA in the simulator and emulator in CI
- [ ] `/ws/status/:code`, `/ws/bad-accept`: Failed WebSocket upgrades
- [ ] `/ws/protocol?pick=X`: Subprotocol negotiation
- [ ] `/ws/ping`, `/ws/bad-frame?type=X`, `/ws/invalid-utf8`, `/ws/close-empty`: Control frames and protocol errors
- [ ] `/ws/echo-close`: Reports the client's close code and reason
- [ ] permessage-deflate WebSocket server: Extension negotiation
- [ ] `/count-and-drop`: Server reads a request on a reused socket and closes without answering
- [ ] `/auth?schemes=`: 401 with several `WWW-Authenticate` challenges
- [ ] `/conditional`: `If-Match`, `If-Unmodified-Since`, `If-Range`
- [ ] `/content-location`: `Content-Location` header
- [ ] `/redirect-cached?status=&maxAge=`: Cacheable redirects with a hit counter
- [ ] `/cache/:id` options `cc`, `expires`, `age`, `date`, `lm`, `vary`, `status`, `bytes`: Cache freshness and invalidation variants
- [ ] `/delay/:n` above 60 s: The iOS 60 s default timeout case
- [ ] `/token/badjson`, `/token/empty`, `/token?delay=`, `/token?shape=typed`: Token refresh edge cases
- [ ] Connect-time logging for every WebSocket upgrade: Proves a prewarm connected before the JS bundle loaded
- [ ] `/ws/echo-close`, `/ws/close-reply`, `/ws/close-raw`: Close handshake details
- [ ] `/ws/ext`, `/ws/big-response`, `/ws/set-cookie`, `/ws/slow-accept`, `/ws/tick`, `/ws/push-on-open`: Handshake and lifecycle variants
- [ ] WebSocket listener on `:9878`: Cross-origin WebSocket redirects
- [ ] Local h2 and h3 servers with fault injection: GOAWAY, RST_STREAM, flow control, push, 0-RTT, Alt-Svc
- [ ] Local DNS server (dnsmasq): TTL changes, NXDOMAIN, happy eyeballs
- [ ] Pin-file build variants (missing, malformed, `{}`, expired today, leaf, intermediate, wss host): Section 0.3
- [ ] `/sse` options `close`, `status`, `first`, `idle`, `split`: Event stream reconnects and buffering
- [ ] `/drip` options `type`, `nosniff`, with `Set-Cookie`: iOS content sniffing and cookies during a stream
- [ ] `/range` with a hit counter and `gzip`: Range requests, resume, cached partials
- [ ] `/page?cursor=`, `/auth/protected`: App scenarios

Tools: Network Link Conditioner (iOS), emulator network profiles (Android), mitmproxy for proxy and
QUIC-blocking cases, a memory profiler (Instruments, Android Studio) for the leak and 100 MB rows.
