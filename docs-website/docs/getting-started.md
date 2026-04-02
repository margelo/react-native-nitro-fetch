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
