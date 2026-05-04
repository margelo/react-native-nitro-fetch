import { describe, it, expect } from 'react-native-harness';
import { TextDecoder } from 'react-native-nitro-text-decoder';

describe('NitroTextDecoder - constructor and metadata', () => {
  it('defaults to utf-8 with fatal=false and ignoreBOM=false', () => {
    const d = new TextDecoder();
    expect(d.encoding).toBe('utf-8');
    expect(d.fatal).toBe(false);
    expect(d.ignoreBOM).toBe(false);
  });

  it('accepts utf8 label and reports encoding as utf-8', () => {
    const d = new TextDecoder('utf8');
    expect(d.encoding).toBe('utf-8');
  });

  it('throws RangeError for unsupported encoding labels', () => {
    expect(() => new TextDecoder('utf-16le')).toThrow(RangeError);
    expect(() => new TextDecoder('iso-8859-1')).toThrow(RangeError);
  });

  it('throws RangeError when label is null', () => {
    expect(() => new TextDecoder(null as any)).toThrow(RangeError);
  });

  it('throws TypeError when options is not an object', () => {
    expect(() => new TextDecoder('utf-8', 1 as any)).toThrow(TypeError);
  });

  it('respects fatal and ignoreBOM options', () => {
    const d = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    expect(d.fatal).toBe(true);
    expect(d.ignoreBOM).toBe(true);
  });
});

describe('NitroTextDecoder - decode', () => {
  it('decodes ASCII from Uint8Array', () => {
    const d = new TextDecoder();
    const bytes = new TextEncoder().encode('hello-nitro');
    expect(d.decode(bytes)).toBe('hello-nitro');
  });

  it('decodes multi-byte UTF-8 (CJK and emoji)', () => {
    const d = new TextDecoder();
    const s = '你好 🙂';
    const bytes = new TextEncoder().encode(s);
    expect(d.decode(bytes)).toBe(s);
  });

  it('decodes from ArrayBuffer slice via ArrayBufferView', () => {
    const d = new TextDecoder();
    const raw = new Uint8Array([0x61, 0x62, 0x63, 0xff, 0x64]).buffer;
    const view = new Uint8Array(raw, 0, 3);
    expect(d.decode(view)).toBe('abc');
  });

  it('strips UTF-8 BOM when ignoreBOM is false (default)', () => {
    const d = new TextDecoder('utf-8', { ignoreBOM: false });
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x62]);
    expect(d.decode(bom)).toBe('ab');
  });

  it('preserves BOM as U+FEFF when ignoreBOM is true', () => {
    const d = new TextDecoder('utf-8', { ignoreBOM: true });
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
    const out = d.decode(bom);
    expect(out.codePointAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe('a');
  });

  it('with fatal=false replaces invalid sequences', () => {
    const d = new TextDecoder('utf-8', { fatal: false });
    const invalid = new Uint8Array([0xff, 0x61]);
    expect(d.decode(invalid)).toBe('\uFFFDa');
  });

  it('with fatal=true throws on invalid UTF-8', () => {
    const d = new TextDecoder('utf-8', { fatal: true });
    const invalid = new Uint8Array([0xff]);
    expect(() => d.decode(invalid)).toThrow(TypeError);
  });

  it('throws TypeError when decode options is not an object', () => {
    const d = new TextDecoder();
    expect(() => d.decode(new Uint8Array([0x61]), 1 as any)).toThrow(TypeError);
  });
});

describe('NitroTextDecoder - streaming decode', () => {
  it('re-assembles a split multi-byte character across chunks', () => {
    const d = new TextDecoder();
    // U+4F60 你 — UTF-8: E4 BD A0
    expect(d.decode(new Uint8Array([0xe4]), { stream: true })).toBe('');
    expect(d.decode(new Uint8Array([0xbd, 0xa0]), { stream: true })).toBe('你');
    expect(d.decode(undefined, { stream: false })).toBe('');
  });

  it('flush completes pending bytes when stream ends', () => {
    const d = new TextDecoder();
    d.decode(new Uint8Array([0xe4, 0xbd]), { stream: true });
    expect(d.decode(new Uint8Array([0xa0]), { stream: false })).toBe('你');
  });
});
