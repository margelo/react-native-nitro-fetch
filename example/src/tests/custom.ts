import { expect } from 'chai';
import { test } from '../utils';
import { TextDecoder } from 'react-native-nitro-fetch';

const SUITE = 'TextDecoder Streaming';

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

test(SUITE, 'Overlong 0xE0 0x80 with stream', () => {
  const decoder = new TextDecoder();
  const result = decoder.decode(new Uint8Array([0xe0, 0x80]), {
    stream: true,
  });
  expect(result).to.equal('\uFFFD\uFFFD');
});

test(SUITE, 'Continuation byte 0x80', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xe0, 0x80]), { stream: true });
  const result = decoder.decode(new Uint8Array([0x80]));
  expect(result).to.equal('\uFFFD');
});

test(SUITE, 'Surrogate 0xED 0xA0 with stream', () => {
  const decoder = new TextDecoder();
  const result = decoder.decode(new Uint8Array([0xed, 0xa0]), {
    stream: true,
  });
  expect(result).to.equal('\uFFFD\uFFFD');
});

test(SUITE, 'Continuation 0x80 after surrogate', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xed, 0xa0]), { stream: true });
  const result = decoder.decode(new Uint8Array([0x80]));
  expect(result).to.equal('\uFFFD');
});

test(SUITE, 'Invalid 0xF0 0x41 with stream', () => {
  const decoder = new TextDecoder();
  const result = decoder.decode(new Uint8Array([0xf0, 0x41]), {
    stream: true,
  });
  expect(result).to.equal('\uFFFDA');
});

test(SUITE, '0x42 (B) after invalid 0xF0 sequence', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xf0, 0x41]), { stream: true });
  const result = decoder.decode(new Uint8Array([0x42]), {
    stream: true,
  });
  expect(result).to.equal('B');
});

test(SUITE, '0x43 (C) final decode', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xf0, 0x41]), { stream: true });
  decoder.decode(new Uint8Array([0x42]), { stream: true });
  const result = decoder.decode(new Uint8Array([0x43]));
  expect(result).to.equal('C');
});

test(SUITE, 'Overlong 0xF0 0x80 with stream', () => {
  const decoder = new TextDecoder();
  const result = decoder.decode(new Uint8Array([0xf0, 0x80]), {
    stream: true,
  });
  expect(result).to.equal('\uFFFD\uFFFD');
});

test(SUITE, 'Continuation 0x80 after overlong F0', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xf0, 0x80]), { stream: true });
  const result = decoder.decode(new Uint8Array([0x80]), {
    stream: true,
  });
  expect(result).to.equal('\uFFFD');
});

test(SUITE, 'Final continuation 0x80', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xf0, 0x80]), { stream: true });
  decoder.decode(new Uint8Array([0x80]), { stream: true });
  const result = decoder.decode(new Uint8Array([0x80]));
  expect(result).to.equal('\uFFFD');
});

test(SUITE, 'Beyond max 0xF4 0xA0 with stream', () => {
  const decoder = new TextDecoder();
  const result = decoder.decode(new Uint8Array([0xf4, 0xa0]), {
    stream: true,
  });
  expect(result).to.equal('\uFFFD\uFFFD');
});

test(SUITE, 'Continuation 0x80 after beyond max', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xf4, 0xa0]), { stream: true });
  const result = decoder.decode(new Uint8Array([0x80]), {
    stream: true,
  });
  expect(result).to.equal('\uFFFD');
});

test(SUITE, 'Final continuation after beyond max', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xf4, 0xa0]), { stream: true });
  decoder.decode(new Uint8Array([0x80]), { stream: true });
  const result = decoder.decode(new Uint8Array([0x80]));
  expect(result).to.equal('\uFFFD');
});

test(SUITE, 'Incomplete 4-byte + 0x41 with stream', () => {
  const decoder = new TextDecoder();
  const result = decoder.decode(new Uint8Array([0xf0, 0x90, 0x41]), {
    stream: true,
  });
  expect(result).to.equal('\uFFFDA');
});

test(SUITE, '0x42 (B) after incomplete 4-byte', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xf0, 0x90, 0x41]), {
    stream: true,
  });
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

test(SUITE, 'Complete emoji 💩 after buffering', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xf0, 0x9f, 0x92]), {
    stream: true,
  });
  const result = decoder.decode(new Uint8Array([0xa9]));
  expect(result).to.equal('💩');
});

test(SUITE, 'Multiple incomplete sequences - Hello + buffered emoji', () => {
  const decoder = new TextDecoder();
  const chunk1 = decoder.decode(
    new Uint8Array([72, 101, 108, 108, 111, 240, 159]),
    { stream: true }
  );
  expect(chunk1).to.equal('Hello');
});

test(
  SUITE,
  'Multiple incomplete sequences - complete first emoji + World + buffer',
  () => {
    const decoder = new TextDecoder();
    decoder.decode(new Uint8Array([72, 101, 108, 108, 111, 240, 159]), {
      stream: true,
    });
    const chunk2 = decoder.decode(
      new Uint8Array([152, 128, 87, 111, 114, 108, 100, 240]),
      { stream: true }
    );
    expect(chunk2).to.equal('😀World');
  }
);

test(SUITE, 'Multiple incomplete sequences - complete second emoji', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([72, 101, 108, 108, 111, 240, 159]), {
    stream: true,
  });
  decoder.decode(new Uint8Array([152, 128, 87, 111, 114, 108, 100, 240]), {
    stream: true,
  });
  const chunk3 = decoder.decode(new Uint8Array([159, 152, 129]), {
    stream: false,
  });
  expect(chunk3).to.equal('😁');
});

