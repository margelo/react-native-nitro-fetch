# Troubleshooting

- No native client available / silent fallback
  - On first run or in dev, JS may fall back to the built-in fetch when native isn’t available yet. Rebuild the app after installing dependencies.

- Prefetch error: "missing prefetchKey"
  - Provide `headers: { prefetchKey: '...' }` or `init.prefetchKey` when calling `prefetch()` and when consuming via `fetch()`.


- Cronet provider details
  - The library logs available Cronet providers and prefers the "Native" provider. Check Android logs for provider name/version during init.

- Streaming / timeouts / cancellation not working
  - Not implemented yet. Current implementation fetches full bodies before resolving. For streaming today, use Expo’s `expo-fetch`. Timeouts/cancellation are planned.

- WebSockets support
  - Not supported. For high‑performance sockets and binary streams, consider `react-native-fast-io`.
