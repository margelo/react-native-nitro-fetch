// TODO: Export specs that extend HybridObject<...> here
import type { HybridObject } from 'react-native-nitro-modules'
/** Options for `decode()`. */
export interface TextDecodeOptions {
  /** Keep an unfinished character at the end for the next `decode()` call. */
  stream?: boolean
}
/** Options for `new TextDecoder()`. */
export interface TextDecoderOptions {
  /** Throw on invalid bytes instead of replacing them with `�`. Default `false`. */
  fatal?: boolean
  /** Keep a leading byte order mark instead of removing it. Default `false`. */
  ignoreBOM?: boolean
}
export interface NitroTextDecoder extends HybridObject<{
  ios: 'c++'
  android: 'c++'
}> {
  readonly encoding: string
  readonly fatal: boolean
  readonly ignoreBOM: boolean
  decode(
    input?: ArrayBuffer,
    byteOffset?: number,
    byteLength?: number,
    options?: TextDecodeOptions
  ): string
}
export interface NitroTextEncoding extends HybridObject<{
  ios: 'c++'
  android: 'c++'
}> {
  createDecoder(label?: string, options?: TextDecoderOptions): NitroTextDecoder
}