test(SUITE, 'Empty final chunk - flush buffered incomplete data', () => {
  const decoder = new TextDecoder();
  const p1 = decoder.decode(new Uint8Array([240, 159]), {
    stream: true,
  });
  expect(p1.length).to.equal(0);

  const p2 = decoder.decode(new Uint8Array([]), { stream: false });
  expect(p2).to.equal('\uFFFD');
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

test(SUITE, '3-byte UTF-8 character split - buffer first byte', () => {
  const decoder = new TextDecoder();
  const t1 = decoder.decode(new Uint8Array([0xe2]), { stream: true });
  expect(t1.length).to.equal(0);
});

test(SUITE, '3-byte UTF-8 character split - buffer second byte', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xe2]), { stream: true });
  const t2 = decoder.decode(new Uint8Array([0x82]), { stream: true });
  expect(t2.length).to.equal(0);
});

test(SUITE, '3-byte UTF-8 character split - complete character €', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xe2]), { stream: true });
  decoder.decode(new Uint8Array([0x82]), { stream: true });
  const t3 = decoder.decode(new Uint8Array([0xac]), { stream: false });
  expect(t3).to.equal('€');
});

test(SUITE, 'Invalid UTF-8 with stream: true', () => {
  const decoder = new TextDecoder();
  const invalid1 = decoder.decode(new Uint8Array([0xff]), {
    stream: true,
  });
  expect(invalid1).to.equal('\uFFFD');
});

test(SUITE, 'Valid byte after invalid UTF-8', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([0xff]), { stream: true });
  const after = decoder.decode(new Uint8Array([65]), { stream: false });
  expect(after).to.equal('A');
});

test(SUITE, 'Stream reset behavior - buffer incomplete emoji', () => {
  const decoder = new TextDecoder();
  const r1 = decoder.decode(new Uint8Array([240, 159]), {
    stream: true,
  });
  expect(r1.length).to.equal(0);
});

test(SUITE, 'Stream reset behavior - flush buffer and decode new data', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([240, 159]), { stream: true });
  const r2 = decoder.decode(new Uint8Array([65, 66, 67]), {
    stream: false,
  });
  // When stream: false, buffered incomplete data becomes replacement chars, then ABC
  expect(r2).to.include('\uFFFD');
  expect(r2).to.include('ABC');
});

test(SUITE, 'Multiple stream: false calls - first incomplete', () => {
  const decoder = new TextDecoder();
  const m1 = decoder.decode(new Uint8Array([240, 159]), {
    stream: false,
  });
  expect(m1).to.equal('\uFFFD');
});

test(
  SUITE,
  'Multiple stream: false calls - second incomplete (state reset)',
  () => {
    const decoder = new TextDecoder();
    decoder.decode(new Uint8Array([240, 159]), { stream: false });
    const m2 = decoder.decode(new Uint8Array([152, 128]), {
      stream: false,
    });
    expect(m2).to.equal('\uFFFD\uFFFD');
  }
);

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

test(SUITE, 'Split emoji with stream: true - first chunk', () => {
  const decoder = new TextDecoder();
  const part1 = decoder.decode(new Uint8Array([240, 159]), {
    stream: true,
  });
  expect(part1.length).to.equal(0);
});

test(SUITE, 'Split emoji with stream: true - complete emoji', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([240, 159]), { stream: true });
  const part2 = decoder.decode(new Uint8Array([152, 128]), {
    stream: false,
  });
  expect(part2).to.equal('😀');
});

test(SUITE, 'Split emoji without stream - first chunk as replacement', () => {
  const decoder = new TextDecoder();
  const broken1 = decoder.decode(new Uint8Array([240, 159]), {
    stream: false,
  });
  expect(broken1).to.equal('\uFFFD');
});

test(SUITE, 'Split emoji without stream - second chunk as replacements', () => {
  const decoder = new TextDecoder();
  decoder.decode(new Uint8Array([240, 159]), { stream: false });
  const broken2 = decoder.decode(new Uint8Array([152, 128]), {
    stream: false,
  });
  expect(broken2).to.equal('\uFFFD\uFFFD');
});

// ===== ADVANCED STREAMING TESTS FOR REAL-WORLD SCENARIOS =====

const SUITE_STREAMING = 'TextDecoder Advanced Streaming';

test(SUITE_STREAMING, 'Large JSON with random chunk boundaries', () => {
  // Simulate a real JSON response with various UTF-8 characters
  const jsonString = JSON.stringify({
    users: Array.from({ length: 100 }, (_, i) => ({
      id: i,
      name: `User ${i} 测试 🎉`,
      email: `user${i}@example.com`,
      description: '日本語 Ελληνικά العربية',
    })),
  });

  const encoder = new TextEncoder();
  const fullBytes = encoder.encode(jsonString);

  // Test with various chunk sizes
  const chunkSizes = [1, 7, 16, 37, 128, 1024];

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

    // Verify JSON is valid
    const parsed = JSON.parse(result);
    expect(parsed.users).to.have.length(100);
  }
});

test(
  SUITE_STREAMING,
  'Split at every possible byte position in multi-byte sequence',
  () => {
    // Test string with various multi-byte characters
    const testString = 'Hello 世界 🌍 café αβγ';
    const encoder = new TextEncoder();
    const bytes = encoder.encode(testString);

    // Test splitting at EVERY single byte position
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
  }
);

