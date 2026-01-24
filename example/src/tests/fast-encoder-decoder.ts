/**
 * Tests for react-native-fast-encoder TextDecoder
 * Running the same tests to compare spec compliance
 */
import { expect } from 'chai';
import { test } from '../utils';
import FastTextEncoder from 'react-native-fast-encoder';

// FastTextEncoder exports TextDecoder as the default export
const TextDecoder = FastTextEncoder;

const SUITE = 'FastEncoder Streaming';

test(SUITE, 'Invalid 0xC1 with stream', () => {
  const decoder = new TextDecoder();
  const result = decoder.decode(new Uint8Array([0xc1]), {
    stream: true,
  });
  expect(result).to.equal('\uFFFD');
});

test(SUITE, 'Empty decode after stream', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xc1]), { stream: true });
  const result = decoder.decode();
  expect(result).to.equal('');
});

test(SUITE, 'Invalid 0xF5 with stream', () => {
  const decoder = new TextDecoder();
  const result = decoder.decode(new Uint8Array([0xf5]), {
    stream: true,
  });
  expect(result).to.equal('\uFFFD');
});

test(SUITE, 'Empty decode after invalid 0xF5', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xf5]), { stream: true });
  const result = decoder.decode();
  expect(result).to.equal('');
});

test(SUITE, 'Invalid 0xE0 0x41 with stream', () => {
  const decoder = new TextDecoder();
  const result = decoder.decode(new Uint8Array([0xe0, 0x41]), {
    stream: true,
  });
  expect(result).to.equal('\uFFFDA');
});

test(SUITE, 'Decode 0x42 (B) after invalid sequence', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xe0, 0x41]), { stream: true });
  const result = decoder.decode(new Uint8Array([0x42]));
  expect(result).to.equal('B');
});

test(SUITE, 'First 3 bytes of emoji - should buffer', () => {
  const decoder = new TextDecoder();
  const result = decoder.decode(new Uint8Array([0xf0, 0x9f, 0x92]), {
    stream: true,
  });
  expect(result).to.equal('');
  expect(result.length).to.equal(0);
});

test(SUITE, 'Complete emoji after buffering', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xf0, 0x9f, 0x92]), {
    stream: true,
  });
  const result = decoder.decode(new Uint8Array([0xa9]));
  expect(result).to.equal('\u{1F4A9}'); // 💩
});

test(SUITE, '2-byte UTF-8 character split - buffer first byte', () => {
  const decoder = new TextDecoder();
  const s1 = decoder.decode(new Uint8Array([0xc3]), { stream: true });
  expect(s1.length).to.equal(0);
});

test(SUITE, '2-byte UTF-8 character split - complete character', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xc3]), { stream: true });
  const s2 = decoder.decode(new Uint8Array([0xa9]), { stream: false });
  expect(s2).to.equal('é');
});

test(SUITE, '3-byte UTF-8 character split - complete character', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xe2]), { stream: true });
  decoder.decode(new Uint8Array([0x82]), { stream: true });
  const t3 = decoder.decode(new Uint8Array([0xac]), { stream: false });
  expect(t3).to.equal('€');
});

test(SUITE, 'Split emoji with stream: true - complete emoji', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([240, 159]), { stream: true });
  const part2 = decoder.decode(new Uint8Array([152, 128]), {
    stream: false,
  });
  expect(part2).to.equal('😀');
});

test(SUITE, 'Byte-by-byte streaming - full string with emojis', () => {
  const decoder = new TextDecoder();
  let result = '';
  const bytes = new Uint8Array([
    72, 101, 108, 108, 111, 240, 159, 152, 128, 87, 111, 114, 108, 100, 240,
    159, 152, 129, 33,
  ]);
  for (let i = 0; i < bytes.length; i++) {
    const isLast = i === bytes.length - 1;
    result += decoder.decode(new Uint8Array([bytes[i]!]), {
      stream: !isLast,
    });
  }
  expect(result).to.equal('Hello😀World😁!');
});

test(SUITE, 'Large JSON with random chunk boundaries', () => {
  const jsonString = JSON.stringify({
    users: Array.from({ length: 50 }, (_, i) => ({
      id: i,
      name: `User ${i} test`,
      email: `user${i}@example.com`,
    })),
  });

  const encoder = new TextEncoder();
  const fullBytes = encoder.encode(jsonString);

  const chunkSizes = [7, 16, 37, 128];

  for (const chunkSize of chunkSizes) {
    const decoder = new TextDecoder();
    let result = '';

    for (let i = 0; i < fullBytes.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, fullBytes.length);
      const chunk = fullBytes.slice(i, end);
      const isLast = end >= fullBytes.length;

      result += decoder.decode(chunk, { stream: !isLast });
    }

    expect(result).to.equal(jsonString, `Failed with chunk size ${chunkSize}`);
  }
});

