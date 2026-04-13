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
- **Pre-warmable.** Once you're on `NitroWebSocket`, you can have the connection already `OPEN` before React Native finishes booting — see [`websocket-prewarm.md`](./websocket-prewarm.md).
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

For more on the new API surface, see [`using-websockets.md`](./using-websockets.md).

## The five rewrites

### 1. Replace `new WebSocket(...)` with `new NitroWebSocket(...)` at the call sites

> **Prefer explicit imports** at the call site — it's safer and easier to debug. If you want a global swap instead (`globalThis.WebSocket = NitroWebSocket`), see the [Global Replace docs](https://margelo.github.io/react-native-nitro-fetch/docs/global-replace) for setup and trade-offs.

```ts
// before
const ws = new WebSocket('wss://stream.example.com/feed', ['v1.proto']);
```

```ts
// after
import { NitroWebSocket } from 'react-native-nitro-websockets';

const ws = new NitroWebSocket('wss://stream.example.com/feed', ['v1.proto']);
```

If you have many call sites, a local alias per module is cleanest:

```ts
import { NitroWebSocket as WebSocket } from 'react-native-nitro-websockets';

// …unchanged call sites below
const ws = new WebSocket('wss://stream.example.com/feed', ['v1.proto']);
```

New call sites gain the third constructor argument (custom upgrade headers) — previously impossible on iOS:

```ts
const ws = new NitroWebSocket(
  'wss://stream.example.com/feed',
  ['v1.proto'],
  { Authorization: `Bearer ${token}` },
);
```

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

Don't forget the Android `Application.onCreate` wiring — see [`websocket-prewarm.md`](./websocket-prewarm.md).

## Library compatibility

Libraries that accept an injectable `WebSocket` constructor (socket.io-client, centrifuge-js, phoenix in some configurations) can be pointed at `NitroWebSocket` directly:

```ts
import { NitroWebSocket } from 'react-native-nitro-websockets';
import { io } from 'socket.io-client';

const socket = io('wss://example.com', {
  transports: ['websocket'],
  WebSocket: NitroWebSocket, // or whatever field the library uses
});
```

Libraries that *don't* accept an injection and hard-code `new WebSocket(...)` internally will keep using React Native's built-in WebSocket. You can either accept that, or do a [global replace](https://margelo.github.io/react-native-nitro-fetch/docs/global-replace) to route everything through NitroWebSocket — just be aware of the trade-offs documented there.

## Checklist

- [ ] `react-native-nitro-websockets`, `react-native-nitro-fetch`, `react-native-nitro-text-decoder`, and `react-native-nitro-modules` installed; `pod install` run.
- [ ] Every `new WebSocket(...)` you own replaced with `new NitroWebSocket(...)` (or `import { NitroWebSocket as WebSocket }` aliasing).
- [ ] All `.readyState` comparisons converted to string form.
- [ ] All `addEventListener` calls converted to property assignment.
- [ ] All `binaryType` setters removed; binary handling uses `e.isBinary` / `e.binaryData`.
- [ ] All `send()` payloads are `string` or `ArrayBuffer`.
- [ ] Verified your sockets appear in `NetworkInspector.getWebSocketEntries()`.
- [ ] (Optional) `prewarmOnAppStart` wired for cold-start latency wins.

## Gotchas

- **Global swap is an option, but has trade-offs.** See the [Global Replace docs](https://margelo.github.io/react-native-nitro-fetch/docs/global-replace) — DevTools, `instanceof`, and hot-reload caveats apply. Prefer explicit imports when possible.
- **Forgetting that `e.binaryData` is `undefined` for text frames.** Always check `e.isBinary` first.
- **Sending a `Blob`.** TypeScript may not catch it; runtime will. Convert first.
- **`NitroWebSocket.OPEN`.** Doesn't exist. Use the string `'OPEN'`.
- **Missed call sites.** `grep -rn 'new WebSocket('` before you ship — anything you didn't migrate keeps using the RN polyfill and silently won't appear in the inspector.

## Pointers

- API reference: [`using-websockets.md`](./using-websockets.md)
- Pre-warming: [`websocket-prewarm.md`](./websocket-prewarm.md)
- Inspector: [`network-inspector.md`](./network-inspector.md)
- Source: [`packages/react-native-nitro-websockets/src/index.ts`](../../../packages/react-native-nitro-websockets/src/index.ts)