test(SUITE_STREAMING, 'NDJSON streaming with chunk boundaries mid-line', () => {
  // Simulate NDJSON (newline-delimited JSON) like the server example
  const lines = [
    '{"type":"metadata","count":1000,"timestamp":"2024-01-01"}',
    '{"type":"data","id":1,"name":"Test 测试","value":"データ 🎯"}',
    '{"type":"data","id":2,"name":"Entry αβγδ","value":"Ελληνικά 🌟"}',
    '{"type":"data","id":3,"name":"Test العربية","value":"مرحبا 🎨"}',
  ];

  const ndjson = lines.join('\n') + '\n';
  const encoder = new TextEncoder();
  const fullBytes = encoder.encode(ndjson);

  // Test with random chunk sizes that will definitely split lines and multi-byte chars
  const chunkSizes = [1, 5, 11, 23, 47];

  for (const chunkSize of chunkSizes) {
    const decoder = new TextDecoder();
    let result = '';

    for (let i = 0; i < fullBytes.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, fullBytes.length);
      const chunk = fullBytes.slice(i, end);
      const isLast = end >= fullBytes.length;

      result += decoder.decode(chunk, { stream: !isLast });
    }

    expect(result).to.equal(ndjson, `Failed with chunk size ${chunkSize}`);

    // Verify each line is valid JSON
    const parsedLines = result
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    expect(parsedLines).to.have.length(lines.length);
  }
});

test(
  SUITE_STREAMING,
  'Chunk boundary exactly at multi-byte character boundaries',
  () => {
    const decoder = new TextDecoder();

    // "Hello" (5 bytes) + "世" (3 bytes) + "界" (3 bytes) = 11 bytes total
    const encoder = new TextEncoder();
    const fullBytes = encoder.encode('Hello世界');

    // Split exactly at character boundaries
    const chunk1 = fullBytes.slice(0, 5); // "Hello"
    const chunk2 = fullBytes.slice(5, 8); // "世"
    const chunk3 = fullBytes.slice(8, 11); // "界"

    const result1 = decoder.decode(chunk1, { stream: true });
    const result2 = decoder.decode(chunk2, { stream: true });
    const result3 = decoder.decode(chunk3, { stream: false });

    expect(result1).to.equal('Hello');
    expect(result2).to.equal('世');
    expect(result3).to.equal('界');
  }
);

test(
  SUITE_STREAMING,
  'Chunk boundary splits 2-byte character (é = 0xC3 0xA9)',
  () => {
    const decoder = new TextDecoder();

    // "café" where é is 2-byte UTF-8: 0xC3 0xA9
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xc3, 0xa9]);

    // Split the é character: "caf" + "é"
    const chunk1 = bytes.slice(0, 4); // "caf" + first byte of é (0xC3)
    const chunk2 = bytes.slice(4, 5); // second byte of é (0xA9)

    const result1 = decoder.decode(chunk1, { stream: true });
    const result2 = decoder.decode(chunk2, { stream: false });

    expect(result1).to.equal('caf');
    expect(result2).to.equal('é');
    expect(result1 + result2).to.equal('café');
  }
);

test(
  SUITE_STREAMING,
  'Chunk boundary splits 3-byte character (€ = 0xE2 0x82 0xAC)',
  () => {
    // "100€" where € is 3-byte UTF-8
    const bytes = new Uint8Array([
      0x31,
      0x30,
      0x30,
      0xe2,
      0x82,
      0xac, // "100€"
    ]);

    // Test split after first byte of €
    {
      const decoder1 = new TextDecoder();
      const chunk1 = bytes.slice(0, 4); // "100" + 0xE2
      const chunk2 = bytes.slice(4, 6); // 0x82 0xAC

      const result1 = decoder1.decode(chunk1, { stream: true });
      const result2 = decoder1.decode(chunk2, { stream: false });

      expect(result1).to.equal('100');
      expect(result2).to.equal('€');
    }

    // Test split after second byte of €
    {
      const decoder2 = new TextDecoder();
      const chunk1 = bytes.slice(0, 5); // "100" + 0xE2 0x82
      const chunk2 = bytes.slice(5, 6); // 0xAC

      const result1 = decoder2.decode(chunk1, { stream: true });
      const result2 = decoder2.decode(chunk2, { stream: false });

      expect(result1).to.equal('100');
      expect(result2).to.equal('€');
    }
  }
);

test(
  SUITE_STREAMING,
  'Chunk boundary splits 4-byte emoji (💩 = 0xF0 0x9F 0x92 0xA9)',
  () => {
    const bytes = new Uint8Array([
      0x48,
      0x69,
      0xf0,
      0x9f,
      0x92,
      0xa9, // "Hi💩"
    ]);

    // Split after first byte
    {
      const decoder = new TextDecoder();
      const chunk1 = bytes.slice(0, 3); // "Hi" + 0xF0
      const chunk2 = bytes.slice(3, 6); // 0x9F 0x92 0xA9

      const result1 = decoder.decode(chunk1, { stream: true });
      const result2 = decoder.decode(chunk2, { stream: false });

      expect(result1).to.equal('Hi');
      expect(result2).to.equal('💩');
    }

    // Split after second byte
    {
      const decoder = new TextDecoder();
      const chunk1 = bytes.slice(0, 4); // "Hi" + 0xF0 0x9F
      const chunk2 = bytes.slice(4, 6); // 0x92 0xA9

      const result1 = decoder.decode(chunk1, { stream: true });
      const result2 = decoder.decode(chunk2, { stream: false });

      expect(result1).to.equal('Hi');
      expect(result2).to.equal('💩');
    }

    // Split after third byte
    {
      const decoder = new TextDecoder();
      const chunk1 = bytes.slice(0, 5); // "Hi" + 0xF0 0x9F 0x92
      const chunk2 = bytes.slice(5, 6); // 0xA9

      const result1 = decoder.decode(chunk1, { stream: true });
      const result2 = decoder.decode(chunk2, { stream: false });

      expect(result1).to.equal('Hi');
      expect(result2).to.equal('💩');
    }
  }
);

