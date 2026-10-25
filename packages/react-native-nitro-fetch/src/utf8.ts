let _TextEncoder: typeof TextEncoder | undefined;
let _TextDecoder: typeof TextDecoder | undefined;

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

if (typeof TextEncoder !== 'undefined') {
  _TextEncoder = TextEncoder;
} else {
  _TextEncoder = loadOptionalTextCodec().TextEncoder;
}

if (typeof TextDecoder !== 'undefined') {
  _TextDecoder = TextDecoder;
} else {
  _TextDecoder = loadOptionalTextCodec().TextDecoder;
}

export function stringToUTF8(str: string): Uint8Array {
  if (!_TextEncoder) {
    console.warn(
      'stringToUTF8: TextEncoder not available. Install react-native-nitro-text-decoder.'
    );
    return new Uint8Array(0);
  }
  return new _TextEncoder().encode(str);
}

const UTF8_LENGTH_SLICE = 0x10000;

// The UTF-8 length of a string as it is sent. A lone surrogate is sent as
// U+FFFD, 3 bytes, as TextEncoder would encode it.
export function utf8Length(text: string): number {
  const encoder = _TextEncoder ? new _TextEncoder() : undefined;
  if (typeof encoder?.encodeInto === 'function') {
    // Encoding natively is far faster than counting in JS. Slices keep the
    // buffer small; a UTF-16 unit takes at most 3 bytes.
    const buffer = new Uint8Array(Math.min(text.length, UTF8_LENGTH_SLICE) * 3);
    let length = 0;
    for (let start = 0; start < text.length; ) {
      let end = Math.min(start + UTF8_LENGTH_SLICE, text.length);
      // Keep a surrogate pair in one slice.
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      length += encoder.encodeInto(text.slice(start, end), buffer).written;
      start = end;
    }
    return length;
  }
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      length += 1;
    } else if (code < 0x800) {
      length += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 4;
        i++;
      } else {
        length += 3;
      }
    } else {
      length += 3;
    }
  }
  return length;
}

export function utf8ToString(bytes: Uint8Array): string {
  if (!_TextDecoder) {
    console.warn(
      'utf8ToString: TextDecoder not available. Install react-native-nitro-text-decoder.'
    );
    return '';
  }
  return new _TextDecoder().decode(bytes);
}
