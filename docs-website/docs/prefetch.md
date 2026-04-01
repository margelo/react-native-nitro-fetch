---
id: prefetch
title: Prefetch & Auto-Prefetch
sidebar_position: 3
---

# Prefetch & Auto-Prefetch

`prefetch()` starts a native request in the background (when available) and lets you consume the result later using the same `prefetchKey`.

## Basics

```ts
import { fetch, prefetch } from 'react-native-nitro-fetch';

// 1) Start prefetch
await prefetch('https://httpbin.org/uuid', {
  headers: { prefetchKey: 'uuid' },
});

// 2) Consume later
const res = await fetch('https://httpbin.org/uuid', {
  headers: { prefetchKey: 'uuid' },
});
console.log('prefetched?', res.headers.get('nitroPrefetched'));
```

Provide the `prefetchKey` either as a header or via `init.prefetchKey`:

```ts
await prefetch('https://httpbin.org/uuid', { prefetchKey: 'uuid' });
```

## Auto-Prefetch on App Start

Use `prefetchOnAppStart()` to enqueue requests so they are fetched on the next app start. This works automatically on both Android and iOS:

```ts
import { prefetchOnAppStart } from 'react-native-nitro-fetch';

await prefetchOnAppStart('https://httpbin.org/uuid', {
  prefetchKey: 'uuid',
});
```

Manage the queue:

```ts
import {
  removeFromAutoPrefetch,
  removeAllFromAutoprefetch,
} from 'react-native-nitro-fetch';

await removeFromAutoPrefetch('uuid');
await removeAllFromAutoprefetch();
```

:::note
Prefetch is best-effort; if native is unavailable, calls are ignored or fall back to JS fetch. Responses served from prefetch add header `nitroPrefetched: true`.
:::

## Why Prefetch Is Cool

- **Earlier start at app launch**: Auto-prefetch can kick off network work immediately when the process starts, before React and JS are ready. On mid-range Android devices (e.g., Samsung A16), we observed the prefetch starting at least **~220 ms** earlier than triggering the same request from JS after the app warms up.
- **Smoother navigation**: Trigger a prefetch when the user initiates navigation, then serve the prefetched result as the destination screen mounts.

## Pattern: Prefetch on Navigation Intent + useQuery

This pattern works well with TanStack Query (react-query). Start prefetch alongside navigation; when the screen loads, the request is already in flight or finished.

```ts
// List screen
import { prefetch, fetch as nitroFetch } from 'react-native-nitro-fetch';
import { useNavigation } from '@react-navigation/native';

const PREFETCH_KEY = 'user:42';
const URL = 'https://api.example.com/users/42';

function Row() {
  const nav = useNavigation();
  return (
    <Button
      title="Open user"
      onPress={async () => {
        try {
          await prefetch(URL, { headers: { prefetchKey: PREFETCH_KEY } });
        } catch {}
        nav.navigate('UserDetails', { id: 42 });
      }}
    />
  );
}
```

Then, in the destination screen:

```ts
// UserDetails.tsx
import { fetch as nitroFetch } from 'react-native-nitro-fetch';
import { useQuery } from '@tanstack/react-query';

const PREFETCH_KEY = 'user:42';
const URL = 'https://api.example.com/users/42';

export function UserDetails() {
  const q = useQuery({
    queryKey: ['user', 42],
    queryFn: async () => {
      const res = await nitroFetch(URL, {
        headers: { prefetchKey: PREFETCH_KEY },
      });
      return res.json();
    },
  });

  // If the request was prefetched, this often resolves immediately
  // and res.headers.get('nitroPrefetched') === 'true'.
}
```

