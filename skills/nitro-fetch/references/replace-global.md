---
id: replace-global
title: Pointing globalThis.fetch and globalThis.WebSocket at nitro
scope: react-native-nitro-fetch, react-native-nitro-websockets
keywords: polyfill, global, fetch, websocket, axios, ky, sentry, swr, react-query, drop-in
---

# Pointing `globalThis.fetch` and `globalThis.WebSocket` at nitro

## Mental model

The nitro packages ship as **named exports**, not polyfills. That's deliberate — the packages stay side-effect free, and you decide whether the swap should happen at all.

The fix is a small setup file that runs *before* anything else in `index.js` and reassigns `globalThis.fetch`, the spec classes, **and** `globalThis.WebSocket` to the nitro implementations. After that, every consumer of those globals — your code and every library you don't own — automatically gets the native client, the native cache, the inspector, and the trace points, for free.

## Why swap the globals

- **Most traffic in a typical RN app comes from libraries you don't own.** Axios, Sentry, Supabase, Apollo, Firebase, react-query's default fetcher, Phoenix Channels, socket.io-client, Ably, Firebase RTDB — they all reach for `globalThis.fetch` or `globalThis.WebSocket`. Patching only your own call sites leaves them on the slow path.
- **Cache hits are automatic.** Any library that goes through the global now benefits from `prefetch` / `prefetchOnAppStart` cache lookups without code changes.
- **One inspector for everything.** `NetworkInspector` records every HTTP and WebSocket the libraries make, not just the ones you wrote — so the in-app debugger and curl export cover the whole app.
- **Native traces cover the whole app too.** With the build flags on (see [`nitro-fetch-perfetto-profiling`](./perfetto-profiling.md)), Perfetto / Instruments shows you the timeline for every library's HTTP calls.
- **`wss://` gets the bundled CA bundle and custom upgrade headers everywhere** — including on iOS, where RN's built-in `WebSocket` can't send headers at all.
- **Pre-warmed sockets are adopted transparently.** With `prewarmOnAppStart` set up (see [`nitro-fetch-websocket-prewarm`](./websocket-prewarm.md)), libraries calling `new WebSocket(url)` on the global pick up the warm connection without knowing it exists.
- **Swap once, forget.** It's a few lines in `index.js`. There's nothing to maintain at the call sites.

This is the only skill in this set where you'll modify global state. Read the gotchas before you ship it.

## Setup

### 1. Create a setup file

This swaps `fetch`, the spec classes, **and** `WebSocket` in one place. The same setup file is the recommended migration path from RN's built-in `WebSocket` (see [`nitro-fetch-migrate-from-rn-ws`](./migrate-from-rn-ws.md)).

```ts
// src/setupNitroGlobals.ts
import {
  fetch as nitroFetch,
  Headers as NitroHeaders,
  Request as NitroRequest,
  Response as NitroResponse,
} from 'react-native-nitro-fetch';
import { NitroWebSocket } from 'react-native-nitro-websockets';

// Stash the originals so you can fall back if you need to.
// (RN attaches these to global at runtime; the casts silence lib.dom.d.ts.)
;(globalThis as any).__rnFetch     = globalThis.fetch;
;(globalThis as any).__rnHeaders   = (globalThis as any).Headers;
;(globalThis as any).__rnRequest   = (globalThis as any).Request;
;(globalThis as any).__rnResponse  = (globalThis as any).Response;
;(globalThis as any).__rnWebSocket = (globalThis as any).WebSocket;

;(globalThis as any).fetch     = nitroFetch;
;(globalThis as any).Headers   = NitroHeaders;
;(globalThis as any).Request   = NitroRequest;
;(globalThis as any).Response  = NitroResponse;
;(globalThis as any).WebSocket = NitroWebSocket;
```

> If you only need the fetch swap and don't have `react-native-nitro-websockets` installed, drop the WebSocket lines (and the import). Both halves are independent.

### 2. Import it as the very first line of `index.js`

Order matters. Many libraries cache `globalThis.fetch` (or `globalThis.WebSocket`) into a module-local at import time; if your setup file runs *after* them, your swap is invisible to them.

