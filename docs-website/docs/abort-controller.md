---
id: abort-controller
title: AbortController
sidebar_position: 5
---

# AbortController

Cancel in-flight requests using the standard `AbortController` API.

## Basic usage

```ts
import { fetch } from 'react-native-nitro-fetch';

const controller = new AbortController();

// Abort after 500ms
setTimeout(() => controller.abort(), 500);

try {
  const res = await fetch('https://httpbin.org/delay/20', {
    signal: controller.signal,
  });
} catch (e) {
  if (e.name === 'AbortError') {
    console.log('Request was cancelled');
  }
}
```

## Pre-aborted signals

Pre-aborted signals are also supported — the request will throw immediately without making a network call:

```ts
const controller = new AbortController();
controller.abort();

await fetch(url, { signal: controller.signal }); // throws AbortError
```

## Timeout pattern

A common pattern is to create a timeout wrapper:

```ts
import { fetch } from 'react-native-nitro-fetch';

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}
```

:::tip
The `AbortController` API works exactly like the browser standard. If you're already using it with the built-in `fetch`, no changes are needed.
:::
