---
id: getting-started
title: Getting Started
sidebar_position: 1
---

# Getting Started

## Installation

```bash
npm install react-native-nitro-fetch react-native-nitro-modules
```

:::note
[Nitro Modules](https://github.com/mrousavy/nitro) requires React Native 0.75 or higher.
:::

## Rebuild your app

After installing, rebuild your app so the Nitro module is linked:

```bash
npx react-native run-android
# or
npx react-native run-ios
```

## Verify with a simple request

```ts
import { fetch } from 'react-native-nitro-fetch';

export async function test() {
  const res = await fetch('https://httpbin.org/get');
  console.log('status', res.status);
  console.log('headers', Object.fromEntries(res.headers));
  console.log('json', await res.json());
}
```

## Local & non-HTTP URLs

Besides `http(s)`, `fetch(...)` also reads local resources, so it stays a safe drop-in even when you replace the global `fetch` (file pickers, spreadsheet/CSV imports, inline data):

```ts
// data: URLs are decoded in JS
await fetch('data:text/plain;base64,SGVsbG8='); // -> "Hello"

// file:// URLs and bare absolute paths are read off disk natively
await fetch('file:///var/mobile/.../import.csv');
await fetch('/var/mobile/.../import.csv'); // scheme-less absolute path

// content:// URIs are read via the ContentResolver (Android)
await fetch('content://com.android.providers.../document/1234');
```

For example, reading two local files:

```ts
import { fetch } from 'react-native-nitro-fetch';

const csv = await (await fetch(`file://${pickedFileUri}`)).text(); // a picked spreadsheet
const config = await (await fetch(`${cacheDir}/config.json`)).json(); // a cached JSON file
```

These return a normal `200` `Response` with a `Content-Type` guessed from the file extension (or the `data:` media type). `blob:` URLs are **not** supported (React Native's blob registry isn't reachable from native) and reject with a `TypeError`.

`data:` text decoding uses `react-native-nitro-text-decoder` (if your app bundles it) or a global `TextDecoder`; if neither exists nitro-fetch logs a hint and the body stays available via `res.arrayBuffer()`/`res.bytes()`. `file://`/`content://` reads decode natively.

## Platform details

- **Android** uses [Cronet](https://chromium.googlesource.com/chromium/src/+/lkgr/components/cronet/README.md) (via `org.chromium.net:cronet-embedded`) which is already included in `android/build.gradle`. No extra setup required.
- **iOS** uses the native [URLSession](https://developer.apple.com/documentation/Foundation/URLSession) client.

## WebSockets (optional)

Add the companion socket package plus the text decoder (peer dependency):

```bash
npm i react-native-nitro-websockets react-native-nitro-text-decoder
```

Then install native pods and rebuild:

```bash
cd ios && pod install && cd ..
npx react-native run-ios
```

See the [WebSockets docs](./websockets.md) for full setup and API details.
