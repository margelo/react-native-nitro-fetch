---
id: text-decoder
title: Native UTF-8 decoding with react-native-nitro-text-decoder
scope: react-native-nitro-text-decoder
keywords: textdecoder, utf-8, jsi, nitro, binary, decoding
---

# `react-native-nitro-text-decoder`

## Mental model

A small package with one job: provide a JSI-backed `TextDecoder` for React Native that's **roughly 50× faster than the built-in JS shim** expo ships with. The decode work happens in C++ on the JS thread with no bridge round-trip.

It's deliberately a thin wrapper:

- One class — `TextDecoder`.
- UTF-8 only (no `'utf-16le'`, no `'iso-8859-1'`, etc.).
- No `TextEncoder` (use `Buffer.from(str, 'utf8')` if you need encoding).
- No `install()` polyfill. If you want a global, see the recipe below.

This package is also a peer dep of `react-native-nitro-websockets`, which uses it internally to decode incoming text frames. So if you already have nitro WebSockets installed, the package is on your device — just import the class.

## Why use this

- **~50× faster than the JS shim.** On large WebSocket frames or `arrayBuffer()` bodies the difference shows up in profiles immediately — the JS shim allocates and walks UTF-8 byte by byte; this one calls into C++.
- **JSI-backed, no bridge.** The decode call is a direct JSI invocation; there's no async hop or serialisation cost.
- **Available everywhere.** The shim Hermes ships is incomplete on older RN versions. This is the same class on every device, every OS, every engine.
- **Reused across packages.** `react-native-nitro-websockets` already uses this internally. Installing it for your own decode work doesn't add new native code beyond what you're already shipping.

## Setup

```bash
# pick your manager
npm    install react-native-nitro-text-decoder react-native-nitro-modules
yarn   add     react-native-nitro-text-decoder react-native-nitro-modules
bun    add     react-native-nitro-text-decoder react-native-nitro-modules

cd ios && pod install
```

`react-native-nitro-modules` is a peer dep — install it once for the whole app.

## API

```ts
import { TextDecoder } from 'react-native-nitro-text-decoder';

class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });

  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;

  decode(
    input?: ArrayBuffer | ArrayBufferView,
    options?: { stream?: boolean }
  ): string;
}
```

What's actually supported:

| Knob | Behaviour |
|---|---|
| `label` | `'utf-8'` (default) and aliases (`'utf8'`, `'unicode-1-1-utf-8'`). Anything else throws. |
| `fatal: true` | Invalid UTF-8 throws instead of yielding U+FFFD. |
| `ignoreBOM: true` | A leading byte-order mark is dropped instead of being included. |
| `decode(buf, { stream: true })` | Holds incomplete code points until the next call so you can chunk binary input. |

Source: [`packages/react-native-nitro-text-decoder/src/TextDecoder.ts`](../../../packages/react-native-nitro-text-decoder/src/TextDecoder.ts).

## Recipes

### Decode a binary fetch body

```ts
import { fetch } from 'react-native-nitro-fetch';
import { TextDecoder } from 'react-native-nitro-text-decoder';

const decoder = new TextDecoder('utf-8'); // create once, reuse

const res  = await fetch('https://api.example.com/snapshot.bin');
const buf  = await res.arrayBuffer();
const data = JSON.parse(decoder.decode(buf));
```

### Decode WebSocket binary frames

For *text* frames `react-native-nitro-websockets` already decodes for you (`e.data` is a string). You only need a decoder for **binary** frames:

```ts
import { NitroWebSocket } from 'react-native-nitro-websockets';
import { TextDecoder } from 'react-native-nitro-text-decoder';

const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
const ws = new NitroWebSocket('wss://stream.example.com/ticks');

ws.onmessage = (e) => {
  if (e.isBinary && e.binaryData) {
    const text = decoder.decode(e.binaryData);
    handleTick(JSON.parse(text));
  } else {
    handleTick(JSON.parse(e.data));
  }
};
```

### Streaming decode across chunks

Pass `{ stream: true }` for every chunk except the final one. The trailing call (with no argument) flushes any incomplete sequence:

```ts
const decoder = new TextDecoder('utf-8');
let acc = '';

for await (const chunk of someAsyncByteIterator) {
  acc += decoder.decode(chunk, { stream: true });
}
acc += decoder.decode(); // flush
```

### Libraries that use `globalThis.TextDecoder`

Some libraries (`protobufjs`, `msgpack-lite`, certain WASM glue) reach for `globalThis.TextDecoder`. **Don't** swap it with the nitro implementation — `nitro-text-decoder` is UTF-8 only, so a library that constructs `new TextDecoder('utf-16le')` will throw under the polyfill, and monkey-patching a web-standard global hides the failure until production.

Prefer one of:

- Use the library's native output and decode the bytes yourself with the explicit nitro decoder import.
- Pass a decoder to the library if it accepts one as an option.
- Leave the library on Hermes' built-in `TextDecoder` — it's slower, but only for that one library.

## Gotchas

- **Subarrays of larger buffers.** `decoder.decode(uint8.subarray(0, 16))` works, but if you pass the *backing* `ArrayBuffer` directly you'll decode from offset 0 of the parent. Pass the typed-array view, not its `.buffer`.
- **Forgetting `pod install`.** The iOS build will fail to find the module. Always run `pod install` after adding the package.
- **Allocating a decoder per call.** The constructor goes through JSI, the decode call is the cheap one. Hold a module-level instance and reuse it.
- **Reaching for `TextEncoder`.** Not exported here. Use `Buffer.from(str, 'utf8')` from `buffer`, or another package.
- **Non-UTF-8 encodings.** Don't exist in this package. If you need them, decode manually or pull in `text-encoding`.

## Pointers

- Source: [`packages/react-native-nitro-text-decoder/src`](../../../packages/react-native-nitro-text-decoder/src)
- Used internally by: [`packages/react-native-nitro-websockets/src/index.ts`](../../../packages/react-native-nitro-websockets/src/index.ts) (look for `utf8Decoder`)
- Pairs with: [`using-websockets.md`](./using-websockets.md)
