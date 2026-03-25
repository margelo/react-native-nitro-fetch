# WebSockets (`react-native-nitro-websockets`)

High-performance WebSockets for React Native, built as a [Nitro Module](https://github.com/mrousavy/nitro) (libwebsockets + mbedTLS). This package lives alongside **react-native-nitro-fetch** in the same repo; HTTP stays in nitro-fetch, sockets in nitro-websockets.

## Installation

Install **three** packages: the WebSocket module, **Nitro Modules** (required by all Nitro libraries), and **react-native-nitro-text-decoder** (a **peer dependency** of nitro-websockets — used to decode UTF-8 text frames on the JS side).

```sh
npm i react-native-nitro-websockets react-native-nitro-text-decoder react-native-nitro-modules
```

If you already use **react-native-nitro-fetch**, add the websockets and text-decoder packages; keep `react-native-nitro-modules` on a compatible version (see each package’s `peerDependencies`).

Then install native pods (iOS) and rebuild:

```sh
cd ios && pod install && cd ..
npx react-native run-ios   # or run-android
```


**iOS:** No additional setup required 



## `NitroWebSocket` API

The JS surface is a small class modeled after the browser `WebSocket`

### Constructor

```ts
import { NitroWebSocket } from 'react-native-nitro-websockets'

const ws = new NitroWebSocket(url: string, protocols?: string | string[], headers?: Record<string, string>)
```

- **url** — `ws:` / `wss:` endpoint.
- **protocols** — optional subprotocol string or list (Sec-WebSocket-Protocol).
- **headers** — optional extra HTTP headers for the upgrade request (as supported by native).

### Properties

- `readyState` — `'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED'`
- `url`, `protocol`, `bufferedAmount`, `extensions`

### Methods

- `send(data: string | ArrayBuffer)` — text or binary.
- `close(code?: number, reason?: string)` — default code `1000`.

### Events (assign like the browser API)

- `onopen: (() => void) | null`
- `onmessage: ((e: WebSocketMessageEvent) => void) | null`
  - `e.data` — string for text frames.
  - `e.isBinary` — `true` for binary; then prefer `e.binaryData` (`ArrayBuffer`).
- `onerror: ((error: string) => void) | null`
- `onclose: ((e: { code: number; reason: string }) => void) | null`

### Example (aligned with the example app)

```ts
const ws = new NitroWebSocket('wss://echo.websocket.org')

ws.onopen = () => console.log('open')
ws.onmessage = (e) => console.log('message', e.data, e.isBinary)
ws.onerror = (err) => console.error(err)
ws.onclose = (e) => console.log('closed', e.code, e.reason)

ws.send('hello')
ws.close(1000, 'bye')
```


## Prewarm on next app launch

Prewarming starts the TLS/WebSocket handshake **natively** on startup (before JS runs), using URLs you enqueue from JavaScript. That uses the same **NativeStorage** queue as nitro-fetch (`nitro_fetch_storage`), so **react-native-nitro-fetch** must be installed for prewarm to work.

### JS helpers

```ts
import {
  prewarmOnAppStart,
  removeFromPrewarmQueue,
  clearPrewarmQueue,
} from 'react-native-nitro-websockets'

// Queue or update an entry (deduped by URL)
prewarmOnAppStart('wss://api.example.com/ws', ['chat-v1'], {
  Authorization: 'Bearer …',
})

// Remove one URL from the queue
removeFromPrewarmQueue('wss://api.example.com/ws')

// Clear the entire queue
clearPrewarmQueue()
```

Optional second argument: **subprotocols** array. Optional third: **headers** for the upgrade request.

### Android native hook

In `Application.onCreate`, before or after `loadReactNative`:

```kotlin
import com.margelo.nitro.nitrofetchwebsockets.NitroWebSocketAutoPrewarmer

override fun onCreate() {
  super.onCreate()
  NitroWebSocketAutoPrewarmer.prewarmOnStart(this)
  // …
}
```



### Auth on cold start

If prewarmed sockets need fresh headers, register token refresh with `target: 'websocket'` or `'all'` using **`registerTokenRefresh`** from `react-native-nitro-fetch` (see the main README, **Token refresh (cold start)**).



## See also

- [Prefetch & auto-prefetch](prefetch.md) — HTTP prefetch; pairs conceptually with WS prewarm.
- [README.md](../README.md) — token refresh, installation, features.
