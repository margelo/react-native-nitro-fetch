---
id: token-refresh
title: Token Refresh
sidebar_position: 7
---

# Token Refresh (Cold Start)

When you use **auto-prefetch** (`prefetchOnAppStart`) and/or **WebSocket prewarm on app start** (`react-native-nitro-websockets`), native code runs **before** your JS bundle. If those requests need auth headers, you can register a **token refresh** configuration.

On each cold start, native code calls your refresh URL, maps the response into HTTP headers, and merges them into auto-prefetches and/or WebSocket prewarms.

## Register the refresh config

The config is persisted in encrypted native storage:

```ts
import { registerTokenRefresh } from 'react-native-nitro-fetch';

registerTokenRefresh({
  target: 'fetch', // 'websocket' | 'fetch' | 'all'
  url: 'https://api.example.com/oauth/token',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'client_credentials' }),
  responseType: 'json',
  mappings: [
    {
      jsonPath: 'access_token',
      header: 'Authorization',
      valueTemplate: 'Bearer {{value}}',
    },
  ],
  // If the refresh request fails:
  // - 'useStoredHeaders' — use last successful headers (default)
  // - 'skip' — skip auto-prefetch / prewarm entirely
  onFailure: 'useStoredHeaders',
});
```

## Response mapping

### JSON responses (default)

Use **`mappings`** to copy fields from the JSON body into header names. Dot paths are supported (e.g., `data.token`):

```ts
mappings: [
  {
    jsonPath: 'access_token',
    header: 'Authorization',
    valueTemplate: 'Bearer {{value}}',
  },
];
```

### Composite headers

Use **`compositeHeaders`** to build a header from a template and multiple JSON paths:

```ts
compositeHeaders: [
  {
    header: 'X-Auth',
    template: '{{token_type}} {{access_token}}',
  },
];
```

### Plain text responses

Set `responseType: 'text'` and use **`textHeader`** / optional **`textTemplate`** (with `{{value}}`):

```ts
registerTokenRefresh({
  // ...
  responseType: 'text',
  textHeader: 'Authorization',
  textTemplate: 'Bearer {{value}}',
});
```

## Example: Token refresh + WebSocket prewarm

```ts
import { registerTokenRefresh } from 'react-native-nitro-fetch';
import {
  prewarmOnAppStart,
  NitroWebSocket,
} from 'react-native-nitro-websockets';

const WSS = 'wss://api.example.com/live';

registerTokenRefresh({
  target: 'websocket', // use 'all' for both prefetch and websocket
  url: 'https://api.example.com/oauth/token',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'client_credentials',
    client_id: '...',
    client_secret: '...',
  }),
  mappings: [
    {
      jsonPath: 'access_token',
      header: 'Authorization',
      valueTemplate: 'Bearer {{value}}',
    },
  ],
});

prewarmOnAppStart(WSS);

// Runtime connection
const ws = new NitroWebSocket(WSS, undefined, {
  Authorization: 'Bearer ...',
});
```

## JS helpers

```ts
import {
  callRefreshEndpoint,
  clearTokenRefresh,
  getStoredTokenRefreshConfig,
} from 'react-native-nitro-fetch';

// Same mapping rules as native; uses global fetch from JS
const headers = await callRefreshEndpoint(config);

// Remove stored config and token caches
// Scope with 'fetch' | 'websocket' | 'all'
clearTokenRefresh('fetch');

// Read back what was registered (or null)
const stored = getStoredTokenRefreshConfig('fetch');
```

:::note
The refresh config and header caches are stored with **platform secure storage** (Android Keystore + encrypted values in `SharedPreferences`, iOS Keychain-backed encryption).
:::
