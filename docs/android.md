# Android

Status

- Uses Cronet Java API via `org.chromium.net:cronet-embedded` (declared in `android/build.gradle`). No extra setup required for basic usage.
- Cronet engine is initialized once with HTTP/2, QUIC, Brotli, and disk cache under `<cacheDir>/nitrofetch_cronet_cache`.

Prefetch

- Start a prefetch:

```ts
import { prefetch } from 'react-native-nitro-fetch';
await prefetch('https://httpbin.org/uuid', { headers: { prefetchKey: 'uuid' } });
```

- Consume later (returns prefetched data when fresh/pending):

```ts
import { fetch } from 'react-native-nitro-fetch';
const res = await fetch('https://httpbin.org/uuid', { headers: { prefetchKey: 'uuid' } });
console.log(res.headers.get('nitroPrefetched')); // 'true' if prefetched
```

Auto-Prefetch (on next app start)

- Queue a request in NativeStorage so native can prefetch on next startup:

```ts
import { prefetchOnAppStart } from 'react-native-nitro-fetch';
await prefetchOnAppStart('https://httpbin.org/uuid', { prefetchKey: 'uuid' });
```

- Clear or remove entries:

```ts
import { removeFromAutoPrefetch, removeAllFromAutoprefetch } from 'react-native-nitro-fetch';
await removeFromAutoPrefetch('uuid');
await removeAllFromAutoprefetch();
```

Notes

- The library prefers the "Native" Cronet provider when available and logs the provider/version during initialization.
- Timeout/cancellation and streaming are not implemented yet.

