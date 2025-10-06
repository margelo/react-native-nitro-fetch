import { expect } from 'chai';
import { test } from '../utils';
import { TextDecoder } from 'react-native-nitro-fetch';

const SUITE = 'TextDecoder';

// https://github.com/inexorabletash/text-encoding/blob/3f330964c0e97e1ed344c2a3e963f4598610a7ad/test/test-misc.js#L34C1-L47C18
test(SUITE, `has expected attributes`, () => {
  expect('encoding' in new TextEncoder()).to.equal(true);
  expect(new TextEncoder().encoding).to.equal('utf-8');

  expect('encoding' in new TextDecoder()).to.equal(true);

  expect(new TextDecoder().encoding).to.equal('utf-8');
  expect(new TextDecoder('utf-8').encoding).to.equal('utf-8');

  expect('fatal' in new TextDecoder()).to.equal(true);
  expect(new TextDecoder('utf-8').fatal).to.equal(false);
  expect(new TextDecoder('utf-8', { fatal: true }).fatal).to.equal(true);

  expect('ignoreBOM' in new TextDecoder()).to.equal(true);
  expect(new TextDecoder('utf-8').ignoreBOM).to.equal(false);
  expect(new TextDecoder('utf-8', { ignoreBOM: true }).ignoreBOM).to.equal(
    true
  );
});

// // https://github.com/inexorabletash/text-encoding/blob/3f330964c0e97e1ed344c2a3e963f4598610a7ad/test/test-misc.js#L49C1-L64C16
test(SUITE, `handles bad data`, () => {
  [
    { input: '\ud800', expected: '\ufffd' }, // Surrogate half
    { input: '\udc00', expected: '\ufffd' }, // Surrogate half
    { input: 'abc\ud800def', expected: 'abc\ufffddef' }, // Surrogate half
    { input: 'abc\udc00def', expected: 'abc\ufffddef' }, // Surrogate half
    { input: '\udc00\ud800', expected: '\ufffd\ufffd' }, // Wrong order
  ].forEach(({ input, expected }) => {
    const encoded = new TextEncoder().encode(input);
    const decoded = new TextDecoder().decode(encoded);
    expect(expected).to.equal(decoded);
  });
});

// https://github.com/inexorabletash/text-encoding/blob/3f330964c0e97e1ed344c2a3e963f4598610a7ad/test/test-misc.js#L66C1-L91C18
const bad = [
  { encoding: 'utf-8', input: [0xc0] }, // ends early
  { encoding: 'utf-8', input: [0xc0, 0x00] }, // invalid trail
  { encoding: 'utf-8', input: [0xc0, 0xc0] }, // invalid trail
  { encoding: 'utf-8', input: [0xe0] }, // ends early
  { encoding: 'utf-8', input: [0xe0, 0x00] }, // invalid trail
  { encoding: 'utf-8', input: [0xe0, 0xc0] }, // invalid trail
  { encoding: 'utf-8', input: [0xe0, 0x80, 0x00] }, // invalid trail
  { encoding: 'utf-8', input: [0xe0, 0x80, 0xc0] }, // invalid trail
  { encoding: 'utf-8', input: [0xfc, 0x80, 0x80, 0x80, 0x80, 0x80] }, // > 0x10FFFF
];

bad.forEach((t) => {
  test(
    SUITE,
    `should throw a TypeError for encoding ${t.encoding} and input ${t.input}`,
    () => {
      expect(() => {
        const x = new TextDecoder(t.encoding, { fatal: true }).decode(
          new Uint8Array(t.input)
        );
        console.log(x);
      }).to.throw(TypeError);
    }
  );
});

// https://github.com/inexorabletash/text-encoding/blob/3f330964c0e97e1ed344c2a3e963f4598610a7ad/test/test-misc.js#L93C1-L108C43
test(SUITE, 'Encoding names are case insensitive', () => {
  const encodings = [{ label: 'utf-8', encoding: 'utf-8' }];

  encodings.forEach((testCase) => {
    expect(new TextDecoder(testCase.label.toLowerCase()).encoding).to.equal(
      testCase.encoding
    );
    expect(new TextDecoder(testCase.label.toUpperCase()).encoding).to.equal(
      testCase.encoding
    );
  });
});

