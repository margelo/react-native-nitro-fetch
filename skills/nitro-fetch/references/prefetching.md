---
id: prefetching
title: Prefetching with nitro-fetch
scope: react-native-nitro-fetch
keywords: prefetch, cold start, cache, performance, app launch, prefetchKey
---

# Prefetching with nitro-fetch

## Mental model

Prefetching means: **fire the request before the JS code that consumes it actually runs.** nitro-fetch supports two flavours of this, and they answer different questions.

- *In-session prefetch* — "the user is on the list screen; they're probably about to tap a row." → `prefetch(...)`. Fires now, completes into the native cache, and any later `fetch(sameUrl)` with the same `prefetchKey` returns from cache.
- *Cross-launch prefetch* — "every cold start, before React Native is even loaded, fire this request." → `prefetchOnAppStart(...)`. Persists the request to disk; the native bootstrap replays it on every subsequent launch.

The key idea is the **`prefetchKey`**. It's how the native cache identifies a stored response and how the consuming `fetch()` looks it up. Forget the key and you've just made a wasted request.

## Why prefetch

- Cross-launch prefetches start *before React Native loads*, so the response is usually sitting in cache by the time the first screen mounts. Cold-start time-to-first-render drops by hundreds of milliseconds on real networks.
- In-session prefetches let a list screen warm the next detail screen — taps feel instant.
- It's free for callers: the consuming `fetch()` is the same call you were already making, just with a `prefetchKey` header.
- The native cache is shared across any code path that imports `fetch` from `react-native-nitro-fetch`, so wrappers around that import (e.g. the [axios adapter](./axios-adapter.md)) automatically benefit.

## Setup

### 1. iOS — nothing to do

The iOS bootstrap registers itself via `+load` in `packages/react-native-nitro-fetch/ios/NitroBootstrap.mm` and listens for `UIApplicationDidFinishLaunchingNotification`. You don't wire anything.

### 2. Android — one line in `Application.onCreate`

```kotlin
// android/app/src/main/java/<your-app>/MainApplication.kt
import com.margelo.nitro.nitrofetch.AutoPrefetcher

class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    try { AutoPrefetcher.prefetchOnStart(this) } catch (_: Throwable) {}
    loadReactNative(this)
  }
}
```

The `try` is intentional — on a fresh install the prefs file doesn't exist yet, and you don't want a missing key to crash the app. See `example/android/app/src/main/java/nitrofetch/example/MainApplication.kt` for the working example.

If you skip this on Android, `prefetchOnAppStart` will appear to "work" (the entry is written to disk) but nothing will replay it on launch.

## Recipes

### Imports

```ts
import {
  prefetch,
  prefetchOnAppStart,
  removeFromAutoPrefetch,
  removeAllFromAutoprefetch,
} from 'react-native-nitro-fetch';
```

### Prewarm a detail screen from the list screen

```ts
function onListItemFocus(id: string) {
  prefetch(`https://api.example.com/items/${id}`, {
    headers: {
      prefetchKey: `item-${id}`,
      Authorization: `Bearer ${token}`,
    },
  }).catch(() => {
    // Non-fatal: if this fails the real fetch() will just go to the network.
  });
}
```

The detail screen consumes it with the same key:

```ts
const res = await fetch(`https://api.example.com/items/${id}`, {
  headers: { prefetchKey: `item-${id}` },
});
```

### Make a screen render from cache on cold start

Call this once after sign-in:

```ts
await prefetchOnAppStart('https://api.example.com/feed', {
  prefetchKey: 'home-feed',
  headers: { Authorization: `Bearer ${token}` },
});
```

On the *next* launch, the request fires while React Native is still booting. By the time `Home` mounts and calls `fetch('https://api.example.com/feed', { headers: { prefetchKey: 'home-feed' } })`, the response is already sitting in the cache.

### Pass the key two ways

The skill code accepts the key in either place — pick whichever is convenient at the call site:

```ts
// As a header (it also goes on the wire)
prefetch(url, { headers: { prefetchKey: 'home-feed' } });

// As a non-standard init field (added to headers under the hood)
prefetchOnAppStart(url, { prefetchKey: 'home-feed' });
```

The header name is case-insensitive — `prefetchKey`, `prefetchkey`, and `PrefetchKey` are all the same thing.

### Tear down on logout

The persisted queue survives app restarts, which is exactly the problem on logout. Always purge it:

```ts
async function onLogout() {
  await removeAllFromAutoprefetch();
  // ...rest of your logout flow
}

// Or, if you only want to drop one entry:
await removeFromAutoPrefetch('home-feed');
```

If you don't, the next cold start will fire the prefetch with stale credentials.

### Fetching tokens for cross-start prefetches

A `prefetchOnAppStart` entry is replayed by **native code, before JS runs**. That's the whole point — but it means there's no JS runtime around to mint a fresh access token. The package solves this with `registerTokenRefresh`: you describe a refresh endpoint and how to map its response into headers, and the native bootstrap calls it on cold start before replaying the queue.

```ts
import {
  registerTokenRefresh,
  prefetchOnAppStart,
} from 'react-native-nitro-fetch';

