  ---
  id: global-replace
  title: Global Replace
  sidebar_position: 1
  ---

  # Global Replace

  By default you import `fetch` explicitly from `react-native-nitro-fetch` at each call site. If
  you prefer a drop-in replacement so that **all** `fetch()` calls in your app (and third-party
  libraries) go through Nitro, you can install it globally.

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
  Many WebSocket libraries (Socket.IO, Centrifuge) accept a `WebSocket` constructor option —
  passing `NitroWebSocket` there avoids touching the global entirely:

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

  If you use [axios](https://axios-http.com), you can route all requests through Nitro via a custom
  adapter.

  :::warning
  A custom adapter is responsible for two things that axios normally does for you. Skipping either
  one produces bugs that only surface in edge cases — the happy path looks fine, so they tend to
  reach production:

  1. **Param serialization.** Don't pass `config.params` straight into `URLSearchParams` — it
  coerces every value with `String()`, so `undefined` becomes the literal `"undefined"`, arrays are
  comma-joined instead of repeated as `key[]`, and `Date` objects become `"Tue May 29 2026…"`
  instead of ISO. Axios's default serializer drops nullish values and expands arrays/Dates;
  replicate that.
  2. **Status handling.** Axios adapters must reject on non-2xx responses (this is what `settle()`
  does internally). If you just return the response, every `4xx`/`5xx` resolves as a *success*,
  which silently disables `try/catch`, status checks, and response error interceptors (token
  refresh, logout, retries).
  :::

  ```ts
  import axios, { AxiosAdapter, AxiosError, AxiosHeaders } from 'axios';
  import { fetch } from 'react-native-nitro-fetch';

  function buildURL(config: any): string {
    let url = config.url ?? '';
    if (config.baseURL && !/^https?:\/\//i.test(url)) {
      url = config.baseURL.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '');
    }
    if (config.params) {
      // Mirror axios's default param serialization rather than letting
      // URLSearchParams stringify everything: skip null/undefined, expand
      // arrays as repeated `key[]` entries, and serialize Dates as ISO.
      const sp = new URLSearchParams();
      for (const [key, value] of Object.entries(config.params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item === undefined || item === null) continue;
            sp.append(`${key}[]`, item instanceof Date ? item.toISOString() : String(item));
          }
        } else if (value instanceof Date) {
          sp.append(key, value.toISOString());
        } else {
          sp.append(key, String(value));
        }
      }
      const qs = sp.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }
    return url;
  }

  function serializeBody(data: unknown) {
    if (data == null) return undefined;
    if (
      typeof data === 'string' ||
      data instanceof ArrayBuffer ||
      data instanceof FormData ||
      data instanceof URLSearchParams
    ) {
      return data;
    }
    // axios usually runs transformRequest before the adapter, but guard against
    // a raw object body if transforms are overridden.
    return JSON.stringify(data);
  }

  const nitroAxiosAdapter: AxiosAdapter = async (config) => {
    const url = buildURL(config);
    const method = (config.method ?? 'get').toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD';

    const res = await fetch(url, {
      method,
      headers: AxiosHeaders.from(config.headers as any).toJSON() as Record<string, string>,
      body: hasBody ? serializeBody(config.data) : undefined,
      signal: config.signal,
    });

    const headers = new AxiosHeaders();
    res.headers.forEach((v, k) => headers.set(k, v));

    const data =
      config.responseType === 'arraybuffer' ? await res.arrayBuffer()
      : config.responseType === 'blob' ? await res.blob()
      : config.responseType === 'text' ? await res.text()
      : await res.json().catch(() => null);

    const response = {
      data,
      status: res.status,
      statusText: res.statusText,
      headers,
      config,
      request: null,
    };

    // Mirror axios's `settle`: reject on error statuses so that downstream
    // catch blocks and response interceptors (token refresh, logout, retries)
    // run instead of treating a 4xx/5xx body as a successful payload.
    const validateStatus = config.validateStatus;
    if (!response.status || !validateStatus || validateStatus(response.status)) {
      return response;
    }
    throw new AxiosError(
      `Request failed with status code ${response.status}`,
      [AxiosError.ERR_BAD_REQUEST, AxiosError.ERR_BAD_RESPONSE][Math.floor(response.status / 100) -
  4],
      config,
      null,
      response,
    );
  };

  export const api = axios.create({ adapter: nitroAxiosAdapter });
  ```
