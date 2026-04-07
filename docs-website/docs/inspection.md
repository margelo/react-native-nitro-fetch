---
id: inspection
title: Network Inspection
sidebar_position: 9
---

# Network Inspection

Nitro Fetch ships with a built-in **NetworkInspector** that records HTTP and WebSocket activity at the JS level, and native **Perfetto / Instruments tracing** for zero-overhead profiling in production.

## JS Network Inspector

### Setup

```ts
import { NetworkInspector } from 'react-native-nitro-fetch';

// Start recording
NetworkInspector.enable();

// Optionally configure limits
NetworkInspector.enable({
  maxEntries: 500,      // ring-buffer size (default 500)
  maxBodyCapture: 4096, // max bytes captured per body (default 4096)
});

// Stop recording
NetworkInspector.disable();
```

Once enabled, **all `fetch()` calls** are automatically recorded. WebSocket tracking is also automatic if `react-native-nitro-websockets` is installed alongside `react-native-nitro-fetch`.

### Reading entries

```ts
// All entries (HTTP + WebSocket), ordered by creation time
const all = NetworkInspector.getEntries();

// Filter by type
const httpOnly = NetworkInspector.getHttpEntries();
const wsOnly = NetworkInspector.getWebSocketEntries();

// Look up a single entry
const entry = NetworkInspector.getEntry(id);

// Clear the buffer
NetworkInspector.clear();
```

### Live listener

Subscribe to new or updated entries in real time:

```ts
const unsubscribe = NetworkInspector.onEntry((entry) => {
  if (entry.type === 'http') {
    console.log(`${entry.method} ${entry.url} → ${entry.status} (${entry.duration.toFixed(0)}ms)`);
  } else {
    console.log(`WS ${entry.url} — ${entry.messagesSent + entry.messagesReceived} messages`);
  }
});

// Later
unsubscribe();
```

### HTTP entry shape

Each HTTP request creates a `NetworkEntry`:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique request identifier |
| `type` | `'http'` | Discriminator |
| `url` | `string` | Request URL |
| `method` | `string` | HTTP method |
| `requestHeaders` | `Array<{ key, value }>` | Request headers |
| `requestBody` | `string \| undefined` | Captured request body (truncated to `maxBodyCapture`) |
| `requestBodySize` | `number` | Full body size in bytes |
| `status` | `number` | HTTP status code |
| `statusText` | `string` | Status text |
| `responseHeaders` | `Array<{ key, value }>` | Response headers |
| `responseBody` | `string \| undefined` | Captured response body (truncated to `maxBodyCapture`) |
| `responseBodySize` | `number` | Full response body size |
| `startTime` | `number` | `performance.now()` at request start |
| `endTime` | `number` | `performance.now()` at response |
| `duration` | `number` | Total time in ms |
| `curl` | `string` | Auto-generated curl command |
| `error` | `string \| undefined` | Error message if failed |

### WebSocket entry shape

Each WebSocket connection creates a `WebSocketEntry`:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique connection identifier |
| `type` | `'websocket'` | Discriminator |
| `url` | `string` | WebSocket URL |
| `protocols` | `string[]` | Requested subprotocols |
| `requestHeaders` | `Array<{ key, value }>` | Upgrade request headers |
| `readyState` | `string` | `CONNECTING`, `OPEN`, or `CLOSED` |
| `messages` | `WebSocketMessage[]` | All recorded messages |
| `messagesSent` | `number` | Total messages sent |
| `messagesReceived` | `number` | Total messages received |
| `bytesSent` | `number` | Total bytes sent |
| `bytesReceived` | `number` | Total bytes received |
| `closeCode` | `number \| undefined` | WebSocket close code |
| `closeReason` | `string \| undefined` | Close reason |
| `error` | `string \| undefined` | Error message if failed |
| `startTime` / `endTime` / `duration` | `number` | Timing (ms) |

Each `WebSocketMessage` contains:

| Field | Type | Description |
|-------|------|-------------|
| `direction` | `'sent' \| 'received'` | Message direction |
| `data` | `string` | Message content (truncated to `maxBodyCapture`) |
| `size` | `number` | Full message size in bytes |
| `isBinary` | `boolean` | Whether the frame was binary |
| `timestamp` | `number` | `performance.now()` when recorded |

### Building a custom UI

You can use the inspector data to build your own network debugging screen. Here's a minimal example:

