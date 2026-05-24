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

## POST, JSON, and FormData prefetches

`prefetchOnAppStart` persists the full request shape — `method`, `bodyString` / `bodyBytes` / `bodyFormData`, headers (including `Content-Type`), `timeoutMs`, and `followRedirects`. The native cold-start replay reconstructs the request exactly, so a JSON POST is replayed as a JSON POST, and a multipart form upload is replayed as a multipart form upload.

```ts
// Plain string body
await prefetchOnAppStart('https://api.example.com/log', {
  method: 'POST',
  body: 'hello',
  prefetchKey: 'log',
});

// JSON body — Content-Type is preserved verbatim
await prefetchOnAppStart('https://api.example.com/feed', {
  method: 'POST',
  body: JSON.stringify({ userId: 42 }),
  headers: { 'Content-Type': 'application/json' },
  prefetchKey: 'feed',
});

// FormData (multipart) — string fields and `{ uri, type, name }` file parts
const fd = new FormData();
fd.append('user', 'alice');
fd.append('avatar', { uri: avatarUri, type: 'image/jpeg', name: 'a.jpg' } as any);
await prefetchOnAppStart('https://api.example.com/upload', {
  method: 'POST',
  body: fd,
  prefetchKey: 'upload',
});
```

The matching consume call uses the same `prefetchKey`:

```ts
const res = await fetch('https://api.example.com/feed', {
  method: 'POST',
  body: JSON.stringify({ userId: 42 }),
  headers: {
    'Content-Type': 'application/json',
    prefetchKey: 'feed',
  },
});
```

:::tip
For FormData with file uploads, only reference stable URIs (bundled assets, persistent app-data paths). Transient `content://` or `file://` URIs captured at scheduling time may be invalid by the next cold launch — the multipart builder will throw and the entry is skipped.
:::

The fields are JSON-serialized in `NativeStorage` under `nitrofetch_autoprefetch_queue`. Defaults are omitted to keep entries compact and backward-compatible: a body-less GET stays `{ url, prefetchKey, headers }`.

## Cache TTL

A cached prefetch is considered fresh for **5 seconds** by default. The check happens at *read time* — when `fetch()` looks up the entry, anything older than the TTL is evicted and the request goes to the network. Five seconds is fine for "prewarm the next screen the user is about to tap," but too short for cross-launch prefetches that have to survive the JS bundle boot, or for screens reached via a slow route.

Pass `prefetchCacheTtlMs` on **both** the prefetch and the consuming `fetch()` to widen the window — each call brings its own TTL (there is no global default to set):

```ts
// In-session: keep the prefetched response fresh for up to 60s.
await prefetch('https://api.example.com/items/42', {
  headers: { prefetchKey: 'item-42' },
  prefetchCacheTtlMs: 60_000,
});

// Consume — pass the same TTL so the cache hit isn't skipped.
const res = await fetch('https://api.example.com/items/42', {
  headers: { prefetchKey: 'item-42' },
  prefetchCacheTtlMs: 60_000,
});
```

For cross-launch prefetches, the TTL is persisted next to the request in the queue, so the next cold start honors it:

```ts
await prefetchOnAppStart('https://api.example.com/feed', {
  prefetchKey: 'home-feed',
  prefetchCacheTtlMs: 5 * 60_000, // 5 minutes
});
```

For native-side registration, both platforms accept the TTL:

```kotlin
// Android
AutoPrefetcher.registerPrefetch(
  context = this,
  url = "https://api.example.com/feed",
  prefetchKey = "feed",
  headers = mapOf("Accept" to "application/json"),
  prefetchCacheTtlMs = 300_000.0, // Double, in ms
)
```

```swift
// iOS — extended @objc selector with trailing prefetchCacheTtlMs:
NitroAutoPrefetcher.registerPrefetch(
  withURL: "https://api.example.com/feed",
  prefetchKey: "feed",
  headers: ["Accept": "application/json"],
  method: nil, bodyString: nil, bodyBytes: nil, bodyFormData: nil,
  timeoutMs: nil, followRedirects: nil,
  prefetchCacheTtlMs: NSNumber(value: 300_000)
)
```

