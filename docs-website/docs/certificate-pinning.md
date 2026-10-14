---
id: certificate-pinning
title: Certificate Pinning
sidebar_position: 13
---

# Certificate Pinning

Optional public-key (SPKI) pinning for every request `nitro-fetch` makes: `fetch`, `stream: true`, `prefetch` and auto-prefetch on app start, the cold-start token refresh, and FormData parts read from a URL. Android's `network_security_config.xml` doesn't apply to Cronet, and TrustKit-style swizzling doesn't reach every session, so `nitro-fetch` reads its own pin file.

Pinning is off unless the app ships the file. WebSockets (`react-native-nitro-websockets`) are not covered.

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
| `publicKeyHashes` | yes | Base64 SHA-256 of a certificate's SubjectPublicKeyInfo. A connection passes when **any** certificate in the verified chain (leaf, intermediate or root) matches. |
| `includeSubdomains` | no (`false`) | Also pin every subdomain. The most specific entry wins. |
| `expirationDate` | no | `yyyy-MM-dd` (UTC). After this date the host is no longer pinned, so old app builds keep working if you can't ship new pins in time. |

It's the same shape `react-native-ssl-public-key-pinning` takes, so one file can drive both: `initializeSslPinning(require('./nitro-fetch-pinning.json'))`.

Get a hash from a live server (repeat per certificate in the chain), or from a PEM file:

```bash
echo | openssl s_client -servername api.example.com -connect api.example.com:443 2>/dev/null \
  | openssl x509 -pubkey -noout | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 -binary | openssl enc -base64
```

Pin at least two keys per host. Root or intermediate CA keys survive certificate renewals, while leaf keys change every time a certificate is re-issued (ACM, Let's Encrypt). Add a backup key so a single rotation can't lock users out.

## 2. Bundle it with the app

- **Android:** `android/app/src/main/assets/nitro-fetch-pinning.json`
- **iOS:** add `nitro-fetch-pinning.json` to the app target in Xcode, so it shows up under *Build Phases → Copy Bundle Resources*.

Nothing else is needed. The file is read when the first request is made.

## Behavior

- **Mismatch:** the request fails before any request bytes are sent, with an error whose message contains `ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN` on both platforms. On the streaming transport it fails as an error, not as an `AbortError`.
- **Broken file:** if the file exists but can't be parsed (bad JSON, a URL instead of a hostname, a hash that isn't 32 bytes), every HTTPS request fails and the reason is logged. A typo never silently turns pinning off.
- **Proxies / user-installed CAs:** they don't bypass pins. To inspect traffic with Charles or Proxyman, ship the file only in release builds, e.g. Android `src/release/assets/`.
- **Hosts not in the file** use the platform's normal certificate validation.
