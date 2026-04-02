---
id: troubleshooting
title: Troubleshooting
sidebar_position: 14
---

# Troubleshooting

## No native client available / silent fallback

On first run or in dev, JS may fall back to the built-in fetch when native isn't available yet.

**Solution**: Rebuild the app after installing dependencies:

```bash
npx react-native run-android
npx react-native run-ios
```

## Prefetch error: "missing prefetchKey"

Provide `headers: { prefetchKey: '...' }` or `init.prefetchKey` when calling `prefetch()` **and** when consuming via `fetch()`:

```ts
// Both calls need the same prefetchKey
await prefetch(url, { headers: { prefetchKey: 'my-key' } });
const res = await fetch(url, { headers: { prefetchKey: 'my-key' } });
```

## Cronet provider details (Android)

The library logs available Cronet providers and prefers the "Native" provider. Check Android logs for provider name/version during initialization:

```bash
adb logcat | grep -i cronet
```

## WebSockets not connecting

If you're having issues with WebSocket connections:

1. Ensure all three packages are installed: `react-native-nitro-websockets`, `react-native-nitro-text-decoder`, `react-native-nitro-modules`
2. Rebuild the app after installation
3. Check that your WebSocket URL uses `ws://` or `wss://` scheme
4. For `wss://`, the TLS handshake requires valid certificates

See the [WebSockets guide](./websockets.md) for full setup instructions.
