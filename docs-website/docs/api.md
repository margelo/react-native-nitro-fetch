---
id: api
title: API Reference
sidebar_position: 2
---

# API Reference

## fetch(input, init)

Drop-in replacement for the global `fetch`.

- Accepts `Headers`, array pairs, or plain object for `init.headers`
- Body supports: `string`, `URLSearchParams`, `ArrayBuffer`, and typed arrays
- Returns a `Response` when available; otherwise a minimal object with `arrayBuffer()`, `text()`, `json()`, and `headers`

```ts
import { fetch } from 'react-native-nitro-fetch';

const res = await fetch('https://jsonplaceholder.typicode.com/todos/1');
const data = await res.json();
```

## nitroFetchOnWorklet(input, init, mapWorklet, options?)

Runs the network request and then invokes `mapWorklet` on a worklet runtime, keeping the JS thread free for UI work.

- `mapWorklet(payload)` receives `{ url, status, statusText, ok, redirected, headers, bodyBytes?, bodyString? }`
- `options.preferBytes` (default `false`) controls whether `bodyBytes` or `bodyString` is sent to the mapper

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

:::tip
See the [Worklets guide](./worklets.md) for setup instructions.
:::

## prefetch(input, init)

Starts a background request in native when possible. Requires a `prefetchKey` provided either via `headers: { prefetchKey }` or `init.prefetchKey`.

Later, call `fetch(url, { headers: { prefetchKey } })` to consume a fresh or pending prefetched result. On success, the response will include header `nitroPrefetched: true`.

## prefetchOnAppStart(input, \{ prefetchKey \})

Enqueues a request to be prefetched at the next app start by writing into native storage.

:::note
Enqueued requests are stored in native storage and automatically executed on the next app start on both platforms.
:::

## removeFromAutoPrefetch / removeAllFromAutoprefetch

Utilities to manage the auto-prefetch queue.

## Types

### NitroRequest

```ts
{
  url: string;
  method?: string;
  headers?: { key: string; value: string }[];
  bodyString?: string;
  bodyBytes?: ArrayBuffer;
  timeoutMs?: number;
  followRedirects?: boolean;
}
```

### NitroResponse

```ts
{
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  redirected: boolean;
  headers: { key: string; value: string }[];
  bodyString?: string;
  bodyBytes?: ArrayBuffer;
}
```