// https://github.com/inexorabletash/text-encoding/blob/3f330964c0e97e1ed344c2a3e963f4598610a7ad/test/test-misc.js#L110C1-L163C24
test(SUITE, 'Byte-order marks', () => {
  const utf8Bom = [0xef, 0xbb, 0xbf];
  const utf8 = [
    0x7a, 0xc2, 0xa2, 0xe6, 0xb0, 0xb4, 0xf0, 0x9d, 0x84, 0x9e, 0xf4, 0x8f,
    0xbf, 0xbd,
  ];

  const utf16leBom = [0xff, 0xfe];

  const utf16beBom = [0xfe, 0xff];

  const string = 'z\xA2\u6C34\uD834\uDD1E\uDBFF\uDFFD'; // z, cent, CJK water, G-Clef, Private-use character

  // missing BOMs
  expect(new TextDecoder('utf-8').decode(new Uint8Array(utf8))).to.equal(
    string
  );

  // matching BOMs
  expect(
    new TextDecoder('utf-8').decode(new Uint8Array([...utf8Bom, ...utf8]))
  ).to.equal(string);

  // mismatching BOMs
  expect(
    new TextDecoder('utf-8').decode(new Uint8Array([...utf16leBom, ...utf8]))
  ).not.to.equal(string);
  expect(
    new TextDecoder('utf-8').decode(new Uint8Array([...utf16beBom, ...utf8]))
  ).not.to.equal(string);

  // ignore BOMs
  expect(
    new TextDecoder('utf-8', { ignoreBOM: true }).decode(
      new Uint8Array([...utf8Bom, ...utf8])
    )
  ).to.equal('\uFEFF' + string);
});

// https://github.com/inexorabletash/text-encoding/blob/3f330964c0e97e1ed344c2a3e963f4598610a7ad/test/test-misc.js#L165
test(SUITE, 'should return canonical case for utf-8', () => {
  expect(new TextDecoder('utf-8').encoding).to.equal('utf-8');
});

// https://github.com/inexorabletash/text-encoding/blob/3f330964c0e97e1ed344c2a3e963f4598610a7ad/test/test-misc.js#L173
const string =
  '\x00123ABCabc\x80\xFF\u0100\u1000\uFFFD\uD800\uDC00\uDBFF\uDFFF';
const cases = [
  {
    encoding: 'utf-8',
    encoded: [
      0, 49, 50, 51, 65, 66, 67, 97, 98, 99, 194, 128, 195, 191, 196, 128, 225,
      128, 128, 239, 191, 189, 240, 144, 128, 128, 244, 143, 191, 191,
    ],
  },
];

cases.forEach((c) => {
  test(SUITE, `should correctly stream decode ${c.encoding}`, () => {
    for (let len = 1; len <= 5; ++len) {
      let out = '';
      const decoder = new TextDecoder(c.encoding);
      for (let i = 0; i < c.encoded.length; i += len) {
        const sub = c.encoded.slice(i, i + len);
        out += decoder.decode(new Uint8Array(sub), { stream: true });
      }
      out += decoder.decode();
      expect(out).to.equal(string);
    }
  });
});

// https://github.com/inexorabletash/text-encoding/blob/3f330964c0e97e1ed344c2a3e963f4598610a7ad/test/test-misc.js#L218
test(SUITE, 'Supersets of ASCII decode ASCII correctly', () => {
  let asciiString = '';
  for (let i = 0; i < 128; ++i) {
    asciiString += String.fromCharCode(i);
  }
  const ascii_encoded = new TextEncoder().encode(asciiString);
  expect(new TextDecoder('utf-8').decode(ascii_encoded)).to.equal(asciiString);
});

// https://github.com/inexorabletash/text-encoding/blob/3f330964c0e97e1ed344c2a3e963f4598610a7ad/test/test-misc.js#L236
test(SUITE, 'Non-fatal errors at EOF', () => {
  expect(() =>
    new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array([0xff]))
  ).to.throw(TypeError);
  new TextDecoder('utf-8').decode(new Uint8Array([0xff]));
});

