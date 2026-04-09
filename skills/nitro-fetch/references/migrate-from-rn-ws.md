---
id: migrate-from-rn-ws
title: Migrating from React Native's WebSocket to NitroWebSocket
scope: react-native-nitro-websockets
keywords: migration, websocket, refactor, wss, addEventListener, binaryType
---

# Migrating from `WebSocket` to `NitroWebSocket`

## Mental model

Migration is a find-and-replace, but there are five things that *will* trip you up if you don't fix them deliberately:

1. The constructor takes a third arg.
2. `readyState` is a string, not a number.
3. There's no `addEventListener` — only property assignment.
4. There's no `binaryType` setter — binary and text are distinguished by `e.isBinary`.
5. `send()` accepts `string | ArrayBuffer` only — no `Blob`, no raw `Uint8Array`.

Once those five are out of the way, the rest of the API maps one-to-one. There's a checklist at the bottom of this skill — work through it and you're done.

## Why migrate

- **Custom upgrade headers everywhere.** Auth tokens, tenant IDs, client metadata go on the upgrade request — including on iOS, where RN's built-in WebSocket can't send headers at all.
- **Reliable `wss://` across devices.** The package ships its own Mozilla CA bundle and validates via mbedTLS, so TLS behaves identically on physical iOS devices, simulators, emulators, and old Android builds.
- **First-class binary frames.** No `Blob` round-trip, no `binaryType` toggle. Binary and text are explicitly distinguished by `e.isBinary`.
- **Native UTF-8 decoding** for text frames via `react-native-nitro-text-decoder` (~50× faster than the JS shim).
- **Pre-warmable.** Once you're on `NitroWebSocket`, you can have the connection already `OPEN` before React Native finishes booting — see [`nitro-fetch-websocket-prewarm`](./websocket-prewarm.md).
- **Inspector-aware.** Every `NitroWebSocket` automatically records open / messages / close into `NetworkInspector` — you get an in-app WS log for free.

## Setup

Install the WebSocket package together with `react-native-nitro-fetch` (so `NitroWebSocket` can register its activity with `NetworkInspector`) and `react-native-nitro-text-decoder` (used internally to decode text frames):

```bash
npm install \
  react-native-nitro-websockets \
  react-native-nitro-fetch \
  react-native-nitro-text-decoder \
  react-native-nitro-modules

cd ios && pod install
```

For more on the new API surface, see [`nitro-fetch-using-websockets`](./using-websockets.md).

## The five rewrites

### 1. Swap `globalThis.WebSocket` once

The recommended migration is the same shape as the [`nitro-fetch-replace-global`](./replace-global.md) skill: a tiny setup file imported as the very first line of `index.js`, which reassigns `globalThis.WebSocket` to `NitroWebSocket`. After that, every `new WebSocket(...)` call site in your app — and inside libraries you don't own — uses the nitro implementation. You don't have to find-and-replace anything.

```ts
// src/setupNitroWebSocket.ts
import { NitroWebSocket } from 'react-native-nitro-websockets';

;(globalThis as any).__rnWebSocket = (globalThis as any).WebSocket; // stash original
;(globalThis as any).WebSocket     = NitroWebSocket;
```

```js
// index.js — must be the very first import
import './src/setupNitroWebSocket';
import './src/setupNitroFetch'; // if you also swap fetch
import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
```

Now your existing call sites just work:

```ts
const ws = new WebSocket('wss://stream.example.com/feed', ['v1.proto']);
// ↑ resolves to NitroWebSocket — gets headers, native TLS, inspector, the lot
```

For new call sites where you want the third constructor argument (custom upgrade headers), pass it the same way you would to a standard `WebSocket`:

```ts
const ws = new WebSocket(
  'wss://stream.example.com/feed',
  ['v1.proto'],
  { Authorization: `Bearer ${token}` }, // ← previously impossible on iOS
);
```

`NitroWebSocket`'s constructor accepts the third arg even when called via the global alias, since it's just a class.


### 2. Fix `readyState` comparisons

`readyState` is a **string**. Search for `.readyState` and rewrite numeric comparisons:

```ts
// before
if (ws.readyState === WebSocket.OPEN) { ... }
if (ws.readyState === 1) { ... }

// after
if (ws.readyState === 'OPEN') { ... }
```

The four valid values are `'CONNECTING'`, `'OPEN'`, `'CLOSING'`, `'CLOSED'`.

### 3. Convert `addEventListener` to property assignment

```ts
// before
ws.addEventListener('open',    onOpen);
ws.addEventListener('message', onMessage);
ws.addEventListener('close',   onClose);
ws.addEventListener('error',   onError);

// after
ws.onopen    = onOpen;
ws.onmessage = onMessage;
ws.onclose   = onClose;
ws.onerror   = onError;
```

Need multiple listeners on a single event? Fan out yourself:

```ts
const messageListeners = new Set<(e: WebSocketMessageEvent) => void>();
ws.onmessage = (e) => messageListeners.forEach((fn) => fn(e));
```

### 4. Fix binary frame handling

```ts
// before — RN's WebSocket with binaryType = 'arraybuffer'
ws.binaryType = 'arraybuffer';
ws.onmessage = (e) => {
  if (typeof e.data === 'string') handleText(e.data);
  else handleBinary(e.data); // ArrayBuffer
};

// after
import type { WebSocketMessageEvent } from 'react-native-nitro-websockets';

ws.onmessage = (e: WebSocketMessageEvent) => {
  if (e.isBinary && e.binaryData) handleBinary(e.binaryData);
  else handleText(e.data); // already a UTF-8 string, decoded natively
};
```

There's no `binaryType` setter — the discriminator is `e.isBinary`.

### 5. Fix `send()` payloads

`send` accepts `string` or `ArrayBuffer`. If you were passing a `Blob`, a `Uint8Array`, or a Node `Buffer`, convert:

```ts
// before
ws.send(blob);
ws.send(uint8Array);
ws.send(buffer);

// after
ws.send(await blob.arrayBuffer());
ws.send(uint8Array.buffer.slice(
  uint8Array.byteOffset,
  uint8Array.byteOffset + uint8Array.byteLength,
));
ws.send(buffer.buffer.slice(
  buffer.byteOffset,
  buffer.byteOffset + buffer.byteLength,
));
```

The `slice` matters when the typed array is a view over a larger backing buffer — without it you'd send the wrong bytes.

## Verifying the migration

Turn on the inspector and confirm the migrated socket flows through nitro:

```ts
import { NetworkInspector } from 'react-native-nitro-fetch';

NetworkInspector.enable();
// ...exercise the WS...
console.log(NetworkInspector.getWebSocketEntries());
```

If your socket isn't in the output, there's still a `new WebSocket(...)` somewhere.

## Optional — once you're migrated, pre-warm

```ts
import { prewarmOnAppStart } from 'react-native-nitro-websockets';

prewarmOnAppStart('wss://stream.example.com/feed', ['v1.proto'], {
  Authorization: `Bearer ${token}`,
});
```

Don't forget the Android `Application.onCreate` wiring — see [`nitro-fetch-websocket-prewarm`](./websocket-prewarm.md).

## Library compatibility

Once `globalThis.WebSocket` points at `NitroWebSocket`, libraries that read from the global (`phoenix`, `socket.io-client`, `centrifuge-js`, Firebase RTDB, Ably, ...) automatically use the nitro implementation. That's the entire point of the swap.

If a library imports `WebSocket` from a typed namespace and does `instanceof WebSocket` checks against the *original*, it'll fail under the swap — uncommon, but real. The escape hatch is the original you stashed at setup time:

```ts
const OriginalWebSocket = (globalThis as any).__rnWebSocket;

const flakyClient = createSomeLibrary({
  WebSocket: OriginalWebSocket, // bypass nitro just for this client
});
```

## Checklist

- [ ] `react-native-nitro-websockets`, `react-native-nitro-fetch`, `react-native-nitro-text-decoder`, and `react-native-nitro-modules` installed; `pod install` run.
- [ ] `setupNitroWebSocket.ts` (and `setupNitroFetch.ts` if you also swap fetch) imported as the very first lines of `index.js`.
- [ ] All `.readyState` comparisons converted to string form.
- [ ] All `addEventListener` calls converted to property assignment.
- [ ] All `binaryType` setters removed; binary handling uses `e.isBinary` / `e.binaryData`.
- [ ] All `send()` payloads are `string` or `ArrayBuffer`.
- [ ] Verified your sockets appear in `NetworkInspector.getWebSocketEntries()`.
- [ ] (Optional) `prewarmOnAppStart` wired for cold-start latency wins.

## Gotchas

- **Setup file imported too late.** The `globalThis.WebSocket = NitroWebSocket` line must run before any library that captures `WebSocket` into a module-local. Make `setupNitroWebSocket` the very first import in `index.js`.
- **Forgetting that `e.binaryData` is `undefined` for text frames.** Always check `e.isBinary` first.
- **Sending a `Blob`.** TypeScript may not catch it; runtime will. Convert first.
- **`NitroWebSocket.OPEN`.** Doesn't exist. Use the string `'OPEN'`.
- **`instanceof WebSocket` against the original.** Uncommon but real — keep `__rnWebSocket` around as an escape hatch for libraries that do this.

## Pointers

- API reference: [`nitro-fetch-using-websockets`](./using-websockets.md)
- Pre-warming: [`nitro-fetch-websocket-prewarm`](./websocket-prewarm.md)
- Inspector: [`nitro-fetch-network-inspector`](./network-inspector.md)
- Source: [`packages/react-native-nitro-websockets/src/index.ts`](../../packages/react-native-nitro-websockets/src/index.ts)