```js
// index.js
import './src/setupNitroGlobals'; // ← MUST be the first import
import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
```

### 3. Verify with the inspector

```ts
import { NetworkInspector } from 'react-native-nitro-fetch';
import axios from 'axios';

NetworkInspector.enable();

// HTTP — through a library that uses the global
await axios.get('https://api.example.com/ping');
console.log(NetworkInspector.getHttpEntries());

// WebSocket — through the global constructor
const ws = new WebSocket('wss://stream.example.com/feed');
ws.onopen = () => console.log(NetworkInspector.getWebSocketEntries());
```

If the axios request and the WebSocket entry both show up, both swaps took. If axios doesn't appear, it's either using its XHR adapter (see gotchas) or it grabbed `fetch` before your setup file ran. If the WebSocket doesn't appear, your setup file is running too late.

## Recipes

### Selective opt-out for a misbehaving library

If exactly one library breaks under the swap, hand it the stashed original:

```ts
const originalFetch     = (globalThis as any).__rnFetch;
const originalWebSocket = (globalThis as any).__rnWebSocket;

const flakyClient = createSomeLibrary({
  fetch:     originalFetch,     // bypass nitro fetch just for this client
  WebSocket: originalWebSocket, // bypass nitro WebSocket just for this client
});
```

### Force axios onto the fetch adapter

In React Native, axios defaults to its **XHR** adapter, not `fetch`. Replacing `globalThis.fetch` does nothing for it unless you flip the adapter:

```ts
import axios from 'axios';

const api = axios.create({
  baseURL: 'https://api.example.com',
  adapter: 'fetch', // requires axios ≥ 1.7
});
```

After this, every `api.get/post/...` call goes through nitro-fetch.

### Keep `Headers`/`Request`/`Response` originals

Some libraries do `instanceof Response` checks against the original class. If one of them throws after you swap the classes, narrow the polyfill to **just `fetch`**:

```ts
import { fetch as nitroFetch } from 'react-native-nitro-fetch';
;(globalThis as any).fetch = nitroFetch;
// leave Headers / Request / Response alone
```

You'll lose the spec-accurate `Headers` API in libraries that use the global one, but the swap won't break `instanceof`.

## Gotchas

- **Setup file imported too late.** Anything that captures `globalThis.fetch` or `globalThis.WebSocket` at module load time (axios, sentry, supabase-js, posthog-js, Firebase, Phoenix, ...) will keep using the original. The setup file must be the first line of `index.js`.
- **axios still uses XHR.** The default adapter on RN is `xhr`, not `fetch`. You won't see axios traffic in the inspector unless you opt into the fetch adapter explicitly.
- **`XMLHttpRequest` consumers are not intercepted.** This skill swaps `fetch` and `WebSocket`, not XHR. Anything that uses raw XHR (older Sentry, react-native-blob-util, the default axios adapter) bypasses nitro-fetch. There's no XHR shim.
- **`instanceof` breakage.** Replacing `Response`/`Request`/`Headers`/`WebSocket` can break libraries that compare against the originals. Use the stashed `__rn*` references as an escape hatch for individual libraries.
- **Worklets.** The polyfill lives on the JS runtime's global. Worklet runtimes don't see it. Inside a worklet, import `nitroFetchOnWorklet` from `react-native-nitro-fetch` directly.
- **No undo at runtime.** Once you've reassigned the globals, restoring the originals is your job — the helpers above stash them under `__rnFetch` / `__rnWebSocket` etc. exactly so you have something to put back.

## Pointers

- The exact set of named exports you can polyfill: [`packages/react-native-nitro-fetch/src/index.tsx`](../../packages/react-native-nitro-fetch/src/index.tsx)
- Spec-accurate classes: [`Headers.ts`](../../packages/react-native-nitro-fetch/src/Headers.ts), [`Request.ts`](../../packages/react-native-nitro-fetch/src/Request.ts), [`Response.ts`](../../packages/react-native-nitro-fetch/src/Response.ts)
- Verify the swap: [`nitro-fetch-network-inspector`](./network-inspector.md)
- Pair with prefetch for cold-start wins: [`nitro-fetch-prefetching`](./prefetching.md)