test(
  SUITE_STREAMING,
  'Multiple multi-byte characters split across chunks',
  () => {
    const decoder = new TextDecoder();

    // "café 世界 🎉" - mix of 1, 2, 3, and 4-byte characters
    const encoder = new TextEncoder();
    const fullBytes = encoder.encode('café 世界 🎉');

    // Split into very small chunks (2 bytes each) to maximize splitting
    const chunkSize = 2;
    let result = '';

    for (let i = 0; i < fullBytes.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, fullBytes.length);
      const chunk = fullBytes.slice(i, end);
      const isLast = end >= fullBytes.length;

      result += decoder.decode(chunk, { stream: !isLast });
    }

    expect(result).to.equal('café 世界 🎉');
  }
);

test(SUITE_STREAMING, 'Very long string with random splits', () => {
  // Create a long string with diverse characters
  const longString = 'Lorem ipsum 中文 🎉 café αβγ العربية '.repeat(100);

  const encoder = new TextEncoder();
  const fullBytes = encoder.encode(longString);

  // Test with pseudo-random chunk sizes
  const decoder = new TextDecoder();
  let result = '';
  let pos = 0;

  while (pos < fullBytes.length) {
    // Pseudo-random chunk size between 1 and 50
    const chunkSize = ((pos * 7) % 47) + 1;
    const end = Math.min(pos + chunkSize, fullBytes.length);
    const chunk = fullBytes.slice(pos, end);
    const isLast = end >= fullBytes.length;

    result += decoder.decode(chunk, { stream: !isLast });
    pos = end;
  }

  expect(result).to.equal(longString);
  expect(result.length).to.equal(longString.length);
});

test(
  SUITE_STREAMING,
  'Alternating single-byte and multi-byte characters',
  () => {
    const decoder = new TextDecoder();

    // "a世b界c🎉d"
    const encoder = new TextEncoder();
    const bytes = encoder.encode('a世b界c🎉d');

    // Stream byte by byte
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
      const isLast = i === bytes.length - 1;
      const byte = bytes[i];
      if (byte !== undefined) {
        result += decoder.decode(new Uint8Array([byte]), {
          stream: !isLast,
        });
      }
    }

    expect(result).to.equal('a世b界c🎉d');
  }
);

test(
  SUITE_STREAMING,
  'Stress test: 1000 chunks with various multi-byte characters',
  () => {
    // Create a long string with many different characters
    const characters = [
      'a',
      'b',
      '1',
      '2',
      'é',
      'ñ',
      '世',
      '界',
      '€',
      '£',
      '🎉',
      '💩',
      '🌍',
      'α',
      'β',
      'γ',
    ];

    let longString = '';
    for (let i = 0; i < 1000; i++) {
      longString += characters[i % characters.length];
    }

    const encoder = new TextEncoder();
    const fullBytes = encoder.encode(longString);

    // Split into random-sized chunks
    const decoder = new TextDecoder();
    let result = '';
    let pos = 0;

    while (pos < fullBytes.length) {
      // Variable chunk size: 1 to 20 bytes
      const chunkSize = ((pos * 13) % 19) + 1;
      const end = Math.min(pos + chunkSize, fullBytes.length);
      const chunk = fullBytes.slice(pos, end);
      const isLast = end >= fullBytes.length;

      result += decoder.decode(chunk, { stream: !isLast });
      pos = end;
    }

    expect(result).to.equal(longString);
    expect(result.length).to.equal(longString.length);
  }
);

test(SUITE_STREAMING, 'Empty chunks between valid chunks', () => {
  const decoder = new TextDecoder();

  const encoder = new TextEncoder();
  const part1 = encoder.encode('Hello ');
  const part2 = encoder.encode('World');

  const result1 = decoder.decode(part1, { stream: true });
  const result2 = decoder.decode(new Uint8Array(), {
    stream: true,
  });
  const result3 = decoder.decode(part2, { stream: false });

  expect(result1 + result2 + result3).to.equal('Hello World');
});

test(
  SUITE_STREAMING,
  'Complex JSON with nested objects and UTF-8 characters',
  () => {
    const complexJson = {
      metadata: {
        timestamp: '2024-01-01T00:00:00Z',
        locale: '日本語',
        version: '1.0.0',
      },
      data: [
        { id: 1, name: 'Test 测试', description: 'Ελληνικά text 🎨' },
        { id: 2, name: 'Entry αβγδ', description: 'العربية مرحبا 🌟' },
        { id: 3, name: 'Item café', description: 'Mixed 世界 🎉 text' },
      ],
      summary: {
        total: 3,
        message: 'Complete ✓',
      },
    };

    const jsonString = JSON.stringify(complexJson);
    const encoder = new TextEncoder();
    const fullBytes = encoder.encode(jsonString);

    // Test with various challenging chunk sizes
    const chunkSizes = [1, 3, 7, 13, 29, 61];

    for (const chunkSize of chunkSizes) {
      const decoder = new TextDecoder();
      let result = '';

      for (let i = 0; i < fullBytes.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, fullBytes.length);
        const chunk = fullBytes.slice(i, end);
        const isLast = end >= fullBytes.length;

        result += decoder.decode(chunk, { stream: !isLast });
      }

      expect(result).to.equal(
        jsonString,
        `Failed with chunk size ${chunkSize}`
      );

      // Verify JSON structure is preserved
      const parsed = JSON.parse(result);
      expect(parsed.data).to.have.length(3);
      expect(parsed.metadata.locale).to.equal('日本語');
    }
  }
);