// https://github.com/inexorabletash/text-encoding/blob/3f330964c0e97e1ed344c2a3e963f4598610a7ad/test/test-misc.js#L257
test(SUITE, 'Replacement encoding labels', () => {
  const replacementEncodings = [
    'csiso2022kr',
    'hz-gb-2312',
    'iso-2022-cn',
    'iso-2022-cn-ext',
    'iso-2022-kr',
  ];

  replacementEncodings.forEach((encoding) => {
    expect(
      new TextEncoder(
        // @ts-expect-error
        encoding
      ).encoding
    ).to.equal('utf-8');

    expect(() => new TextDecoder(encoding, { fatal: true })).to.throw(
      RangeError
    );

    expect(() => new TextDecoder(encoding, { fatal: false })).to.throw(
      RangeError
    );
  });
});

// https://github.com/inexorabletash/text-encoding/blob/3f330964c0e97e1ed344c2a3e963f4598610a7ad/test/test-misc.js#L280
test(SUITE, 'ArrayBuffer, ArrayBufferView and buffer offsets', () => {
  const decoder = new TextDecoder();
  const bytes = [
    65, 66, 97, 98, 99, 100, 101, 102, 103, 104, 67, 68, 69, 70, 71, 72,
  ];
  const chars = 'ABabcdefghCDEFGH';
  const buffer = new Uint8Array(bytes).buffer;

  expect(decoder.decode(buffer)).to.equal(chars);

  const types = [
    'Uint8Array',
    'Int8Array',
    'Uint8ClampedArray',
    'Uint16Array',
    'Int16Array',
    'Uint32Array',
    'Int32Array',
    'Float32Array',
    'Float64Array',
  ];

  types.forEach((typeName) => {
    const TypeConstructor = (globalThis as any)[typeName];
    const array = new TypeConstructor(buffer);

    expect(decoder.decode(array)).to.equal(chars);

    const subset = new TypeConstructor(
      buffer,
      TypeConstructor.BYTES_PER_ELEMENT,
      8 / TypeConstructor.BYTES_PER_ELEMENT
    );
    expect(decoder.decode(subset)).to.equal(
      chars.substring(
        TypeConstructor.BYTES_PER_ELEMENT,
        TypeConstructor.BYTES_PER_ELEMENT + 8
      )
    );
  });
});

// https://github.com/inexorabletash/text-encoding/blob/3f330964c0e97e1ed344c2a3e963f4598610a7ad/test/test-misc.js#L305
test(SUITE, 'Invalid parameters', () => {
  expect(
    () =>
      // @ts-expect-error
      new TextDecoder(null)
  ).to.throw(RangeError);

  expect(
    () =>
      // @ts-expect-error
      new TextDecoder('utf-8', '')
  ).to.throw(TypeError);

  expect(() =>
    // @ts-expect-error
    new TextDecoder('utf-8').decode(null, '')
  ).to.throw(TypeError);
});

// https://github.com/inexorabletash/text-encoding/blob/3f330964c0e97e1ed344c2a3e963f4598610a7ad/test/test-misc.js#L383
test(SUITE, 'encode() called with falsy arguments (polyfill bindings)', () => {
  const encoder = new TextEncoder();
  // @ts-expect-error
  expect([...encoder.encode(false)]).to.deep.equal([102, 97, 108, 115, 101]);
  // @ts-expect-error
  expect([...encoder.encode(0)]).to.deep.equal([48]);
});

// https://github.com/inexorabletash/text-encoding/blob/master/test/test-utf.js
test(SUITE, 'UTF-8 - Encode/Decode - reference sample', () => {
  // z, cent, CJK water, G-Clef, Private-use character
  const sample = 'z\xA2\u6C34\uD834\uDD1E\uDBFF\uDFFD';
  const testCases = [
    {
      encoding: 'utf-8',
      expected: [
        0x7a, 0xc2, 0xa2, 0xe6, 0xb0, 0xb4, 0xf0, 0x9d, 0x84, 0x9e, 0xf4, 0x8f,
        0xbf, 0xbd,
      ],
    },
  ];

  testCases.forEach(function (t) {
    const decoded = new TextDecoder(t.encoding).decode(
      new Uint8Array(t.expected)
    );

    expect(decoded).to.equal(sample);
  });
});

