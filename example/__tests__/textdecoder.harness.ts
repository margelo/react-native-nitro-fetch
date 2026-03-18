import { describe, it, expect } from 'react-native-harness'
import { TextDecoder } from 'react-native-nitro-text-decoder'

describe('TextDecoder - Constructor', () => {
  it('default encoding is utf-8', () => {
    const decoder = new TextDecoder()
    expect(decoder.encoding).toBe('utf-8')
  })

  it('fatal defaults to false', () => {
    const decoder = new TextDecoder()
    expect(decoder.fatal).toBe(false)
  })

  it('ignoreBOM defaults to false', () => {
    const decoder = new TextDecoder()
    expect(decoder.ignoreBOM).toBe(false)
  })

  it('accepts utf-8 label', () => {
    const decoder = new TextDecoder('utf-8')
    expect(decoder.encoding).toBe('utf-8')
  })

  it('accepts utf8 label (alias)', () => {
    const decoder = new TextDecoder('utf8')
    expect(decoder.encoding).toBe('utf-8')
  })

  it('fatal option is preserved', () => {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    expect(decoder.fatal).toBe(true)
  })

  it('ignoreBOM option is preserved', () => {
    const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
    expect(decoder.ignoreBOM).toBe(true)
  })
})

describe('TextDecoder - Basic Decoding', () => {
  it('decodes ASCII string from Uint8Array', () => {
    const decoder = new TextDecoder()
    const input = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
    expect(decoder.decode(input)).toBe('Hello')
  })

  it('decodes empty buffer returns empty string', () => {
    const decoder = new TextDecoder()
    const input = new Uint8Array([])
    expect(decoder.decode(input)).toBe('')
  })

  it('decode with no argument returns empty string', () => {
    const decoder = new TextDecoder()
    expect(decoder.decode()).toBe('')
  })

  it('decode with undefined returns empty string', () => {
    const decoder = new TextDecoder()
    expect(decoder.decode(undefined)).toBe('')
  })

  it('decodes longer ASCII text', () => {
    const decoder = new TextDecoder()
    const text = 'The quick brown fox jumps over the lazy dog'
    const bytes = new Uint8Array(text.split('').map((c) => c.charCodeAt(0)))
    expect(decoder.decode(bytes)).toBe(text)
  })
})

describe('TextDecoder - UTF-8 Multi-byte', () => {
  it('decodes 2-byte characters (é = 0xC3 0xA9)', () => {
    const decoder = new TextDecoder()
    const input = new Uint8Array([0xc3, 0xa9]) // é
    expect(decoder.decode(input)).toBe('é')
  })

  it('decodes 3-byte characters (€ = 0xE2 0x82 0xAC)', () => {
    const decoder = new TextDecoder()
    const input = new Uint8Array([0xe2, 0x82, 0xac]) // €
    expect(decoder.decode(input)).toBe('€')
  })

  it('decodes 4-byte characters (🎉 = 0xF0 0x9F 0x8E 0x89)', () => {
    const decoder = new TextDecoder()
    const input = new Uint8Array([0xf0, 0x9f, 0x8e, 0x89]) // 🎉
    expect(decoder.decode(input)).toBe('🎉')
  })

  it('decodes mixed ASCII + multi-byte', () => {
    const decoder = new TextDecoder()
    // "Hi é € 🎉"
    const input = new Uint8Array([
      0x48, 0x69, 0x20, // "Hi "
      0xc3, 0xa9, 0x20, // "é "
      0xe2, 0x82, 0xac, 0x20, // "€ "
      0xf0, 0x9f, 0x8e, 0x89, // "🎉"
    ])
    expect(decoder.decode(input)).toBe('Hi é € 🎉')
  })
})

