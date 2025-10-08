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
  private readonly decoder: NitroTextDecoder;

  constructor(label: string = 'utf-8', options?: TextDecoderOptions) {
    if (label === null) {
      throw new RangeError('Invalid encoding label');
    }
    if (options !== undefined && typeof options !== 'object') {
      throw new TypeError('Options must be an object');
    }

    try {
      this.decoder = TextEncoding.createDecoder(label, options);
    } catch (e: any) {
      throw new RangeError(e.message);
    }
    this.encoding = this.decoder.encoding;
    this.fatal = this.decoder.fatal;
    this.ignoreBOM = this.decoder.ignoreBOM;
  }

  decode(
    input?: ArrayBuffer | ArrayBufferView,
    options?: TextDecodeOptions
  ): string {
    try {
      // Handle ArrayBufferView (Uint8Array, Int8Array, Uint16Array, etc.)
      if (
        input &&
        'buffer' in input &&
        'byteOffset' in input &&
        'byteLength' in input
      ) {
        // Create a Uint8Array view of the exact bytes we need to decode
        const view = new Uint8Array(
          input.buffer as ArrayBuffer,
          input.byteOffset,
          input.byteLength
        );
        // Now slice to get a new buffer with just those bytes
        const sliced = view.slice();
        return this.decoder.decode(sliced.buffer as ArrayBuffer, options);
      }
      // Handle plain ArrayBuffer
      return this.decoder.decode(input as ArrayBuffer | undefined, options);
    } catch (e: any) {
      throw new TypeError(e.message);
    }
  }
}
