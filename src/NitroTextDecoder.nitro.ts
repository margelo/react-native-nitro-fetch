import type { HybridObject } from 'react-native-nitro-modules';

// export interface TextDecodeOptions {
//   stream?: boolean;
// }

// export interface TextDecoderOptions {
//   fatal?: boolean;
//   ignoreBOM?: boolean;
// }

export interface NitroTextDecoder
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  decode(input?: ArrayBuffer, options?: TextDecodeOptions): string;
}
export interface NitroTextEncoding
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  createDecoder(label?: string, options?: TextDecoderOptions): NitroTextDecoder;
}
