# react-native-nitro-fetch

Awesome Fetch :)

## Installation


```sh
npm install react-native-nitro-fetch react-native-nitro-modules

> `react-native-nitro-modules` is required as this library relies on [Nitro Modules](https://nitro.margelo.com/).
```


## Usage


```ts
import { fetch, setNitroEnv, NitroFetch } from 'react-native-nitro-fetch';

// Drop-in replacement for global fetch
// Optionally provide NitroEnv to enable native cache dir usage
// setNitroEnv(NitroModules.createHybridObject('NitroEnv'));
const res = await fetch('https://httpbin.org/get');
const json = await res.json();

// Direct native access (singleton instance): create a client once
// const client = NitroFetch.createClient();
// await client.request({ url: 'https://httpbin.org/get' });
```

Notes

- This package exposes a Nitro-backed fetch shim designed to be replaced by a Cronet C API implementation.
- Today it falls back to the platform fetch if the native module isn’t present; once Cronet is wired, calls go fully native.

Roadmap (Cronet integration)

- Android: link Cronet C API, initialize an engine, implement request() in native, bridge via Nitro.
- iOS: link Cronet for iOS, mirror Android API and behavior.
- Streaming: add request handles and chunk events to support Response.body streaming.
 - Env module: provide `NitroEnv` to native to locate cache directory for Cronet cache, downloads, etc.

Android Cronet setup

- Ensure you have sufficient disk space (>30GB) and build tools installed (Ninja, Python, Java, Android NDK).
- Run the helper script to build Cronet and copy headers/libs into `android/cronet`:
  - `scripts/prepare_cronet_android.sh --checkout /absolute/path/to/chromium --arch arm64-v8a`
- Build the library; CMake auto-detects `android/cronet/include` and `android/cronet/libs/<abi>` and links Cronet.


## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