test(SUITE_STREAMING, 'Decoder state isolation between instances', () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode('Hello世界');

  // Create two decoders
  const decoder1 = new TextDecoder();
  const decoder2 = new TextDecoder();

  // Decode with decoder1
  const chunk1a = bytes.slice(0, 6); // "Hello" + first byte of 世
  const result1a = decoder1.decode(chunk1a, { stream: true });

  // Decode completely different data with decoder2
  const decoder2Bytes = encoder.encode('café');
  const result2 = decoder2.decode(decoder2Bytes, {
    stream: false,
  });

  // Continue with decoder1
  const chunk1b = bytes.slice(6); // rest of "世界"
  const result1b = decoder1.decode(chunk1b, { stream: false });

  expect(result1a + result1b).to.equal('Hello世界');
  expect(result2).to.equal('café');
});

test(
  SUITE_STREAMING,
  'Realistic NDJSON bucket streaming with multi-byte characters',
  () => {
    // Simulate the exact pattern from your server: buckets of records
    const bucket1 = {
      type: 'bucket',
      table: 'activities',
      records: Array.from({ length: 50 }, (_, i) => ({
        id: i,
        name: `Activity ${i} 活动`,
        description: `Description with emoji 🎯 and Greek Ελληνικά`,
      })),
    };

    const bucket2 = {
      type: 'bucket',
      table: 'users',
      records: Array.from({ length: 50 }, (_, i) => ({
        id: i + 100,
        name: `User ${i} 用户 👤`,
        email: `user${i}@example.com`,
      })),
    };

    const ndjson =
      JSON.stringify(bucket1) + '\n' + JSON.stringify(bucket2) + '\n';

    const encoder = new TextEncoder();
    const fullBytes = encoder.encode(ndjson);

    // Test with chunk sizes that will split across JSON boundaries
    const chunkSizes = [50, 100, 500, 1000];

    for (const chunkSize of chunkSizes) {
      const decoder = new TextDecoder();
      let result = '';

      for (let i = 0; i < fullBytes.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, fullBytes.length);
        const chunk = fullBytes.slice(i, end);
        const isLast = end >= fullBytes.length;

        result += decoder.decode(chunk, { stream: !isLast });
      }

      expect(result).to.equal(ndjson, `Failed with chunk size ${chunkSize}`);

      // Verify both JSON objects are valid
      const lines = result
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      expect(lines).to.have.length(2);
      expect(lines[0].records).to.have.length(50);
      expect(lines[1].records).to.have.length(50);
    }
  }
);

test(
  SUITE_STREAMING,
  'ASCII chunk followed by incomplete multi-byte sequence',
  () => {
    // This tests a specific edge case: complete ASCII chunk, then incomplete multi-byte
    const decoder = new TextDecoder();

    // Chunk 1: Pure ASCII (complete valid UTF-8)
    const chunk1 = new Uint8Array([0x41, 0x42, 0x43]); // "ABC"
    const result1 = decoder.decode(chunk1, { stream: true });
    expect(result1).to.equal('ABC');

    // Chunk 2: Incomplete 3-byte character (should be buffered)
    const chunk2 = new Uint8Array([0xe4, 0xb8]); // First 2 bytes of 世
    const result2 = decoder.decode(chunk2, { stream: true });
    expect(result2).to.equal(''); // Should buffer, return empty

    // Chunk 3: Complete the character
    const chunk3 = new Uint8Array([0x96]); // Last byte of 世
    const result3 = decoder.decode(chunk3, { stream: false });
    expect(result3).to.equal('世');

    // Final result
    expect(result1 + result2 + result3).to.equal('ABC世');
  }
);

test(
  SUITE_STREAMING,
  'Interleaved ASCII and multi-byte with stream boundaries',
  () => {
    // Test: A|BC测|试D|EF
    // Where | represents chunk boundaries that split multi-byte chars
    const decoder = new TextDecoder();

    const fullString = 'ABC测试DEF';
    const encoder = new TextEncoder();
    const fullBytes = encoder.encode(fullString);

    // Split at positions that will definitely split the multi-byte characters
    const chunkBoundaries = [1, 4, 10, 13]; // Manually chosen to split 测 and 试

    let result = '';
    let pos = 0;

    for (let i = 0; i < chunkBoundaries.length; i++) {
      const end = chunkBoundaries[i]!;
      const chunk = fullBytes.slice(pos, end);
      const isLast = i === chunkBoundaries.length - 1;

      result += decoder.decode(chunk, { stream: !isLast });
      pos = end;
    }

    // Final chunk
    if (pos < fullBytes.length) {
      result += decoder.decode(fullBytes.slice(pos), { stream: false });
    }

    expect(result).to.equal(fullString);
  }
);

