---
id: certificate-pinning
title: Certificate Pinning
sidebar_position: 13
---

# Certificate Pinning

Optional public-key (SPKI) pinning for the requests `nitro-fetch` makes natively: `fetch`, `stream: true`, `prefetch` and auto-prefetch on app start, the cold-start token refresh, `callRefreshEndpoint`, and FormData parts read from a URL. Android's `network_security_config.xml` doesn't apply to Cronet, and TrustKit-style swizzling doesn't reach every session, so `nitro-fetch` reads its own pin file.

`react-native-nitro-websockets` applies the same file to `wss://` connections, prewarmed ones included, and to its own cold-start token refresh. On Android, a pinned `wss://` host must also pass the Android trust store, as with `fetch`.

Pinning is off unless the app ships the file.

**Upgrading:** earlier versions sent `callRefreshEndpoint` through React Native's networking, so pins set up for it, such as a `<pin-set>` in Android's `network_security_config.xml` or `react-native-ssl-public-key-pinning`, covered it. It now uses `nitro-fetch`, which follows only `nitro-fetch-pinning.json`. Ship that file with the same pins to keep refreshes started from JS pinned.

## 1. Write the pin file

`nitro-fetch-pinning.json` maps each hostname to the SHA-256 hashes of the public keys you trust:

```json
{
  "api.example.com": {
    "publicKeyHashes": [
      "++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=",
      "f0KW/FtqTjs108NpYj42SrGvOB2PpxIVM8nWxjPqJGE="
    ],
    "includeSubdomains": false,
    "expirationDate": "2027-06-01"
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `publicKeyHashes` | yes | Standard padded base64 (44 characters) of the SHA-256 of a certificate's SubjectPublicKeyInfo. A connection passes when **any** certificate in the verified chain (leaf, intermediate or root) matches. |
| `includeSubdomains` | no (`false`) | Also pin every subdomain. |
| `expirationDate` | no | `yyyy-MM-dd`. The pins stop applying at 00:00 UTC on this date, so old app builds keep working if you can't ship new pins in time. |

**Which entry applies:** the same rule as Chromium, on every platform. Starting from the full hostname and moving up one label at a time, expired entries are skipped and the first live entry decides. It applies if it names the host exactly or has `includeSubdomains`. Otherwise the host isn't pinned, even if a parent entry has `includeSubdomains`.

**Format:** the file must be strict JSON with each host listed once, and keys must be plain hostnames. Uppercase letters and a trailing dot are ignored. Anything else makes the file invalid on both platforms and in the Expo plugin.

It's the same shape `react-native-ssl-public-key-pinning` takes, so one file can drive both: `initializeSslPinning(require('./nitro-fetch-pinning.json'))`.

Get a hash from a live server (repeat per certificate in the chain), or from a PEM file:

```bash
echo | openssl s_client -servername api.example.com -connect api.example.com:443 2>/dev/null \
  | openssl x509 -pubkey -noout | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 -binary | openssl enc -base64
```

Pin at least two keys per host. Root or intermediate CA keys survive certificate renewals, while leaf keys change every time a certificate is re-issued (ACM, Let's Encrypt). Add a backup key so a single rotation can't lock users out.

## 2. Bundle it with the app

**Expo:** point the config plugin at the file. `expo prebuild` copies it into both native projects, and fails if the file is malformed.

```json
{
  "plugins": [
    ["react-native-nitro-fetch", { "certificatePinning": "./nitro-fetch-pinning.json" }]
  ]
}
```

Removing the option later doesn't delete the copies. Run `expo prebuild --clean`, or delete the two files yourself.

**Bare React Native:**

- **Android:** `android/app/src/main/assets/nitro-fetch-pinning.json`
- **iOS:** add `nitro-fetch-pinning.json` to the app target in Xcode, so it shows up under *Build Phases → Copy Bundle Resources*. App extensions have their own bundle, so add the file to every target that uses `nitro-fetch`.

Nothing else is needed. The file is read when the first request is made.

## Behavior

- **Mismatch:** the request fails before any request bytes are sent, with an error whose message contains `ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN` on both platforms. On the streaming transport it fails as an error, not as an `AbortError`.
- **Untrusted certificate:** an expired, self-signed or wrong-host certificate on a pinned host fails with the platform's usual certificate error, not the pinning error.
- **Broken file:** if the file exists but is invalid, requests fail with the reason in the error message. A typo never silently turns pinning off. On iOS this affects HTTPS requests; on Android, `nitro-fetch` doesn't create its network client at all, so every request fails. Every `wss://` connection fails on both platforms.
- **Proxies / user-installed CAs:** they don't bypass pins. To inspect traffic with Charles or Proxyman, ship the file only in release builds, e.g. Android `src/release/assets/`.
- **Hosts not in the file** use the platform's normal certificate validation.
- **Android `HttpURLConnection` paths** (cold-start token refresh, FormData parts read from a URL): once a pin file exists, these use the system trust store, like Cronet does. A default `SSLSocketFactory` installed with `HttpsURLConnection.setDefaultSSLSocketFactory` isn't used for them. The WebSocket prewarm's token refresh is the exception: it keeps the default socket factory and checks a pinned host in its `HostnameVerifier`, before the request is sent.
- **Android `wss://`:** apps that ship the file do a full TLS handshake on every connection, because a resumed TLS session doesn't carry the server's whole chain.
