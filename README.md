<p align="center">
  <img src="./assets/logo.png" alt="Nitro Fetch Logo" width="200" />
</p>

# react-native-nitro-fetch

Nitro-powered fetch for React Native. Android uses Chromium Cronet (via `org.chromium.net:cronet-embedded`); iOS currently falls back to the built-in fetch. Includes helpers for background prefetching and off-thread parsing with worklets.

## Installation

```sh
npm install react-native-nitro-fetch react-native-nitro-modules
```

- `react-native-nitro-modules` is required as this library relies on Nitro Modules. Rebuild your app after installing.

## Quick Start

```ts
import { fetch } from 'react-native-nitro-fetch';

const res = await fetch('https://httpbin.org/get');
const json = await res.json();
```

## Features

- Nitro-backed `fetch`: drop-in replacement for global fetch.
- Android Cronet: fast HTTP stack via `org.chromium.net:cronet-embedded` (already wired in `android/build.gradle`).
- Prefetch: start a background request tied to a `prefetchKey` and serve it later.
- Android auto-prefetch: enqueue requests to MMKV so they warm up on next app start.
- Worklets helper: run mapping/parsing off the JS thread with `react-native-worklets-core`.

## Why Prefetch

- Faster first paint of data: Prefetching lets you move network I/O earlier on the critical path so the screen can render with data sooner.
- App start wins: With auto‑prefetch + MMKV, we can begin fetching immediately at process start. In our measurements on mid‑range Android devices (e.g., Samsung A16), this starts at least ~220 ms earlier than initiating the same request from JS after React is up.
- UX hooks: Kick off prefetch on navigation intent (button press) and serve the result when the destination screen mounts.

See `docs/prefetch.md` for patterns and examples.

## Why Cronet

- Performance: Enables HTTP/2 multiplexing and QUIC/HTTP/3, reducing latency and avoiding head‑of‑line blocking.
- Efficiency: Advanced connection management, TLS/ALPN, Brotli, and robust on‑disk caching.
- Battle‑tested: Built on Chromium’s networking stack (the same tech behind Chrome) and widely adopted across the ecosystem, including the Flutter community.

## Philosophy

- Nitro Fetch often outperforms built‑in fetch thanks to Cronet’s optimizations, but raw speed is not the primary goal.
- The main goals are:
  - High‑quality prefetching (including auto‑prefetch on app start)
  - Enabling a multi‑threaded React Native architecture (e.g., off‑thread mapping with worklets)
- Performance is a nice side‑effect.

## Usage Examples

- Basic fetch (drop-in replacement):

```ts
import { fetch } from 'react-native-nitro-fetch';
const res = await fetch('https://jsonplaceholder.typicode.com/todos/1');
console.log(await res.json());
```

- Prefetch and consume (Android or JS fallback):

```ts
import { fetch, prefetch } from 'react-native-nitro-fetch';

await prefetch('https://httpbin.org/uuid', { headers: { prefetchKey: 'uuid' } });
const res = await fetch('https://httpbin.org/uuid', { headers: { prefetchKey: 'uuid' } });
console.log('prefetched header:', res.headers.get('nitroPrefetched'));
```

- Schedule auto-prefetch on Android (requires `react-native-mmkv` in your app):

```ts
import { prefetchOnAppStart } from 'react-native-nitro-fetch';
await prefetchOnAppStart('https://httpbin.org/uuid', { prefetchKey: 'uuid' });
```

- Off-thread parsing with worklets:

```ts
import { nitroFetchOnWorklet } from 'react-native-nitro-fetch';

const map = (payload: { bodyString?: string }) => {
  'worklet';
  return JSON.parse(payload.bodyString ?? '{}');
};

const data = await nitroFetchOnWorklet('https://httpbin.org/get', undefined, map, { preferBytes: false });
```

## Platform Notes

- Android: Uses Cronet Java API; no extra setup needed beyond install and rebuild. Cronet engine is initialized once and enables HTTP/2, QUIC, Brotli, and disk cache.
- iOS: Uses a native `URLSession` client for requests and prefetch (in‑memory cache). Cronet integration is still planned for future releases.

## Limitations & Alternatives

- HTTP streaming: Not supported yet. For streaming responses today, use Expo’s `expo-fetch`. Streaming is on the roadmap.
- WebSockets: Not supported. For high‑performance sockets and binary streams, consider `react-native-fast-io`.

## Documentation

- Getting Started: `docs/getting-started.md`
- API Reference: `docs/api.md`
- Android Details: `docs/android.md`
- iOS Details: `docs/ios.md`
- Prefetch & Auto-Prefetch: `docs/prefetch.md`
- Worklets: `docs/worklets.md`
- Troubleshooting: `docs/troubleshooting.md`
- Cronet (Android) notes: `docs/cronet-android.md`
- Cronet (iOS) notes: `docs/cronet-ios.md`

## Work With Margelo

Need top‑notch React Native help or custom networking solutions? Reach out to Margelo: hello@margelo.com

## Contributing

- Development workflow: `CONTRIBUTING.md#development-workflow`
- Sending a pull request: `CONTRIBUTING.md#sending-a-pull-request`
- Code of conduct: `CODE_OF_CONDUCT.md`

## Authors

- [Szymon Kapala](https://x.com/Turbo_Szymon)
- [Alex Shumihin](https://x.com/pioner_dev)

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