test(SUITE_STREAMING, 'Random byte boundary stress test with JSON', () => {
  // Create a complex JSON with multi-byte characters
  const testData = {
    users: [
      { name: '测试User', city: 'São Paulo', score: 100 },
      { name: 'Tëst', city: 'Москва', score: 200 },
      { name: '用户名', city: 'القاهرة', score: 300 },
    ],
    metadata: { timestamp: '2024-01-01', locale: '日本語' },
  };

  const jsonString = JSON.stringify(testData);
  const encoder = new TextEncoder();
  const fullBytes = encoder.encode(jsonString);

  // Test with many different chunk sizes including primes
  // (primes are more likely to hit weird boundaries)
  const chunkSizes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41];

  for (const chunkSize of chunkSizes) {
    const decoder = new TextDecoder();
    let result = '';

    for (let i = 0; i < fullBytes.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, fullBytes.length);
      const chunk = fullBytes.slice(i, end);
      const isLast = end >= fullBytes.length;

      result += decoder.decode(chunk, { stream: !isLast });
    }

    // Verify exact match
    expect(result).to.equal(
      jsonString,
      `Mismatch with chunk size ${chunkSize}`
    );

    // Verify JSON is parseable and correct
    const parsed = JSON.parse(result);
    expect(parsed.users).to.have.length(3);
    expect(parsed.users[0].name).to.equal('测试User');
    expect(parsed.users[1].city).to.equal('Москва');
    expect(parsed.metadata.locale).to.equal('日本語');
  }
});

test(
  SUITE_STREAMING,
  'Character-by-character decode with byte length verification',
  () => {
    // This test verifies that no bytes are lost during streaming
    const testString = '{"key":"测试","value":123,"name":"NumMaternityDays"}';
    const encoder = new TextEncoder();
    const fullBytes = encoder.encode(testString);

    const decoder = new TextDecoder();
    let result = '';
    let totalBytesProcessed = 0;

    // Process in very small chunks (1-4 bytes randomly)
    let pos = 0;
    while (pos < fullBytes.length) {
      // Random chunk size between 1 and 4 bytes
      const chunkSize = ((pos * 7 + 3) % 4) + 1;
      const end = Math.min(pos + chunkSize, fullBytes.length);
      const chunk = fullBytes.slice(pos, end);
      const isLast = end >= fullBytes.length;

      totalBytesProcessed += chunk.length;

      const decoded = decoder.decode(chunk, { stream: !isLast });
      result += decoded;

      pos = end;
    }

    expect(totalBytesProcessed).to.equal(fullBytes.length);
    expect(result).to.equal(testString);
    expect(result.length).to.equal(testString.length);
  }
);

test(SUITE_STREAMING, 'Exact reproduction of server streaming pattern', () => {
  // Simulate the exact pattern from your error message
  const record1 = {
    ActivityKey: 400000020,
    Code: 'PCA',
    NumMaternityDays: false,
    isUnAuthorizedAbsence: false,
    isMaternityLeave: false,
  };

  const record2 = {
    ActivityKey: 400000021,
    Code: 'PCB',
    NumMaternityDays: false,
    isUnAuthorizedAbsence: false,
  };

  const jsonLine1 = JSON.stringify(record1);
  const jsonLine2 = JSON.stringify(record2);
  const ndjson = jsonLine1 + '\n' + jsonLine2 + '\n';

  const encoder = new TextEncoder();
  const fullBytes = encoder.encode(ndjson);

  // Test with chunk sizes that might split in problematic places
  const testChunkSizes = [16, 32, 50, 64, 100, 128, 256];

  for (const chunkSize of testChunkSizes) {
    const decoder = new TextDecoder();
    let result = '';

    for (let i = 0; i < fullBytes.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, fullBytes.length);
      const chunk = fullBytes.slice(i, end);
      const isLast = end >= fullBytes.length;

      const decoded = decoder.decode(chunk, { stream: !isLast });
      result += decoded;
    }

    expect(result).to.equal(ndjson, `Failed with chunk size ${chunkSize}`);

    // Try to parse each line
    const lines = result
      .split('\n')
      .filter((line) => line.trim())
      .map((line, idx) => {
        try {
          return JSON.parse(line);
        } catch (e) {
          throw new Error(
            `Failed to parse line ${idx} with chunk size ${chunkSize}: "${line.substring(0, 50)}..."`
          );
        }
      });

    expect(lines).to.have.length(2);
    expect(lines[0].Code).to.equal('PCA');
    expect(lines[1].Code).to.equal('PCB');
  }
});

// ============================================================================
// Split Multi-byte Character Edge Cases
// These tests ensure multi-byte UTF-8 characters split across chunk boundaries
// are correctly reassembled during streaming decoding
// ============================================================================

const SPLIT_SUITE = 'TextDecoder Split Multi-byte Characters';

test(SPLIT_SUITE, '2-byte UTF-8 (é) split across chunks', () => {
  const decoder = new TextDecoder();

  // UTF-8 encoding of 'é' (U+00E9) is [0xC3, 0xA9]
  // Split it: first chunk gets 0xC3, second chunk gets 0xA9
  const chunk1 = decoder.decode(new Uint8Array([0xc3]), { stream: true });
  const chunk2 = decoder.decode(new Uint8Array([0xa9]), { stream: false });

  expect(chunk1).to.equal(''); // First chunk is incomplete
  expect(chunk2).to.equal('é'); // Second chunk completes the character
});

test(SPLIT_SUITE, '3-byte UTF-8 (€) split across chunks (1+2 bytes)', () => {
  const decoder = new TextDecoder();

  // UTF-8 encoding of '€' (U+20AC) is [0xE2, 0x82, 0xAC]
  // Split after first byte
  const chunk1 = decoder.decode(new Uint8Array([0xe2]), { stream: true });
  const chunk2 = decoder.decode(new Uint8Array([0x82, 0xac]), {
    stream: false,
  });

  expect(chunk1).to.equal('');
  expect(chunk2).to.equal('€');
});

