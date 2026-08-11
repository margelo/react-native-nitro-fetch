let _TextEncoder: typeof TextEncoder | undefined;
let _TextDecoder: typeof TextDecoder | undefined;
let _triedOptionalCodec = false;

const NITRO_TEXT_DECODER_PKG = 'react-native-nitro-text-decoder';

function loadOptionalTextCodec(): {
  TextEncoder?: typeof TextEncoder;
  TextDecoder?: typeof TextDecoder;
} {
  try {
    // Hide require from the bundler so the package stays truly optional.
    // eslint-disable-next-line no-new-func
    const dynamicRequire = new Function('mod', 'return require(mod);') as (
      m: string
    ) => unknown;
    return dynamicRequire(NITRO_TEXT_DECODER_PKG) as {
      TextEncoder?: typeof TextEncoder;
      TextDecoder?: typeof TextDecoder;
    };
  } catch {
    return {};
  }
}

function ensureTextCodecs(): void {
  if (typeof TextEncoder !== 'undefined') {
    _TextEncoder = TextEncoder;
  }
  if (typeof TextDecoder !== 'undefined') {
    _TextDecoder = TextDecoder;
  }
  if ((_TextEncoder && _TextDecoder) || _triedOptionalCodec) return;
  _triedOptionalCodec = true;
  const optional = loadOptionalTextCodec();
  if (!_TextEncoder && optional.TextEncoder) {
    _TextEncoder = optional.TextEncoder;
  }
  if (!_TextDecoder && optional.TextDecoder) {
    _TextDecoder = optional.TextDecoder;
  }
}

// Bootstrap eagerly when globals exist (Node/Jest/browsers). RN may only
// expose codecs later via the optional native package, so call sites also
// re-check through ensureTextCodecs().
ensureTextCodecs();

/**
 * Minimal UTF-8 decoder used when TextDecoder is unavailable (common in RN
 * before react-native-nitro-text-decoder is loaded). Handles 1-4 byte
 * sequences and surrogate pairs.
 */
/* eslint-disable no-bitwise -- UTF-8 bit packing */
function utf8ToStringFallback(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  const len = bytes.length;
  while (i < len) {
    const c = bytes[i]!;
    if (c < 0x80) {
      out += String.fromCharCode(c);
      i += 1;
      continue;
    }
    if (c < 0xe0) {
      if (i + 1 >= len) break;
      out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i + 1]! & 0x3f));
      i += 2;
      continue;
    }
    if (c < 0xf0) {
      if (i + 2 >= len) break;
      out += String.fromCharCode(
        ((c & 0x0f) << 12) |
          ((bytes[i + 1]! & 0x3f) << 6) |
          (bytes[i + 2]! & 0x3f)
      );
      i += 3;
      continue;
    }
    if (i + 3 >= len) break;
    const cp =
      ((c & 0x07) << 18) |
      ((bytes[i + 1]! & 0x3f) << 12) |
      ((bytes[i + 2]! & 0x3f) << 6) |
      (bytes[i + 3]! & 0x3f);
    const offset = cp - 0x10000;
    out += String.fromCharCode(
      0xd800 + (offset >> 10),
      0xdc00 + (offset & 0x3ff)
    );
    i += 4;
  }
  return out;
}
/* eslint-enable no-bitwise */

export function stringToUTF8(str: string): Uint8Array {
  ensureTextCodecs();
  if (!_TextEncoder) {
    console.warn(
      'stringToUTF8: TextEncoder not available. Install react-native-nitro-text-decoder.'
    );
    return new Uint8Array(0);
  }
  return new _TextEncoder().encode(str);
}

export function utf8ToString(bytes: Uint8Array): string {
  ensureTextCodecs();
  if (_TextDecoder) {
    return new _TextDecoder().decode(bytes);
  }
  return utf8ToStringFallback(bytes);
}
