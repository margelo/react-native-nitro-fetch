---
id: network-inspector
title: NetworkInspector — in-process HTTP and WebSocket recording
scope: react-native-nitro-fetch
keywords: networkinspector, devtools, debugging, in-app, curl, websocket
---

# `NetworkInspector`

## Mental model

`NetworkInspector` is a singleton that lives inside your JS bundle. When enabled, every nitro-fetch HTTP call and every `NitroWebSocket` connection becomes an entry in a ring buffer that you can read, subscribe to, or render in your own UI.

It is *not*:

- a Chrome DevTools / Flipper / RN DevTools integration,
- a wire protocol,
- a binary you ship separately.

It *is*:

- a Set of entries, a few methods, and a callback fan-out.
- always available — no special build flags, no native side to enable.
- the right tool for "let me ship a debug screen so QA can paste me a curl when something fails".

## Two visibility boundaries you should understand

Two important things this inspector deliberately *doesn't* do. They confuse people, so spell them out before you start:

1. **HTTP calls made by anything other than nitro-fetch are not visible here, and they are not in your Perfetto / Instruments traces either.** RN's built-in `fetch`, raw `XMLHttpRequest`, OkHttp/`URLSession` calls inside third-party SDKs, native Cronet calls outside this package — none of them go through nitro's recording path. They live in the OS network stack and are entirely invisible to both the inspector and the native trace points. If you want a specific caller visible, migrate that caller to import `fetch` from `react-native-nitro-fetch` — or plug axios in via the [axios adapter](./axios-adapter.md). Don't monkey-patch `globalThis.fetch`.
2. **nitro-fetch's own HTTP calls are not pushed to React Native DevTools / Chrome DevTools network panel.** RN's DevTools network panel hooks `XMLHttpRequest`. nitro-fetch bypasses XHR entirely and goes through Nitro / JSI to native code, so its requests will never appear in DevTools. The `NetworkInspector` is the replacement view — and the curl export and `onEntry` listener are how you reach traffic that DevTools can't see.

**Symmetric summary:** DevTools sees the libraries that use XHR. The `NetworkInspector` (and Perfetto) see the libraries that use nitro-fetch. Neither sees both unless you explicitly bridge them.

If you need request-stage breakdowns (DNS / TLS / TTFB / body), this inspector is the wrong tool — you want native traces. See [`perfetto-profiling.md`](./perfetto-profiling.md).

## API

```ts
import { NetworkInspector } from 'react-native-nitro-fetch';
import type {
  NetworkEntry,        // type === 'http'
  WebSocketEntry,      // type === 'websocket'
  WebSocketMessage,
  InspectorEntry,      // = NetworkEntry | WebSocketEntry
} from 'react-native-nitro-fetch';

NetworkInspector.enable(options?: { maxEntries?: number; maxBodyCapture?: number });
NetworkInspector.disable();
NetworkInspector.isEnabled(): boolean;

NetworkInspector.getEntries():          ReadonlyArray<InspectorEntry>;
NetworkInspector.getHttpEntries():      ReadonlyArray<NetworkEntry>;
NetworkInspector.getWebSocketEntries(): ReadonlyArray<WebSocketEntry>;
NetworkInspector.getEntry(id: string):  InspectorEntry | undefined;
NetworkInspector.clear(): void;

const unsubscribe = NetworkInspector.onEntry((entry) => {
  // fires on entry creation AND every update
});
```

Defaults: `maxEntries: 500`, `maxBodyCapture: 4096` (bytes per body, per side).

Source: [`packages/react-native-nitro-fetch/src/NetworkInspector.ts`](../../../packages/react-native-nitro-fetch/src/NetworkInspector.ts).

## Setup

Once at app startup. Gating on `__DEV__` is the usual move:

```ts
// src/setupInspector.ts
import { NetworkInspector } from 'react-native-nitro-fetch';

if (__DEV__) {
  NetworkInspector.enable({
    maxEntries: 500,
    maxBodyCapture: 4096,
  });
}
```

```js
// index.js
import './src/setupInspector';
// ...
```

In a production build you typically leave the inspector off — every active entry holds references to bodies and headers.

## Recipes

### Find slow requests

```ts
const slow = NetworkInspector.getHttpEntries()
  .filter((e) => e.duration > 1000) // ms
  .sort((a, b) => b.duration - a.duration);

console.table(slow.map((e) => ({
  method: e.method,
  url:    e.url.slice(0, 60),
  status: e.status,
  ms:     Math.round(e.duration),
})));
```

### React to entries in real time

```ts
const unsub = NetworkInspector.onEntry((entry) => {
  if (entry.type === 'http') {
    if (entry.error)            console.warn('✗', entry.method, entry.url, entry.error);
    else if (entry.status >= 400) console.warn('!', entry.status, entry.url);
  } else {
    console.log('WS', entry.readyState, entry.url);
  }
});

// later
unsub();
```

`onEntry` fires both when an entry is created (e.g. fetch start) and every time it's updated (response, error, WS message). The same mutable object is passed each time — if you stash it for later, clone it.

### Copy a failing request as `curl`

