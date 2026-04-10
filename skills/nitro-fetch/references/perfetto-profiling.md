---
id: perfetto-profiling
title: Finding slow APIs — inspector, Hermes profiler, and native traces
scope: react-native-nitro-fetch, react-native-nitro-websockets
keywords: perfetto, instruments, os_signpost, atrace, profiling, slow, hermes, profileFetch
---

# Finding slow APIs in nitro-fetch

## Mental model

You have three tools at progressively higher levels of detail. Start with the cheapest and escalate as needed — each layer answers a different question.

| Tool | Question it answers | Cost |
|---|---|---|
| `NetworkInspector` | "Which requests are slow on this device?" | None — JS only, always available |
| `profileFetch` (Hermes) | "Why is the JS thread blocked when this request finishes?" | Sampling profiler overhead during the wrapped call |
| Perfetto (Android) / Instruments (iOS) | "Where in the request lifecycle is the time going? DNS? TLS? TTFB? Body?" | Free at runtime when enabled at *build* time |

The usual flow is: triage with the inspector → if the slowness looks JS-side, wrap the call in `profileFetch` → if it's native or you need stage-level attribution, capture a Perfetto/Instruments trace.

> **Visibility boundary.** Both `NetworkInspector` and the native trace points only see traffic that goes through nitro-fetch. RN's built-in `fetch`, raw `XMLHttpRequest`, third-party SDKs that use OkHttp / `URLSession` directly — none of those show up in the inspector or in your Perfetto / Instruments traces. Migrate those specific call sites to import `fetch` from `react-native-nitro-fetch` (or use the [axios adapter](./axios-adapter.md) for axios) if you want unified visibility. **Don't** try to patch this with `globalThis.fetch = nitroFetch` — it's fragile and hides which callers actually benefit. Conversely, nitro-fetch's calls do **not** appear in React Native DevTools' network panel either, since DevTools hooks XHR.

---

## Layer 1 — `NetworkInspector` for triage

This is *always* the first move. It takes ten seconds, no rebuild, no flags.

```ts
import { NetworkInspector } from 'react-native-nitro-fetch';

NetworkInspector.enable();

// ...exercise the app...

const slow = NetworkInspector.getHttpEntries()
  .filter((e) => e.duration > 500)
  .sort((a, b) => b.duration - a.duration);

console.table(slow.map((e) => ({
  method:   e.method,
  url:      e.url.slice(0, 60),
  status:   e.status,
  ms:       Math.round(e.duration),
  reqBytes: e.requestBodySize,
  resBytes: e.responseBodySize,
})));
```

Reading the output:

| Pattern | What it suggests |
|---|---|
| One endpoint always slow | Server-side or routing/CDN issue — the rest of the stack is fine |
| Same `prefetchKey` URL appearing twice | Your prefetch isn't being adopted — see [prefetching](./prefetching.md) |
| Large `responseBodySize` ↔ high duration | Bandwidth-bound; consider pagination or compression |
| Every request from one domain is slow | DNS or TLS issue — escalate to a native trace |

What this layer **can't** tell you: DNS vs TLS vs TTFB vs body breakdown, JS-thread time after the response arrives, time spent on the JS thread vs the native networking thread. For those, escalate.

Full inspector docs: [`network-inspector.md`](./network-inspector.md).

---

## Layer 2 — `profileFetch` for JS hot spots

`profileFetch` wraps a function in the Hermes sampling profiler and dumps a `.cpuprofile` you can drop into Chrome DevTools.

```ts
import { profileFetch, fetch } from 'react-native-nitro-fetch';

const { result, profilePath } = await profileFetch(async () => {
  const res = await fetch('https://api.example.com/big.json');
  return res.json();           // ← if THIS is the slow part, the profile reveals it
}, '/tmp/big-json.cpuprofile');

console.log('profile written to', profilePath);
```

Pull the file off the device:

- **Android:** `adb pull /tmp/big-json.cpuprofile .`
- **iOS:** Xcode → Window → Devices and Simulators → your app → Container → Download container.

Then in Chrome, open `chrome://inspect`, click "Open dedicated DevTools for Node", switch to the Performance panel, and load the profile.

Caveats:

- **Hermes only.** On JSC the function runs unprofiled and `profilePath` is `undefined`.
- **Captures all JS, not just your wrapped code.** Keep the wrapper tight.
- **Sampling.** Sub-10ms bursts may not show up.

Source: [`packages/react-native-nitro-fetch/src/HermesProfiler.ts`](../../../packages/react-native-nitro-fetch/src/HermesProfiler.ts).

---

## Layer 3 — native traces

This is the most powerful layer: full native flame charts with stage attribution. Tracing is **opt-in at build time**. When the flags are off, the trace points compile to no-ops with **zero runtime cost**.

### Enable the build flags

#### Android — `gradle.properties`

```properties
# HTTP fetch tracing — android.os.Trace async sections
NitroFetch_enableTracing=true

# WebSocket tracing — ATrace synchronous sections (C++)
NitroFetchWebsockets_enableTracing=true
```

Then `cd android && ./gradlew clean && cd .. && yarn android`.

