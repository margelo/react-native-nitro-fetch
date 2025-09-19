<a href="https://margelo.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/static/img/banner-nitro-modules-dark.png" />
    <source media="(prefers-color-scheme: light)" srcset="./docs/static/img/banner-nitro-modules-light.png" />
    <img alt="Nitro Modules" src="./docs/static/img/banner-nitro-modules-light.png" />
  </picture>
</a>

<br />

**react-native-nitro-fetch** is a general purpose network fetching library for React Native. It can be used as a drop-in replacement for the built-in `fetch(...)` method, as well as provide additional features like prefetching and workletized mappers.

## Features

- 🔧 Drop-in replacement for the built-in `fetch(...)` method
- ⚡️ Fast HTTP stack using [Cronet](https://chromium.googlesource.com/chromium/src/+/lkgr/components/cronet/README.md) on Android, and [URLSession](https://developer.apple.com/documentation/Foundation/URLSession) on iOS
- 💪 Supports [HTTP/2](https://en.wikipedia.org/wiki/HTTP/2), [QUIC](https://www.chromium.org/quic/), [Brotli](https://github.com/google/brotli), and disk cache
- ⏰ Prefetching on app-startup for even faster initialization
- 🧵 Worklet support for parallel data mapping without blocking the JS Thread
- 🔥 Powered by [Nitro Modules](https://github.com/mrousavy/nitro)

## Installation

```sh
npm i react-native-nitro-fetch react-native-nitro-modules
```

> [Nitro Modules](https://github.com/mrousavy/nitro) requires react-native 0.75+ or higher

## Usage

To simply fetch data, import the `fetch(...)` method from `react-native-nitro-fetch`:

```ts
import { fetch } from 'react-native-nitro-fetch'

const res = await fetch('https://httpbin.org/get')
const json = await res.json()
```

This can be used as a drop-in-replacement for the built-in `fetch(...)` method.

### Prefetching in JS

You can prefetch a URL in JS, which keeps the result cached for the next actual `fetch(...)` call - this can be used shortly before navigating to a new screen to have results hot & ready:

```ts
import { prefetch } from 'react-native-nitro-fetch'

await prefetch('https://httpbin.org/uuid', {
  headers: { prefetchKey: 'uuid' }
})
```

Then, on the new screen that was navigated to:

```ts
import { fetch } from 'react-native-nitro-fetch'

const res = await fetch('https://httpbin.org/uuid', {
  headers: { prefetchKey: 'uuid' }
})
console.log('prefetched header:', res.headers.get('nitroPrefetched'))
```

### Prefetching for the next app launch

Prefetching data on app launch (or _process start_) will make it hot & ready once your JS code actually runs. Call `prefetchOnAppStart(...)` to enqueue a prefetch for the **next** app start:

```ts
import { prefetchOnAppStart } from 'react-native-nitro-fetch'

await prefetchOnAppStart('https://httpbin.org/uuid', {
  prefetchKey: 'uuid'
})
```

Then, once the app opens the next time, a call to `fetch(...)` might resolve faster since it will contain already cached results:

```ts
import { fetch } from 'react-native-nitro-fetch'

const res = await fetch('https://httpbin.org/uuid', {
  headers: { prefetchKey: 'uuid' }
})
console.log('prefetched header:', res.headers.get('nitroPrefetched'))
```

In our tests, prefetching alone yielded a **~220 ms** faster TTI (time-to-interactive) time! 🤯

### Worklet Mapping

Since Nitro Fetch is a [Nitro Module](https://nitro.margelo.com), it can be used from Worklets.
This can be useful to parse data without blocking the main JS-Thread:

```ts
import { nitroFetchOnWorklet } from 'react-native-nitro-fetch'

const data = await nitroFetchOnWorklet(
  'https://httpbin.org/get',
  undefined,
  (payload) => {
    'worklet'
    return JSON.parse(payload.bodyString ?? '{}')
  }
)
```

## Project Status

Nitro Fetch is currently in an alpha stage. You can adopt it in production, but keep in mind that the library and it's API is subject to change.

## Limitations & Alternatives

- [HTTP streaming](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API) is not yet supported. As an alternative, use Expo's [expo-fetch](https://docs.expo.dev/versions/latest/sdk/expo/). Streaming is on the roadmap.
- [WebSockets](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) are not supported. For high‑performance sockets and binary streams, consider using [react-native-fast-io](https://github.com/callstackincubator/react-native-fast-io) by our friends at Callstack.

## Documentation

- [Getting Started](docs/getting-started.md)
- [API Reference](docs/api.md)
- [Android Details](docs/android.md)
- [iOS Details](docs/ios.md)
- [Prefetch & Auto-Prefetch](docs/prefetch.md)
- [Worklets](docs/worklets.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Cronet (Android) notes](docs/cronet-android.md)
- [Cronet (iOS) notes](docs/cronet-ios.md)

## Margelo

Nitro Fetch is built with ❤️ by Margelo.
We build fast and beautiful apps. Contact us at [margelo.com](https://margelo.com) for high-end consultancy services.

## Contributing

- Development workflow: `CONTRIBUTING.md#development-workflow`
- Sending a pull request: `CONTRIBUTING.md#sending-a-pull-request`
- Code of conduct: `CODE_OF_CONDUCT.md`

## Authors

- [Szymon Kapala](https://github.com/Szymon20000)
- [Alex Shumihin](https://github.com/pioner92)
- [Ronald Goedeke](https://github.com/ronickg)
- [Marc Rousavy](https://github.com/mrousavy)

## License

MIT