```tsx
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { NetworkInspector } from 'react-native-nitro-fetch';
import type { InspectorEntry } from 'react-native-nitro-fetch';

export function NetworkDebugger() {
  const [entries, setEntries] = useState<readonly InspectorEntry[]>([]);

  useEffect(() => {
    NetworkInspector.enable();
    const unsub = NetworkInspector.onEntry(() => {
      setEntries([...NetworkInspector.getEntries()]);
    });
    return () => {
      unsub();
      NetworkInspector.disable();
    };
  }, []);

  return (
    <FlatList
      data={entries}
      keyExtractor={(e) => e.id}
      renderItem={({ item }) => (
        <View style={{ padding: 8, borderBottomWidth: 1, borderColor: '#eee' }}>
          {item.type === 'http' ? (
            <Text>
              {item.method} {item.url} → {item.status} ({item.duration.toFixed(0)}ms)
            </Text>
          ) : (
            <Text>
              WS {item.url} — {item.messagesSent + item.messagesReceived} msgs
            </Text>
          )}
        </View>
      )}
    />
  );
}
```

:::tip
The example app includes a full-featured inspector screen with filter tabs (All / HTTP / WS), detail views, curl export, and a live log console. See [`example/src/screens/NetworkInspectorScreen.tsx`](https://github.com/margelo/react-native-nitro-fetch/blob/main/example/src/screens/NetworkInspectorScreen.tsx) for the complete implementation.
:::

---

## Native Tracing (Perfetto & Instruments)

Both HTTP fetch and WebSocket operations can emit native trace events, giving you flame-chart visibility in **Perfetto** (Android) and **Instruments** (iOS) with zero JS overhead. Both are **opt-in** via build flags.

### Enabling tracing

Tracing is controlled separately for HTTP fetch and WebSockets. You can enable one or both.

#### Android

Add to your app's `gradle.properties`:

```properties
# HTTP fetch tracing (android.os.Trace async sections)
NitroFetch_enableTracing=true

# WebSocket tracing (ATrace sync sections in C++)
NitroFetchWebsockets_enableTracing=true
```

Rebuild your app after changing these flags.

#### iOS

Set environment variables **before** running `pod install`:

```bash
# HTTP fetch tracing (os_signpost intervals in Swift)
NITROFETCH_TRACING=1 bundle exec pod install

# WebSocket tracing (os_signpost events/intervals in C++)
NITRO_WS_TRACING=1 bundle exec pod install

# Both at once
NITROFETCH_TRACING=1 NITRO_WS_TRACING=1 bundle exec pod install
```

Then rebuild your app. The env vars inject compile-time flags (`NITROFETCH_TRACING` Swift condition and `-DNITRO_WS_TRACING=1` C++ define) into the pod build — they have no runtime cost when disabled.

### What gets traced

#### HTTP fetch

When `NitroFetch_enableTracing=true` (Android) or `NITROFETCH_TRACING=1` (iOS) is set:

- **Android**: Each `fetch()` call emits an **async section** via `android.os.Trace.beginAsyncSection` / `endAsyncSection`. The label is `"NitroFetch <METHOD> <path>"` (e.g., `NitroFetch GET /api/users`). The section spans from request start to response completion (including success, failure, and cancellation).

- **iOS**: Each `fetch()` call emits an **`os_signpost` interval** under subsystem `com.margelo.nitrofetch`, category `network`, name `"NitroFetch"`. The begin event includes `"<METHOD> <path>"` and the end event includes `"status=<code> bytes=<count>"`.

#### WebSocket

When `NitroFetchWebsockets_enableTracing=true` (Android) or `NITRO_WS_TRACING=1` (iOS) is set, the native layer emits trace events for each WebSocket lifecycle event:

- **Android**: Uses `ATrace_beginSection` / `ATrace_endSection` (synchronous sections from `<android/trace.h>` in C++). These appear as slices on the thread where the event occurred.

- **iOS**: Uses `os_signpost` under subsystem `com.margelo.nitro.websockets`, category `NitroWS`. The `connect` → `connected` pair uses an interval (begin/end with a shared signpost ID). All other events (`send`, `receive`, `close`, `error`) are point events via `os_signpost_event_emit`.

### Capturing a Perfetto trace (Android)

#### Option 1: Perfetto UI (recommended)

1. Connect your Android device via USB (with USB debugging enabled).

2. Open [ui.perfetto.dev](https://ui.perfetto.dev/) in Chrome.

3. Click **"Record new trace"** and select your device.

4. Under **"Probes"**, enable **"Atrace userspace annotations"**.

5. **Critical step**: In the Atrace configuration, set **`atrace_apps`** to your app's package name (e.g., `com.example.myapp`) or `*` for all apps. Without this, `android.os.Trace` and `ATrace_beginSection` events from your app will **not** be captured.

6. Optionally add **"Scheduling details"** for CPU context.

7. Click **"Start recording"**, use your app (make fetch requests, open WebSocket connections), then click **"Stop"**.

8. In the trace viewer, look for your app's process. HTTP traces appear as async slices labeled `NitroFetch GET /path`, `NitroFetch POST /path`, etc. WebSocket traces appear as sync slices labeled `NitroWS connect <url>`, `NitroWS established`, `NitroWS send text`, `NitroWS receive`, etc.

#### Option 2: Command-line with config file

Create a file `trace_config.pbtx`:

```protobuf
buffers {
  size_kb: 65536
}
data_sources {
  config {
    name: "linux.ftrace"
    ftrace_config {
      atrace_categories: "view"
      atrace_apps: "com.example.myapp"
    }
  }
}
duration_ms: 15000
```

:::caution
Replace `com.example.myapp` with your actual package name. Using `*` captures all apps but produces larger traces.
:::

Then record:

```bash
# Push config and start trace
adb push trace_config.pbtx /data/local/tmp/
adb shell perfetto --config /data/local/tmp/trace_config.pbtx --out /data/local/tmp/trace.perfetto-trace

# After using your app, pull the trace
adb pull /data/local/tmp/trace.perfetto-trace .
```

Open the resulting `.perfetto-trace` file at [ui.perfetto.dev](https://ui.perfetto.dev/).

### Capturing an Instruments trace (iOS)

1. Open **Instruments** (Xcode menu → Open Developer Tool → Instruments).

2. Choose the **`os_signpost`** template (or create a custom template and add the "os_signpost" instrument).

3. Select your **app process** as the target.

4. Click the **record** button, use your app, then **stop**.

5. In the timeline, look for these subsystems:

   | Subsystem | Category | What it traces |
   |-----------|----------|----------------|
   | `com.margelo.nitrofetch` | `network` | HTTP fetch requests |
   | `com.margelo.nitro.websockets` | `NitroWS` | WebSocket lifecycle |

   - **HTTP fetch**: Appears as **intervals** (begin/end pair) under name `"NitroFetch"`. The begin annotation shows the method and path (e.g., `GET /api/users`), the end annotation shows `status=200 bytes=1234`.
   - **WebSocket connect**: Appears as an **interval** from `connect` (begin, annotated with the URL) to `connected` (end). This measures the handshake duration.
   - **WebSocket send/receive/close/error**: Appear as **point events** under name `"NitroWS"` with details like `send text 42 bytes`, `receive text`, `close code=1000 clean=1`, `error <message>`.

### Trace events reference

#### HTTP fetch events

| Event | Android | iOS |
|-------|---------|-----|
| Request start | `Trace.beginAsyncSection("NitroFetch GET /path", cookie)` | `os_signpost(.begin, "NitroFetch", "GET /path")` |
| Request end (success) | `Trace.endAsyncSection("NitroFetch GET /path", cookie)` | `os_signpost(.end, "NitroFetch", "status=200 bytes=N")` |
| Request end (failure) | `Trace.endAsyncSection(...)` | `os_signpost(.end, ...)` |
| Request end (cancelled) | `Trace.endAsyncSection(...)` | `os_signpost(.end, ...)` |

#### WebSocket events

| Event | Android (`ATrace`) | iOS (`os_signpost`) |
|-------|-------------------|---------------------|
| Connect start | `ATrace_beginSection("NitroWS connect wss://...")` | interval begin: `"NitroWS"` with URL |
| Connected | `ATrace_beginSection("NitroWS established")` | interval end: `"NitroWS"` `"connected"` |
| Send text | `ATrace_beginSection("NitroWS send text")` | event: `"send text <N> bytes"` |
| Send binary | `ATrace_beginSection("NitroWS send binary")` | event: `"send binary <N> bytes"` |
| Receive | `ATrace_beginSection("NitroWS receive")` | event: `"receive text"` or `"receive binary"` |
| Close | `ATrace_beginSection("NitroWS close")` | event: `"close code=<N> clean=<0\|1>"` |
| Error | `ATrace_beginSection("NitroWS error")` | event: `"error <message>"` |

:::note
On Android, WebSocket events use synchronous `ATrace_beginSection` / `ATrace_endSection` pairs (not async sections) because `ATrace_beginAsyncSection` requires API 29+ while the library supports API 24+. HTTP fetch uses the Java `android.os.Trace.beginAsyncSection` API which is available on all supported API levels.
:::

## See also

- [API Reference](./api.md) — fetch options and response API
- [WebSockets](./websockets.md) — WebSocket setup and usage
- [Troubleshooting](./troubleshooting.md) — common issues
