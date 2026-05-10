let _TextEncoder: typeof TextEncoder | undefined;
let _TextDecoder: typeof TextDecoder | undefined;

// The module name is held in a variable so bundlers (webpack, rspack) treat
// this as an "expression require" rather than a static literal — they won't
// try to resolve the optional peer at build time. Metro keeps working as
// before because it evaluates require() lazily.
const NITRO_TEXT_DECODER_PKG = 'react-native-nitro-text-decoder';

function loadOptionalTextCodec(): {
  TextEncoder?: typeof TextEncoder;
  TextDecoder?: typeof TextDecoder;
} {
  try {
    return require(NITRO_TEXT_DECODER_PKG);
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

export function utf8ToString(bytes: Uint8Array): string {
  if (!_TextDecoder) {
    console.warn(
      'utf8ToString: TextDecoder not available. Install react-native-nitro-text-decoder.'
    );
    return '';
  }
  return new _TextDecoder().decode(bytes);
}
