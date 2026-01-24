import 'web-streams-polyfill/polyfill';
import { NitroModules } from 'react-native-nitro-modules';
import type {
  NitroTextDecoder,
  NitroTextEncoding,
} from './NitroTextDecoder.nitro';

const TextEncoding =
  NitroModules.createHybridObject<NitroTextEncoding>('NitroTextEncoding');

export class TextDecoder {
  public readonly encoding: string;
  public readonly fatal: boolean;
  public readonly ignoreBOM: boolean;
  // The raw decode method handles ArrayBuffer, TypedArray, and DataView directly in C++
  private readonly _decode: (
    input?: ArrayBuffer | ArrayBufferView,
    options?: TextDecodeOptions
  ) => string;

  constructor(label: string = 'utf-8', options?: TextDecoderOptions) {
    if (label === null) {
      throw new RangeError('Invalid encoding label');
    }
    if (options !== undefined && typeof options !== 'object') {
      throw new TypeError('Options must be an object');
    }

    let decoder: NitroTextDecoder;
    try {
      decoder = TextEncoding.createDecoder(label, options);
    } catch (e: any) {
      throw new RangeError(e.message);
    }
    this.encoding = decoder.encoding;
    this.fatal = decoder.fatal;
    this.ignoreBOM = decoder.ignoreBOM;
    // The C++ raw method handles TypedArray directly - no JS conversion needed!
    this._decode = (decoder as any).decode.bind(decoder);
  }

  decode(
    input?: ArrayBuffer | ArrayBufferView,
    options?: TextDecodeOptions
  ): string {
    // Validate options parameter - must be undefined or an object
    if (options !== undefined && typeof options !== 'object') {
      throw new TypeError('Options must be an object');
    }
    try {
      return this._decode(input, options);
    } catch (e: any) {
      throw new TypeError(e.message);
    }
  }
}
