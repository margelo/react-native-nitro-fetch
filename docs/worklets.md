# Worklets

`nitroFetchOnWorklet()` lets you run parsing/mapping off the JS thread using `react-native-worklets` .

## Usage

```ts
import { nitroFetchOnWorklet } from 'react-native-nitro-fetch';

const map = (payload: { bodyString?: string }) => {
  'worklet';
  return JSON.parse(payload.bodyString ?? '{}');
};

const data = nitroFetchOnWorklet('https://httpbin.org/get', undefined, map, { preferBytes: false });
```

Options

- `preferBytes` (default `false`): when `true`, sends `bodyBytes` to the mapper; when `false`, sends `bodyString`.
- `runtimeName`: optional name for the created worklet runtime.

Notes

- Ensure `react-native-worklets` is installed in your app to get off-thread.


