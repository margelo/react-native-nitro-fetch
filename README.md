<a href="https://margelo.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/banner-dark.png" />
    <source media="(prefers-color-scheme: light)" srcset="./assets/banner-light.png" />
    <img alt="Nitro Modules" src="./assets/banner-light.png" />
  </picture>
</a>

<br />



**react-native-nitro-fetch** is a general purpose network fetching library for React Native. It can be used as a drop-in replacement for the built-in `fetch(...)` method, as well as provide additional features like prefetching and workletized mappers.

<p align="center">
  <a href="https://margelo.github.io/react-native-nitro-fetch/"><b>Documentation</b></a>
</p>

## Features

- 🔧 Drop-in replacement for the built-in `fetch(...)` method
- ⚡️ Fast HTTP stack using [Cronet](https://chromium.googlesource.com/chromium/src/+/lkgr/components/cronet/README.md) on Android, and [URLSession](https://developer.apple.com/documentation/Foundation/URLSession) on iOS
- 💪 Supports HTTP/1, HTTP/2 and [HTTP/3](https://en.wikipedia.org/wiki/HTTP/3) over [QUIC](https://www.chromium.org/quic/), [Brotli](https://github.com/google/brotli), and disk cache
- ⏰ Prefetching on app-startup for even faster initialization
- 🧵 Worklet support for parallel data mapping without blocking the JS Thread
- 🔌 Optional **WebSockets** via [`react-native-nitro-websockets`](docs/websockets.md) (see [WebSockets & prewarm](#websockets--prewarm) below)
- 🔥 Powered by [Nitro Modules](https://github.com/mrousavy/nitro)

## Installation

```sh
npm i react-native-nitro-fetch react-native-nitro-modules
```

> [Nitro Modules](https://github.com/mrousavy/nitro) requires react-native 0.75+ or higher

**WebSockets (optional)** — add the companion socket package plus **text decoder** (peer dependency of websockets):

```sh
npm i react-native-nitro-websockets react-native-nitro-text-decoder
```

Full setup, native hooks, prewarm, and API details: **[docs/websockets.md](docs/websockets.md)** · UI: [`example/src/screens/WebSocketScreen.tsx`](example/src/screens/WebSocketScreen.tsx) · auth + prewarm: [Token refresh](#token-refresh-cold-start) (example block).

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

### Token refresh (cold start)

When you use **auto-prefetch** (`prefetchOnAppStart`) and/or **WebSocket prewarm on app start** (`react-native-nitro-websockets`), native code runs **before** your JS bundle. If those requests need auth headers, you can register a **token refresh** configuration. On each cold start, native code calls your refresh URL, maps the response into HTTP headers, and merges them into auto-prefetches and/or WebSocket prewarms.

**1. Register the refresh config** (persisted in encrypted native storage):

```ts
import { registerTokenRefresh } from 'react-native-nitro-fetch'

registerTokenRefresh({
  target: 'fetch', // 'websocket' | 'fetch' | 'all'
  url: 'https://api.example.com/oauth/token',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'client_credentials' }),
  responseType: 'json',
  mappings: [
    { jsonPath: 'access_token', header: 'Authorization', valueTemplate: 'Bearer {{value}}' },
  ],
  // If the refresh request fails:
  // - 'useStoredHeaders' — use last successful headers from the previous run (default)
  // - 'skip' — skip auto-prefetch / prewarm entirely when refresh fails
  onFailure: 'useStoredHeaders',
})
```

**Response mapping**

- Default `responseType` is `'json'`. Use **`mappings`** to copy fields from the JSON body into header names (dot paths supported, e.g. `data.token`).
- Use **`compositeHeaders`** to build a header from a template and multiple JSON paths (`{{placeholder}}` in the template).
- For a plain-text body, set `responseType: 'text'` and use **`textHeader`** / optional **`textTemplate`** (with `{{value}}`).



**Example: token refresh + WebSocket prewarm**

```ts
import { registerTokenRefresh } from 'react-native-nitro-fetch'
import { prewarmOnAppStart, NitroWebSocket } from 'react-native-nitro-websockets'

const WSS = 'wss://api.example.com/live'

registerTokenRefresh({
  target: 'websocket', // use 'all' if you also use prefetchOnAppStart with the same token flow
  url: 'https://api.example.com/oauth/token',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'client_credentials',
    client_id: '…',
    client_secret: '…',
  }),
  mappings: [
    { jsonPath: 'access_token', header: 'Authorization', valueTemplate: 'Bearer {{value}}' },
  ],
})

```

**3. Optional JS helpers**

```ts
import {
  callRefreshEndpoint,
  clearTokenRefresh,
  getStoredTokenRefreshConfig,
} from 'react-native-nitro-fetch'

// Same mapping rules as native; uses global fetch from JS
const headers = await callRefreshEndpoint(config)

// Remove stored config and token caches (scope with 'fetch' | 'websocket' | 'all')
clearTokenRefresh('fetch')

// Read back what was registered (or null)
const stored = getStoredTokenRefreshConfig('fetch')
```

The refresh config and header caches are stored with **platform secure storage** (Android Keystore + encrypted values in `SharedPreferences`, iOS Keychain-backed encryption in the same `UserDefaults` suite as other nitro keys).

### AbortController

Cancel in-flight requests using the standard `AbortController` API:

```ts
import { fetch } from 'react-native-nitro-fetch'

const controller = new AbortController()

// Abort after 500ms
setTimeout(() => controller.abort(), 500)

try {
  const res = await fetch('https://httpbin.org/delay/20', {
    signal: controller.signal,
  })
} catch (e) {
  if (e.name === 'AbortError') {
    console.log('Request was cancelled')
  }
}
```

Pre-aborted signals are also supported — the request will throw immediately without making a network call:

```ts
const controller = new AbortController()
controller.abort()

await fetch(url, { signal: controller.signal }) // throws AbortError
```

### FormData

Upload files and form fields using `FormData`:

```ts
import { fetch } from 'react-native-nitro-fetch'

const fd = new FormData()
fd.append('username', 'nitro_user')
fd.append('avatar', {
  uri: 'file:///path/to/photo.jpg',
  type: 'image/jpeg',
  name: 'avatar.jpg',
} as any)

const res = await fetch('https://httpbin.org/post', {
  method: 'POST',
  body: fd,
})
const json = await res.json()
```

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
Before using worklet mapping, install and configure [react-native-worklets](https://docs.swmansion.com/react-native-worklets/docs/).

### Streaming with `TextDecoder` 

Nitro Fetch can also expose an streaming mode that returns a `ReadableStream` body.  
Combined with [`react-native-nitro-text-decoder`](https://github.com/margelo/react-native-nitro-fetch/tree/main/packages/react-native-nitro-text-decoder), you can incrementally decode UTF‑8 chunks:

```tsx
import { useRef, useState } from 'react'
import { fetch as nitroFetch } from 'react-native-nitro-fetch'
import { TextDecoder } from 'react-native-nitro-text-decoder'

export function StreamingExample() {
  const [output, setOutput] = useState('')
  const decoder = useRef(new TextDecoder())

  const append = (text: string) => {
    setOutput(prev => prev + text)
  }

  const runStream = async () => {
    // `stream: true` enables the streaming transport
    const res = await nitroFetch('https://httpbin.org/stream/20', {
      stream: true,
    })

    const reader = res.body?.getReader()
    if (!reader) {
      append('No readable stream!')
      return
    }

    let chunks = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks++
      const text = decoder.current.decode(value, { stream: true })
      append(text)
    }

    append(`\n\n✅ Done — ${chunks} chunk(s) received`)
  }

  // Call `runStream()` from a button handler in your UI
}
```

### WebSockets & prewarm

Use **[react-native-nitro-websockets](docs/websockets.md)** for `NitroWebSocket` (browser-like API: `onopen`, `onmessage`, `send`, `close`, …). Install **`react-native-nitro-text-decoder`** alongside it — the socket package uses it to decode UTF-8 text frames.

**Prewarm on next launch** — queue URLs from JS so native code can start the handshake before React loads:

```ts
import {
  prewarmOnAppStart,
  removeFromPrewarmQueue,
  clearPrewarmQueue,
} from 'react-native-nitro-websockets'

prewarmOnAppStart('wss://echo.websocket.org')
// optional: prewarmOnAppStart(url, ['subproto'], { Authorization: 'Bearer …' })

clearPrewarmQueue()
removeFromPrewarmQueue('wss://echo.websocket.org')
```

On **Android**, call `NitroWebSocketAutoPrewarmer.prewarmOnStart(this)` in `Application.onCreate` (see [example `MainApplication.kt`](example/android/app/src/main/java/nitrofetch/example/MainApplication.kt)). **iOS** picks up the queue via the linked pod.

Authenticated prewarms: use **`registerTokenRefresh`** with `target: 'websocket'` or `'all'` — see [Token refresh (cold start)](#token-refresh-cold-start) for a **small `registerTokenRefresh` + `prewarmOnAppStart` + `NitroWebSocket` example**.

More detail: **[docs/websockets.md](docs/websockets.md)** · UI sample: **[example/src/screens/WebSocketScreen.tsx](example/src/screens/WebSocketScreen.tsx)**.

## Limitations & Alternatives

- **WebSockets** are not part of `react-native-nitro-fetch` itself; use the companion package **[react-native-nitro-websockets](docs/websockets.md)** (with **react-native-nitro-text-decoder**). For other stacks, [react-native-fast-io](https://github.com/callstackincubator/react-native-fast-io) is another option.

## Documentation

- [Getting Started](docs/getting-started.md)
- [API Reference](docs/api.md)
- [Android Details](docs/android.md)
- [iOS Details](docs/ios.md)
- [Prefetch & Auto-Prefetch](docs/prefetch.md)
- [WebSockets & prewarm](docs/websockets.md)
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
- [Ritesh Shukla](https://github.com/riteshshukla04)

## License

MIT

