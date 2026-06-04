---
id: global-replace
title: Global Replace
sidebar_position: 1
---

# Global Replace

By default you import `fetch` explicitly from `react-native-nitro-fetch` at each call site. If you prefer a drop-in replacement so that **all** `fetch()` calls in your app (and third-party libraries) go through Nitro, you can install it globally.

## Setup

Add this at the **very top** of your entry file (before any other imports):

```ts
// index.js or App.tsx — must be the first import
import { fetch, Headers, Request, Response } from 'react-native-nitro-fetch';

globalThis.fetch = fetch;
globalThis.Headers = Headers;
globalThis.Request = Request;
globalThis.Response = Response;
```

That's it — every `fetch()` call in the process now uses the Nitro implementation.

## WebSocket

The same pattern works for the WebSocket package:

```ts
import { NitroWebSocket } from 'react-native-nitro-websockets';

globalThis.WebSocket = NitroWebSocket;
```

:::tip
Many WebSocket libraries (Socket.IO, Centrifuge) accept a `WebSocket` constructor option — passing `NitroWebSocket` there avoids touching the global entirely:

```ts
import { io } from 'socket.io-client';
import { NitroWebSocket } from 'react-native-nitro-websockets';

const socket = io('https://example.com', {
  transports: ['websocket'],
  WebSocket: NitroWebSocket,
});
```

:::

## Axios

If you use [axios](https://axios-http.com), prefer axios's built-in fetch adapter and pass Nitro's `fetch` explicitly. This keeps the integration at the axios instance boundary instead of relying on global replacement.

:::warning
Custom `env.fetch` support requires axios `v1.12.0` or newer.

Setting `Request` and `Response` to `null` disables upload/download progress capture in axios's fetch adapter. Visit [axios adapter docs](https://axios.rest/pages/advanced/fetch-adapter.html) for more info
:::

```ts
import axios, { type AxiosRequestConfig } from 'axios';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';

type AxiosEnv = NonNullable<AxiosRequestConfig['env']>;

export const api = axios.create({
  adapter: 'fetch',
  env: {
    fetch: nitroFetch,
    Request: null as unknown as AxiosEnv['Request'],
    Response: null as unknown as AxiosEnv['Response'],
  },
});
```
