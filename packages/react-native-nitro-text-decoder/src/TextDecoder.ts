import 'web-streams-polyfill/polyfill'
import { NitroModules } from 'react-native-nitro-modules'
import type {
  NitroTextDecoder,
  NitroTextEncoding,
  TextDecodeOptions,
  TextDecoderOptions,
} from './specs/TextDecoder.nitro'

const TextEncoding =
  NitroModules.createHybridObject<NitroTextEncoding>('NitroTextEncoding')

export class TextDecoder {
  public readonly encoding: string
  public readonly fatal: boolean
  public readonly ignoreBOM: boolean
  private readonly decoder: NitroTextDecoder

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

  decode(
    input?: ArrayBuffer | ArrayBufferView,
    options?: TextDecodeOptions
  ): string {
    if (options !== undefined && typeof options !== 'object') {
      throw new TypeError('Options must be an object')
    }
    try {
      // Ensure input is ArrayBuffer
      let buffer: ArrayBuffer | undefined
      if (input) {
        if (input instanceof ArrayBuffer) {
          buffer = input
        } else if (ArrayBuffer.isView(input)) {
          buffer = input.buffer.slice(
            input.byteOffset,
            input.byteOffset + input.byteLength
          ) as ArrayBuffer
        }
      }
      return this.decoder.decode(buffer, options)
    } catch (e: any) {
      throw new TypeError(e.message)
    }
  }
}
