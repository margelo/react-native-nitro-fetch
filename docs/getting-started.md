# Getting Started

- Install dependencies:

```
npm install react-native-nitro-fetch react-native-nitro-modules
```

- Rebuild your app so the Nitro module is linked.

Verify with a simple request:

```ts
import { fetch } from 'react-native-nitro-fetch';

export async function test() {
  const res = await fetch('https://httpbin.org/get');
  console.log('status', res.status);
  console.log('headers', Object.fromEntries(res.headers as any));
  console.log('json', await res.json());
}
```

Notes

- Android uses Cronet (via `org.chromium.net:cronet-embedded`) which is already included in `android/build.gradle`.
- iOS currently falls back to the built-in fetch path while Cronet integration is in progress.

