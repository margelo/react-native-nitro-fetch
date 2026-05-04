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

If you use [axios](https://axios-http.com), you can route all requests through Nitro via a custom adapter:

```ts
import axios, { AxiosAdapter, AxiosHeaders } from 'axios';
import { fetch } from 'react-native-nitro-fetch';

const nitroAxiosAdapter: AxiosAdapter = async (config) => {
  const url = buildURL(config);
  const res = await fetch(url, {
    method: (config.method ?? 'get').toUpperCase(),
    headers: AxiosHeaders.from(config.headers as any).toJSON() as Record<string, string>,
    body: config.data,
    signal: config.signal,
  });

  const headers = new AxiosHeaders();
  res.headers.forEach((v, k) => headers.set(k, v));
  const data = config.responseType === 'arraybuffer' ? await res.arrayBuffer()
    : config.responseType === 'blob' ? await res.blob()
    : config.responseType === 'text' ? await res.text()
    : await res.json().catch(() => null);

  return { data, status: res.status, statusText: res.statusText, headers, config, request: null };
};

function buildURL(config: any): string {
  let url = config.url ?? '';
  if (config.baseURL && !/^https?:\/\//i.test(url))
    url = config.baseURL.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '');
  if (config.params) {
    const qs = new URLSearchParams(config.params).toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
  return url;
}

export const api = axios.create({ adapter: nitroAxiosAdapter });
```
