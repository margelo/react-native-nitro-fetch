# Prefetch

`prefetch()` starts a native request in the background (when available) and lets you consume the result later using the same `prefetchKey`.

## Basics

```ts
import { fetch, prefetch } from 'react-native-nitro-fetch';

// 1) Start prefetch
await prefetch('https://httpbin.org/uuid', { headers: { prefetchKey: 'uuid' } });

// 2) Consume later
const res = await fetch('https://httpbin.org/uuid', { headers: { prefetchKey: 'uuid' } });
console.log('prefetched?', res.headers.get('nitroPrefetched'));
```

Provide the `prefetchKey` either as a header or via `init.prefetchKey`:

```ts
await prefetch('https://httpbin.org/uuid', { prefetchKey: 'uuid' } as any);
```

## Auto-Prefetch on Android

Use `prefetchOnAppStart()` to enqueue requests in MMKV so they are fetched on next app start:

```ts
import { prefetchOnAppStart } from 'react-native-nitro-fetch';
await prefetchOnAppStart('https://httpbin.org/uuid', { prefetchKey: 'uuid' });
```

Manage the queue:

```ts
import { removeFromAutoPrefetch, removeAllFromAutoprefetch } from 'react-native-nitro-fetch';
await removeFromAutoPrefetch('uuid');
await removeAllFromAutoprefetch();
```

Notes

- Prefetch is best-effort; if native is unavailable, calls are ignored or fall back to JS fetch.
- Responses served from prefetch add header `nitroPrefetched: true`.