:::note
Omitting `prefetchCacheTtlMs` preserves the historical 5-second behavior. A value `<= 0` disables cache hits for that key (any positive age fails the `age <= maxAgeMs` check). A long TTL widens the "stale-after-deploy" window — bump the `prefetchKey` on backend schema changes regardless of TTL.
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

## Native-side prefetch registration (first-run prefetching)

`prefetchOnAppStart()` only fires from the **second** cold launch onward — JS has to run once to seed the queue. To prefetch on the very **first** launch (fresh install), register URLs from native code before JS boots. Both APIs share the same persistent queue, so JS-side `removeFromAutoPrefetch()` works on natively-registered entries too.

**Android — `MainApplication.onCreate()`:**

```kotlin
import com.margelo.nitro.nitrofetch.AutoPrefetcher

override fun onCreate() {
  super.onCreate()

  AutoPrefetcher.registerPrefetch(
    this,
    "https://api.example.com/feed",
    "feed",
    mapOf("Accept" to "application/json")
  )

  AutoPrefetcher.prefetchOnStart(this) // existing call — drains the queue
  loadReactNative(this)
}
```

**iOS — `application(_:didFinishLaunchingWithOptions:)`:**

```swift
NitroAutoPrefetcher.registerPrefetch(
  withUrl: "https://api.example.com/feed",
  prefetchKey: "feed",
  headers: ["Accept": "application/json"]
)
// No explicit prefetchOnStart() needed — fired automatically after launch.
```

:::tip
From Swift, expose `NitroAutoPrefetcher` via your bridging header with `#import <NitroFetch/NitroAutoPrefetcher.h>`.
:::

### Native POST + body registration

Both platforms expose an extended `registerPrefetch` that also accepts `method`, `bodyString`, `bodyBytes`, `bodyFormData`, `timeoutMs`, and `followRedirects` — useful for pre-warming a POST endpoint on the very first launch.

**Android** — `registerPrefetch` is annotated `@JvmOverloads`, so the existing 4-arg call keeps working and you can add the new args by name:

```kotlin
AutoPrefetcher.registerPrefetch(
  context = this,
  url = "https://api.example.com/feed",
  prefetchKey = "feed",
  headers = mapOf("X-App" to "demo"),
  method = "POST",
  bodyFormData = listOf(
    mapOf("name" to "user", "value" to "alice"),
  ),
)
```

**iOS** — Swift `@objc` cannot expose default arguments, so the extended API is a separate selector:

```swift
NitroAutoPrefetcher.registerPrefetch(
  withURL: "https://api.example.com/feed",
  prefetchKey: "feed",
  headers: ["X-App": "demo"],
  method: "POST",
  bodyString: nil,
  bodyBytes: nil,
  bodyFormData: [
    ["name": "user", "value": "alice"],
  ],
  timeoutMs: nil,
  followRedirects: nil
)
```


JS consumes the result the same way as before:

```ts
const res = await fetch('https://api.example.com/feed', {
  headers: { prefetchKey: 'feed' },
});
// res.headers.get('nitroPrefetched') === 'true' on first launch
```

## Android Setup

To enable auto-prefetch on Android, you need to call `AutoPrefetcher.prefetchOnStart()` from your `MainApplication.kt`. This kicks off queued requests as early as possible — before React Native and JS have finished loading.

### Manual Setup (bare React Native)

Edit `android/app/src/main/java/.../MainApplication.kt`:

```kotlin
import com.margelo.nitro.nitrofetch.AutoPrefetcher

class MainApplication : Application(), ReactApplication {
  // ...

  override fun onCreate() {
    super.onCreate()
     // Start any queued auto-prefetch requests as early as possible
    try { AutoPrefetcher.prefetchOnStart(this) } catch (_: Throwable) {}
    
    loadReactNative(this)
  }
}
```

:::tip
Place the `AutoPrefetcher.prefetchOnStart(this)` call as early as possible in `onCreate()` — the earlier it runs, the more network time you save before JS is ready.
:::

### Expo Plugin (Android)

If you use **Expo**, the plugin automatically injects `AutoPrefetcher.prefetchOnStart()` into `MainApplication.kt` during `expo prebuild` — no manual native code changes needed.

Add to your `app.json`:

```json
{
  "plugins": ["react-native-nitro-fetch"]
}
```