Each `NetworkEntry` carries an auto-generated `curl` field:

```ts
const entry = NetworkInspector.getEntry(id);
if (entry?.type === 'http') {
  Clipboard.setString(entry.curl);
}
```

You can also build curl strings yourself with `generateCurl` (also exported from `react-native-nitro-fetch`).

### Build a debug screen

```tsx
import React, { useEffect, useState } from 'react';
import { FlatList, Text } from 'react-native';
import {
  NetworkInspector,
  type InspectorEntry,
} from 'react-native-nitro-fetch';

export function NetworkLogScreen() {
  const [entries, setEntries] = useState<readonly InspectorEntry[]>([]);

  useEffect(() => {
    NetworkInspector.enable();
    setEntries([...NetworkInspector.getEntries()]);
    return NetworkInspector.onEntry(() => {
      setEntries([...NetworkInspector.getEntries()]);
    });
  }, []);

  return (
    <FlatList
      data={entries}
      keyExtractor={(e) => e.id}
      renderItem={({ item }) =>
        item.type === 'http' ? (
          <Text>
            {item.method} {item.url} → {item.status} ({Math.round(item.duration)}ms)
          </Text>
        ) : (
          <Text>WS {item.url} — {item.messagesSent + item.messagesReceived} msgs</Text>
        )
      }
    />
  );
}
```

A full reference implementation (filter tabs, detail view, curl export, live console) lives in [`example/src/screens/NetworkInspectorScreen.tsx`](../../../example/src/screens/NetworkInspectorScreen.tsx).

## Entry shapes

### HTTP — `NetworkEntry`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unique request id |
| `type` | `'http'` | Discriminator |
| `url`, `method` | `string` | |
| `requestHeaders` | `Array<{ key, value }>` | |
| `requestBody` | `string \| undefined` | Truncated to `maxBodyCapture` |
| `requestBodySize` | `number` | Full size in bytes |
| `status`, `statusText` | `number`, `string` | `0` while in flight |
| `responseHeaders` | `Array<{ key, value }>` | |
| `responseBody` | `string \| undefined` | Truncated |
| `responseBodySize` | `number` | Full size |
| `startTime`, `endTime`, `duration` | `number` (ms via `performance.now()`) | |
| `curl` | `string` | Auto-generated |
| `error` | `string \| undefined` | Set on failure |

### WebSocket — `WebSocketEntry`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | |
| `type` | `'websocket'` | |
| `url`, `protocols`, `requestHeaders` | | Captured at open |
| `readyState` | `'CONNECTING' \| 'OPEN' \| 'CLOSED'` | |
| `messages` | `WebSocketMessage[]` | |
| `messagesSent`, `messagesReceived`, `bytesSent`, `bytesReceived` | `number` | |
| `closeCode`, `closeReason`, `error` | optional | |
| `startTime`, `endTime`, `duration` | `number` | |

`WebSocketMessage` = `{ direction, data, size, isBinary, timestamp }`. For binary frames, `data` is the literal placeholder string `[binary N bytes]` — only `size` is meaningful. Decode at the call site if you need the contents.

## Gotchas

- **Inspector disabled.** `getEntries()` returns `[]`. The cause is almost always "we forgot to call `NetworkInspector.enable()` at startup".
- **Calls made before `enable()` aren't recorded.** Only requests started while the inspector is enabled show up.
- **Bodies are truncated.** Default 4096 bytes. Bump `maxBodyCapture` for larger payloads, but be aware it allocates more per request.
- **Binary WS frames don't capture payload.** Only the size is recorded. The placeholder is the literal `[binary N bytes]` — don't try to JSON-parse it.
- **Entry mutation.** `getEntries()` returns the live array. Treat it as read-only and clone before storing or rendering snapshots.
- **Libraries that bypass nitro-fetch.** Anything using raw `XMLHttpRequest` (older Sentry, react-native-blob-util, the default axios adapter) won't appear. Fix this by migrating the specific call sites — use the [axios adapter](./axios-adapter.md) for axios, and construct `NitroWebSocket` directly at your call sites. Don't monkey-patch `globalThis.fetch` to paper over it.
- **Production buffer growth.** The ring buffer caps entry count, but each entry holds bodies. Either disable in production or set a small `maxEntries`/`maxBodyCapture`.

## Pointers

- Source: [`packages/react-native-nitro-fetch/src/NetworkInspector.ts`](../../../packages/react-native-nitro-fetch/src/NetworkInspector.ts)
- curl generator: [`packages/react-native-nitro-fetch/src/CurlGenerator.ts`](../../../packages/react-native-nitro-fetch/src/CurlGenerator.ts)
- Reference UI: [`example/src/screens/NetworkInspectorScreen.tsx`](../../../example/src/screens/NetworkInspectorScreen.tsx)
- Long-form docs: [`docs-website/docs/inspection.md`](../../../docs-website/docs/inspection.md)
- When this isn't enough: [`perfetto-profiling.md`](./perfetto-profiling.md)
- Plugging axios into nitro-fetch: [`axios-adapter.md`](./axios-adapter.md)
