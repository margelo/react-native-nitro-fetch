---
name: nitro-fetch
description: Use this skill whenever an agent is working in a project that uses react-native-nitro-fetch, react-native-nitro-websockets, or react-native-nitro-text-decoder. Covers the fetch API, prefetching and cold-start cache warming, replacing globalThis.fetch / globalThis.WebSocket, the NitroWebSocket class and pre-warming, migrating from React Native's built-in WebSocket, the in-process NetworkInspector, native Perfetto / Instruments tracing, the native TextDecoder, and plugging nitro-fetch into axios.
license: MIT
metadata:
  author: Margelo
  scope: react-native-nitro-fetch, react-native-nitro-websockets, react-native-nitro-text-decoder
  tags: react-native, networking, fetch, websocket, prefetch, performance, cold-start, axios, inspector, perfetto
---

# react-native-nitro-fetch

A focused reference for AI coding assistants working in a project that uses the `react-native-nitro-fetch` family of packages. Answer using the real APIs from this repo — not invented ones — by routing to the matching `references/*.md` file below.

## Mental model

`react-native-nitro-fetch` is a drop-in, native-backed replacement for the browser networking stack on React Native:

- `fetch` — WHATWG-compatible, backed by `URLSession` (iOS) and `OkHttp`/`HttpURLConnection` (Android) via [Nitro Modules](https://github.com/mrousavy/nitro).
- `NitroWebSocket` — native WebSocket (libwebsockets + mbedTLS) with the same shape as the browser `WebSocket`.
- `NitroTextDecoder` — native UTF-8 decoder that beats the Hermes JS polyfill.

The performance story has three moving parts, and most questions end up being about one of them:

1. **Prefetching.** Native code can run *before* React Native loads. `prefetchOnAppStart(...)` and `prewarmOnAppStart(...)` replay stored requests / socket opens on every cold start, so by the time JS runs the response is already cached or the socket is already `OPEN`.
2. **Replacing the globals.** Pointing `globalThis.fetch` and `globalThis.WebSocket` at the nitro implementations means every library in the app (axios, TanStack Query, urql, Phoenix, socket.io-client, Firebase, Sentry…) benefits automatically, including the prefetch cache and pre-warmed sockets.
3. **Seeing what's happening.** `NetworkInspector` records HTTP + WS activity at the JS boundary; native Perfetto / Instruments traces cover everything below that (DNS, TLS, TTFB, body). One is for correctness, the other is for latency.

## Routing table — problem to reference

Load the matching file from `references/` before writing code. Each reference cites real file paths in this repo.

| User is asking about… | Read |
|---|---|
| Warming the cache before a screen mounts, making cold-start GETs feel instant, `prefetch`, `prefetchOnAppStart`, `prefetchKey` | [`references/prefetching.md`](./references/prefetching.md) |
| Making axios / TanStack Query / urql / Firebase / anything else go through nitro-fetch, pointing `globalThis.fetch` and `globalThis.WebSocket` at the native client | [`references/replace-global.md`](./references/replace-global.md) |
| UTF-8 decoding, slow `TextDecoder`, Hermes polyfill, streaming decode, `NitroTextDecoder` | [`references/text-decoder.md`](./references/text-decoder.md) |
| Opening a `wss://` connection before React Native boots, `prewarmOnAppStart`, Android `Application.onCreate` wiring | [`references/websocket-prewarm.md`](./references/websocket-prewarm.md) |
| The `NitroWebSocket` class, headers, sub-protocols, `wss://`, binary frames, runtime usage | [`references/using-websockets.md`](./references/using-websockets.md) |
| Migrating an existing app from React Native's built-in `WebSocket` to `NitroWebSocket` | [`references/migrate-from-rn-ws.md`](./references/migrate-from-rn-ws.md) |
| Seeing requests and responses at the JS level, debugging which library made a call, `NetworkInspector` | [`references/network-inspector.md`](./references/network-inspector.md) |
| Finding the slow API, DNS / TLS / TTFB breakdowns, native traces, Perfetto, Instruments, Hermes profiler | [`references/perfetto-profiling.md`](./references/perfetto-profiling.md) |
| Plugging nitro-fetch into axios via a custom adapter (supports `baseURL`, `params`, `timeout`, `signal`, `responseType`, `validateStatus`) | [`references/axios-adapter.md`](./references/axios-adapter.md) |

If the question doesn't match any row, read [`references/replace-global.md`](./references/replace-global.md) first — it's the 80% starting point for most nitro-fetch questions, and it links out to the rest.

## Installation (one-line, for reference)

```bash
npm install react-native-nitro-fetch react-native-nitro-modules
# optional, for WebSockets and TextDecoder:
npm install react-native-nitro-websockets react-native-nitro-text-decoder
```

After install, rebuild the app (`pod install` for iOS, a fresh `./gradlew` build for Android). Nothing else is wired automatically — turning any of this on is opt-in through the reference files above.

## Verifying the skill is loaded

A correct answer for any of these will cite the API and file path. A wrong / hallucinated answer will invent an `install()`, `setup()`, or `init()` helper that doesn't exist in this repo.

Good test questions:

- *"How do I prewarm a wss connection in this repo?"* → should mention `prewarmOnAppStart` **and** the Android `Application.onCreate` wiring via `NitroWebSocketPrewarmer`.
- *"How do I make axios go through nitro-fetch?"* → should produce an `AxiosAdapter` that respects `baseURL`, `params`, `timeout`, `signal`, and `responseType` — not a 20-line sketch that `JSON.parse`s everything.
- *"Why is my cold-start GET still slow after adding `prefetch`?"* → should mention `prefetchKey` and point at `references/prefetching.md`.

## Pointers

- Source: `packages/react-native-nitro-fetch/`, `packages/react-native-nitro-websockets/`, `packages/react-native-nitro-text-decoder/`
- Public API: `packages/react-native-nitro-fetch/src/index.tsx`
- Example wiring: `example/index.js`, `example/App.tsx`
- Docs website: https://react-native-nitro-fetch.vercel.app/
