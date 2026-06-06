# API Reference

## `fetch(input, init)`

- Drop-in replacement for the global `fetch`.
- Accepts `Headers`, array pairs, or plain object for `init.headers`.
- Body supports: `string`, `URLSearchParams`, `FormData`, and `Blob`.
- Returns a spec-compliant `Response` with `text()`, `json()`, `arrayBuffer()`, `blob()`, `bytes()`, `clone()`, a `body` stream, and `headers`.

Example

```ts
import { fetch } from 'react-native-nitro-fetch';
const res = await fetch('https://jsonplaceholder.typicode.com/todos/1');
const data = await res.json();
```

## `nitroFetchOnWorklet(input, init, mapWorklet, options?)`

- Runs the network request and then invokes `mapWorklet` on a worklet runtime, falling back to the JS thread when `react-native-worklets` isn't installed.
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

## `prefetchOnAppStart(input, { prefetchKey })`

- Enqueues a request to be prefetched at the next app start by writing into native storage under `nitrofetch_autoprefetch_queue`. Replayed on the next cold start on both Android and iOS.

## `removeFromAutoPrefetch(prefetchKey)` / `removeAllFromAutoprefetch()`

- Utilities to manage the auto-prefetch queue.

## Types

- `NitroRequest`: `{ url, method?, headers?: { key, value }[], bodyString?, bodyBytes?, timeoutMs?, followRedirects? }`.
- `NitroResponse`: `{ url, status, statusText, ok, redirected, headers, bodyString?, bodyBytes? }`.