test(SPLIT_SUITE, '3-byte UTF-8 (€) split across chunks (2+1 bytes)', () => {
  const decoder = new TextDecoder();

  // UTF-8 encoding of '€' (U+20AC) is [0xE2, 0x82, 0xAC]
  // Split after second byte
  const chunk1 = decoder.decode(new Uint8Array([0xe2, 0x82]), { stream: true });
  const chunk2 = decoder.decode(new Uint8Array([0xac]), { stream: false });

  expect(chunk1).to.equal('');
  expect(chunk2).to.equal('€');
});

test(
  SPLIT_SUITE,
  '4-byte UTF-8 emoji (😀) split across chunks (1+3 bytes)',
  () => {
    const decoder = new TextDecoder();

    // UTF-8 encoding of '😀' (U+1F600) is [0xF0, 0x9F, 0x98, 0x80]
    // Split after first byte
    const chunk1 = decoder.decode(new Uint8Array([0xf0]), { stream: true });
    const chunk2 = decoder.decode(new Uint8Array([0x9f, 0x98, 0x80]), {
      stream: false,
    });

    expect(chunk1).to.equal('');
    expect(chunk2).to.equal('😀');
  }
);

test(
  SPLIT_SUITE,
  '4-byte UTF-8 emoji (😀) split across chunks (2+2 bytes)',
  () => {
    const decoder = new TextDecoder();

    // UTF-8 encoding of '😀' (U+1F600) is [0xF0, 0x9F, 0x98, 0x80]
    // Split after second byte
    const chunk1 = decoder.decode(new Uint8Array([0xf0, 0x9f]), {
      stream: true,
    });
    const chunk2 = decoder.decode(new Uint8Array([0x98, 0x80]), {
      stream: false,
    });

    expect(chunk1).to.equal('');
    expect(chunk2).to.equal('😀');
  }
);

test(
  SPLIT_SUITE,
  '4-byte UTF-8 emoji (😀) split across chunks (3+1 bytes)',
  () => {
    const decoder = new TextDecoder();

    // UTF-8 encoding of '😀' (U+1F600) is [0xF0, 0x9F, 0x98, 0x80]
    // Split after third byte
    const chunk1 = decoder.decode(new Uint8Array([0xf0, 0x9f, 0x98]), {
      stream: true,
    });
    const chunk2 = decoder.decode(new Uint8Array([0x80]), { stream: false });

    expect(chunk1).to.equal('');
    expect(chunk2).to.equal('😀');
  }
);

test(SPLIT_SUITE, 'Multiple splits across multiple chunks', () => {
  const decoder = new TextDecoder();

  // Decode "Hello 😀 World €!"
  // 'H' 'e' 'l' 'l' 'o' ' ' [0xF0] | [0x9F] | [0x98, 0x80] ' ' 'W' 'o' 'r' 'l' 'd' ' ' [0xE2] | [0x82, 0xAC] '!'

  const chunk1 = decoder.decode(
    new Uint8Array([72, 101, 108, 108, 111, 32, 0xf0]),
    { stream: true }
  );
  const chunk2 = decoder.decode(new Uint8Array([0x9f]), { stream: true });
  const chunk3 = decoder.decode(
    new Uint8Array([0x98, 0x80, 32, 87, 111, 114, 108, 100, 32, 0xe2]),
    { stream: true }
  );
  const chunk4 = decoder.decode(new Uint8Array([0x82, 0xac, 33]), {
    stream: false,
  });

  const result = chunk1 + chunk2 + chunk3 + chunk4;
  expect(result).to.equal('Hello 😀 World €!');
});

test(SPLIT_SUITE, 'JSON-like data with split UTF-8 in property name', () => {
  const decoder = new TextDecoder();

  // Simulate JSON: {"días":true}
  // "días" contains 'í' (U+00ED) = [0xC3, 0xAD]
  // Split happens in the middle of "días"

  const json1 = '{"d';
  const utf8_i_part1 = new Uint8Array([0xc3]); // First byte of 'í'
  const utf8_i_part2 = new Uint8Array([0xad]); // Second byte of 'í'
  const json2 = 'as":true}';

  // Create the full byte sequence
  const encoder = new TextEncoder();
  const jsonBytes1 = encoder.encode(json1);
  const jsonBytes2 = encoder.encode(json2);

  // Chunk 1: '{"d' + first byte of 'í'
  const chunk1Bytes = new Uint8Array([...jsonBytes1, ...utf8_i_part1]);

  // Chunk 2: second byte of 'í' + 'as":true}'
  const chunk2Bytes = new Uint8Array([...utf8_i_part2, ...jsonBytes2]);

  const chunk1 = decoder.decode(chunk1Bytes, { stream: true });
  const chunk2 = decoder.decode(chunk2Bytes, { stream: false });

  const fullJson = chunk1 + chunk2;
  expect(fullJson).to.equal('{"días":true}');

  // Verify it parses correctly
  const parsed = JSON.parse(fullJson);
  expect(parsed.días).to.equal(true);
});

