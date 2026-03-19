# react-native-nitro-text-decoder

`TextDecoder` implementation backed by Nitro Modules for React Native.

## Installation

```sh
npm i react-native-nitro-text-decoder react-native-nitro-modules
```

## Usage

```ts
import { TextDecoder } from 'react-native-nitro-text-decoder'

const decoder = new TextDecoder()
const text = decoder.decode(new Uint8Array([72, 101, 108, 108, 111])) // "Hello"
```

`decode` accepts:

- `ArrayBuffer`
- `ArrayBufferView` (for example `Uint8Array`, `Int8Array`, `DataView`)

### Constructor options

```ts
import { TextDecoder } from 'react-native-nitro-text-decoder'

const decoder = new TextDecoder('utf-8', {
  fatal: false,
  ignoreBOM: true,
})
```

## Streaming decode (chunked UTF-8)

If you decode incrementally (for example from an HTTP stream), reuse the same decoder and pass `{ stream: true }` for intermediate chunks:

```ts
import { TextDecoder } from 'react-native-nitro-text-decoder'

const decoder = new TextDecoder('utf-8')

// For each chunk:
const chunkText = decoder.decode(chunkUint8Array, { stream: true })

// On the final chunk, you can omit it or set stream to false:
const finalText = decoder.decode(lastChunk, { stream: false })
```

## API Reference

### `class TextDecoder`

- `constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean })`
- `encoding: string`
- `fatal: boolean`
- `ignoreBOM: boolean`
- `decode(input?: ArrayBuffer | ArrayBufferView, options?: { stream?: boolean }): string`
