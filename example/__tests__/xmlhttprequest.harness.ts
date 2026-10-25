import { describe, expect, it } from 'react-native-harness';
import { Platform } from 'react-native';
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

describe('XMLHttpRequest state and validation', () => {
  type Request = InstanceType<typeof NitroXMLHttpRequest>;

  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  // The name of the error fn throws, or 'no error'.
  const errorName = (fn: () => unknown): string => {
    try {
      fn();
    } catch (error) {
      return (error as Error).name;
    }
    return 'no error';
  };

  // Resolves at loadend with the event before it (load, error, abort or
  // timeout), or with 'no loadend' after ms.
  const ended = (xhr: Request, ms = 10000) =>
    new Promise<string>((resolve) => {
      let outcome = 'no loadend';
      const timer = setTimeout(() => resolve(outcome), ms);
      for (const type of ['load', 'error', 'abort', 'timeout']) {
        xhr.addEventListener(type, () => {
          outcome = type;
        });
      }
      xhr.addEventListener('loadend', () => {
        clearTimeout(timer);
        resolve(outcome);
      });
    });

  // The methods of the requests that reached /hits/:id.
  const hitsAt = async (id: string): Promise<string[]> => {
    const response = await fetch(`${BASE}/hits-report/${id}`);
    return (await response.json()).methods;
  };

  // Waits until /drip?id= finished or its client disconnected.
  const dripReport = async (id: string) => {
    const until = Date.now() + 6000;
    while (true) {
      const response = await fetch(`${BASE}/drip-report/${id}`);
      const report = await response.json();
      if (report.finished || report.disconnected || Date.now() > until) {
        return report;
      }
      await sleep(100);
    }
  };

  it('throws InvalidStateError for calls in the wrong state', () => {
    const xhr = new NitroXMLHttpRequest();
    const errors: Record<string, string> = {};
    errors.headerBeforeOpen = errorName(() => xhr.setRequestHeader('X-A', '1'));
    errors.sendBeforeOpen = errorName(() => xhr.send());
    xhr.open('GET', `${BASE}/delay/3`);
    xhr.responseType = 'json';
    errors.responseTextForJSON = errorName(() => xhr.responseText);
    xhr.send();
    errors.sendTwice = errorName(() => xhr.send());
    errors.headerAfterSend = errorName(() => xhr.setRequestHeader('X-A', '1'));
    xhr.abort();

    expect(errors).toEqual({
      headerBeforeOpen: 'InvalidStateError',
      sendBeforeOpen: 'InvalidStateError',
      responseTextForJSON: 'InvalidStateError',
      sendTwice: 'InvalidStateError',
      headerAfterSend: 'InvalidStateError',
    });
  });

  it('allows setting responseType until send()', async () => {
    const xhr = new NitroXMLHttpRequest();
    const errors: Record<string, string> = {};
    xhr.onreadystatechange = () => {
      const setResponseType = () =>
        errorName(() => {
          xhr.responseType = 'text';
        });
      if (xhr.readyState === NitroXMLHttpRequest.HEADERS_RECEIVED) {
        errors.headersReceived = setResponseType();
      } else if (xhr.readyState === NitroXMLHttpRequest.LOADING) {
        errors.loading ??= setResponseType();
      } else if (xhr.readyState === NitroXMLHttpRequest.DONE) {
        errors.done = setResponseType();
      }
    };
    // Download progress streams the body, so LOADING comes before the end.
    xhr.onprogress = () => {};
    xhr.open('GET', `${BASE}/drip?numbytes=4&duration=0.4`);
    errors.beforeSend = errorName(() => {
      xhr.responseType = 'text';
    });
    const done = ended(xhr);
    xhr.send();
    errors.afterSend = errorName(() => {
      xhr.responseType = 'text';
    });
    const outcome = await done;

    // send() picks the transport from the response type, so it is fixed from
    // then on.
    expect({ outcome, errors, responseText: xhr.responseText }).toEqual({
      outcome: 'load',
      errors: {
        beforeSend: 'no error',
        afterSend: 'InvalidStateError',
        headersReceived: 'InvalidStateError',
        loading: 'InvalidStateError',
        done: 'InvalidStateError',
      },
      responseText: '****',
    });
  });

  it('rejects CONNECT, TRACE and TRACK in open() and sends nothing', async () => {
    const id = uid();
    const url = `${BASE}/hits/${id}`;
    const errors: Record<string, string> = {};
    const requests: Request[] = [];
    for (const method of ['CONNECT', 'TRACE', 'trace', 'TRACK', 'Track']) {
      const xhr = new NitroXMLHttpRequest();
      requests.push(xhr);
      errors[`open ${method}`] = errorName(() => xhr.open(method, url));
      errors[`send ${method}`] = errorName(() => xhr.send());
    }
    // A request that is sent shows up in the report.
    const control = new NitroXMLHttpRequest();
    control.open('GET', url);
    const done = ended(control);
    control.send();
    await done;
    const methods = await hitsAt(id);
    requests.forEach((xhr) => xhr.abort());

    expect({ errors, methods }).toEqual({
      errors: {
        'open CONNECT': 'SecurityError',
        'send CONNECT': 'InvalidStateError',
        'open TRACE': 'SecurityError',
        'send TRACE': 'InvalidStateError',
        'open trace': 'SecurityError',
        'send trace': 'InvalidStateError',
        'open TRACK': 'SecurityError',
        'send TRACK': 'InvalidStateError',
        'open Track': 'SecurityError',
        'send Track': 'InvalidStateError',
      },
      methods: ['GET'],
    });
  });

  it('rejects invalid methods and URLs in open() and sends nothing', async () => {
    const id = uid();
    const url = `${BASE}/hits/${id}`;
    const badPort = `${BASE.replace(/:\d+$/, '')}:99999/hits/${id}`;
    const errors: Record<string, string> = {};
    const requests: Request[] = [];
    const attempt = (label: string, method: string, target: string) => {
      const xhr = new NitroXMLHttpRequest();
      requests.push(xhr);
      errors[label] = errorName(() => {
        xhr.open(method, target);
        xhr.send();
      });
    };
    for (const method of ['GE T', 'GET\n', '', 'GET(']) {
      attempt(`method ${JSON.stringify(method)}`, method, url);
    }
    for (const target of ['http://[', 'http://exa mple.com/', badPort]) {
      attempt(`URL ${target}`, 'GET', target);
    }
    const control = new NitroXMLHttpRequest();
    control.open('GET', url);
    const done = ended(control);
    control.send();
    await done;
    const methods = await hitsAt(id);
    requests.forEach((xhr) => xhr.abort());

    expect({ errors, methods }).toEqual({
      errors: {
        'method "GE T"': 'SyntaxError',
        'method "GET\\n"': 'SyntaxError',
        'method ""': 'SyntaxError',
        'method "GET("': 'SyntaxError',
        'URL http://[': 'SyntaxError',
        'URL http://exa mple.com/': 'SyntaxError',
        [`URL ${badPort}`]: 'SyntaxError',
      },
      methods: ['GET'],
    });
  });

  it('rejects invalid header names and values in setRequestHeader()', async () => {
    const xhr = new NitroXMLHttpRequest();
    xhr.open('GET', `${BASE}/headers`);
    const errors: Record<string, string> = {};
    for (const name of ['Bad Header', 'X-A:', 'X-\u00c4']) {
      errors[`name ${JSON.stringify(name)}`] = errorName(() =>
        xhr.setRequestHeader(name, 'v')
      );
    }
    for (const value of ['a\r\nInjected: 1', 'a\nInjected: 1', 'a\u0000b']) {
      errors[`value ${JSON.stringify(value)}`] = errorName(() =>
        xhr.setRequestHeader('X-Bad', value)
      );
    }
    // Leading and trailing whitespace is dropped, not rejected.
    errors.padded = errorName(() =>
      xhr.setRequestHeader('X-Padded', ' \tvalue\t ')
    );
    const done = ended(xhr);
    xhr.send();
    const outcome = await done;
    const headers =
      outcome === 'load' ? JSON.parse(xhr.responseText).headers : {};

    expect({
      errors,
      outcome,
      padded: headers['X-Padded'],
      bad: headers['X-Bad'] ?? null,
      injected: headers.Injected ?? null,
    }).toEqual({
      errors: {
        'name "Bad Header"': 'SyntaxError',
        'name "X-A:"': 'SyntaxError',
        'name "X-\u00c4"': 'SyntaxError',
        'value "a\\r\\nInjected: 1"': 'SyntaxError',
        'value "a\\nInjected: 1"': 'SyntaxError',
        'value "a\\u0000b"': 'SyntaxError',
        'padded': 'no error',
      },
      outcome: 'load',
      padded: 'value',
      bad: null,
      injected: null,
    });
  });

  it('open() during a response stops it without events and reuses the object', async () => {
    const id = uid();
    const xhr = new NitroXMLHttpRequest();
    const events: string[] = [];
    for (const type of [
      'readystatechange',
      'abort',
      'error',
      'timeout',
      'load',
      'loadend',
    ]) {
      xhr.addEventListener(type, () => events.push(type));
    }
    const loading = new Promise<void>((resolve) => {
      xhr.onprogress = () => resolve();
    });
    xhr.open('GET', `${BASE}/drip?numbytes=30&duration=3&id=${id}`);
    xhr.send();
    await loading;
    const stateBefore = xhr.readyState;
    xhr.onprogress = null;
    events.length = 0;
    const openError = errorName(() =>
      xhr.open('GET', `${BASE}/get?reopened=1`)
    );
    const stateAfter = xhr.readyState;
    const eventsFromOpen = [...events];
    const report = await dripReport(id);
    const done = ended(xhr);
    const sendError = errorName(() => xhr.send());
    const outcome = sendError === 'no error' ? await done : 'not sent';
    const reopened =
      outcome === 'load' ? JSON.parse(xhr.responseText).args.reopened : null;

    expect({
      stateBefore,
      openError,
      stateAfter,
      eventsFromOpen,
      disconnected: report.disconnected,
      finished: report.finished,
      outcome,
      reopened,
    }).toEqual({
      stateBefore: NitroXMLHttpRequest.LOADING,
      openError: 'no error',
      stateAfter: NitroXMLHttpRequest.OPENED,
      // Only the state change to OPENED.
      eventsFromOpen: ['readystatechange'],
      disconnected: true,
      finished: false,
      outcome: 'load',
      reopened: '1',
    });
  });

  it('open() after DONE reuses the object', async () => {
    const xhr = new NitroXMLHttpRequest();
    xhr.open('GET', `${BASE}/get?n=1`);
    let done = ended(xhr);
    xhr.send();
    const firstOutcome = await done;
    const openError = errorName(() => xhr.open('GET', `${BASE}/get?n=2`));
    done = ended(xhr);
    const sendError = errorName(() => xhr.send());
    const outcome = sendError === 'no error' ? await done : 'not sent';
    const n = outcome === 'load' ? JSON.parse(xhr.responseText).args.n : null;

    expect({ firstOutcome, openError, outcome, n }).toEqual({
      firstOutcome: 'load',
      openError: 'no error',
      outcome: 'load',
      n: '2',
    });
  });

  it('abort() before send() keeps the request OPENED, and send() works', async () => {
    const xhr = new NitroXMLHttpRequest();
    const events: string[] = [];
    xhr.open('GET', `${BASE}/get?kept=1`);
    xhr.setRequestHeader('X-Kept', '1');
    for (const type of ['readystatechange', 'abort', 'loadend']) {
      xhr.addEventListener(type, () => events.push(type));
    }
    xhr.abort();
    const eventsFromAbort = [...events];
    const state = xhr.readyState;
    const done = ended(xhr);
    const sendError = errorName(() => xhr.send());
    const outcome = sendError === 'no error' ? await done : 'not sent';
    const body = outcome === 'load' ? JSON.parse(xhr.responseText) : null;

    expect({
      eventsFromAbort,
      state,
      sendError,
      outcome,
      query: body?.args.kept,
      header: body?.headers['X-Kept'],
    }).toEqual({
      eventsFromAbort: [],
      state: NitroXMLHttpRequest.OPENED,
      sendError: 'no error',
      outcome: 'load',
      query: '1',
      header: '1',
    });
  });

  it('applies a timeout set after send() from the start of send()', async () => {
    const xhr = new NitroXMLHttpRequest();
    xhr.open('GET', `${BASE}/delay/3`);
    const done = ended(xhr);
    const start = Date.now();
    xhr.send();
    await sleep(600);
    const setAt = Date.now() - start;
    // 800 ms after send(), not after this.
    xhr.timeout = 800;
    const outcome = await done;
    const elapsed = Date.now() - start;

    expect({
      outcome,
      fromSend: elapsed >= 800 && elapsed < setAt + 800,
    }).toEqual({
      outcome: 'timeout',
      fromSend: true,
    });
  });

  it('stops the timer when timeout is set to 0 after send()', async () => {
    const xhr = new NitroXMLHttpRequest();
    xhr.timeout = 300;
    xhr.open('GET', `${BASE}/delay/1`);
    const done = ended(xhr);
    xhr.send();
    xhr.timeout = 0;

    expect(await done).toBe('load');
  });

  it('does not call a listener removed during dispatch', async () => {
    const xhr = new NitroXMLHttpRequest();
    const calls: string[] = [];
    const removed = () => calls.push('removed');
    xhr.addEventListener('load', () => {
      calls.push('first');
      xhr.removeEventListener('load', removed);
    });
    xhr.addEventListener('load', removed);
    xhr.addEventListener('load', () => calls.push('last'));
    xhr.open('GET', `${BASE}/get`);
    const done = ended(xhr);
    xhr.send();
    await done;

    expect(calls).toEqual(['first', 'last']);
  });

  it('reports throwing listeners and keeps dispatching', async () => {
    const boom = new Error('listener failed');
    const reported: unknown[] = [];
    const report = (error: unknown) => {
      reported.push(error);
    };
    // Throwing listeners go to ErrorUtils.reportError(), or console.error()
    // without it.
    const errorUtils = (globalThis as any).ErrorUtils;
    const reportError = errorUtils?.reportError;
    const consoleError = console.error;
    if (errorUtils) errorUtils.reportError = report;
    console.error = report;
    try {
      const xhr = new NitroXMLHttpRequest();
      const states: number[] = [];
      let readyStateChanges = 0;
      const seen: string[] = [];
      xhr.addEventListener('readystatechange', () => {
        throw boom;
      });
      xhr.addEventListener('readystatechange', () => {
        readyStateChanges += 1;
        if (states[states.length - 1] !== xhr.readyState) {
          states.push(xhr.readyState);
        }
      });
      xhr.addEventListener('load', () => {
        throw boom;
      });
      for (const type of ['load', 'error', 'loadend']) {
        xhr.addEventListener(type, () => seen.push(type));
      }
      const openError = errorName(() => xhr.open('GET', `${BASE}/get`));
      const done = ended(xhr, 5000);
      xhr.send();
      await done;
      const reports = reported.filter((error) => error === boom).length;

      expect({ openError, states, seen, reports }).toEqual({
        openError: 'no error',
        states: [1, 2, 3, 4],
        seen: ['load', 'loadend'],
        // Every readystatechange, then load.
        reports: readyStateChanges + 1,
      });
    } finally {
      if (errorUtils) errorUtils.reportError = reportError;
      console.error = consoleError;
    }
  });
});

