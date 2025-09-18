# Worklets

`nitroFetchOnWorklet()` lets you run parsing/mapping off the JS thread using `react-native-worklets-core` (Android). On iOS or when worklets are unavailable, it falls back to running the mapper on the JS thread.

## Usage

```ts
import { nitroFetchOnWorklet } from 'react-native-nitro-fetch';

const map = (payload: { bodyString?: string }) => {
  'worklet';
  return JSON.parse(payload.bodyString ?? '{}');
};

const data = await nitroFetchOnWorklet('https://httpbin.org/get', undefined, map, { preferBytes: false });
```

Options

- `preferBytes` (default `false`): when `true`, sends `bodyBytes` to the mapper; when `false`, sends `bodyString`.
- `runtimeName`: optional name for the created worklet runtime.

Notes

- Ensure `react-native-worklets-core` is installed in your app to get off-thread execution on Android.
- On iOS, the mapper runs on JS but the API surface remains the same.

