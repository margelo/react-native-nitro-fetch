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

### Mapping destinations: header, JSON body, form-data

A refreshed value can be routed to a request **header**, the **JSON body**, or a **multipart form-data field** — or all three at once. The examples below assume the refresh endpoint returns:

```json
{ "data": { "accessToken": "abc123" } }
```

**Header mapping** — `mappings` sets a request header:

```ts
mappings: [
  { jsonPath: 'data.accessToken', header: 'Authorization', valueTemplate: 'Bearer {{value}}' },
];
// → Authorization: Bearer abc123
```

**JSON-body mapping** — `bodyMappings` sets a (possibly nested) dot-path key in the prefetch's JSON body:

```ts
bodyMappings: [
  { jsonPath: 'data.accessToken', bodyPath: 'auth.token' },
];
// JSON prefetch  { "deviceId": "d-1" }
//        becomes { "deviceId": "d-1", "auth": { "token": "abc123" } }
```

**Form-data mapping** — `formDataMappings` replaces (or appends) a multipart field by name:

```ts
formDataMappings: [
  { jsonPath: 'data.accessToken', field: 'token' },
];
// → form-data prefetch gains/overwrites a `token=abc123` part
```

**All three in one config** — each mapping only applies to a prefetch whose body it matches, so a single config safely fans out across a header, a JSON prefetch, and a form-data prefetch (this is the **`fetch`** prefetch path only):

```ts
registerTokenRefresh({
  target: 'fetch',
  url: 'https://api.example.com/oauth/token',
  responseType: 'json',
  mappings: [
    { jsonPath: 'data.accessToken', header: 'Authorization', valueTemplate: 'Bearer {{value}}' },
  ],
  bodyMappings: [
    { jsonPath: 'data.accessToken', bodyPath: 'auth.token' },
  ],
  formDataMappings: [
    { jsonPath: 'data.accessToken', field: 'token' },
  ],
});
```

Notes:

- `bodyMappings` only rewrites a prefetch that **already has a JSON-object body** — it won't synthesize a body on a GET or a form-data request, and a non-JSON body is left untouched.
- `formDataMappings` only applies to prefetches that already send form-data — it won't turn a JSON/GET request into a multipart one.
- A config can mix both: each mapping is only applied to the prefetches whose body it matches, so a shared token-refresh config safely fans out across a JSON prefetch and a form-data prefetch without cross-contaminating them.
- `bodyPath` supports dot paths (`auth.token`); intermediate objects are created as needed.

### Plain text responses

Set `responseType: 'text'` and use **`textHeader`** / optional **`textTemplate`** (with `{{value}}`). The text value can also target the body or a form-data field via **`bodyTextPath`** / **`formDataTextField`**:

```ts
registerTokenRefresh({
  // ...
  responseType: 'text',
  textHeader: 'Authorization',
  textTemplate: 'Bearer {{value}}',
  // optional, fetch prefetch path only:
  bodyTextPath: 'auth.token',
  formDataTextField: 'token',
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