describe('XMLHttpRequest progress events', () => {
  type NitroXHR = InstanceType<typeof NitroXMLHttpRequest>;
  type Body = Parameters<NitroXHR['send']>[0];
  type Recorded = {
    name: string;
    readyState: number;
    loaded: number;
    total: number;
    lengthComputable: boolean;
  };

  const ALL_TYPES = [
    'loadstart',
    'progress',
    'load',
    'error',
    'abort',
    'timeout',
    'loadend',
  ];
  // Nothing listens on port 1, so the connection is refused.
  const CLOSED_PORT_URL = BASE.replace(/:\d+$/, ':1/');
  const NONE = { loaded: 0, total: 0, lengthComputable: false };

  // Sends a request and resolves on loadend with the progress events of the
  // request and its upload, in order. `setUp` runs between open() and send().
  const record = (
    method: string,
    url: string,
    body: Body,
    setUp: (xhr: NitroXHR) => void = () => {},
    types = ALL_TYPES
  ) =>
    new Promise<{ duringSend: string[]; events: Recorded[]; xhr: NitroXHR }>(
      (resolve) => {
        const xhr = new NitroXMLHttpRequest();
        const events: Recorded[] = [];
        let duringSend: string[] = [];
        const listen = (target: EventTarget, prefix: string, type: string) => {
          target.addEventListener(type, (event) => {
            const { loaded, total, lengthComputable } = event as ProgressEvent;
            events.push({
              name: `${prefix}${type}`,
              readyState: xhr.readyState,
              loaded,
              total,
              lengthComputable,
            });
          });
        };
        for (const type of types) {
          listen(xhr as unknown as EventTarget, '', type);
          listen(xhr.upload as unknown as EventTarget, 'upload.', type);
        }
        xhr.addEventListener('loadend', () => {
          resolve({ duringSend, events, xhr });
        });
        xhr.open(method, url);
        setUp(xhr);
        xhr.send(body);
        duringSend = events.map((event) => event.name);
      }
    );

  const fieldsOf = (events: Recorded[], name: string) =>
    events
      .filter((event) => event.name === name)
      .map(({ loaded, total, lengthComputable }) => ({
        loaded,
        total,
        lengthComputable,
      }));

  const namesOn = (events: Recorded[], prefix: '' | 'upload.') =>
    events
      .filter((event) => event.name.startsWith('upload.') === (prefix !== ''))
      .map((event) => event.name.slice(prefix.length));

  it('fires loadstart, progress, load and loadend with the bytes received', async () => {
    const { duringSend, events } = await record(
      'GET',
      `${BASE}/bytes/1024`,
      null
    );
    const done = { loaded: 1024, total: 1024, lengthComputable: true };

    expect(duringSend).toEqual(['loadstart']);
    expect([...new Set(namesOn(events, ''))]).toEqual([
      'loadstart',
      'progress',
      'load',
      'loadend',
    ]);
    expect(fieldsOf(events, 'loadstart')).toEqual([NONE]);
    expect(fieldsOf(events, 'progress').pop()).toEqual(done);
    expect(fieldsOf(events, 'load')).toEqual([done]);
    expect(fieldsOf(events, 'loadend')).toEqual([done]);
    expect(namesOn(events, 'upload.')).toEqual([]);
  });

  it('reports the bytes received on load and loadend without a progress listener', async () => {
    const { events } = await record(
      'GET',
      `${BASE}/bytes/1024`,
      null,
      undefined,
      ['load', 'loadend']
    );
    const done = { loaded: 1024, total: 1024, lengthComputable: true };

    expect(fieldsOf(events, 'load')).toEqual([done]);
    expect(fieldsOf(events, 'loadend')).toEqual([done]);
  });

  it('reports no total for a gzip body the client decompressed', async () => {
    const { events, xhr } = await record(
      'GET',
      `${BASE}/text?gzip=1&phrase=a&repeat=200000`,
      null
    );
    const progress = fieldsOf(events, 'progress');
    const done = { loaded: 200000, total: 0, lengthComputable: false };

    expect(xhr.responseText.length).toBe(200000);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.filter((event) => event.lengthComputable)).toEqual([]);
    expect(progress.pop()).toEqual(done);
    expect(fieldsOf(events, 'load')).toEqual([done]);
    expect(fieldsOf(events, 'loadend')).toEqual([done]);
  });

  it('fires upload events for a string body before the response headers', async () => {
    // 2 UTF-8 bytes per character.
    const body = 'é'.repeat(32 * 1024);
    const size = 64 * 1024;
    const { events, xhr } = await record('POST', `${BASE}/post`, body);
    const upload = events.filter((event) => event.name.startsWith('upload.'));
    const sent = { loaded: size, total: size, lengthComputable: true };

    expect(JSON.parse(xhr.responseText).dataLength).toBe(size);
    expect(namesOn(events, 'upload.')).toEqual([
      'loadstart',
      'progress',
      'load',
      'loadend',
    ]);
    expect(upload.map((event) => event.readyState)).toEqual([1, 1, 1, 1]);
    expect(fieldsOf(events, 'upload.loadstart')).toEqual([
      { ...sent, loaded: 0 },
    ]);
    expect(fieldsOf(events, 'upload.progress')).toEqual([sent]);
    expect(fieldsOf(events, 'upload.load')).toEqual([sent]);
    expect(fieldsOf(events, 'upload.loadend')).toEqual([sent]);
  });

  it('fires upload events for a FormData body before the response headers', async () => {
    const form = new FormData();
    form.append('message', 'hello');
    const { events, xhr } = await record('POST', `${BASE}/post`, form);
    const upload = events.filter((event) => event.name.startsWith('upload.'));

    expect(JSON.parse(xhr.responseText).form.message).toBe('hello');
    // Only the native client knows the size of a multipart body, so there is
    // no progress to report.
    expect(namesOn(events, 'upload.')).toEqual([
      'loadstart',
      'load',
      'loadend',
    ]);
    expect(upload.map((event) => event.readyState)).toEqual([1, 1, 1]);
    expect(fieldsOf(events, 'upload.loadend')).toEqual([NONE]);
  });

  it('fires upload events for a string with a lone surrogate', async () => {
    const { events, xhr } = await record('POST', `${BASE}/post`, 'a\uD800b');

    expect(xhr.status).toBe(200);
    expect([...new Set(namesOn(events, ''))]).toEqual([
      'loadstart',
      'progress',
      'load',
      'loadend',
    ]);
    // Progress depends on whether the string's size can be counted.
    expect(
      namesOn(events, 'upload.').filter((name) => name !== 'progress')
    ).toEqual(['loadstart', 'load', 'loadend']);
  });

  for (const [type, url, setUp] of [
    [
      'abort',
      `${BASE}/delay/3`,
      (xhr: NitroXHR) => {
        setTimeout(() => xhr.abort(), 300);
      },
    ],
    ['error', CLOSED_PORT_URL, () => {}],
    [
      'timeout',
      `${BASE}/delay/3`,
      (xhr: NitroXHR) => {
        xhr.timeout = 500;
      },
    ],
  ] as const) {
    it(`ends the upload, then the request, on ${type}`, async () => {
      const { events } = await record('POST', url, 'body', setUp);

      expect(namesOn(events, 'upload.')).toEqual([
        'loadstart',
        type,
        'loadend',
      ]);
      expect(namesOn(events, '')).toEqual(['loadstart', type, 'loadend']);
      expect(events.slice(2).map((event) => event.name)).toEqual([
        `upload.${type}`,
        'upload.loadend',
        type,
        'loadend',
      ]);
      expect(fieldsOf(events, `upload.${type}`)).toEqual([NONE]);
      expect(fieldsOf(events, type)).toEqual([NONE]);
    });
  }

  it("ends axios' onDownloadProgress at the bytes received", async () => {
    // axios 1.20's XHR adapter passes progress events to onDownloadProgress
    // through a throttle, and flushes it with the loadend event.
    const delivered: Array<{ loaded: number; total?: number }> = [];
    const onDownloadProgress = (event: ProgressEvent) => {
      const total = event.lengthComputable ? event.total : undefined;
      const loaded =
        total != null ? Math.min(event.loaded, total) : event.loaded;
      delivered.push({ loaded, total });
    };
    await record('GET', `${BASE}/bytes/100000`, null, (xhr) => {
      xhr.responseType = 'arraybuffer';
      xhr.addEventListener('progress', (event: Event) =>
        onDownloadProgress(event as ProgressEvent)
      );
      xhr.onloadend = (event) => onDownloadProgress(event);
    });

    expect(delivered.pop()).toEqual({ loaded: 100000, total: 100000 });
  });
});

