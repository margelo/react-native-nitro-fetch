---
id: websockets
title: WebSockets
sidebar_position: 8
---

# WebSockets

High-performance WebSockets for React Native, built as a [Nitro Module](https://github.com/mrousavy/nitro) (libwebsockets + mbedTLS). This package lives alongside **react-native-nitro-fetch** in the same repo; HTTP stays in nitro-fetch, sockets in nitro-websockets.

## Installation

Install **three** packages: the WebSocket module, **Nitro Modules** (required by all Nitro libraries), and **react-native-nitro-text-decoder** (a peer dependency used to decode UTF-8 text frames).

```bash
npm i react-native-nitro-websockets react-native-nitro-text-decoder react-native-nitro-modules
```

:::tip
If you already use **react-native-nitro-fetch**, just add the websockets and text-decoder packages. Keep `react-native-nitro-modules` on a compatible version.
:::

Then install native pods and rebuild:

```bash
cd ios && pod install && cd ..
npx react-native run-ios   # or run-android
```

## NitroWebSocket API

The JS surface is a small class modeled after the browser `WebSocket`.

### Constructor

```ts
import { NitroWebSocket } from 'react-native-nitro-websockets';

const ws = new NitroWebSocket(
  url: string,
  protocols?: string | string[],
  headers?: Record<string, string>
);
```

- **url** — `ws:` / `wss:` endpoint
- **protocols** — optional subprotocol string or list (`Sec-WebSocket-Protocol`)
- **headers** — optional extra HTTP headers for the upgrade request

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `readyState` | `'CONNECTING' \| 'OPEN' \| 'CLOSING' \| 'CLOSED'` | Current connection state |
| `url` | `string` | The WebSocket URL |
| `protocol` | `string` | Negotiated subprotocol |
| `bufferedAmount` | `number` | Bytes queued for sending |
| `extensions` | `string` | Negotiated extensions |

### Methods

- **`send(data: string | ArrayBuffer)`** — Send text or binary data
- **`close(code?: number, reason?: string)`** — Close the connection (default code `1000`)

### Events

```ts
ws.onopen = () => void;
ws.onmessage = (e: WebSocketMessageEvent) => void;
ws.onerror = (error: string) => void;
ws.onclose = (e: { code: number; reason: string }) => void;
```

The `WebSocketMessageEvent` contains:
- `e.data` — string for text frames
- `e.isBinary` — `true` for binary frames; use `e.binaryData` (`ArrayBuffer`)

### Example

```ts
const ws = new NitroWebSocket('wss://echo.websocket.org');

ws.onopen = () => console.log('open');
ws.onmessage = (e) => console.log('message', e.data, e.isBinary);
ws.onerror = (err) => console.error(err);
ws.onclose = (e) => console.log('closed', e.code, e.reason);

ws.send('hello');
ws.close(1000, 'bye');
```

## Prewarm on next app launch

Prewarming starts the TLS/WebSocket handshake **natively** on startup (before JS runs), using URLs you enqueue from JavaScript.

:::note
Prewarm uses the same NativeStorage queue as nitro-fetch, so **react-native-nitro-fetch** must be installed.
:::

### JS helpers

```ts
import {
  prewarmOnAppStart,
  removeFromPrewarmQueue,
  clearPrewarmQueue,
} from 'react-native-nitro-websockets';

// Queue or update an entry (deduped by URL)
prewarmOnAppStart('wss://api.example.com/ws', ['chat-v1'], {
  Authorization: 'Bearer ...',
});

// Remove one URL from the queue
removeFromPrewarmQueue('wss://api.example.com/ws');

// Clear the entire queue
clearPrewarmQueue();
```

### Android native hook

In `Application.onCreate`, before or after `loadReactNative`:

```kotlin
import com.margelo.nitro.nitrofetchwebsockets.NitroWebSocketAutoPrewarmer

override fun onCreate() {
  super.onCreate()
  NitroWebSocketAutoPrewarmer.prewarmOnStart(this)
  // ...
}
```

### Auth on cold start

If prewarmed sockets need fresh headers, register token refresh with `target: 'websocket'` or `'all'` using `registerTokenRefresh` from `react-native-nitro-fetch`. See the [Token Refresh guide](./token-refresh.md) for details.

## See also

- [Prefetch & Auto-Prefetch](./prefetch.md) — HTTP prefetch; pairs conceptually with WS prewarm
- [Token Refresh](./token-refresh.md) — Auth token configuration for cold-start requests
