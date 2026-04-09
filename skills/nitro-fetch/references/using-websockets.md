---
id: using-websockets
title: Using NitroWebSocket (ws and wss)
scope: react-native-nitro-websockets
keywords: websocket, wss, tls, libwebsockets, mbedtls, headers, binary
---

# Using `NitroWebSocket`

## Mental model

`NitroWebSocket` is a browser-shaped WebSocket class backed by **libwebsockets + mbedTLS** under the hood. It looks and feels like the standard `WebSocket` you're used to, with three concrete differences that exist for good reasons:

| Difference | Why |
|---|---|
| Constructor takes a third `headers` argument | RN's built-in WebSocket can't send custom upgrade headers on iOS. This one can. |
| `readyState` is a string (`'OPEN'`, etc.) instead of a number | Easier to read, no constants to remember. |
| Binary frames come back as `e.binaryData: ArrayBuffer` (with `e.isBinary` flag) | No `binaryType` setter; binary and text are always distinguishable. |

For TLS, the package ships its own Mozilla CA bundle and validates against it via mbedTLS. That means `wss://` works the same on physical iOS devices, simulators, emulators, and old Android builds — you don't depend on the system trust store.

For migrating from React Native's built-in `WebSocket`, see the [migration skill](./migrate-from-rn-ws.md).

## Why use NitroWebSocket

- **Custom upgrade headers on every platform.** Auth tokens, tenant IDs, client metadata — all on the upgrade request, including on iOS where RN's built-in WebSocket doesn't support headers at all.
- **First-class binary frames.** No `Blob` round-trip, no `binaryType` toggle — binary and text are distinguished by `e.isBinary`.
- **Native UTF-8 decoding for text frames** via `react-native-nitro-text-decoder` — text payloads arrive as JS strings without you doing any decoding.
- **Bundled CA trust store.** Mozilla's `cacert.pem` is compiled in via mbedTLS, so `wss://` behaves identically on physical devices, simulators, and old Android builds.
- **Pre-warmable.** Pair with `prewarmOnAppStart` to have the connection already `OPEN` before React Native boots.
- **Inspector-aware.** When `NetworkInspector` is enabled, every `NitroWebSocket` automatically records its open / messages / close into the inspector log.

## Setup