test(SUITE, 'Split at every byte position in multi-byte sequence', () => {
  const testString = 'Hello World test';
  const encoder = new TextEncoder();
  const bytes = encoder.encode(testString);

  for (let splitPoint = 1; splitPoint < bytes.length; splitPoint++) {
    const decoder = new TextDecoder();

    const part1 = bytes.slice(0, splitPoint);
    const part2 = bytes.slice(splitPoint);

    const result1 = decoder.decode(part1, { stream: true });
    const result2 = decoder.decode(part2, { stream: false });
    const combined = result1 + result2;

    expect(combined).to.equal(
      testString,
      `Failed when splitting at byte ${splitPoint}/${bytes.length}`
    );
  }
});

test(SUITE, 'Multiple multi-byte characters split across chunks', () => {
  const decoder = new TextDecoder();

  const encoder = new TextEncoder();
  const fullBytes = encoder.encode('cafe test');

  const chunkSize = 2;
  let result = '';

  for (let i = 0; i < fullBytes.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, fullBytes.length);
    const chunk = fullBytes.slice(i, end);
    const isLast = end >= fullBytes.length;

    result += decoder.decode(chunk, { stream: !isLast });
  }

  expect(result).to.equal('cafe test');
});

test(SUITE, 'Non-fatal invalid bytes', () => {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const nonfatal = decoder.decode(new Uint8Array([0xff, 65]), {
    stream: false,
  });
  expect(nonfatal).to.equal('\uFFFDA');
});

test(SUITE, 'Fatal flag with invalid bytes - should throw', () => {
  expect(() => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    decoder.decode(new Uint8Array([0xff, 65]), { stream: false });
  }).to.throw(Error);
});

// ============================================================================
// Split Multi-byte Character Tests
// ============================================================================

const SPLIT_SUITE = 'FastEncoder Split Multi-byte';

test(SPLIT_SUITE, '2-byte UTF-8 split across chunks', () => {
  const decoder = new TextDecoder();

  const chunk1 = decoder.decode(new Uint8Array([0xc3]), { stream: true });
  const chunk2 = decoder.decode(new Uint8Array([0xa9]), { stream: false });

  expect(chunk1).to.equal('');
  expect(chunk2).to.equal('é');
});

test(SPLIT_SUITE, '3-byte UTF-8 split across chunks (1+2 bytes)', () => {
  const decoder = new TextDecoder();

  const chunk1 = decoder.decode(new Uint8Array([0xe2]), { stream: true });
  const chunk2 = decoder.decode(new Uint8Array([0x82, 0xac]), {
    stream: false,
  });

  expect(chunk1).to.equal('');
  expect(chunk2).to.equal('€');
});

test(SPLIT_SUITE, '4-byte UTF-8 emoji split across chunks (1+3 bytes)', () => {
  const decoder = new TextDecoder();

  const chunk1 = decoder.decode(new Uint8Array([0xf0]), { stream: true });
  const chunk2 = decoder.decode(new Uint8Array([0x9f, 0x98, 0x80]), {
    stream: false,
  });

  expect(chunk1).to.equal('');
  expect(chunk2).to.equal('😀');
});

test(SPLIT_SUITE, '4-byte UTF-8 emoji split across chunks (2+2 bytes)', () => {
  const decoder = new TextDecoder();

  const chunk1 = decoder.decode(new Uint8Array([0xf0, 0x9f]), {
    stream: true,
  });
  const chunk2 = decoder.decode(new Uint8Array([0x98, 0x80]), {
    stream: false,
  });

  expect(chunk1).to.equal('');
  expect(chunk2).to.equal('😀');
});

test(SPLIT_SUITE, '4-byte UTF-8 emoji split across chunks (3+1 bytes)', () => {
  const decoder = new TextDecoder();

  const chunk1 = decoder.decode(new Uint8Array([0xf0, 0x9f, 0x98]), {
    stream: true,
  });
  const chunk2 = decoder.decode(new Uint8Array([0x80]), { stream: false });

  expect(chunk1).to.equal('');
  expect(chunk2).to.equal('😀');
});

test(SPLIT_SUITE, 'Stress test: random split points', () => {
  const text = 'Hello World test string with ASCII only';
  const encoder = new TextEncoder();
  const fullBytes = encoder.encode(text);

  for (let splitPoint = 1; splitPoint < fullBytes.length - 1; splitPoint++) {
    const decoder = new TextDecoder();

    const chunk1 = decoder.decode(fullBytes.slice(0, splitPoint), {
      stream: true,
    });
    const chunk2 = decoder.decode(fullBytes.slice(splitPoint), {
      stream: false,
    });

    const result = chunk1 + chunk2;

    if (result !== text) {
      throw new Error(
        `Split at byte ${splitPoint} failed!\nExpected: ${text}\nGot: ${result}`
      );
    }
  }
});