test(SPLIT_SUITE, 'JSON-like data with split UTF-8 in property value', () => {
  const decoder = new TextDecoder();

  // Simulate JSON: {"name":"José"}
  // "José" contains 'é' (U+00E9) = [0xC3, 0xA9]
  // Split happens in the middle of "José"

  const json1 = '{"name":"Jos';
  const utf8_e_part1 = new Uint8Array([0xc3]); // First byte of 'é'
  const utf8_e_part2 = new Uint8Array([0xa9]); // Second byte of 'é'
  const json2 = '"}';

  const encoder = new TextEncoder();
  const jsonBytes1 = encoder.encode(json1);
  const jsonBytes2 = encoder.encode(json2);

  const chunk1Bytes = new Uint8Array([...jsonBytes1, ...utf8_e_part1]);
  const chunk2Bytes = new Uint8Array([...utf8_e_part2, ...jsonBytes2]);

  const chunk1 = decoder.decode(chunk1Bytes, { stream: true });
  const chunk2 = decoder.decode(chunk2Bytes, { stream: false });

  const fullJson = chunk1 + chunk2;
  expect(fullJson).to.equal('{"name":"José"}');

  const parsed = JSON.parse(fullJson);
  expect(parsed.name).to.equal('José');
});

test(
  SPLIT_SUITE,
  'Real-world scenario: streaming JSON with emoji split mid-chunk',
  () => {
    const decoder = new TextDecoder();

    // Simulate streaming JSON with emoji that gets split
    const line1 = '{"user":"Alice","msg":"Hello 😀"}\n';
    const line2 = '{"user":"Bob","msg":"Hi 🎉"}\n';

    const encoder = new TextEncoder();
    const fullBytes = encoder.encode(line1 + line2);

    // Find where the emoji '😀' is in bytes
    // '😀' = [0xF0, 0x9F, 0x98, 0x80]
    // Artificially split the stream right in the middle of the emoji
    const emojiStartInLine1 = line1.indexOf('😀');
    const bytesBeforeEmoji = encoder.encode(
      line1.substring(0, emojiStartInLine1)
    ).length;

    // Split after 2 bytes of the emoji
    const splitPoint = bytesBeforeEmoji + 2;

    const chunk1 = decoder.decode(fullBytes.slice(0, splitPoint), {
      stream: true,
    });
    const chunk2 = decoder.decode(fullBytes.slice(splitPoint), {
      stream: false,
    });

    const result = chunk1 + chunk2;
    expect(result).to.equal(line1 + line2);

    // Verify both JSON lines parse correctly
    const lines = result.trim().split('\n');
    expect(lines.length).to.equal(2);
    const parsed1 = JSON.parse(lines[0]!);
    const parsed2 = JSON.parse(lines[1]!);

    expect(parsed1.msg).to.equal('Hello 😀');
    expect(parsed2.msg).to.equal('Hi 🎉');
  }
);

test(
  SPLIT_SUITE,
  'Edge case: chunk boundary exactly at character boundary (should work)',
  () => {
    const decoder = new TextDecoder();

    // Test that splitting at a complete character boundary works fine
    const text = 'Hello😀World';
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);

    // Split at the boundary between 'Hello' and '😀'
    const splitPoint = encoder.encode('Hello').length;

    const chunk1 = decoder.decode(bytes.slice(0, splitPoint), { stream: true });
    const chunk2 = decoder.decode(bytes.slice(splitPoint), { stream: false });

    expect(chunk1).to.equal('Hello');
    expect(chunk2).to.equal('😀World');
  }
);

test(
  SPLIT_SUITE,
  'CRITICAL: Verify fast path is bypassed during streaming (the actual bug)',
  () => {
    const decoder = new TextDecoder();

    // This test specifically checks that the decoder uses the slow path
    // during streaming, even if validate_utf8 might accept the chunk.
    // The bug was that the fast path didn't check _doNotFlush flag.

    // Create a scenario where bytes might look "valid" individually
    // but form an incomplete character at the boundary
    const text = 'Valid UTF-8 text with emoji 😀 and special chars €';
    const encoder = new TextEncoder();
    const fullBytes = encoder.encode(text);

    // Find the emoji and split RIGHT in the middle of it
    const emojiIndex = text.indexOf('😀');
    const bytesBeforeEmoji = encoder.encode(
      text.substring(0, emojiIndex)
    ).length;

    // Split after 2 bytes of the 4-byte emoji (0xF0 0x9F | 0x98 0x80)
    const splitPoint = bytesBeforeEmoji + 2;

    const chunk1 = decoder.decode(fullBytes.slice(0, splitPoint), {
      stream: true,
    });
    const chunk2 = decoder.decode(fullBytes.slice(splitPoint), {
      stream: false,
    });

    const result = chunk1 + chunk2;

    // The full text should be reconstructed perfectly
    expect(result).to.equal(text);

    // Verify no replacement characters appeared (would indicate corruption)
    expect(result).to.not.include('\uFFFD');
  }
);

test(SPLIT_SUITE, 'Stress test: Many random split points in UTF-8 text', () => {
  const text =
    'Hello 世界 🌍 Привет мир 🌎 مرحبا بالعالم 🌏 नमस्ते दुनिया 👋 €100 ¥200 £300';
  const encoder = new TextEncoder();
  const fullBytes = encoder.encode(text);

  // Try splitting at every possible byte position
  for (let splitPoint = 1; splitPoint < fullBytes.length - 1; splitPoint++) {
    const decoder = new TextDecoder();

    const chunk1 = decoder.decode(fullBytes.slice(0, splitPoint), {
      stream: true,
    });
    const chunk2 = decoder.decode(fullBytes.slice(splitPoint), {
      stream: false,
    });

    const result = chunk1 + chunk2;

    // Every split should reconstruct the original text
    if (result !== text) {
      throw new Error(
        `Split at byte ${splitPoint} failed!\nExpected: ${text}\nGot: ${result}\nChunk1: ${chunk1}\nChunk2: ${chunk2}`
      );
    }
  }
});
