---
id: websocket-prewarm
title: Pre-warming WebSockets before React Native boots
scope: react-native-nitro-websockets
keywords: websocket, prewarm, cold start, libwebsockets, wss, handshake
---

# Pre-warming WebSockets

## Mental model

A WebSocket handshake on a cold start has to wait for: TCP connect, TLS handshake, HTTP upgrade, server-side auth. On a slow network and a TLS endpoint, that's easily 500–1500 ms — and it can't even *begin* until React Native has loaded enough to run your `new WebSocket()` line.

The pre-warmer cuts that delay to roughly zero by doing two things:

1. **Persist intent.** You tell it once (after login, say) that "this URL should be open on every cold start". It writes the URL + headers to native storage.
2. **Native bootstrap.** On the *next* launch, before the JS engine even runs, native code reads the queue and opens the connection on a background C++ service thread. Anything the server pushes during boot is buffered.
3. **JS adoption.** Later, when your screen runs `new NitroWebSocket(sameUrl, ...)`, the constructor finds the warm `wsi`, takes ownership (`lws_set_wsi_user`), and replays buffered messages onto your `onmessage` handler.

The user code is ordinary — no `await`, no special "warm socket" type. The pre-warmer is a side-channel optimisation; if it doesn't kick in (first install, no queue entry, URL mismatch), construction falls back to opening fresh.

This is for the *next* launch, not the current one. Pre-warming and immediately constructing a `NitroWebSocket` does nothing useful.

## Why pre-warm

- **The TLS handshake is the slowest part of opening `wss://`** — pre-warming runs it on a background thread before React Native finishes booting, so the JS code that constructs the socket gets an already-`OPEN` connection.
- **Server messages received during boot are buffered.** If your backend pushes a snapshot the moment the socket connects, you don't lose it — the JS handler replays it after adoption.
- **Zero JS-side complexity.** Your screen still calls `new NitroWebSocket(url, ...)`; the adoption is invisible to your code.
- **Survives app restarts.** Schedule the pre-warm once after sign-in and every subsequent cold start gets the win.
- **Combines with token refresh** so pre-warmed sockets still authenticate correctly after long idle periods.

## Setup

### iOS — automatic

iOS auto-bootstraps via `+load` in [`packages/react-native-nitro-websockets/ios/NitroWSAutoBootstrap.mm`](../../packages/react-native-nitro-websockets/ios/NitroWSAutoBootstrap.mm). Nothing to wire.

### Android — one line in `Application.onCreate`

```kotlin
import com.margelo.nitro.nitrofetchwebsockets.NitroWebSocketAutoPrewarmer

class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    NitroWebSocketAutoPrewarmer.prewarmOnStart(this)
    loadReactNative(this)
  }
}
```

Reference: [`example/android/app/src/main/java/nitrofetch/example/MainApplication.kt`](../../example/android/app/src/main/java/nitrofetch/example/MainApplication.kt).

If you skip this on Android, the JS API silently writes to disk and nothing on the native side ever reads it back.

## API

```ts
import {
  prewarmOnAppStart,
  removeFromPrewarmQueue,
  clearPrewarmQueue,
} from 'react-native-nitro-websockets';
```

| Function | Behaviour |
|---|---|
| `prewarmOnAppStart(url, protocols?, headers?)` | Persist this entry. Synchronous; no return value. Replaces an existing entry with the same URL. |
| `removeFromPrewarmQueue(url)` | Drop one entry. No-op if it isn't there. |
| `clearPrewarmQueue()` | Wipe the queue. |

Source: [`packages/react-native-nitro-websockets/src/prewarm.ts`](../../packages/react-native-nitro-websockets/src/prewarm.ts).

## Recipes

### Schedule a pre-warm after sign-in

```ts
import { prewarmOnAppStart } from 'react-native-nitro-websockets';

function onLoginSuccess(token: string) {
  prewarmOnAppStart(
    'wss://stream.example.com/feed',
    ['v1.feed.proto'],
    {
      Authorization: `Bearer ${token}`,
      'X-Client': 'mobile',
    },
  );
}
```

### Adopt the warm connection

