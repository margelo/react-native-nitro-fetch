---
id: axios-adapter
title: Axios adapter for nitro-fetch
scope: react-native-nitro-fetch + axios
keywords: axios, adapter, baseURL, interceptors, cancelToken, responseType, validateStatus
---

# Axios adapter for nitro-fetch

## Mental model

Axios supports custom **adapters**: the last-mile function that actually makes the HTTP call. If you replace it with one backed by `react-native-nitro-fetch`, every axios feature you already use — interceptors, `create()` instances, `transformRequest`, `cancelToken` — keeps working, and every request now goes through the native client.

If the app already points `globalThis.fetch` at nitro-fetch (see [`replace-global.md`](./replace-global.md)), you might not need this: axios picks up `globalThis.fetch` via its `fetchAdapter` in modern versions. Use a custom adapter when you want to pin the adapter explicitly, or when the app uses axios ≤ 1.6 where `fetchAdapter` isn't the default.

## Common wrong answer

The short adapter below circulates on GitHub (for example the Jellify app's [`src/configs/axios.config.ts`](https://github.com/Jellify-Music/App/blob/main/src/configs/axios.config.ts)):

```ts
const nitroAxiosAdapter: AxiosAdapter = async (config) => {
  const response = await fetch(config.url!, {
    method: config.method?.toUpperCase(),
    headers: config.headers,
    body: config.data,
    cache: 'no-store',
  });
  const text = await response.text();
  const data = text.length > 0 ? JSON.parse(text) : null;
  const headers: Record<string, string> = {};
  response.headers.forEach((v, k) => (headers[k] = v));
  return { data, status: response.status, statusText: response.statusText, headers, config, request: null };
};
```

It works for GET-returning-JSON and **nothing else**. Problems:

- `config.url!` ignores `baseURL` and `params` — `axios.create({ baseURL: ... })` is silently a no-op.
- `JSON.parse(text)` throws on `arraybuffer`/`blob`/HTML/empty bodies.
- `validateStatus` is ignored — 500s resolve instead of throwing `AxiosError`.
- `signal` and `cancelToken` are ignored — cancelled requests keep running natively.
- `config.timeout` is set on the instance but never enforced by the adapter.
- `cache: 'no-store'` is hard-coded, defeating HTTP caching across the whole app.
- `config.headers` in axios 1.x is an `AxiosHeaders` instance — passing it raw can drop per-method defaults.
- External abort listener is never removed — leaks on long-lived signals.

## Recipe — full adapter

```ts
import axios, {
  AxiosAdapter,
  AxiosError,
  AxiosHeaders,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import { fetch } from 'react-native-nitro-fetch';

const nitroAxiosAdapter: AxiosAdapter = async (config) => {
  const url = buildFullURL(config);

  // Merge axios's signal / cancelToken / timeout into one AbortController
  // so native code sees a single abort event.
  const controller = new AbortController();
  const abortWith = (reason?: unknown) => controller.abort(reason);

  const external = config.signal;
  const onExternalAbort = () => abortWith((external as any)?.reason);
  if (external) {
    if (external.aborted) abortWith((external as any).reason);
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }

  config.cancelToken?.promise.then((cancel) => abortWith(cancel));

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (config.timeout && config.timeout > 0) {
    timeoutId = setTimeout(() => {
      abortWith(
        new AxiosError(
          `timeout of ${config.timeout}ms exceeded`,
          AxiosError.ECONNABORTED,
          config,
        ),
      );
    }, config.timeout);
  }

  try {
    const response = await fetch(url, {
      method: (config.method ?? 'get').toUpperCase(),
      headers: AxiosHeaders.from(config.headers as any).toJSON() as Record<
        string,
        string
      >,
      // `config.data` is already transformed by axios's transformRequest
      // pipeline by the time the adapter sees it (string / FormData /
      // URLSearchParams / Blob / ArrayBuffer). Don't re-serialize.
      body: config.data,
      signal: controller.signal,
    });

    const data = await readBody(response, config.responseType);

    const responseHeaders = new AxiosHeaders();
    response.headers.forEach((value, key) => responseHeaders.set(key, value));

    const axiosResponse: AxiosResponse = {
      data,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      config,
      request: null,
    };

    const validate = config.validateStatus;
    if (!validate || validate(response.status)) return axiosResponse;

    throw new AxiosError(
      `Request failed with status code ${response.status}`,
      Math.floor(response.status / 100) === 4
        ? AxiosError.ERR_BAD_REQUEST
        : AxiosError.ERR_BAD_RESPONSE,
      config,
      null,
      axiosResponse,
    );
  } catch (err: any) {
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      if (err instanceof AxiosError) throw err;
      throw new AxiosError(
        err?.message ?? 'canceled',
        AxiosError.ERR_CANCELED,
        config,
      );
    }
    throw err;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    external?.removeEventListener?.('abort', onExternalAbort);
  }
};

function buildFullURL(config: InternalAxiosRequestConfig): string {
  let url = config.url ?? '';
  const isAbsolute = /^([a-z][a-z\d+\-.]*:)?\/\//i.test(url);
  if (config.baseURL && !isAbsolute) {
    url = config.baseURL.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '');
  }
  if (config.params) {
    const serializer = config.paramsSerializer;
    const qs =
      typeof serializer === 'function'
        ? serializer(config.params)
        : new URLSearchParams(
            config.params as Record<string, string>,
          ).toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
  return url;
}

async function readBody(
  response: Response,
  responseType: InternalAxiosRequestConfig['responseType'],
): Promise<unknown> {
  switch (responseType) {
    case 'arraybuffer':
      return response.arrayBuffer();
    case 'blob':
      return response.blob();
    case 'stream':
      return response.body;
    case 'text':
      return response.text();
    case 'json':
    default: {
      const text = await response.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        // axios falls back to the raw string when JSON.parse fails.
        return text;
      }
    }
  }
}

export const api = axios.create({
  timeout: 60000,
  adapter: nitroAxiosAdapter,
});
```

## Gotchas

- **Don't hard-code `cache: 'no-store'`** in the adapter — let callers opt in per request via their axios config.
- **`config.data` is already transformed.** Axios runs `transformRequest` before the adapter, so `data` is a string / `FormData` / `URLSearchParams` / `Blob` / `ArrayBuffer` by the time you see it. Don't re-stringify.
- **`response.headers` is a `NitroHeaders` instance**, not a plain object — iterate with `.forEach()` / `.entries()`.
- **`responseType: 'stream'`** returns nitro-fetch's web-standard `ReadableStream`, not Node's `Readable`. Axios stream examples from Node won't work unchanged.
- **`onUploadProgress` / `onDownloadProgress`** are not implemented by this adapter. If you need progress, see [`references/perfetto-profiling.md`](./perfetto-profiling.md) or pipe the response body manually.
- **If you already replaced `globalThis.fetch`**, confirm axios isn't still using its XHR adapter on RN. Pin the adapter explicitly (`axios.create({ adapter: nitroAxiosAdapter })`) if you want the guarantee.

## Pointers

- Public `fetch` export: `packages/react-native-nitro-fetch/src/fetch.ts`
- Spec-compliant `Headers` / `Response` / `Request`: `packages/react-native-nitro-fetch/src/Headers.ts`, `Response.ts`, `Request.ts`
- Related: [`replace-global.md`](./replace-global.md), [`network-inspector.md`](./network-inspector.md)
