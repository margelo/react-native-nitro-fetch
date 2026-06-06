# Troubleshooting

- No native client available / silent fallback
  - On first run or in dev, JS may fall back to the built-in fetch when native isn’t available yet. Rebuild the app after installing dependencies.

- Prefetch error: "missing prefetchKey"
  - Provide `headers: { prefetchKey: '...' }` or `init.prefetchKey` when calling `prefetch()` and when consuming via `fetch()`.


- Cronet provider details
  - The library logs available Cronet providers and prefers the "Native" provider. Check Android logs for provider name/version during init.

- Streaming / cancellation
  - Both are supported. Pass `{ stream: true }` to get a `ReadableStream` body, and use `AbortController` to cancel. For request timeouts, pair an `AbortController` with a timer.

- WebSockets
  - Supported via the companion package `react-native-nitro-websockets` (install `react-native-nitro-text-decoder` alongside it).
