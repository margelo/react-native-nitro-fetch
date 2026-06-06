# iOS networking (URLSession)

iOS does **not** use Chromium Cronet. The iOS client is built entirely on Apple's native `URLSession`, which provides HTTP/1.1 and HTTP/2 (and HTTP/3 on recent iOS) from the OS. The `NitroCronet` name in the shared Nitro spec is just the streaming-client interface — on iOS it is URLSession-backed.

## Client

`NitroFetchClient.swift` (`HybridNitroFetchClientSpec`) drives requests through a shared `URLSession`:

- `URLSessionConfiguration.default` with a `URLCache` (disk path `nitrofetch_urlcache`).
- `request(req:)` returns a `Promise<NitroResponse>`; `requestSync(req:)` is the synchronous variant used by `nitroFetchOnWorklet`.
- `followRedirects: false` installs a `NoRedirectDelegate`, so 3xx responses are surfaced instead of followed.
- Prefetch results are held in an in-memory `FetchCache` and served with a `nitroPrefetched: true` header (`requestStatic`).

## Streaming

`HybridNitroCronet.swift` (the iOS side of the `NitroCronet` spec) is also URLSession-backed. `newUrlRequestBuilder(url)` returns a builder whose response/read callbacks feed the `ReadableStream` used by `fetch(url, { stream: true })`.

## Auto-prefetch

`NitroAutoPrefetcher.swift` reads the shared `nitrofetch_autoprefetch_queue` (UserDefaults suite `nitro_fetch_storage`) and runs queued requests on launch. It fires automatically via `NitroBootstrap.mm`, which observes `UIApplicationDidFinishLaunchingNotification` — no AppDelegate code is required.

## App Transport Security

`URLSession` enforces ATS. Use `https://` endpoints, or add ATS exceptions in `Info.plist` for plain-`http` test endpoints.
