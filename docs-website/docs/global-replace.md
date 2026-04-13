---
id: global-replace
title: Global Replace
sidebar_position: 1
---

# Global Replace

By default you import `fetch` explicitly from `react-native-nitro-fetch` at each call site. If you prefer a drop-in replacement so that **all** `fetch()` calls in your app (and third-party libraries) go through Nitro, you can install it globally.

## Setup

Add this at the **very top** of your entry file (before any other imports):

```ts
// index.js or App.tsx — must be the first import
import { fetch, Headers, Request, Response } from 'react-native-nitro-fetch';

globalThis.fetch = fetch;
globalThis.Headers = Headers;
globalThis.Request = Request;
globalThis.Response = Response;
```

That's it — every `fetch()` call in the process now uses the Nitro implementation.

:::caution Trade-offs
Swapping globals is convenient but comes with caveats:

- **DevTools / Flipper** network inspectors hook into the built-in `fetch` — they won't see requests after the swap. Use the [Network Inspector](./inspection.md) instead.
- **`instanceof` checks** in third-party code (e.g. `response instanceof Response`) may fail if the library captured the original `Response` before your shim ran.
- **Hot-reload** can re-run your entry file and double-patch the global — generally harmless but worth knowing.

If any of these are a problem, prefer the explicit import approach instead.
:::

## WebSocket

The same pattern works for the WebSocket package:

```ts
import { NitroWebSocket } from 'react-native-nitro-websockets';

globalThis.WebSocket = NitroWebSocket;
```

:::tip
Many WebSocket libraries (Socket.IO, Centrifuge) accept a `WebSocket` constructor option — passing `NitroWebSocket` there avoids touching the global entirely:

```ts
import { io } from 'socket.io-client';
import { NitroWebSocket } from 'react-native-nitro-websockets';

const socket = io('https://example.com', {
  transports: ['websocket'],
  WebSocket: NitroWebSocket,
});
```
:::