Install three packages — the WebSocket class, the fetch package (the inspector lives there and `NitroWebSocket` autoregisters with it when present), and the text decoder (it's used internally to decode incoming text frames):

```bash
npm install \
  react-native-nitro-websockets \
  react-native-nitro-fetch \
  react-native-nitro-text-decoder \
  react-native-nitro-modules

cd ios && pod install
```

`react-native-nitro-modules` is the shared Nitro runtime; the other three are independent packages you'll use throughout the app. `react-native-nitro-fetch` and `react-native-nitro-text-decoder` are technically declared as peer deps of `react-native-nitro-websockets`, but installing them explicitly makes the dependency obvious in your `package.json` and prevents version drift on `bun` / `yarn` workspaces.

> **Why nitro-fetch even if you only use WebSockets?** `NitroWebSocket` does a `try { require('react-native-nitro-fetch').NetworkInspector } catch {}` at load time and silently no-ops if it's missing. Installing the fetch package gives you in-app WebSocket recording for free; skipping it just means you won't see WS entries in the inspector.

## API at a glance

```ts
import { NitroWebSocket } from 'react-native-nitro-websockets';
import type {
  WebSocketMessageEvent,
  WebSocketCloseEvent,
} from 'react-native-nitro-websockets';

class NitroWebSocket {
  constructor(
    url: string,
    protocols?: string | string[],
    headers?: Record<string, string>,
  );

  // State (all read-only)
  readonly readyState: 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED';
  readonly url: string;
  readonly protocol: string;
  readonly bufferedAmount: number;
  readonly extensions: string;

  // Handlers — assignment, not addEventListener
  onopen:    (() => void) | null;
  onmessage: ((e: WebSocketMessageEvent) => void) | null;
  onclose:   ((e: WebSocketCloseEvent) => void) | null;
  onerror:   ((error: string) => void) | null;

  // Methods
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}

type WebSocketMessageEvent = {
  data: string;             // decoded UTF-8 (empty when binary)
  isBinary: boolean;
  binaryData?: ArrayBuffer; // present iff isBinary
};
```

Source: [`packages/react-native-nitro-websockets/src/index.ts`](../../packages/react-native-nitro-websockets/src/index.ts).

## Recipes

### Recommended: swap `globalThis.WebSocket` once

The cleanest way to use `NitroWebSocket` everywhere — your code *and* libraries you don't own (Phoenix, socket.io-client, Firebase RTDB, Ably, centrifuge-js, ...) — is to point `globalThis.WebSocket` at it from a setup file imported as the very first line of `index.js`. After that, every `new WebSocket(...)` call site uses the nitro implementation:

```ts
// src/setupNitroGlobals.ts
import { NitroWebSocket } from 'react-native-nitro-websockets';

;(globalThis as any).__rnWebSocket = (globalThis as any).WebSocket;
;(globalThis as any).WebSocket     = NitroWebSocket;
```

```js
// index.js — must be the very first import
import './src/setupNitroGlobals';
import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
```

Now every existing call site just works — including the third constructor argument for headers:

```ts
const ws = new WebSocket('wss://stream.example.com/feed', ['v1.proto'], {
  Authorization: `Bearer ${token}`, // ← previously impossible on iOS
});
```

For the combined fetch + WebSocket setup file (and the matching escape hatch via `__rnWebSocket`), see [`nitro-fetch-replace-global`](./replace-global.md).

The remaining recipes use `NitroWebSocket` directly — both styles work side by side.

### `ws://` echo client

```ts
import { NitroWebSocket } from 'react-native-nitro-websockets';

const ws = new NitroWebSocket('ws://localhost:8080/echo');

ws.onopen    = () => ws.send('hello');
ws.onmessage = (e) => console.log('text:', e.data);
ws.onclose   = (e) => console.log('closed', e.code, e.reason);
ws.onerror   = (err) => console.warn('ws error', err);
```

### `wss://` with auth headers

The constructor's third argument is the reason most teams reach for this package:

```ts
const ws = new NitroWebSocket(
  'wss://stream.example.com/feed',
  ['v1.feed.proto'],          // optional subprotocols
  {
    Authorization: `Bearer ${token}`,
    'X-Tenant':   'acme',
  },
);
```

The headers go on the upgrade request via libwebsockets' `LWS_CALLBACK_CLIENT_APPEND_HANDSHAKE_HEADER` hook.

### Binary frames in and out

```ts
ws.onmessage = (e) => {
  if (e.isBinary && e.binaryData) {
    const view = new Uint8Array(e.binaryData);
    handleBinary(view);
  } else {
    handleText(e.data);
  }
};

// Sending: ArrayBuffer → binary frame, string → text frame
ws.send('hello');

const buf = new Uint8Array([0x01, 0x02, 0x03, 0x04]).buffer;
ws.send(buf);
```

### Lifecycle in a React screen

`NitroWebSocket` instances aren't garbage-collected when a component unmounts. Always close in cleanup:

```tsx
function FeedScreen() {
  useEffect(() => {
    const ws = new NitroWebSocket('wss://stream.example.com/feed');
    ws.onmessage = (e) => /* ... */;
    return () => ws.close();
  }, []);
  return <View />;
}
```

For long-lived sockets that should outlive a single screen, hoist the instance to a module variable or context.

## Differences from `WebSocket` (cheat sheet)

| | Standard `WebSocket` | `NitroWebSocket` |
|---|---|---|
| `readyState` | numeric (0–3) | string (`'OPEN'` etc.) |
| Custom upgrade headers | not supported on iOS | ✅ third constructor arg |
| Binary frames | `binaryType` toggle | `e.isBinary` + `e.binaryData` |
| `addEventListener` | yes | **no** — use property assignment |
| `Blob` payloads | yes | no — pass an `ArrayBuffer` |
| TLS roots | OS trust store | bundled Mozilla CA via mbedTLS |
| Pre-warming | n/a | yes ([prewarm skill](./websocket-prewarm.md)) |

For migrating an existing app, see [`nitro-fetch-migrate-from-rn-ws`](./migrate-from-rn-ws.md).

## Gotchas

- **Numeric `readyState` checks.** `if (ws.readyState === 1)` is always false here. Use `'OPEN'`.
- **`addEventListener` not implemented.** Property assignment only.
- **Reading `e.data` for binary frames.** It's the empty string. Always check `e.isBinary` first.
- **Sending a `Blob` or `Buffer`.** Throws. Convert: `send(uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength))`.
- **Forgetting `ws.close()` in `useEffect` cleanup.** The native socket stays alive, the JS object stays referenced, and you slowly leak.
- **Multiple sockets to the same URL.** Allowed. But pre-warming only adopts the *first* one — subsequent constructors open fresh connections.

## Pointers

- Source: [`packages/react-native-nitro-websockets/src/index.ts`](../../packages/react-native-nitro-websockets/src/index.ts)
- C++ side: [`packages/react-native-nitro-websockets/cpp/HybridWebSocket.cpp`](../../packages/react-native-nitro-websockets/cpp/HybridWebSocket.cpp)
- Bundled CA: [`packages/react-native-nitro-websockets/cpp/cacert.pem`](../../packages/react-native-nitro-websockets/cpp/cacert.pem)
- Working example: [`example/src/screens/WebSocketScreen.tsx`](../../example/src/screens/WebSocketScreen.tsx)
- Long-form docs: [`docs-website/docs/websockets.md`](../../docs-website/docs/websockets.md)
- Related: [`nitro-fetch-websocket-prewarm`](./websocket-prewarm.md), [`nitro-fetch-migrate-from-rn-ws`](./migrate-from-rn-ws.md), [`nitro-fetch-network-inspector`](./network-inspector.md)