// 1. Tell nitro how to mint a fresh token at cold start.
registerTokenRefresh({
  target: 'fetch',                            // or 'all' to also cover WebSockets
  url:    'https://api.example.com/oauth/token',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body:   JSON.stringify({ grant_type: 'refresh_token', refresh_token: longLived }),
  responseType: 'json',
  mappings: [
    { jsonPath: 'access_token', header: 'Authorization', valueTemplate: 'Bearer {{value}}' },
  ],
  onFailure: 'useStoredHeaders', // fall back to last-known good headers if refresh fails
});

// 2. Schedule the prefetches that need that header.
await prefetchOnAppStart('https://api.example.com/feed', {
  prefetchKey: 'home-feed',
  // No Authorization here — it'll be injected by the token refresh response.
});
```

On every subsequent cold start, the native bootstrap will:

1. Read the refresh config from encrypted prefs (`NitroFetchSecureAtRest`).
2. Call the refresh URL on a background thread.
3. Map the JSON response into headers (`Authorization: Bearer ey...`).
4. Merge those headers into every queued prefetch and fire them.

### Putting the token in the URL

The native auto-prefetcher merges refreshed values into **headers**, not into the URL. The stored URL is replayed verbatim. If your backend requires the token in the URL (e.g. a signed query string), you have two options:

**Option A — store the URL with the token already in it.** The token will be the one captured at scheduling time. Re-call `prefetchOnAppStart` whenever it rotates:

```ts
function refreshHomeFeedPrefetch(token: string) {
  return prefetchOnAppStart(
    `https://api.example.com/feed?token=${encodeURIComponent(token)}`,
    { prefetchKey: 'home-feed' },
  );
}
```

This is fine for tokens with multi-day TTLs. It's the wrong fit for short-lived ones because the *next* cold start will replay the *previous* token.

**Option B — use a `compositeHeaders` mapping and have the backend accept the header form.** If you can change the server to read the token from a header instead of the query string, you keep the cold-start refresh path working without any JS code on launch.

```ts
registerTokenRefresh({
  target: 'fetch',
  url:    'https://api.example.com/oauth/token',
  method: 'POST',
  body:   JSON.stringify({ grant_type: 'refresh_token', refresh_token: longLived }),
  mappings: [
    { jsonPath: 'access_token', header: 'X-Token', valueTemplate: '{{value}}' },
  ],
});
```

If neither option works for you (the URL itself must contain a fresh value, e.g. an HMAC of a fresh nonce), then the request fundamentally cannot be prefetched on cold start — there's no JS runtime to compute the new URL. Use an in-session prefetch from your splash screen instead.

### Without token refresh

If you don't register a refresh config, the bootstrap reuses whatever headers were stored at `prefetchOnAppStart` time. That works fine for tokens that outlive the app's typical kill/restart cycle. See [`docs-website/docs/token-refresh.md`](../../../docs-website/docs/token-refresh.md) for the full reference (composite headers, plain-text response bodies, `onFailure` modes).

## Gotchas

- **No `prefetchKey` → throws.** The error is literal: `prefetch requires a "prefetchKey" header`. Both `prefetch` and `prefetchOnAppStart` enforce this.
- **Mismatched keys → cold cache.** A prefetch with `prefetchKey: 'home'` and a fetch with `prefetchKey: 'home-feed'` are unrelated. The URL alone is *not* the cache key.
- **Android wiring missing.** `prefetchOnAppStart` writes silently; only the missing `Application.onCreate` line gives it away. Double-check it.
- **Prefetch loops.** The native side doesn't throttle. Don't call `prefetchOnAppStart` for fifty endpoints — you're just slowing down boot.
- **POST/PUT prefetches.** Allowed, but only sensible for idempotent endpoints. The cache lookup is by `prefetchKey`, not by request body.
- **Stale prefetches after deploys.** If your backend changes shape, old cached responses can hit the new client. Bump the `prefetchKey` (e.g. include a schema version).

## Pointers

- Source: [`packages/react-native-nitro-fetch/src/fetch.ts`](../../../packages/react-native-nitro-fetch/src/fetch.ts), search for `prefetch`
- Android bootstrap: [`packages/react-native-nitro-fetch/android/src/main/java/com/margelo/nitro/nitrofetch/AutoPrefetcher.kt`](../../../packages/react-native-nitro-fetch/android/src/main/java/com/margelo/nitro/nitrofetch/AutoPrefetcher.kt)
- iOS bootstrap: [`packages/react-native-nitro-fetch/ios/NitroBootstrap.mm`](../../../packages/react-native-nitro-fetch/ios/NitroBootstrap.mm)
- End-to-end example: [`example/src/screens/PrefetchScreen.tsx`](../../../example/src/screens/PrefetchScreen.tsx)
- Long-form docs: [`docs-website/docs/prefetch.md`](../../../docs-website/docs/prefetch.md)
- Related: [`axios-adapter.md`](./axios-adapter.md), [`network-inspector.md`](./network-inspector.md)