test(
  SUITE,
  'UTF-8 - Encode/Decode - full roundtrip and agreement with encode/decodeURIComponent',
  () => {
    function assertStringEquals(
      actual: string,
      expected: string,
      description: string
    ) {
      // short circuit success case
      if (actual === expected) {
        return;
      }

      // length check
      expect(actual.length).to.equal(expected.length);

      for (let i = 0; i < actual.length; i++) {
        const a = actual.charCodeAt(i);
        const b = expected.charCodeAt(i);
        if (a !== b) {
          throw new Error(
            description +
              ': code unit ' +
              i.toString() +
              ' unequal: ' +
              cpname(a) +
              ' != ' +
              cpname(b)
          );
        }
      }

      // It should be impossible to get here, because the initial
      // comparison failed, so either the length comparison or the
      // codeunit-by-codeunit comparison should also fail.
      throw new Error(description + ': failed to detect string difference');
    }

    // Inspired by:
    // http://ecmanaut.blogspot.com/2006/07/encoding-decoding-utf8-in-javascript.html
    function encodeUtf8(str: string) {
      const utf8 = unescape(encodeURIComponent(str));
      const octets = new Uint8Array(utf8.length);
      for (let i = 0; i < utf8.length; i += 1) {
        octets[i] = utf8.charCodeAt(i);
      }
      return octets;
    }

    function decodeUtf8(octets: Uint8Array) {
      const utf8 = String.fromCharCode.apply(null, Array.from(octets));
      return decodeURIComponent(escape(utf8));
    }

    // Helpers for test_utf_roundtrip.
    function cpname(n: number) {
      if (n + 0 !== n) return n.toString();
      const w = n <= 0xffff ? 4 : 6;
      return 'U+' + ('000000' + n.toString(16).toUpperCase()).slice(-w);
    }

    function genblock(from: number, len: number, skip: number) {
      const block = [];
      for (let i = 0; i < len; i += skip) {
        let cp = from + i;
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        if (cp < 0x10000) {
          block.push(String.fromCharCode(cp));
          continue;
        }
        cp = cp - 0x10000;
        // eslint-disable-next-line no-bitwise
        block.push(String.fromCharCode(0xd800 + (cp >> 10)));
        // eslint-disable-next-line no-bitwise
        block.push(String.fromCharCode(0xdc00 + (cp & 0x3ff)));
      }
      return block.join('');
    }

    const MIN_CODEPOINT = 0;
    const MAX_CODEPOINT = 0x10ffff;
    const BLOCK_SIZE = 0x1000;
    const SKIP_SIZE = 31;

    const TE_U8 = new TextEncoder();
    const TD_U8 = new TextDecoder('UTF-8');

    for (let i = MIN_CODEPOINT; i < MAX_CODEPOINT; i += BLOCK_SIZE) {
      const block_tag = cpname(i) + ' - ' + cpname(i + BLOCK_SIZE - 1);
      const block = genblock(i, BLOCK_SIZE, SKIP_SIZE);

      // test UTF-8 encodings against themselves

      const encoded = TE_U8.encode(block);
      const decoded = TD_U8.decode(encoded);
      assertStringEquals(block, decoded, 'UTF-8 round trip ' + block_tag);

      // test TextEncoder(UTF-8) against the older idiom
      const expEncoded = encodeUtf8(block);

      expect(encoded.length).to.equal(expEncoded.length);
      // assert_array_equals(encoded, expEncoded, 'UTF-8 reference encoding ' + block_tag);

      const expDecoded = decodeUtf8(expEncoded);
      assertStringEquals(
        decoded,
        expDecoded,
        'UTF-8 reference decoding ' + block_tag
      );
    }
  }
);