describe('TextDecoder - Streaming', () => {
  it('streaming with split multi-byte character across chunks', () => {
    const decoder = new TextDecoder()
    // é = 0xC3 0xA9, split across two chunks
    const chunk1 = new Uint8Array([0xc3])
    const chunk2 = new Uint8Array([0xa9])

    const part1 = decoder.decode(chunk1, { stream: true })
    const part2 = decoder.decode(chunk2, { stream: false })
    expect(part1 + part2).toBe('é')
  })

  it('streaming with split 4-byte character', () => {
    const decoder = new TextDecoder()
    // 🎉 = 0xF0 0x9F 0x8E 0x89
    const chunk1 = new Uint8Array([0xf0, 0x9f])
    const chunk2 = new Uint8Array([0x8e, 0x89])

    const part1 = decoder.decode(chunk1, { stream: true })
    const part2 = decoder.decode(chunk2, { stream: false })
    expect(part1 + part2).toBe('🎉')
  })

  it('streaming multiple chunks with ASCII', () => {
    const decoder = new TextDecoder()
    const chunk1 = new Uint8Array([72, 101, 108]) // "Hel"
    const chunk2 = new Uint8Array([108, 111]) // "lo"

    const part1 = decoder.decode(chunk1, { stream: true })
    const part2 = decoder.decode(chunk2, { stream: false })
    expect(part1 + part2).toBe('Hello')
  })
})

describe('TextDecoder - BOM Handling', () => {
  it('UTF-8 BOM is stripped by default', () => {
    const decoder = new TextDecoder()
    // BOM (0xEF 0xBB 0xBF) + "Hi"
    const input = new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x69])
    expect(decoder.decode(input)).toBe('Hi')
  })

  it('UTF-8 BOM preserved with ignoreBOM: true', () => {
    const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
    // BOM (0xEF 0xBB 0xBF) + "Hi"
    const input = new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x69])
    const result = decoder.decode(input)
    // With ignoreBOM: true, BOM should be in the output
    expect(result.charCodeAt(0)).toBe(0xfeff) // BOM character
    expect(result.slice(1)).toBe('Hi')
  })
})

describe('TextDecoder - Error Handling', () => {
  it('invalid bytes with fatal: false produce replacement character', () => {
    const decoder = new TextDecoder('utf-8', { fatal: false })
    // 0xFF is an invalid UTF-8 byte
    const input = new Uint8Array([0xff])
    const result = decoder.decode(input)
    expect(result).toBe('\uFFFD')
  })

  it('invalid bytes with fatal: true throws TypeError', () => {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const input = new Uint8Array([0xff])
    let threw = false
    try {
      decoder.decode(input)
    } catch (e: any) {
      threw = true
    }
    expect(threw).toBe(true)
  })

  it('truncated multi-byte with fatal: false produces replacement', () => {
    const decoder = new TextDecoder('utf-8', { fatal: false })
    // 0xC3 expects a continuation byte but none follows (non-streaming)
    const input = new Uint8Array([0xc3])
    const result = decoder.decode(input)
    expect(result).toBe('\uFFFD')
  })
})

describe('TextDecoder - Input Types', () => {
  it('ArrayBuffer input', () => {
    const decoder = new TextDecoder()
    const buf = new Uint8Array([72, 101, 108, 108, 111]).buffer
    expect(decoder.decode(buf)).toBe('Hello')
  })

  it('Uint8Array input', () => {
    const decoder = new TextDecoder()
    const input = new Uint8Array([72, 101, 108, 108, 111])
    expect(decoder.decode(input)).toBe('Hello')
  })

  it('Uint8Array with byteOffset (subarray)', () => {
    const decoder = new TextDecoder()
    // Full buffer: "XXHello"
    const full = new Uint8Array([88, 88, 72, 101, 108, 108, 111])
    const sub = full.subarray(2) // "Hello" starting at offset 2
    expect(decoder.decode(sub)).toBe('Hello')
  })

  it('Uint8Array subarray in the middle', () => {
    const decoder = new TextDecoder()
    // Full buffer: "XXHelloYY"
    const full = new Uint8Array([88, 88, 72, 101, 108, 108, 111, 89, 89])
    const sub = full.subarray(2, 7) // "Hello"
    expect(decoder.decode(sub)).toBe('Hello')
  })
})
