let _TextEncoder: typeof TextEncoder | undefined;
let _TextDecoder: typeof TextDecoder | undefined;

try {
  _TextEncoder =
    typeof TextEncoder !== 'undefined'
      ? TextEncoder
      : require('react-native-nitro-text-decoder').TextEncoder;
} catch {
  /* resolved at first use */
}

try {
  _TextDecoder =
    typeof TextDecoder !== 'undefined'
      ? TextDecoder
      : require('react-native-nitro-text-decoder').TextDecoder;
} catch {
  /* resolved at first use */
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
