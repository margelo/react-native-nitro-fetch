// Concrete path so Metro resolves it even with unstable_enablePackageExports: false (#103).
import 'web-streams-polyfill/dist/polyfill.js'
import { NitroModules } from 'react-native-nitro-modules'
import type {
  NitroTextDecoder,
  NitroTextEncoding,
  TextDecodeOptions,
  TextDecoderOptions,
} from './specs/TextDecoder.nitro'

const TextEncoding =
  NitroModules.createHybridObject<NitroTextEncoding>('NitroTextEncoding')

/** Turns UTF-8 bytes into a string natively. Works like the standard `TextDecoder`. */
export class TextDecoder {
  /** Always `'utf-8'`. */
  public readonly encoding: string
  /** Whether invalid bytes throw. Set in the constructor. */
  public readonly fatal: boolean
  /** Whether a leading byte order mark is kept. Set in the constructor. */
  public readonly ignoreBOM: boolean
  private readonly decoder: NitroTextDecoder

  /** Only UTF-8 is supported. Other labels throw a `RangeError`. */
  constructor(label: string = 'utf-8', options?: TextDecoderOptions) {
    if (label === null) {
      throw new RangeError('Invalid encoding label')
    }
    if (options !== undefined && typeof options !== 'object') {
      throw new TypeError('Options must be an object')
    }

    try {
      this.decoder = TextEncoding.createDecoder(label, options)
    } catch (e: any) {
      throw new RangeError(e.message)
    }
    this.encoding = this.decoder.encoding
    this.fatal = this.decoder.fatal
    this.ignoreBOM = this.decoder.ignoreBOM
  }

  /** Turns `input` into a string. */
  decode(
    input?: ArrayBuffer | ArrayBufferView,
    options?: TextDecodeOptions
  ): string {
    if (options !== undefined && typeof options !== 'object') {
      throw new TypeError('Options must be an object')
    }
    try {
      // Native reads byteOffset/byteLength off TypedArray/DataView directly —
      // no JS-side slicing or unpacking.
      return (this.decoder as any).decode(input, options)
    } catch (e: any) {
      throw new TypeError(e.message)
    }
  }
}