The screen that opens the WebSocket doesn't need to know whether the connection is warm or cold — it constructs `NitroWebSocket` the same way. The native layer hands over the warm `wsi` if the URL matches.

```ts
import { NitroWebSocket } from 'react-native-nitro-websockets';

const ws = new NitroWebSocket(
  'wss://stream.example.com/feed', // ← must match exactly
  ['v1.feed.proto'],
  { Authorization: `Bearer ${token}` },
);

ws.onopen = () => {
  // May fire immediately on adoption (the connection is already open).
};

ws.onmessage = (e) => {
  // Includes buffered messages from before JS was ready.
  if (e.isBinary) handleBinary(e.binaryData!);
  else handleText(e.data);
};
```

### Adoption via the global swap

If you've followed [`nitro-fetch-replace-global`](./replace-global.md) and pointed `globalThis.WebSocket` at `NitroWebSocket`, pre-warmed connections are adopted by **anything** that calls `new WebSocket(url)` on the global — your code and the libraries (Phoenix, socket.io-client, Firebase RTDB, Ably, ...) you don't own. The libraries don't need to know the pre-warmer exists.

```ts
// index.js
import './src/setupNitroGlobals'; // swaps globalThis.WebSocket → NitroWebSocket
// ...
```

```ts
// somewhere else in your app — could be inside a third-party library
const ws = new WebSocket('wss://stream.example.com/feed', ['v1.feed.proto']);
// ↑ adopts the warm connection if the URL matches the prewarm queue
```

This is the recommended setup. It's the only way to make pre-warming benefit libraries that construct their own WebSockets internally.

### Tear down on logout

```ts
import { clearPrewarmQueue, removeFromPrewarmQueue } from 'react-native-nitro-websockets';

function onLogout() {
  clearPrewarmQueue();
}

// Or selectively:
removeFromPrewarmQueue('wss://stream.example.com/feed');
```

If you forget, the next cold start tries to reconnect with a stale auth header.

### Refresh tokens before replay

If your stored auth header expires, register a token-refresh config (see `docs-website/docs/token-refresh.md`). The native bootstrap calls the refresh endpoint first, then replays the queue with the fresh headers.

## Gotchas

- **URL mismatch kills adoption.** `wss://example.com/feed` and `wss://example.com/feed/` (trailing slash) are different. Match them character-for-character.
- **Wiring missed on Android.** No crash, no log — just silently no pre-warm. The single line in `Application.onCreate` is the difference between "works" and "did nothing".
- **Pre-warming the current launch.** It only helps the *next* cold start. There's nothing to do for the launch you're currently in.
- **Stale headers.** Whatever you stored is what gets used. Either rotate quickly enough that they stay fresh, or wire token refresh.
- **Too many entries.** Each entry opens a real socket on cold start. Stick to one or two streams that actually matter.
- **`onopen` race.** If the warm socket is already `OPEN` by the time you assign `onopen`, the JS class still fires it for you (it buffers internally). Just assign your handlers synchronously after construction and don't worry about it.

## Pointers

- JS: [`packages/react-native-nitro-websockets/src/prewarm.ts`](../../packages/react-native-nitro-websockets/src/prewarm.ts)
- Android bootstrap: [`packages/react-native-nitro-websockets/android/src/main/java/com/margelo/nitro/nitrofetchwebsockets/NitroWebSocketAutoPrewarmer.kt`](../../packages/react-native-nitro-websockets/android/src/main/java/com/margelo/nitro/nitrofetchwebsockets/NitroWebSocketAutoPrewarmer.kt)
- iOS bootstrap: [`packages/react-native-nitro-websockets/ios/NitroWSAutoBootstrap.mm`](../../packages/react-native-nitro-websockets/ios/NitroWSAutoBootstrap.mm)
- C++ singleton: [`packages/react-native-nitro-websockets/cpp/WebSocketPrewarmer.hpp`](../../packages/react-native-nitro-websockets/cpp/WebSocketPrewarmer.hpp)
- Working example: [`example/src/screens/WebSocketScreen.tsx`](../../example/src/screens/WebSocketScreen.tsx)
- Related: [`nitro-fetch-using-websockets`](./using-websockets.md), [`nitro-fetch-migrate-from-rn-ws`](./migrate-from-rn-ws.md)
