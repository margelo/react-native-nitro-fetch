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

export function utf8ToString(bytes: Uint8Array): string {
  if (!_TextDecoder) {
    console.warn(
      'utf8ToString: TextDecoder not available. Install react-native-nitro-text-decoder.'
    );
    return '';
  }
  return new _TextDecoder().decode(bytes);
}
