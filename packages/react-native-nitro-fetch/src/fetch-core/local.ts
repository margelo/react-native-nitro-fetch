import type {
  NitroRequest as NitroRequestNative,
  NitroResponse as NitroResponseNative,
} from '../NitroFetch.nitro';
import { ensureClient } from './client';

function base64ToBytes(b64: string): Uint8Array {
  const decode = (globalThis as { atob?: (s: string) => string }).atob;
  if (typeof decode === 'function') {
    const bin = decode(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // base64 fallback for runtimes without a global atob.
  /* eslint-disable no-bitwise */
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | chars.indexOf(clean[i]!);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (buf >> bits) & 0xff;
    }
  }
  return out;
  /* eslint-enable no-bitwise */
}

type MinimalTextDecoder = {
  decode(input: ArrayBufferView): string;
};
type TextDecoderCtor = new (
  label?: string,
  options?: { fatal?: boolean }
) => MinimalTextDecoder;

// Cached: our nitro-text-decoder if the app bundles it (aliased require keeps it optional, not a dep), else a global TextDecoder.
let _decoder: MinimalTextDecoder | null | undefined;
function resolveTextDecoder(): MinimalTextDecoder | null {
  if (_decoder !== undefined) return _decoder;
  try {
    const dynamicRequire = require;
    const mod = dynamicRequire('react-native-nitro-text-decoder') as {
      TextDecoder?: TextDecoderCtor;
    };
    if (mod && typeof mod.TextDecoder === 'function') {
      _decoder = new mod.TextDecoder('utf-8', { fatal: true });
      return _decoder;
    }
  } catch {
    // optional, not bundled
  }
  const GlobalTextDecoder = (globalThis as { TextDecoder?: TextDecoderCtor })
    .TextDecoder;
  if (typeof GlobalTextDecoder === 'function') {
    _decoder = new GlobalTextDecoder('utf-8', { fatal: true });
    return _decoder;
  }
  _decoder = null;
  return _decoder;
}

// data: text via a TextDecoder; null (bytes-only) + a one-time warn if none.
let _warnedNoTextDecoder = false;
function decodeUtf8(bytes: Uint8Array): string | null {
  const decoder = resolveTextDecoder();
  if (decoder) {
    try {
      return decoder.decode(bytes);
    } catch {
      return null; // invalid UTF-8 -> keep bytes only
    }
  }
  if (!_warnedNoTextDecoder) {
    _warnedNoTextDecoder = true;
    console.warn(
      '[nitro-fetch] Reading a data: URL as text needs a TextDecoder. Install ' +
        'react-native-nitro-text-decoder or expose a global TextDecoder. The ' +
        'body is still available via response.arrayBuffer()/bytes().'
    );
  }
  return null;
}

// Decode a data: URL into a synthetic 200 response, entirely in JS.
function decodeDataUrl(url: string): NitroResponseNative {
  const comma = url.indexOf(',');
  if (comma < 0) throw new TypeError('Failed to fetch: invalid data: URL');
  const meta = url.slice(5, comma); // strip leading "data:"
  const rawData = url.slice(comma + 1);
  const isBase64 = /;base64\s*$/i.test(meta);
  const mediaType =
    (isBase64 ? meta.replace(/;base64\s*$/i, '') : meta).trim() ||
    'text/plain;charset=US-ASCII';

  let bodyString: string | undefined;
  let bodyBytes: ArrayBuffer | undefined;
  let length: number;
  if (isBase64) {
    const bytes = base64ToBytes(rawData);
    length = bytes.byteLength;
    // bytes for arrayBuffer/bytes; string for text/json when a decoder exists.
    bodyBytes = bytes.buffer as ArrayBuffer;
    const decoded = decodeUtf8(bytes);
    if (decoded != null) bodyString = decoded;
  } else {
    bodyString = decodeURIComponent(rawData);
    length =
      typeof TextEncoder !== 'undefined'
        ? new TextEncoder().encode(bodyString).length
        : bodyString.length;
  }

  return {
    url,
    status: 200,
    statusText: 'OK',
    ok: true,
    redirected: false,
    headers: [
      { key: 'Content-Type', value: mediaType },
      { key: 'Content-Length', value: String(length) },
    ],
    bodyString,
    bodyBytes,
  } as NitroResponseNative;
}

// Non-http(s): decode data: in JS, reject blob:, read file/content/path natively.
export async function fetchLocalResource(
  req: NitroRequestNative
): Promise<NitroResponseNative> {
  const url = req.url;
  if (url.startsWith('data:')) return decodeDataUrl(url);
  if (url.startsWith('blob:')) {
    throw new TypeError(
      'nitro-fetch cannot read blob: URLs (the React Native blob registry is not ' +
        'reachable from native). Read blobs with the platform fetch/FileReader instead.'
    );
  }
  const client = ensureClient();
  if (!client || typeof client.request !== 'function') {
    throw new Error('NitroFetch client not available');
  }
  return client.request(req);
}
