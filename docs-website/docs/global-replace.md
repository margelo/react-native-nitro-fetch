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

:::tip
Custom `env.fetch` support requires axios `v1.12.0` or newer.

Setting `Request` and `Response` to `null` is the recommended configuration: it tells axios to hand the request straight to Nitro's native client instead of wrapping it in its own JS `Request`/`Response`. Nitro performs the transfer natively, so the only trade-off is that axios's JS-level upload/download progress callbacks — which it builds on those constructors — won't fire. If you leave them unset, axios falls back to the global `Request`/`Response`, which aren't a 1:1 match for Nitro's native objects.

See the [axios fetch adapter docs](https://axios.rest/pages/advanced/fetch-adapter.html) for more info.
:::

```ts
import axios from 'axios';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';

export const api = axios.create({
  adapter: 'fetch',
  env: {
    fetch: nitroFetch,
    Request: null!,
    Response: null!,
  },
});
```

## TanStack Query (React Query)

If you installed the globals above, nothing to configure — every `queryFn` that calls `fetch()` already runs on Nitro.

To keep it explicit instead, import Nitro's `fetch` and use it inside `queryFn`. Forward the `signal` React Query hands you so cancelled queries also cancel the native request:

```ts
import { useQuery } from '@tanstack/react-query';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';

export function useUser(id: string) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: async ({ signal }) => {
      const res = await nitroFetch(`https://api.example.com/users/${id}`, {
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
}
```

A shared wrapper keeps the boilerplate in one place:

```ts
import { QueryClient } from '@tanstack/react-query';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';

const BASE_URL = 'https://api.example.com';

export async function nitroQueryFn({
  queryKey,
  signal,
}: {
  queryKey: readonly unknown[];
  signal: AbortSignal;
}) {
  const res = await nitroFetch(`${BASE_URL}/${queryKey.join('/')}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { queryFn: nitroQueryFn } },
});
```

:::tip
Pair this with [prefetch](./prefetch.md) to serve the first render from a cold-start warm request — enqueue it on app start and pass the same `prefetchKey` from the `queryFn`:

```ts
import { prefetchOnAppStart } from 'react-native-nitro-fetch';

await prefetchOnAppStart('https://api.example.com/users/me', {
  prefetchKey: 'me',
});

useQuery({
  queryKey: ['user', 'me'],
  queryFn: async ({ signal }) => {
    const res = await nitroFetch('https://api.example.com/users/me', {
      headers: { prefetchKey: 'me' },
      signal,
    });
    return res.json();
  },
});
```

:::

## RTK Query

If you installed the globals above, `fetchBaseQuery` picks up Nitro automatically — no `fetchFn` needed.

Otherwise pass `fetchFn`. `fetchBaseQuery` builds a `Request` object and calls `fetchFn(request)` with **no** second argument, so lift `signal` off the request — that is what carries `AbortController` cancellation and `fetchBaseQuery`'s own `timeout` option down to the native client:

```ts
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: 'https://api.example.com',
    timeout: 10_000,
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as RootState).auth.token;
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return headers;
    },
    fetchFn: (input, init) =>
      nitroFetch(input, {
        ...init,
        signal: init?.signal ?? (input as Request).signal,
      }),
  }),
  endpoints: (build) => ({
    getUser: build.query<User, string>({ query: (id) => `/users/${id}` }),
    createUser: build.mutation<User, Partial<User>>({
      query: (body) => ({ url: '/users', method: 'POST', body }),
    }),
  }),
});

export const { useGetUserQuery, useCreateUserMutation } = api;
```

Method, headers, and body all travel on the `Request` object, so nothing else needs forwarding.
