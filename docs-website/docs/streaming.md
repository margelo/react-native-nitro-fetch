---
id: streaming
title: Streaming
sidebar_position: 4
---

# Streaming

Nitro Fetch can expose a streaming mode that returns a `ReadableStream` body. Combined with [`react-native-nitro-text-decoder`](https://github.com/margelo/react-native-nitro-fetch/tree/main/packages/react-native-nitro-text-decoder), you can incrementally decode UTF-8 chunks.

## Installation

Make sure you have the text decoder package installed:

```bash
npm i react-native-nitro-text-decoder
```

## Usage

```tsx
import { useRef, useState } from 'react';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';
import { TextDecoder } from 'react-native-nitro-text-decoder';

export function StreamingExample() {
  const [output, setOutput] = useState('');
  const decoder = useRef(new TextDecoder());

  const append = (text: string) => {
    setOutput((prev) => prev + text);
  };

  const runStream = async () => {
    // `stream: true` enables the streaming transport
    const res = await nitroFetch('https://httpbin.org/stream/20', {
      stream: true,
    });

    const reader = res.body?.getReader();
    if (!reader) {
      append('No readable stream!');
      return;
    }

    let chunks = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks++;
      const text = decoder.current.decode(value, { stream: true });
      append(text);
    }

    append(`\n\nDone - ${chunks} chunk(s) received`);
  };

  // Call `runStream()` from a button handler in your UI
}
```

:::tip
Pass `{ stream: true }` in the fetch options to enable streaming mode. Without it, the full body is buffered before resolving.
:::

## How it works

1. `fetch()` with `stream: true` returns a `Response` whose `body` is a `ReadableStream<Uint8Array>`
2. Use `getReader()` to obtain a `ReadableStreamDefaultReader`
3. Call `reader.read()` in a loop until `done` is `true`
4. Decode each `Uint8Array` chunk with `TextDecoder` for UTF-8 text

Streaming is supported on both Android and iOS.