#### iOS — env vars before `pod install`

```bash
NITROFETCH_TRACING=1 NITRO_WS_TRACING=1 bundle exec pod install
```

Rebuild from Xcode (or `yarn ios`). The env vars inject `-DNITRO_WS_TRACING=1` and the `NITROFETCH_TRACING` Swift compile condition into the pod build only — your app code is untouched.

### Capture an Android Perfetto trace

1. Enable USB debugging on the device.
2. Open <https://ui.perfetto.dev/> in Chrome.
3. **Record new trace** → select your device.
4. Under **Probes**, enable **Atrace userspace annotations**.
5. **Critical:** in the Atrace config, set `atrace_apps` to your app's package name (or `*`). Without this, the events you care about will not be captured.
6. **Start recording**, exercise the app, **Stop**.
7. In the timeline, find your app's process. HTTP requests appear as async slices labelled `NitroFetch GET /path`, etc. WebSocket events appear as sync slices labelled `NitroWS connect <url>`, `NitroWS send text`, `NitroWS receive`, `NitroWS close`, etc.

A protobuf config alternative for `adb shell perfetto` is in [`docs-website/docs/inspection.md`](../../../docs-website/docs/inspection.md).

### Capture an iOS Instruments trace

1. Open Instruments (Xcode → Open Developer Tool → Instruments).
2. Pick the **`os_signpost`** template.
3. Target your app process, hit **record**, exercise the app, hit **stop**.
4. Look for these subsystems:

   | Subsystem | Category | Traces |
   |---|---|---|
   | `com.margelo.nitrofetch` | `network` | HTTP fetch (intervals) |
   | `com.margelo.nitro.websockets` | `NitroWS` | WebSocket lifecycle (intervals + events) |

   For each fetch, the interval **begin** annotation is `<METHOD> <path>` and the **end** is `status=<code> bytes=<count>`. The interval length is the wall-clock duration.

### Reading a trace

| You see | It means |
|---|---|
| Long `NitroFetch GET /x` interval, JS thread mostly idle underneath it | Slow at the network layer — DNS, TLS, server, or transport |
| Long interval that ends right when the JS thread spikes | Body parsing is the real cost — go back to `profileFetch` to confirm |
| Two intervals for the same URL that don't overlap | Cache miss — the prefetch isn't being adopted |
| `NitroWS connect <url>` interval much longer than expected | TLS handshake is slow — pre-warm the socket |
| `NitroWS receive` events bursting at launch with no JS handler attached yet | Connection is open before JS is ready; events buffer and replay correctly |

Trace point definitions: [`packages/react-native-nitro-websockets/cpp/WsTrace.hpp`](../../../packages/react-native-nitro-websockets/cpp/WsTrace.hpp).

---

## A practical workflow

1. **Inspector first.** Note the URL, the duration, and whether it's slow on every request or only the first.
2. **First-request slow only** → connection / TLS warm-up cost. Use prefetch (HTTP) or pre-warm (WebSocket).
3. **Every request slow** → grab a Perfetto / Instruments trace. If the JS thread is mostly idle inside the interval, the network is the cost. Talk to the backend or check the CDN.
4. **JS thread is busy when the request "ends"** → wrap the call in `profileFetch`, load the `.cpuprofile` in DevTools. Look for `JSON.parse` on huge objects, `Object.assign` storms, or React state updates that touch big trees.
5. **Many requests slow at once** → check `bufferedAmount` on WebSockets, confirm you're on HTTP/2 (so requests multiplex), and look for HOL blocking.

## Gotchas

- **Forgetting `atrace_apps` in Perfetto.** Most common cause of "I enabled tracing but I see nothing". Set it to your package name.
- **Setting iOS env vars after `pod install`.** The flags are baked at install time. Re-run `pod install` with the env var set, then rebuild.
- **Profiling builds without the trace flags.** No events will appear. Tracing is opt-in at build time, deliberately.
- **`duration === 0` on an in-flight entry.** It's filled in on completion. Subscribe via `onEntry` if you need to react when it lands.
- **Profiling on JSC.** `profileFetch` is a no-op there; you get `{ result }` back with no `profilePath`.
- **Confusing JS time and network time.** The inspector's `duration` is wall-clock from JS-side `performance.now()` to JS-side `performance.now()` — it includes time the JS thread was blocked. For pure network time, look at the native trace interval.

## Pointers

- Inspector skill: [`network-inspector.md`](./network-inspector.md)
- Hermes profiler: [`packages/react-native-nitro-fetch/src/HermesProfiler.ts`](../../../packages/react-native-nitro-fetch/src/HermesProfiler.ts)
- Trace macros: [`packages/react-native-nitro-websockets/cpp/WsTrace.hpp`](../../../packages/react-native-nitro-websockets/cpp/WsTrace.hpp)
- Long-form docs (with screenshots): [`docs-website/docs/inspection.md`](../../../docs-website/docs/inspection.md)
- Once slow APIs are identified — usual fixes: [`prefetching.md`](./prefetching.md), [`websocket-prewarm.md`](./websocket-prewarm.md)
