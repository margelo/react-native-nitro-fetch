---
id: worklets
title: Worklets
sidebar_position: 9
---

# Worklets

`nitroFetchOnWorklet()` lets you run parsing/mapping off the JS thread using [react-native-worklets](https://docs.swmansion.com/react-native-worklets/docs). This is useful to parse data without blocking the main JS thread.

## Setup

### 1. Install the package

```bash
npm install react-native-worklets
```

### 2. Add the Babel plugin

Add the Worklets babel plugin to your `babel.config.js`:

```js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // ... other plugins
    'react-native-worklets/plugin',
  ],
};
```

:::tip
Since Expo SDK 54, the Expo starter template includes the Worklets babel plugin by default — you can skip this step.
:::

### 3. Install native dependencies

```bash
# iOS
cd ios && pod install && cd ..

# Clear Metro cache
npm start -- --reset-cache
```

## Usage

```ts
import { nitroFetchOnWorklet } from 'react-native-nitro-fetch';

const map = (payload: { bodyString?: string }) => {
  'worklet';
  return JSON.parse(payload.bodyString ?? '{}');
};

const data = await nitroFetchOnWorklet(
  'https://httpbin.org/get',
  undefined,
  map,
  { preferBytes: false }
);
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `preferBytes` | `false` | When `true`, sends `bodyBytes` to the mapper; when `false`, sends `bodyString` |
| `runtimeName` | — | Optional name for the created worklet runtime |

For more details, see the full [react-native-worklets documentation](https://docs.swmansion.com/react-native-worklets/docs/).
