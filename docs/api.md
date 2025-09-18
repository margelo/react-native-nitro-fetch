# API Reference

## `fetch(input, init)`

- Drop-in replacement for the global `fetch`.
- Accepts `Headers`, array pairs, or plain object for `init.headers`.
- Body supports: `string`, `URLSearchParams`, `ArrayBuffer`, and typed arrays.
- Returns a `Response` when available; otherwise a minimal object with `arrayBuffer()`, `text()`, `json()`, and `headers`.

Example

```ts
import { fetch } from 'react-native-nitro-fetch';
const res = await fetch('https://jsonplaceholder.typicode.com/todos/1');
const data = await res.json();
```

## `nitroFetchOnWorklet(input, init, mapWorklet, options?)`

- Runs the network request and then invokes `mapWorklet` on a worklet runtime (Android) or on JS as a fallback (iOS or when worklets not available).
- `mapWorklet(payload)` receives `{ url, status, statusText, ok, redirected, headers, bodyBytes?, bodyString? }`.
- `options.preferBytes` (default `false`) controls whether `bodyBytes` or `bodyString` is sent to the mapper.

Example

```ts
import { nitroFetchOnWorklet } from 'react-native-nitro-fetch';

const map = (payload: { bodyString?: string }) => {
  'worklet';
  return JSON.parse(payload.bodyString ?? '{}');
};

const data = await nitroFetchOnWorklet('https://httpbin.org/get', undefined, map, { preferBytes: false });
```

## `prefetch(input, init)`

- Starts a background request in native when possible. Requires a `prefetchKey` provided either via `headers: { prefetchKey }` or `init.prefetchKey`.
- Later, call `fetch(url, { headers: { prefetchKey } })` to consume a fresh or pending prefetched result.
- On success, response will include header `nitroPrefetched: true`.

## `prefetchOnAppStart(input, { prefetchKey })` (Android)

- Enqueues a request to be prefetched at the next app start by writing into MMKV under `nitrofetch_autoprefetch_queue`.
- Requires `react-native-mmkv` in the app. No-op on iOS.

## `removeFromAutoPrefetch(prefetchKey)` / `removeAllFromAutoprefetch()` (Android)

- Utilities to manage the MMKV auto-prefetch queue.

## Types

- `NitroRequest`: `{ url, method?, headers?: { key, value }[], bodyString?, bodyBytes?, timeoutMs?, followRedirects? }`.
- `NitroResponse`: `{ url, status, statusText, ok, redirected, headers, bodyString?, bodyBytes? }`.