describe('XMLHttpRequest credentials and cleanup', () => {
  type NitroXHR = InstanceType<typeof NitroXMLHttpRequest>;

  const RUN = String(Date.now());
  // Nothing listens on port 1, so the connection is refused.
  const CLOSED_PORT_URL = BASE.replace(/:\d+$/, ':1/');

  function stateOf(xhr: NitroXHR) {
    return {
      allHeaders: xhr.getAllResponseHeaders(),
      contentType: xhr.getResponseHeader('content-type'),
      // responseText throws for the other response types.
      responseText:
        xhr.responseType === '' || xhr.responseType === 'text'
          ? xhr.responseText
          : undefined,
      responseURL: xhr.responseURL,
      status: xhr.status,
      statusText: xhr.statusText,
    };
  }

  const CLEARED = {
    allHeaders: '',
    contentType: null,
    responseText: '',
    responseURL: '',
    status: 0,
    statusText: '',
  };

  type Sent = {
    atLoadend: ReturnType<typeof stateOf>;
    events: string[];
    message: string | undefined;
    xhr: NitroXHR;
  };

  function send(
    method: string,
    url: string,
    setUp: (xhr: NitroXHR) => void = () => {},
    body: Parameters<NitroXHR['send']>[0] = null
  ): Promise<Sent> {
    return new Promise((resolve, reject) => {
      const xhr = new NitroXMLHttpRequest();
      const events: string[] = [];
      let message: string | undefined;
      // Fail the case rather than stall the suite.
      const timer = setTimeout(() => {
        reject(
          new Error(`${method} ${url}: no loadend after 10 s (${events})`)
        );
      }, 10000);
      for (const type of ['load', 'error', 'timeout', 'abort']) {
        xhr.addEventListener(type, (event: unknown) => {
          events.push(type);
          if (type === 'error') {
            message = (event as { message?: string }).message;
          }
        });
      }
      xhr.addEventListener('loadend', () => {
        clearTimeout(timer);
        resolve({ atLoadend: stateOf(xhr), events, message, xhr });
      });
      xhr.open(method, url);
      setUp(xhr);
      xhr.send(body);
    });
  }

  async function cookiesSent(
    setUp?: (xhr: NitroXHR) => void
  ): Promise<Record<string, string>> {
    const { xhr } = await send('GET', `${BASE}/cookies`, setUp);
    return JSON.parse(xhr.responseText).cookies;
  }

  // The number of requests that reached /hits/:id.
  async function hits(id: string): Promise<number> {
    const { xhr } = await send('GET', `${BASE}/hits-report/${id}`);
    return JSON.parse(xhr.responseText).methods.length;
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const withoutCredentials = (xhr: NitroXHR) => {
    xhr.withCredentials = false;
  };

  it('sends and stores cookies by default (iOS cookie jar)', async () => {
    if (Platform.OS !== 'ios') return;
    await send('GET', `${BASE}/cookies/set?xhrDefault=${RUN}`);
    const cookies = await cookiesSent();
    expect(cookies.xhrDefault).toBe(RUN);
  });

  // onprogress makes the request stream, so both native clients are covered.
  for (const [mode, observe] of [
    ['buffered', () => {}],
    [
      'streamed',
      (xhr: NitroXHR) => {
        xhr.onprogress = () => {};
      },
    ],
  ] as const) {
    it(`withCredentials = false sends no cookies (${mode})`, async () => {
      await send('GET', `${BASE}/cookies/set?xhrOmitSend=${RUN}`);
      const cookies = await cookiesSent((xhr) => {
        withoutCredentials(xhr);
        observe(xhr);
      });
      expect('xhrOmitSend' in cookies).toBe(false);
    });

    it(`withCredentials = false stores no cookies (${mode})`, async () => {
      const name = `xhrOmitStore${mode}`;
      await send('GET', `${BASE}/cookies/set?${name}=${RUN}`, (xhr) => {
        withoutCredentials(xhr);
        observe(xhr);
      });
      const cookies = await cookiesSent();
      expect(cookies[name]).not.toBe(RUN);
    });
  }

  it('clears the response after a network error', async () => {
    const { atLoadend, events, message, xhr } = await send(
      'GET',
      CLOSED_PORT_URL
    );
    expect(events).toEqual(['error']);
    expect(atLoadend).toEqual(CLEARED);
    expect(stateOf(xhr)).toEqual(CLEARED);
    // Not in the spec: the cause, which responseText used to hold.
    expect(typeof message).toBe('string');
    expect(message?.length).toBeGreaterThan(0);
  });

  it('clears the response after a timeout', async () => {
    const { atLoadend, events, xhr } = await send(
      'GET',
      `${BASE}/drip?numbytes=20&duration=5`,
      (request) => {
        // Streamed, so the headers arrive before the timeout.
        request.onprogress = () => {};
        request.timeout = 500;
      }
    );
    expect(events).toEqual(['timeout']);
    expect(atLoadend).toEqual(CLEARED);
    expect(stateOf(xhr)).toEqual(CLEARED);
  });

  it('clears the response when aborted while loading', async () => {
    const { atLoadend, events, xhr } = await send(
      'GET',
      `${BASE}/drip?numbytes=20&duration=3`,
      (request) => {
        request.onprogress = () => request.abort();
      }
    );
    expect(events).toEqual(['abort']);
    expect(atLoadend).toEqual(CLEARED);
    expect(stateOf(xhr)).toEqual(CLEARED);
  });

  it('has a responseXML property', () => {
    expect('responseXML' in new NitroXMLHttpRequest()).toBe(true);
  });

  for (const responseType of ['', 'text', 'document'] as const) {
    it(`responseXML is null for responseType '${responseType}'`, async () => {
      const { events, xhr } = await send('GET', `${BASE}/get`, (request) => {
        request.responseType = responseType;
      });
      expect(events).toEqual(['load']);
      expect(xhr.responseXML).toBe(null);
    });
  }

  for (const responseType of ['json', 'arraybuffer', 'blob'] as const) {
    it(`responseXML throws InvalidStateError for responseType '${responseType}'`, async () => {
      const { events, xhr } = await send('GET', `${BASE}/get`, (request) => {
        request.responseType = responseType;
      });
      expect(events).toEqual(['load']);
      let error: unknown;
      try {
        xhr.responseXML;
      } catch (caught) {
        error = caught;
      }
      expect((error as Error | undefined)?.name).toBe('InvalidStateError');
    });
  }

  it('sends a string with a lone surrogate as U+FFFD', async () => {
    const uploaded: number[] = [];
    const { events, xhr } = await send(
      'POST',
      `${BASE}/post`,
      (request) => {
        request.upload.onprogress = (event) => uploaded.push(event.total);
      },
      'a\uD800b'
    );
    expect(events).toEqual(['load']);
    expect(xhr.status).toBe(200);
    // a, EF BF BD, b
    expect(JSON.parse(xhr.responseText).dataBase64).toBe('Ye+/vWI=');
    expect(uploaded).toEqual([5]);
  });

  it('sends nothing when aborted while a Blob body is read', async () => {
    const blob = new Blob(['b'.repeat(1024 * 1024)]);
    const id = `xhr-blob-abort-${RUN}`;
    const events: string[] = [];
    const xhr = new NitroXMLHttpRequest();
    xhr.addEventListener('abort', () => events.push('abort'));
    xhr.open('POST', `${BASE}/hits/${id}`);
    xhr.send(blob);
    xhr.abort();
    expect(events).toEqual(['abort']);
    await sleep(1000);
    expect(await hits(id)).toBe(0);

    // Control: the same body, not aborted, does reach the server.
    const sent = await send('POST', `${BASE}/hits/${id}-sent`, undefined, blob);
    expect(sent.events).toEqual(['load']);
    expect(await hits(`${id}-sent`)).toBe(1);
  });
});
