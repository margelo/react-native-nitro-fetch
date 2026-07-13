import { utf8ToString } from './utf8';

// RN's Blob can't be built from an ArrayBuffer in JS. The NitroFetchBlob TurboModule
// registers the bytes in RN's native Blob registry (RCTBlobManager / BlobModule) and
// returns a blobId we build the Blob from. base64 keeps the JS<->native hop binary-safe.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/* eslint-disable no-bitwise */
export function base64FromBytes(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? (bytes[i + 1] ?? 0) : 0;
    const b2 = hasB2 ? (bytes[i + 2] ?? 0) : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += hasB1 ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += hasB2 ? B64[b2 & 63] : '=';
  }
  return out;
}
/* eslint-enable no-bitwise */

// Lazy/guarded so the web build (which re-exports Response) and older archs
// degrade to a string Blob instead of throwing. Static requires (not new Function)
// so Metro/Hermes resolves them at bundle time — the new-Function indirection
// failed to resolve `require` in release/CI Hermes.
let _bm: { createFromOptions?: (opts: unknown) => Blob } | null | undefined;
function blobManager(): { createFromOptions?: (opts: unknown) => Blob } | null {
  if (_bm !== undefined) return _bm;
  try {
    const m = require('react-native/Libraries/Blob/BlobManager');
    _bm = m?.default ?? m ?? null;
  } catch {
    _bm = null;
  }
  return _bm ?? null;
}

let _tm: { createBlobId?: (base64: string) => string } | null | undefined;
function nitroFetchBlob(): {
  createBlobId?: (base64: string) => string;
} | null {
  if (_tm !== undefined) return _tm;
  try {
    // Plain native module: Android reaches it via NativeModules (New-Arch legacy
    // interop); iOS resolves it via NativeModules or the TurboModuleRegistry accessor.
    const { NativeModules } = require('react-native');
    _tm =
      NativeModules?.NitroFetchBlob ??
      require('./turbomodule/NativeNitroFetchBlob').default ??
      null;
  } catch {
    _tm = null;
  }
  return _tm ?? null;
}

export function bytesToBlob(bytes: ArrayBuffer, type: string): Blob {
  if (bytes.byteLength === 0) return new Blob([], { type });
  try {
    const bm = blobManager();
    const tm = nitroFetchBlob();
    if (
      typeof bm?.createFromOptions === 'function' &&
      typeof tm?.createBlobId === 'function'
    ) {
      const blobId = tm.createBlobId(base64FromBytes(new Uint8Array(bytes)));
      if (blobId) {
        return bm.createFromOptions({
          blobId,
          offset: 0,
          size: bytes.byteLength,
          type,
        });
      }
    }
  } catch {
    // fall through
  }
  return new Blob([utf8ToString(new Uint8Array(bytes))], { type });
}
