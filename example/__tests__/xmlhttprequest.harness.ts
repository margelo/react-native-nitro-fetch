import { describe, expect, it } from 'react-native-harness';
import { XMLHttpRequest as NitroXMLHttpRequest } from 'react-native-nitro-fetch';
import { BASE } from '../test-utils/server';

describe('XMLHttpRequest streamed responseText', () => {
  // 2, 3 and 4 byte UTF-8 sequences. At 9 bytes, the server's 16 KB writes
  // cut characters at every offset.
  const PHRASE = '\u00e9\u20ac\u{1f600}';
  const PHRASE_BYTES = 9;
  // How much longer a 10x larger body may take. On an iOS simulator it took
  // 6-9x as long when each chunk is decoded once, and 48-70x when every chunk
  // decodes the whole body again.
  const MAX_RATIO = 20;
  // Below this, timer noise in the 2 MB time would decide the result.
  const MIN_LIMIT_MS = 500;

  const textUrl = (repeat: number) =>
    `${BASE}/text?chunked=1&phrase=${encodeURIComponent(
      PHRASE
    )}&repeat=${repeat}`;

  // Reads responseText on every progress event, like a client that renders a
  // response as it loads. Rejects if it takes longer than timeoutMs.
  const readWhileLoading = (url: string, expected: string, timeoutMs: number) =>
    new Promise<{
      // responseText while loading that was not the start of the body.
      badText: string | null;
      events: number;
      ms: number;
      responseText: string;
    }>((resolve, reject) => {
      const xhr = new NitroXMLHttpRequest();
      let badText: string | null = null;
      let events = 0;
      let checked = 0;
      xhr.onprogress = () => {
        events++;
        const text = xhr.responseText;
        // Compares only what is new, so checking stays linear too.
        if (
          badText == null &&
          (text.length < checked ||
            text.slice(checked) !== expected.slice(checked, text.length))
        ) {
          badText = text.slice(Math.max(0, checked - 8), checked + 8);
        }
        checked = text.length;
      };
      const start = Date.now();
      const timer = setTimeout(() => {
        xhr.abort();
        reject(
          new Error(`${url} took more than ${timeoutMs} ms (${events} events)`)
        );
      }, timeoutMs);
      xhr.onload = () => {
        clearTimeout(timer);
        resolve({
          badText,
          events,
          ms: Date.now() - start,
          responseText: xhr.responseText,
        });
      };
      xhr.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`${url} failed`));
      };
      xhr.open('GET', url);
      xhr.send();
    });

  it('holds whole characters during and after a multi-byte body', async () => {
    const repeat = Math.round(2_000_000 / PHRASE_BYTES);
    const expected = PHRASE.repeat(repeat);
    const result = await readWhileLoading(textUrl(repeat), expected, 30_000);

    expect(result.events).toBeGreaterThan(1);
    expect(result.badText).toBeNull();
    expect(result.responseText.length).toBe(expected.length);
    expect(result.responseText === expected).toBe(true);
  });

  it('reads a 10x larger body in about 10x the time', async () => {
    const smallRepeat = Math.round(2_000_000 / PHRASE_BYTES);
    const small = await readWhileLoading(
      textUrl(smallRepeat),
      PHRASE.repeat(smallRepeat),
      30_000
    );
    const largeRepeat = smallRepeat * 10;
    const largeExpected = PHRASE.repeat(largeRepeat);
    const limitMs = Math.max(MAX_RATIO * small.ms, MIN_LIMIT_MS);
    const large = await readWhileLoading(
      textUrl(largeRepeat),
      largeExpected,
      limitMs
    );

    expect(large.ms).toBeLessThanOrEqual(limitMs);
    expect(large.badText).toBeNull();
    expect(large.responseText.length).toBe(largeExpected.length);
  });
});
