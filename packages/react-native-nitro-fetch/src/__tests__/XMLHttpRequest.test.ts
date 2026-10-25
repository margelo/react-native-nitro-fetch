// Dynamic imports do not mark this file as a TypeScript module. Keep generated
// test declarations module-scoped so they cannot collide with the source file.
export {};

jest.mock('../fetch-core/fetch', () => ({
  nitroFetch: jest.fn(),
}));

// The native client nitroFetchRaw talks to.
const mockClient = {
  request: jest.fn(),
  requestWithEvents: jest.fn(),
  cancelRequest: jest.fn(),
};
jest.mock('../fetch-core/client', () => ({
  NitroFetchHybrid: { createClient: () => mockClient },
  ensureClient: () => mockClient,
  clientUnavailableError: () => new Error('NitroFetch client not available'),
}));

type NitroFetchFunction = typeof import('../fetch-core/fetch').nitroFetch;
type NitroRawInit = import('../fetch-core/raw').NitroRawInit;
type NitroRequestWithEvents =
  import('../fetch-core/raw').NitroRequestWithEvents;
type UrlResponseInfo = import('../NitroCronet.nitro').UrlResponseInfo;
type NitroXMLHttpRequestConstructor =
  typeof import('../XMLHttpRequest').NitroXMLHttpRequest;
type NitroXMLHttpRequestInstance = InstanceType<NitroXMLHttpRequestConstructor>;

let mockNitroFetch: jest.MockedFunction<NitroFetchFunction>;
let NitroXMLHttpRequest: NitroXMLHttpRequestConstructor;

// `text` stands in for the text the buffered client decoded natively. It
// defaults to the chunks decoded as UTF-8.
function makeResponse(
  chunks: Uint8Array[],
  init: {
    headers?: Record<string, string>;
    status?: number;
    statusText?: string;
    text?: string;
    url?: string;
  } = {}
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  const bytes = Buffer.concat(chunks);
  return {
    body: stream,
    headers: new Headers(init.headers),
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    url: init.url ?? 'https://example.com/result',
    async arrayBuffer() {
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      );
    },
    async text() {
      return init.text ?? new TextDecoder().decode(bytes);
    },
  } as unknown as Response;
}

function responseInfo(
  headers: Record<string, string>,
  init: { status?: number; url?: string } = {}
): UrlResponseInfo {
  const url = init.url ?? 'https://example.com/result';
  return {
    url,
    httpStatusCode: init.status ?? 200,
    httpStatusText: 'OK',
    allHeaders: headers,
    allHeadersAsList: Object.entries(headers).map(([key, value]) => ({
      key,
      value,
    })),
    urlChain: [url],
    negotiatedProtocol: '',
    proxyServer: '',
    receivedByteCount: 0,
    wasCached: false,
  };
}

// What the XHR asked the native client for.
function sentInit(): NitroRawInit & { stream?: boolean } {
  return mockNitroFetch.mock.calls[0]![1] as NitroRawInit;
}

// What the XHR asked the native client to report while the request loads.
function sentEvents(): NitroRequestWithEvents {
  return sentInit()._withEvents!;
}

// Plays what the native client reports while the request loads, then
// resolves with `response`.
function mockNative(
  response: Response,
  whileLoading: (events: NitroRequestWithEvents) => void = () => {}
): void {
  mockNitroFetch.mockImplementation(async (_input, init) => {
    await Promise.resolve();
    whileLoading((init as NitroRawInit)._withEvents!);
    return response;
  });
}

// The native client buffers the body, and reports the bytes received to a
// request that asked for progress.
function buffered(
  chunks: Uint8Array[],
  init: Parameters<typeof makeResponse>[1] = {}
): NitroFetchFunction {
  const bytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  return async (_input, requestInit) => {
    await Promise.resolve();
    (requestInit as NitroRawInit)._withEvents?.onProgress?.(bytes, -1);
    return makeResponse(chunks, init);
  };
}

function mockBuffered(
  chunks: Uint8Array[],
  init: Parameters<typeof makeResponse>[1] = {}
): void {
  mockNitroFetch.mockImplementation(buffered(chunks, init));
}

function waitForEvent(
  xhr: NitroXMLHttpRequestInstance,
  type: string
): Promise<Event> {
  return new Promise((resolve) => {
    xhr.addEventListener(type, (event) => {
      resolve(event);
    });
  });
}

// Cuts bytes into chunks at the given offsets.
function splitAt(bytes: Uint8Array, offsets: number[]): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (const offset of [...offsets, bytes.byteLength]) {
    chunks.push(bytes.slice(start, offset));
    start = offset;
  }
  return chunks;
}

// Streams the chunks as a text response. When watched, responseText is read
// on every progress event.
async function receiveText(
  chunks: Uint8Array[],
  watched: boolean
): Promise<{ responseText: string; texts: string[] }> {
  if (watched) {
    // The native client streams what a watched request has asked for.
    mockNative(makeResponse([]), (events) => {
      events.onResponseStarted?.(responseInfo({}));
      for (const chunk of chunks) {
        if (chunk.byteLength > 0) events.onData?.(chunk.slice().buffer);
      }
    });
  } else {
    mockNitroFetch.mockResolvedValue(makeResponse(chunks));
  }
  const xhr = new NitroXMLHttpRequest();
  const texts: string[] = [];
  if (watched) {
    xhr.onprogress = () => {
      texts.push(xhr.responseText);
    };
  }
  xhr.open('GET', 'https://example.com/text');
  const completed = waitForEvent(xhr, 'loadend');
  xhr.send();
  await completed;
  return { responseText: xhr.responseText, texts };
}

// A request that never answers. Returns the signals it was sent with.
function hangingFetch(): AbortSignal[] {
  const signals: AbortSignal[] = [];
  mockNitroFetch.mockImplementation((_input, init) => {
    const signal = init?.signal ?? undefined;
    if (signal) signals.push(signal);
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        reject(new Error('aborted'));
      });
    });
  });
  return signals;
}

// A request whose body the native client streams: it reports the chunks and
// then stays open until it is aborted. Returns the signals it was sent with.
function openNative(
  chunks: Uint8Array[],
  headers: Record<string, string> = {}
): AbortSignal[] {
  const signals: AbortSignal[] = [];
  mockNitroFetch.mockImplementationOnce(async (_input, init) => {
    await Promise.resolve();
    const signal = init?.signal ?? undefined;
    if (signal) signals.push(signal);
    const events = (init as NitroRawInit)._withEvents!;
    events.onResponseStarted?.(responseInfo(headers));
    for (const chunk of chunks) events.onData?.(chunk.slice().buffer);
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        reject(new Error('aborted'));
      });
    });
  });
  return signals;
}

function recordEvents(xhr: NitroXMLHttpRequestInstance): string[] {
  const events: string[] = [];
  for (const type of [
    'readystatechange',
    'loadstart',
    'progress',
    'load',
    'error',
    'abort',
    'timeout',
    'loadend',
  ]) {
    xhr.addEventListener(type, () => events.push(type));
  }
  return events;
}

// The name of the error fn throws, or 'no error'.
function errorName(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).name;
  }
  return 'no error';
}

type RecordedEvent = {
  name: string;
  readyState: number;
  loaded?: number;
  total?: number;
  lengthComputable?: boolean;
};

const PROGRESS_EVENT_TYPES = [
  'loadstart',
  'progress',
  'load',
  'error',
  'abort',
  'timeout',
  'loadend',
];

// Records the progress events of the request and its upload, in order.
function recordProgressEvents(
  xhr: NitroXMLHttpRequestInstance,
  types = PROGRESS_EVENT_TYPES
): RecordedEvent[] {
  const events: RecordedEvent[] = [];
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
    listen(xhr, '', type);
    listen(xhr.upload as unknown as EventTarget, 'upload.', type);
  }
  return events;
}

function eventNames(events: RecordedEvent[]): string[] {
  return events.map((event) => event.name);
}

// A request the native client streams: it reports 'partial' and then waits
// until `fail` is called.
function stalledNative(): { fail(error: Error): void } {
  let rejectRequest: (error: Error) => void = () => {};
  const request = new Promise<Response>((_resolve, reject) => {
    rejectRequest = reject;
  });
  // fail() may come before the request is awaited.
  request.catch(() => {});
  mockNitroFetch.mockImplementationOnce(async (_input, init) => {
    await Promise.resolve();
    const events = (init as NitroRawInit)._withEvents!;
    events.onResponseStarted?.(
      responseInfo(
        { 'content-type': 'text/plain' },
        { url: 'https://example.com/final' }
      )
    );
    events.onData?.(new TextEncoder().encode('partial').buffer);
    return request;
  });
  return { fail: (error) => rejectRequest(error) };
}

function responseState(xhr: NitroXMLHttpRequestInstance) {
  return {
    allHeaders: xhr.getAllResponseHeaders(),
    contentType: xhr.getResponseHeader('content-type'),
    responseText: xhr.responseText,
    responseURL: xhr.responseURL,
    status: xhr.status,
    statusText: xhr.statusText,
  };
}

const CLEARED_STATE = {
  allHeaders: '',
  contentType: null,
  responseText: '',
  responseURL: '',
  status: 0,
  statusText: '',
};

describe('NitroXMLHttpRequest', () => {
  beforeAll(async () => {
    // Bun does not hoist Jest-compatible module mocks. Load the implementation
    // only after registering the mock so native React Native modules stay out
    // of the unit-test process.
    const fetchModule = await import('../fetch-core/fetch');
    const xhrModule = await import('../XMLHttpRequest');
    mockNitroFetch =
      fetchModule.nitroFetch as jest.MockedFunction<NitroFetchFunction>;
    NitroXMLHttpRequest = xhrModule.NitroXMLHttpRequest;
  });

  beforeEach(() => {
    mockNitroFetch.mockReset();
  });

  it('streams an event-stream response state, headers, text, and download progress', async () => {
    const encoder = new TextEncoder();
    const headers = {
      'content-length': '11',
      'content-type': 'text/event-stream',
    };
    mockNative(makeResponse([], { headers }), (events) => {
      events.onResponseStarted?.(responseInfo(headers));
      events.onData?.(encoder.encode('{"ok":').buffer);
      events.onData?.(encoder.encode('true}').buffer);
    });

    const xhr = new NitroXMLHttpRequest();
    const states: number[] = [];
    const progress: number[] = [];
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.getAllResponseHeaders()).toBe('');
    xhr.addEventListener('readystatechange', () => {
      states.push(xhr.readyState);
    });
    xhr.addEventListener('progress', (event) => {
      const progressEvent = event as ProgressEvent;
      progress.push(progressEvent.loaded);
    });

    xhr.open('GET', 'https://example.com/source');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(states).toEqual([1, 2, 3, 3, 4]);
    expect(progress).toEqual([6, 11]);
    expect(xhr.status).toBe(200);
    expect(xhr.statusText).toBe('');
    expect(xhr.responseText).toBe('{"ok":true}');
    expect(xhr.getResponseHeader('Content-Type')).toBe('text/event-stream');
    expect(xhr.getAllResponseHeaders()).toContain(
      'content-type: text/event-stream\r\n'
    );
    expect(mockNitroFetch).toHaveBeenCalledWith(
      'https://example.com/source',
      expect.objectContaining({
        credentials: 'include',
        method: 'GET',
      })
    );
    expect(sentInit().stream).toBeUndefined();
  });

  it.each([
    ['watched', true],
    ['unwatched', false],
  ])(
    'decodes a %s body split anywhere like the whole body',
    async (_name, watched) => {
      const encoder = new TextEncoder();
      // 2, 3 and 4 byte sequences, byte order marks at the start and inside,
      // an invalid byte and a sequence cut off at the end of the body.
      const body = new Uint8Array([
        ...encoder.encode('\ufeffa\u00e9\u20ac\u{1f600}\ufeff\ufeffb'),
        0xff,
        ...encoder.encode('\u00e9c'),
        0xe2,
        0x82,
      ]);
      const expected = new TextDecoder().decode(body);
      expect(expected).toBe(
        'a\u00e9\u20ac\u{1f600}\ufeff\ufeffb\ufffd\u00e9c\ufffd'
      );

      // Empty chunks at the start, inside a sequence and at the end.
      const splits = [[0, 2, 2, 5, body.byteLength]];
      for (let offset = 1; offset < body.byteLength; offset++) {
        splits.push([offset]);
      }
      splits.push(Array.from({ length: body.byteLength - 1 }, (_, i) => i + 1));
      for (const offsets of splits) {
        const { responseText, texts } = await receiveText(
          splitAt(body, offsets),
          watched
        );
        expect({ offsets, responseText }).toEqual({
          offsets,
          responseText: expected,
        });
        // While it loads, responseText only grows and holds whole characters.
        let previous = '';
        for (const text of texts) {
          expect({ offsets, text }).toEqual({
            offsets,
            text: expected.slice(0, text.length),
          });
          expect(text.length).toBeGreaterThanOrEqual(previous.length);
          previous = text;
        }
      }
    }
  );

  it('decodes each byte once while responseText is read on every progress event', async () => {
    const encoder = new TextEncoder();
    const body = encoder.encode('ab\u00e9\u20ac\u{1f600}'.repeat(1000));
    // 100 chunks, many of them ending inside a character.
    const chunkSize = Math.ceil(body.byteLength / 100) + 1;
    const offsets: number[] = [];
    for (
      let offset = chunkSize;
      offset < body.byteLength;
      offset += chunkSize
    ) {
      offsets.push(offset);
    }
    const chunks = splitAt(body, offsets);
    const decode = jest.spyOn(TextDecoder.prototype, 'decode');
    try {
      const { responseText, texts } = await receiveText(chunks, true);

      expect(texts).toHaveLength(chunks.length);
      expect(responseText).toBe('ab\u00e9\u20ac\u{1f600}'.repeat(1000));
      const decodedBytes = decode.mock.calls.reduce((sum, [input]) => {
        return sum + ((input as Uint8Array | undefined)?.byteLength ?? 0);
      }, 0);
      expect(decodedBytes).toBe(body.byteLength);
    } finally {
      decode.mockRestore();
    }
  });

  it('uses the buffered transport for React Native FormData uploads', async () => {
    const encoder = new TextEncoder();
    const response = makeResponse([encoder.encode('{}')]);
    mockNitroFetch.mockResolvedValue(response);

    const form = new FormData();
    form.append('message', 'hello');
    const xhr = new NitroXMLHttpRequest();
    xhr.open('POST', 'https://example.com/upload');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send(form);
    await completed;

    expect(mockNitroFetch).toHaveBeenCalledWith(
      'https://example.com/upload',
      expect.objectContaining({ body: form, method: 'POST' })
    );
    expect(sentInit().stream).toBeUndefined();
  });

  it.each(['', 'text', 'json'] as const)(
    'uses the buffered transport for a %p response nothing observes early',
    async (responseType) => {
      const encoder = new TextEncoder();
      const response = makeResponse([encoder.encode('{"ok":true}')]);
      mockNitroFetch.mockResolvedValue(response);

      const xhr = new NitroXMLHttpRequest();
      xhr.onload = () => {};
      xhr.upload.addEventListener('progress', () => {});
      xhr.open('POST', 'https://example.com/plain');
      xhr.responseType = responseType;
      const completed = waitForEvent(xhr, 'loadend');
      xhr.send('body');
      await completed;

      expect(xhr.response).toEqual(
        responseType === 'json' ? { ok: true } : '{"ok":true}'
      );
      expect(mockNitroFetch).toHaveBeenCalledWith(
        'https://example.com/plain',
        expect.objectContaining({ body: 'body' })
      );
      expect(sentEvents()).toEqual({
        options: expect.objectContaining({ responseBytes: false }),
        onResponseStarted: undefined,
        onData: undefined,
        onProgress: undefined,
      });
      expect(sentInit().stream).toBeUndefined();
    }
  );

  it.each<[string, string, (xhr: NitroXMLHttpRequestInstance) => void]>([
    [
      'onreadystatechange is set',
      'GET',
      (xhr) => {
        xhr.onreadystatechange = () => {};
      },
    ],
    [
      'a readystatechange listener is added',
      'GET',
      (xhr) => {
        xhr.addEventListener('readystatechange', () => {});
      },
    ],
    [
      // SuperAgent adds a readystatechange listener to every request.
      'SuperAgent sends a JSON body',
      'POST',
      (xhr) => {
        xhr.addEventListener('readystatechange', () => {});
        xhr.setRequestHeader('Content-Type', 'application/json');
      },
    ],
  ])(
    'asks for the head and event streams early, buffered, when %s',
    async (_reason, method, setUp) => {
      const encoder = new TextEncoder();
      mockNitroFetch.mockResolvedValue(makeResponse([encoder.encode('ok')]));

      const xhr = new NitroXMLHttpRequest();
      xhr.open(method, 'https://example.com/watched');
      setUp(xhr);
      const completed = waitForEvent(xhr, 'loadend');
      xhr.send(method === 'POST' ? '{}' : null);
      await completed;

      expect(xhr.responseText).toBe('ok');
      expect(mockNitroFetch).toHaveBeenCalledWith(
        'https://example.com/watched',
        expect.objectContaining({ method })
      );
      expect(sentEvents()).toEqual({
        options: expect.objectContaining({ separateConnections: false }),
        onResponseStarted: expect.any(Function),
        onData: expect.any(Function),
        onProgress: undefined,
      });
      expect(sentInit().stream).toBeUndefined();
    }
  );

  it.each<[string, (xhr: NitroXMLHttpRequestInstance) => void]>([
    [
      'onprogress is set',
      (xhr) => {
        xhr.onprogress = () => {};
      },
    ],
    [
      'a progress listener is added',
      (xhr) => {
        xhr.addEventListener('progress', () => {});
      },
    ],
    [
      // axios' XHR adapter, with onDownloadProgress.
      'axios observes download progress',
      (xhr) => {
        xhr.onloadend = () => {};
        xhr.addEventListener('progress', () => {});
      },
    ],
    [
      // SuperAgent's .on('progress').
      'SuperAgent observes progress',
      (xhr) => {
        xhr.addEventListener('readystatechange', () => {});
        xhr.addEventListener('progress', () => {});
        xhr.upload.addEventListener('progress', () => {});
      },
    ],
  ])('asks for progress, buffered, when %s', async (_reason, setUp) => {
    const encoder = new TextEncoder();
    mockNitroFetch.mockResolvedValue(makeResponse([encoder.encode('ok')]));

    const xhr = new NitroXMLHttpRequest();
    xhr.open('GET', 'https://example.com/progress');
    setUp(xhr);
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(mockNitroFetch).toHaveBeenCalledWith(
      'https://example.com/progress',
      expect.anything()
    );
    expect(sentEvents()).toEqual(
      expect.objectContaining({
        onResponseStarted: expect.any(Function),
        onData: expect.any(Function),
        onProgress: expect.any(Function),
      })
    );
    expect(sentInit().stream).toBeUndefined();
  });

  it('asks only for the whole response when axios observes the end and upload progress', async () => {
    const encoder = new TextEncoder();
    mockNitroFetch.mockResolvedValue(makeResponse([encoder.encode('ok')]));

    const xhr = new NitroXMLHttpRequest();
    xhr.open('POST', 'https://example.com/axios');
    xhr.onloadend = () => {};
    xhr.onabort = () => {};
    xhr.onerror = () => {};
    xhr.ontimeout = () => {};
    xhr.upload.addEventListener('progress', () => {});
    xhr.upload.addEventListener('loadend', () => {});
    xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send('{}');
    await completed;

    expect(xhr.responseText).toBe('ok');
    expect(mockNitroFetch).toHaveBeenCalledWith(
      'https://example.com/axios',
      expect.anything()
    );
    expect(sentEvents()).toEqual({
      options: expect.objectContaining({ separateConnections: false }),
      onResponseStarted: undefined,
      onData: undefined,
      onProgress: undefined,
    });
  });

  it.each(['arraybuffer', 'blob'] as const)(
    'uses the buffered transport for a %p response, asking for its bytes as received',
    async (responseType) => {
      const bytes = [0x63, 0x61, 0x66, 0xe9];
      mockNitroFetch.mockResolvedValue(makeResponse([Uint8Array.from(bytes)]));

      const xhr = new NitroXMLHttpRequest();
      xhr.addEventListener('readystatechange', () => {});
      xhr.open('GET', 'https://example.com/bytes');
      xhr.responseType = responseType;
      const completed = waitForEvent(xhr, 'loadend');
      xhr.send();
      await completed;

      if (responseType === 'arraybuffer') {
        expect(Array.from(new Uint8Array(xhr.response as ArrayBuffer))).toEqual(
          bytes
        );
      }
      expect(mockNitroFetch).toHaveBeenCalledWith(
        'https://example.com/bytes',
        expect.anything()
      );
      expect(sentEvents().options.responseBytes).toBe(true);
      expect(sentInit().stream).toBeUndefined();
    }
  );

  it('sends a method the buffered client has no enum value for as a custom method', async () => {
    mockNitroFetch.mockResolvedValue(
      makeResponse([new TextEncoder().encode('ok')])
    );

    const xhr = new NitroXMLHttpRequest();
    xhr.open('PROPFIND', 'https://example.com/dav');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(mockNitroFetch).toHaveBeenCalledWith(
      'https://example.com/dav',
      expect.objectContaining({ method: 'PROPFIND' })
    );
    expect(sentEvents().options.customMethod).toBe('PROPFIND');
    expect(sentInit().stream).toBeUndefined();
  });

  it('reports the head of a buffered response before its body', async () => {
    let init: NitroRawInit = {};
    let resolveResponse: (response: Response) => void = () => {};
    mockNitroFetch.mockImplementation((_input, requestInit) => {
      init = requestInit as NitroRawInit;
      return new Promise((resolve) => {
        resolveResponse = resolve;
      });
    });

    const xhr = new NitroXMLHttpRequest();
    const seen: Array<[number, number, string]> = [];
    xhr.addEventListener('readystatechange', () => {
      seen.push([xhr.readyState, xhr.status, xhr.responseText]);
    });
    xhr.open('GET', 'https://example.com/slow');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();

    init._withEvents?.onResponseStarted?.(
      responseInfo(
        { 'Content-Type': 'text/plain' },
        { status: 201, url: 'https://example.com/final' }
      )
    );
    expect(xhr.readyState).toBe(NitroXMLHttpRequest.HEADERS_RECEIVED);
    expect(xhr.status).toBe(201);
    expect(xhr.responseURL).toBe('https://example.com/final');
    expect(xhr.getResponseHeader('content-type')).toBe('text/plain');

    resolveResponse(
      makeResponse([new TextEncoder().encode('done')], {
        headers: { 'content-type': 'text/plain' },
        status: 201,
        url: 'https://example.com/final',
      })
    );
    await completed;

    expect(seen).toEqual([
      [1, 0, ''],
      [2, 201, ''],
      [3, 201, 'done'],
      [4, 201, 'done'],
    ]);
  });

  it('fires readystatechange for each state of a buffered response', async () => {
    const encoder = new TextEncoder();
    const response = makeResponse(
      [encoder.encode('{"ok":'), encoder.encode('true}')],
      { headers: { 'content-length': '11' } }
    );
    mockNitroFetch.mockResolvedValue(response);

    const xhr = new NitroXMLHttpRequest();
    const seen: Array<[number, string]> = [];
    xhr.addEventListener('readystatechange', () => {
      seen.push([xhr.readyState, xhr.responseText]);
    });
    xhr.open('GET', 'https://example.com/buffered');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(seen).toEqual([
      [1, ''],
      [2, ''],
      [3, '{"ok":true}'],
      [4, '{"ok":true}'],
    ]);
  });

  it('uses the text the buffered client decoded', async () => {
    // "café" in ISO-8859-1. The buffered client decodes it with the charset.
    const response = makeResponse([Uint8Array.of(0x63, 0x61, 0x66, 0xe9)], {
      headers: { 'content-type': 'text/plain; charset=iso-8859-1' },
      text: 'café',
    });
    mockNitroFetch.mockResolvedValue(response);

    const xhr = new NitroXMLHttpRequest();
    xhr.onreadystatechange = () => {};
    xhr.open('GET', 'https://example.com/latin1');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(xhr.responseText).toBe('café');
  });

  it('holds native progress on a text body until the text arrives', async () => {
    const headers = { 'content-length': '10' };
    mockNative(makeResponse([], { headers, text: 'abcdefghij' }), (events) => {
      events.onResponseStarted?.(responseInfo(headers));
      events.onProgress?.(3, 10);
      events.onProgress?.(10, 10);
    });

    const xhr = new NitroXMLHttpRequest();
    const progress: Array<[number, number, string]> = [];
    xhr.onprogress = (event) => {
      progress.push([event.loaded, event.total, xhr.responseText]);
    };
    xhr.open('GET', 'https://example.com/download');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(progress).toEqual([[10, 10, 'abcdefghij']]);
    expect(xhr.responseText).toBe('abcdefghij');
  });

  it('reports native progress on a binary body while it loads, once each', async () => {
    const headers = { 'content-length': '4' };
    mockNative(
      makeResponse([Uint8Array.of(1, 2, 3, 4)], { headers }),
      (events) => {
        events.onResponseStarted?.(responseInfo(headers));
        events.onProgress?.(2, 4);
        events.onProgress?.(4, 4);
      }
    );

    const xhr = new NitroXMLHttpRequest();
    const progress: Array<[number, number]> = [];
    xhr.onprogress = (event) => {
      progress.push([event.loaded, xhr.readyState]);
    };
    xhr.open('GET', 'https://example.com/bytes');
    xhr.responseType = 'arraybuffer';
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(progress).toEqual([
      [2, NitroXMLHttpRequest.HEADERS_RECEIVED],
      [4, NitroXMLHttpRequest.HEADERS_RECEIVED],
    ]);
    expect((xhr.response as ArrayBuffer).byteLength).toBe(4);
  });

  it('reports no total for a compressed stream', async () => {
    const headers = {
      'content-encoding': 'gzip',
      'content-length': '3',
      'content-type': 'text/event-stream',
    };
    mockNative(makeResponse([], { headers }), (events) => {
      events.onResponseStarted?.(responseInfo(headers));
      events.onData?.(new TextEncoder().encode('data: x\n\n').buffer);
    });

    const xhr = new NitroXMLHttpRequest();
    const progress: Array<[number, number, boolean]> = [];
    xhr.onprogress = (event) => {
      progress.push([event.loaded, event.total, event.lengthComputable]);
    };
    xhr.open('GET', 'https://example.com/gzip');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(progress).toEqual([[9, 0, false]]);
  });

  it('drops a leading byte order mark from a buffered text body', async () => {
    mockNitroFetch.mockResolvedValue(
      makeResponse([], { text: '\uFEFF{"a":1}' })
    );

    const xhr = new NitroXMLHttpRequest();
    xhr.onreadystatechange = () => {};
    xhr.open('GET', 'https://example.com/bom');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(xhr.responseText).toBe('{"a":1}');
  });

  // Native writes the next chunk into the memory of the last one once onData
  // returns.
  it('copies the streamed chunks of a binary response', async () => {
    const memory = new Uint8Array([1, 2, 3, 4]);
    mockNative(makeResponse([]), (events) => {
      events.onResponseStarted?.(responseInfo({}));
      events.onData?.(memory.buffer);
      memory.set([5, 6, 7, 8]);
      events.onData?.(memory.buffer);
    });

    const xhr = new NitroXMLHttpRequest();
    xhr.onreadystatechange = () => {};
    xhr.open('GET', 'https://example.com/binary');
    xhr.responseType = 'arraybuffer';
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(Array.from(new Uint8Array(xhr.response as ArrayBuffer))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('decodes streamed text from memory native reuses', async () => {
    const memory = new Uint8Array([0x61, 0xe2, 0x82]);
    mockNative(makeResponse([]), (events) => {
      events.onResponseStarted?.(responseInfo({}));
      events.onData?.(memory.buffer);
      // The euro sign is cut off at the end of the first chunk.
      memory.set([0xac, 0x62, 0x63]);
      events.onData?.(memory.buffer);
    });

    const xhr = new NitroXMLHttpRequest();
    xhr.onreadystatechange = () => {};
    xhr.open('GET', 'https://example.com/text');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(xhr.responseText).toBe('a\u20acbc');
  });

  it('ignores what native reports after an abort or the end', async () => {
    let init: NitroRawInit = {};
    mockNitroFetch.mockImplementation((_input, requestInit) => {
      init = requestInit as NitroRawInit;
      return new Promise(() => {});
    });
    const headers = { 'content-type': 'text/event-stream' };

    const aborted = new NitroXMLHttpRequest();
    const abortedEvents: string[] = [];
    aborted.onreadystatechange = () => abortedEvents.push('readystatechange');
    aborted.onprogress = () => abortedEvents.push('progress');
    aborted.open('GET', 'https://example.com/aborted');
    aborted.send();
    aborted.abort();
    abortedEvents.length = 0;
    init._withEvents?.onResponseStarted?.(responseInfo(headers));
    expect(
      init._withEvents?.onData?.(new TextEncoder().encode('late').buffer)
    ).toBe(false);
    init._withEvents?.onProgress?.(4, 4);
    expect(abortedEvents).toEqual([]);
    expect(aborted.readyState).toBe(NitroXMLHttpRequest.UNSENT);

    mockNative(makeResponse([new TextEncoder().encode('done')]), (events) => {
      init = { _withEvents: events };
    });
    const done = new NitroXMLHttpRequest();
    done.onreadystatechange = () => {};
    done.onprogress = () => {};
    done.open('GET', 'https://example.com/done');
    const completed = waitForEvent(done, 'loadend');
    done.send();
    await completed;
    const doneEvents: string[] = [];
    done.addEventListener('readystatechange', () =>
      doneEvents.push('readystatechange')
    );
    done.addEventListener('progress', () => doneEvents.push('progress'));
    init._withEvents?.onResponseStarted?.(responseInfo(headers));
    init._withEvents?.onData?.(new TextEncoder().encode('late').buffer);
    init._withEvents?.onProgress?.(8, 8);
    expect(doneEvents).toEqual([]);
    expect(done.responseText).toBe('done');
  });

  it('reports progress that came with the whole body after the head', async () => {
    mockNative(makeResponse([new TextEncoder().encode('abcd')]), (events) => {
      events.onProgress?.(4, 4);
    });

    const xhr = new NitroXMLHttpRequest();
    const events: string[] = [];
    xhr.addEventListener('readystatechange', () => {
      events.push(`readystatechange.${xhr.readyState}`);
    });
    xhr.addEventListener('progress', (event) => {
      events.push(`progress.${(event as ProgressEvent).loaded}`);
    });
    xhr.open('GET', 'https://example.com/small');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(events).toEqual([
      'readystatechange.1',
      'readystatechange.2',
      'readystatechange.3',
      'progress.4',
      'readystatechange.4',
    ]);
  });

  it.each<[string, boolean]>([
    ['text/event-stream', true],
    ['Text/Event-Stream', true],
    ['text/event-stream; charset=utf-8', true],
    ['application/json, text/event-stream;q=0.9', true],
    ['application/json, text/plain, */*', false],
    ['text/event-streams', false],
  ])(
    'with Accept %p, uses the stream client connections: %p',
    async (accept, separateConnections) => {
      const encoder = new TextEncoder();
      const response = makeResponse([encoder.encode('data: ok\n\n')]);
      mockNitroFetch.mockResolvedValue(response);

      const xhr = new NitroXMLHttpRequest();
      xhr.onreadystatechange = () => {};
      xhr.open('GET', 'https://example.com/events');
      xhr.setRequestHeader('Accept', accept);
      const completed = waitForEvent(xhr, 'loadend');
      xhr.send();
      await completed;

      expect(mockNitroFetch).toHaveBeenCalledWith(
        'https://example.com/events',
        expect.anything()
      );
      expect(sentEvents().options.separateConnections).toBe(
        separateConnections
      );
      expect(sentInit().stream).toBeUndefined();
    }
  );

  it('returns parsed JSON for responseType json', async () => {
    const encoder = new TextEncoder();
    const response = makeResponse([encoder.encode('{"value":42}')]);
    mockNitroFetch.mockResolvedValue(response);

    const xhr = new NitroXMLHttpRequest();
    xhr.open('GET', 'https://example.com/json');
    xhr.responseType = 'json';
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(xhr.response).toEqual({ value: 42 });
  });

  it('aborts the Nitro request through AbortController', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockNitroFetch.mockImplementation((_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    });

    const xhr = new NitroXMLHttpRequest();
    const events: string[] = [];
    xhr.addEventListener('abort', () => events.push('abort'));
    xhr.addEventListener('loadend', () => events.push('loadend'));
    xhr.open('GET', 'https://example.com/slow');
    xhr.send();
    expect(() => {
      xhr.responseType = 'json';
    }).toThrow('response type cannot be set after the request has been sent');
    xhr.abort();

    expect(capturedSignal?.aborted).toBe(true);
    expect(events).toEqual(['abort', 'loadend']);
    expect(xhr.readyState).toBe(NitroXMLHttpRequest.UNSENT);
  });

  it('finishes with status zero after a network error', async () => {
    mockNitroFetch.mockRejectedValue(new Error('network failed'));

    const xhr = new NitroXMLHttpRequest();
    const events: string[] = [];
    xhr.addEventListener('error', () => events.push('error'));
    xhr.open('GET', 'https://example.com/failure');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(xhr.status).toBe(0);
    expect(xhr.readyState).toBe(NitroXMLHttpRequest.DONE);
    expect(events).toEqual(['error']);
  });

  it('uses React Native timeout event ordering', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockNitroFetch.mockImplementation((_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    });

    const xhr = new NitroXMLHttpRequest();
    const events: string[] = [];
    xhr.timeout = 5;
    xhr.addEventListener('timeout', () => events.push('timeout'));
    xhr.addEventListener('loadend', () => events.push('loadend'));
    xhr.open('GET', 'https://example.com/slow');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(capturedSignal?.aborted).toBe(true);
    expect(events).toEqual(['timeout', 'loadend']);
    expect(xhr.readyState).toBe(NitroXMLHttpRequest.DONE);
  });

  it('throws InvalidStateError DOMExceptions for calls in the wrong state', () => {
    hangingFetch();
    const xhr = new NitroXMLHttpRequest();
    expect(errorName(() => xhr.setRequestHeader('X-A', '1'))).toBe(
      'InvalidStateError'
    );
    expect(errorName(() => xhr.send())).toBe('InvalidStateError');

    xhr.open('GET', 'https://example.com/slow');
    xhr.responseType = 'json';
    expect(errorName(() => xhr.responseText)).toBe('InvalidStateError');
    expect(() => xhr.responseText).toThrow(DOMException);

    xhr.send();
    expect(errorName(() => xhr.send())).toBe('InvalidStateError');
    expect(errorName(() => xhr.setRequestHeader('X-A', '1'))).toBe(
      'InvalidStateError'
    );
    xhr.abort();
  });

  it('allows setting responseType until send()', async () => {
    const encoder = new TextEncoder();
    mockNitroFetch.mockResolvedValue(makeResponse([encoder.encode('{"a":1}')]));

    const xhr = new NitroXMLHttpRequest();
    const errors: Array<[number, string]> = [];
    xhr.onreadystatechange = () => {
      if (xhr.readyState === NitroXMLHttpRequest.OPENED) return;
      const name = errorName(() => {
        xhr.responseType = 'text';
      });
      errors.push([xhr.readyState, name]);
    };
    xhr.open('GET', 'https://example.com/json');
    xhr.responseType = 'json';
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    errors.push([
      xhr.readyState,
      errorName(() => {
        xhr.responseType = 'text';
      }),
    ]);
    await completed;

    // The transport is chosen at send(), so the type is fixed from then on.
    expect(errors).toEqual([
      [NitroXMLHttpRequest.OPENED, 'InvalidStateError'],
      [NitroXMLHttpRequest.HEADERS_RECEIVED, 'InvalidStateError'],
      [NitroXMLHttpRequest.LOADING, 'InvalidStateError'],
      [NitroXMLHttpRequest.DONE, 'InvalidStateError'],
    ]);
    expect(xhr.responseType).toBe('json');
    expect(xhr.response).toEqual({ a: 1 });

    // A reopened request can change it again.
    xhr.onreadystatechange = null;
    xhr.open('GET', 'https://example.com/text');
    xhr.responseType = 'text';
    expect(xhr.responseType).toBe('text');
  });

  it.each(['CONNECT', 'connect', 'TRACE', 'trace', 'TRACK', 'Track'])(
    'open() throws SecurityError for %p and sends nothing',
    (method) => {
      const xhr = new NitroXMLHttpRequest();
      expect(errorName(() => xhr.open(method, 'https://example.com'))).toBe(
        'SecurityError'
      );
      expect(xhr.readyState).toBe(NitroXMLHttpRequest.UNSENT);
      expect(errorName(() => xhr.send())).toBe('InvalidStateError');
      expect(mockNitroFetch).not.toHaveBeenCalled();
    }
  );

  it.each(['GE T', 'GET\n', '', 'GET(', 'G\u00c9T'])(
    'open() throws SyntaxError for the method %p',
    (method) => {
      const xhr = new NitroXMLHttpRequest();
      expect(errorName(() => xhr.open(method, 'https://example.com'))).toBe(
        'SyntaxError'
      );
      expect(xhr.readyState).toBe(NitroXMLHttpRequest.UNSENT);
    }
  );

  it.each([
    '',
    'http://',
    'http://[',
    'http://exa mple.com/',
    'http://exa<mple.com/',
    'https://example.com:99999/',
    'https://example.com:80a/',
    'http://user@:80/',
  ])('open() throws SyntaxError for the URL %p', (url) => {
    const xhr = new NitroXMLHttpRequest();
    expect(errorName(() => xhr.open('GET', url))).toBe('SyntaxError');
    expect(xhr.readyState).toBe(NitroXMLHttpRequest.UNSENT);
  });

  it.each([
    'https://example.com',
    ' https://example.com/a b ',
    'HTTP://EXAMPLE.COM:8080/',
    'http://example.com:/',
    'http://[::1]:8080/',
    'https://user:pass@example.com/',
    'file:///data/file.txt',
    'data:,x',
  ])('open() accepts the URL %p', (url) => {
    const xhr = new NitroXMLHttpRequest();
    expect(errorName(() => xhr.open('GET', url))).toBe('no error');
    expect(xhr.readyState).toBe(NitroXMLHttpRequest.OPENED);
  });

  it.each([
    ['post', 'POST'],
    ['Delete', 'DELETE'],
    ['get', 'GET'],
    ['head', 'HEAD'],
    ['options', 'OPTIONS'],
    ['put', 'PUT'],
    ['patch', 'patch'],
    ['PATCH', 'PATCH'],
    ['propfind', 'propfind'],
  ])('sends the method %p as %p', async (method, sent) => {
    mockNitroFetch.mockResolvedValue(makeResponse([]));
    const xhr = new NitroXMLHttpRequest();
    xhr.open(method, 'https://example.com/method');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(mockNitroFetch).toHaveBeenCalledWith(
      'https://example.com/method',
      expect.objectContaining({ method: sent })
    );
  });

  it.each<[string, string | undefined]>([
    ['patch', undefined],
    ['Delete', undefined],
    ['propfind', 'PROPFIND'],
  ])(
    'asks the client for the method %p by its upper-case name: %p',
    async (method, customMethod) => {
      mockNitroFetch.mockResolvedValue(makeResponse([]));
      const xhr = new NitroXMLHttpRequest();
      xhr.onload = () => {};
      xhr.open(method, 'https://example.com/method');
      const completed = waitForEvent(xhr, 'loadend');
      xhr.send();
      await completed;

      expect(sentEvents().options.customMethod).toBe(customMethod);
    }
  );

  it('setRequestHeader() throws SyntaxError for an invalid name or value', async () => {
    mockNitroFetch.mockResolvedValue(makeResponse([]));
    const xhr = new NitroXMLHttpRequest();
    xhr.open('POST', 'https://example.com/headers');
    for (const name of ['Bad Header', 'X-A:', '', 'X-\u00c4', 'X-A\r\n']) {
      expect(errorName(() => xhr.setRequestHeader(name, 'v'))).toBe(
        'SyntaxError'
      );
    }
    for (const value of [
      'a\r\nb',
      'a\nInjected: 1',
      'a\rb',
      'a\u0000b',
      '\u0000a',
      ' a\u0000',
    ]) {
      expect(errorName(() => xhr.setRequestHeader('X-Bad', value))).toBe(
        'SyntaxError'
      );
    }
    // Leading and trailing whitespace is dropped before the check.
    xhr.setRequestHeader('X-Padded', ' \tvalue\r\n');
    xhr.setRequestHeader('X-Trailing', 'a\n');
    xhr.setRequestHeader('X-Inner', 'a\tb');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(mockNitroFetch).toHaveBeenCalledWith(
      'https://example.com/headers',
      expect.objectContaining({
        headers: { 'x-padded': 'value', 'x-trailing': 'a', 'x-inner': 'a\tb' },
      })
    );
  });

  it('checks header values that JSON escapes, and long ones', async () => {
    mockNitroFetch.mockResolvedValue(makeResponse([]));
    const xhr = new NitroXMLHttpRequest();
    xhr.open('GET', 'https://example.com/headers');
    const long = 'x'.repeat(800);
    for (const value of [
      '"a\nb"',
      'a\\\r\nb',
      `${long}\r${long}`,
      `${long}\u0000`,
    ]) {
      expect(errorName(() => xhr.setRequestHeader('X-Bad', value))).toBe(
        'SyntaxError'
      );
    }
    const accepted = {
      'x-etag': '"abc"',
      'x-backslash': 'a\\b',
      'x-tab': 'a\tb',
      'x-surrogate': '\uD800a',
      'x-long': `Bearer ${long}`,
    };
    for (const [name, value] of Object.entries(accepted)) {
      xhr.setRequestHeader(name, value);
    }
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(mockNitroFetch).toHaveBeenCalledWith(
      'https://example.com/headers',
      expect.objectContaining({ headers: accepted })
    );
  });

  it('checks header names the same way once it has seen many', async () => {
    mockNitroFetch.mockResolvedValue(makeResponse([]));
    const xhr = new NitroXMLHttpRequest();
    xhr.open('GET', 'https://example.com/headers');
    // More names than the lower-case keys kept for them.
    for (let i = 0; i < 300; i++) {
      xhr.setRequestHeader(`X-Name-${i}`, 'v');
      expect(errorName(() => xhr.setRequestHeader(`Bad Name ${i}`, 'v'))).toBe(
        'SyntaxError'
      );
    }
    xhr.setRequestHeader('X-NAME-0', 'w');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    const headers = mockNitroFetch.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(Object.keys(headers)).toHaveLength(300);
    expect(headers['x-name-0']).toBe('v, w');
    expect(headers['x-name-299']).toBe('v');
  });

  it('checks the whole URL on an origin it has accepted', () => {
    const accepts = (url: string) =>
      errorName(() => new NitroXMLHttpRequest().open('GET', url));
    expect(accepts('http://example.com:8080/a')).toBe('no error');
    for (const url of [
      'http://example.com:8080',
      'http://example.com:8080?q=1',
      'http://example.com:8080#f',
      'http://example.com:8080/b',
      // userinfo before the real host
      'http://example.com:8080@other.example/',
    ]) {
      expect(accepts(url)).toBe('no error');
    }
    for (const url of [
      'http://example.com:80800/',
      'http://example.com:8080</',
      'http://example.com:8080 /',
      'http://example.com:8080:1/',
      'http://example.com:65536/',
    ]) {
      expect(accepts(url)).toBe('SyntaxError');
    }
  });

  it('open() stops a LOADING request without events and reuses the object', async () => {
    const encoder = new TextEncoder();
    const signals = openNative([encoder.encode('partial')]);

    const xhr = new NitroXMLHttpRequest();
    const events = recordEvents(xhr);
    xhr.open('GET', 'https://example.com/first');
    xhr.setRequestHeader('X-First', '1');
    xhr.responseType = 'text';
    const loading = new Promise<void>((resolve) => {
      xhr.onprogress = () => resolve();
    });
    xhr.send();
    await loading;
    expect(xhr.readyState).toBe(NitroXMLHttpRequest.LOADING);
    events.length = 0;
    xhr.onprogress = null;

    xhr.open('POST', 'https://example.com/second');
    expect(signals[0]?.aborted).toBe(true);
    expect(events).toEqual(['readystatechange']);
    expect(xhr.readyState).toBe(NitroXMLHttpRequest.OPENED);
    expect(xhr.status).toBe(0);
    expect(xhr.responseText).toBe('');
    expect(xhr.responseType).toBe('text');

    mockNitroFetch.mockResolvedValue(makeResponse([encoder.encode('second')]));
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send('body');
    await completed;
    expect(mockNitroFetch).toHaveBeenLastCalledWith(
      'https://example.com/second',
      expect.objectContaining({ headers: {}, method: 'POST' })
    );
    expect(xhr.responseText).toBe('second');
    expect(events).not.toContain('abort');
  });

  it('open() before the response stops the request without events', () => {
    const signals = hangingFetch();
    const xhr = new NitroXMLHttpRequest();
    xhr.open('GET', 'https://example.com/first');
    xhr.send();
    const events = recordEvents(xhr);
    xhr.open('GET', 'https://example.com/second');

    expect(signals[0]?.aborted).toBe(true);
    // The state stays OPENED, so there is no readystatechange either.
    expect(events).toEqual([]);
    expect(xhr.readyState).toBe(NitroXMLHttpRequest.OPENED);
    expect(errorName(() => xhr.setRequestHeader('X-Second', '1'))).toBe(
      'no error'
    );
  });

  it('open() after DONE reuses the object', async () => {
    const encoder = new TextEncoder();
    mockNitroFetch.mockResolvedValueOnce(
      makeResponse([encoder.encode('first')])
    );
    mockNitroFetch.mockResolvedValueOnce(
      makeResponse([encoder.encode('second')])
    );
    const xhr = new NitroXMLHttpRequest();
    xhr.open('GET', 'https://example.com/first');
    let completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;
    expect(xhr.responseText).toBe('first');

    xhr.open('GET', 'https://example.com/second');
    expect(xhr.readyState).toBe(NitroXMLHttpRequest.OPENED);
    expect(xhr.responseText).toBe('');
    completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;
    expect(xhr.responseText).toBe('second');
  });

  it('ends an aborted request with abort when a listener calls open()', () => {
    hangingFetch();
    const xhr = new NitroXMLHttpRequest();
    xhr.open('GET', 'https://example.com/slow');
    xhr.send();
    const events = recordEvents(xhr);
    xhr.addEventListener('readystatechange', () => {
      if (xhr.readyState === NitroXMLHttpRequest.DONE) {
        xhr.open('GET', 'https://example.com/next');
      }
    });
    xhr.abort();

    // DONE, then OPENED from open(), then the aborted request's events.
    expect(events).toEqual([
      'readystatechange',
      'readystatechange',
      'abort',
      'loadend',
    ]);
    expect(xhr.readyState).toBe(NitroXMLHttpRequest.OPENED);
  });

  it('abort() before send() keeps the request OPENED, and send() works', async () => {
    mockNitroFetch.mockResolvedValue(makeResponse([]));
    const xhr = new NitroXMLHttpRequest();
    xhr.open('GET', 'https://example.com/get');
    xhr.setRequestHeader('X-Kept', '1');
    const events = recordEvents(xhr);
    xhr.abort();
    expect(events).toEqual([]);
    expect(xhr.readyState).toBe(NitroXMLHttpRequest.OPENED);

    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;
    expect(xhr.status).toBe(200);
    expect(events).toContain('load');
    expect(events).not.toContain('abort');
    expect(mockNitroFetch).toHaveBeenCalledWith(
      'https://example.com/get',
      expect.objectContaining({ headers: { 'x-kept': '1' } })
    );
  });

  describe('timeout', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('set after send() counts from send()', () => {
      const signals = hangingFetch();
      const xhr = new NitroXMLHttpRequest();
      xhr.open('GET', 'https://example.com/slow');
      xhr.send();
      const events = recordEvents(xhr);
      jest.advanceTimersByTime(300);
      xhr.timeout = 500;
      jest.advanceTimersByTime(199);
      expect(events).toEqual([]);
      jest.advanceTimersByTime(1);

      expect(signals[0]?.aborted).toBe(true);
      expect(events).toEqual(['readystatechange', 'timeout', 'loadend']);
      expect(xhr.readyState).toBe(NitroXMLHttpRequest.DONE);
    });

    it('that has already passed fires at once', () => {
      hangingFetch();
      const xhr = new NitroXMLHttpRequest();
      xhr.open('GET', 'https://example.com/slow');
      xhr.send();
      const events = recordEvents(xhr);
      jest.advanceTimersByTime(300);
      xhr.timeout = 100;
      jest.advanceTimersByTime(0);

      expect(events).toEqual(['readystatechange', 'timeout', 'loadend']);
    });

    it('set to 0 after send() cancels the timer', () => {
      const signals = hangingFetch();
      const xhr = new NitroXMLHttpRequest();
      xhr.timeout = 100;
      xhr.open('GET', 'https://example.com/slow');
      xhr.send();
      const events = recordEvents(xhr);
      xhr.timeout = 0;
      jest.advanceTimersByTime(10_000);

      expect(events).toEqual([]);
      expect(signals[0]?.aborted).toBe(false);
      xhr.abort();
    });

    it('does not fire after the request completes', async () => {
      mockNitroFetch.mockResolvedValue(makeResponse([]));
      const xhr = new NitroXMLHttpRequest();
      const events = recordEvents(xhr);
      xhr.timeout = 100;
      xhr.open('GET', 'https://example.com/fast');
      const completed = waitForEvent(xhr, 'loadend');
      xhr.send();
      await completed;
      jest.advanceTimersByTime(1_000);

      expect(events).toContain('load');
      expect(events).not.toContain('timeout');
    });

    it('converts the value like a browser', () => {
      const signals = hangingFetch();
      const xhr = new NitroXMLHttpRequest();
      xhr.timeout = 'abc' as unknown as number;
      expect(xhr.timeout).toBe(0);
      xhr.timeout = 12.7;
      expect(xhr.timeout).toBe(12);
      // axios passes config.timeout on as given, which can be a string.
      xhr.timeout = '50' as unknown as number;
      expect(xhr.timeout).toBe(50);
      xhr.open('GET', 'https://example.com/slow');
      xhr.send();
      const events = recordEvents(xhr);
      jest.advanceTimersByTime(49);
      expect(events).toEqual([]);
      jest.advanceTimersByTime(1);

      expect(events).toEqual(['readystatechange', 'timeout', 'loadend']);
      expect(signals[0]?.aborted).toBe(true);
    });
  });

  it('does not call a listener removed during dispatch', async () => {
    mockNitroFetch.mockResolvedValue(makeResponse([]));
    const xhr = new NitroXMLHttpRequest();
    const calls: string[] = [];
    const removed = () => calls.push('removed');
    const removedObject = { handleEvent: () => calls.push('removedObject') };
    xhr.addEventListener('load', () => {
      calls.push('first');
      xhr.removeEventListener('load', removed);
      xhr.removeEventListener('load', removedObject);
    });
    xhr.addEventListener('load', removed);
    xhr.addEventListener('load', removedObject);
    xhr.addEventListener('load', () => calls.push('last'));
    xhr.open('GET', 'https://example.com/get');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(calls).toEqual(['first', 'last']);
  });

  it('fires no load or loadend for a request reopened at DONE', async () => {
    const encoder = new TextEncoder();
    mockNitroFetch.mockResolvedValueOnce(
      makeResponse([encoder.encode('first')])
    );
    mockNitroFetch.mockResolvedValueOnce(
      makeResponse([encoder.encode('second')])
    );
    const xhr = new NitroXMLHttpRequest();
    const events: string[] = [];
    let retried = false;
    // A retry from the DONE readystatechange.
    xhr.onreadystatechange = () => {
      if (xhr.readyState === NitroXMLHttpRequest.DONE && !retried) {
        retried = true;
        xhr.open('GET', 'https://example.com/second');
        xhr.send();
      }
    };
    for (const type of ['load', 'loadend']) {
      xhr.addEventListener(type, () => {
        events.push(`${type} ${xhr.readyState} ${xhr.responseText}`);
      });
    }
    xhr.open('GET', 'https://example.com/first');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(events).toEqual(['load 4 second', 'loadend 4 second']);
  });

  it('reports throwing listeners to ErrorUtils when React Native has it', async () => {
    const globals = globalThis as { ErrorUtils?: unknown };
    const reportError = jest.fn();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    globals.ErrorUtils = { reportError };
    try {
      mockNitroFetch.mockResolvedValue(makeResponse([]));
      const xhr = new NitroXMLHttpRequest();
      const boom = new Error('boom');
      const events: string[] = [];
      xhr.addEventListener('load', () => {
        throw boom;
      });
      xhr.addEventListener('load', () => events.push('load'));
      xhr.addEventListener('loadend', () => events.push('loadend'));
      xhr.open('GET', 'https://example.com/get');
      const completed = waitForEvent(xhr, 'loadend');
      xhr.send();
      await completed;

      expect(events).toEqual(['load', 'loadend']);
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(boom);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      delete globals.ErrorUtils;
      errorSpy.mockRestore();
    }
  });

  it('reports throwing listeners with console.error and keeps dispatching', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const encoder = new TextEncoder();
      mockNitroFetch.mockResolvedValue(makeResponse([encoder.encode('ok')]));
      const xhr = new NitroXMLHttpRequest();
      const boom = new Error('boom');
      const events: string[] = [];
      xhr.onreadystatechange = () => {
        throw boom;
      };
      xhr.addEventListener('readystatechange', () => {
        events.push(`readystatechange.${xhr.readyState}`);
      });
      xhr.addEventListener('load', () => {
        throw boom;
      });
      xhr.addEventListener('load', () => events.push('load'));
      xhr.addEventListener('error', () => events.push('error'));
      xhr.addEventListener('loadend', () => events.push('loadend'));
      expect(() => xhr.open('GET', 'https://example.com/get')).not.toThrow();
      const completed = waitForEvent(xhr, 'loadend');
      xhr.send();
      await completed;

      expect(events).toEqual([
        'readystatechange.1',
        'readystatechange.2',
        'readystatechange.3',
        'readystatechange.4',
        'load',
        'loadend',
      ]);
      expect(xhr.status).toBe(200);
      expect(xhr.responseText).toBe('ok');
      // onreadystatechange for states 1 to 4, then the load listener.
      expect(errorSpy).toHaveBeenCalledTimes(5);
      expect(errorSpy).toHaveBeenCalledWith(boom);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it.each([true, false])(
    'fires loadstart in send() and ends with the bytes received (progress listener: %p)',
    async (observesProgress) => {
      mockBuffered([new Uint8Array(1024)], {
        headers: { 'content-length': '1024' },
      });

      const xhr = new NitroXMLHttpRequest();
      const events = recordProgressEvents(
        xhr,
        PROGRESS_EVENT_TYPES.filter(
          (type) => observesProgress || type !== 'progress'
        )
      );
      xhr.open('GET', 'https://example.com/bytes');
      const completed = waitForEvent(xhr, 'loadend');
      xhr.send();
      expect(eventNames(events)).toEqual(['loadstart']);
      await completed;

      const done = { loaded: 1024, total: 1024, lengthComputable: true };
      expect(events).toEqual([
        {
          name: 'loadstart',
          readyState: 1,
          loaded: 0,
          total: 0,
          lengthComputable: false,
        },
        ...(observesProgress
          ? [{ name: 'progress', readyState: 3, ...done }]
          : []),
        { name: 'load', readyState: 4, ...done },
        { name: 'loadend', readyState: 4, ...done },
      ]);
    }
  );

  it.each<[string, Record<string, string>]>([
    ['without Content-Length', {}],
    [
      'for a decompressed body',
      { 'content-encoding': 'gzip', 'content-length': '20' },
    ],
    ['for a Content-Length in exponent form', { 'content-length': '1e2' }],
    ['for a hexadecimal Content-Length', { 'content-length': '0x64' }],
    ['for a negative Content-Length', { 'content-length': '-100' }],
  ])('reports no download total %s', async (_reason, headers) => {
    mockBuffered([new Uint8Array(100)], { headers });

    const xhr = new NitroXMLHttpRequest();
    const events = recordProgressEvents(xhr);
    xhr.open('GET', 'https://example.com/text');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    const unknown = { loaded: 100, total: 0, lengthComputable: false };
    expect(events.slice(1)).toEqual([
      { name: 'progress', readyState: 3, ...unknown },
      { name: 'load', readyState: 4, ...unknown },
      { name: 'loadend', readyState: 4, ...unknown },
    ]);
  });

  it('fires upload events between loadstart and the response headers', async () => {
    mockBuffered([new TextEncoder().encode('ok')]);
    const xhr = new NitroXMLHttpRequest();
    const events = recordProgressEvents(xhr);
    xhr.open('POST', 'https://example.com/upload');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send('héllo');
    expect(eventNames(events)).toEqual(['loadstart', 'upload.loadstart']);
    await completed;

    const sent = { loaded: 6, total: 6, lengthComputable: true };
    expect(events.slice(1, 5)).toEqual([
      { name: 'upload.loadstart', readyState: 1, ...sent, loaded: 0 },
      { name: 'upload.progress', readyState: 1, ...sent },
      { name: 'upload.load', readyState: 1, ...sent },
      { name: 'upload.loadend', readyState: 1, ...sent },
    ]);
    expect(eventNames(events.slice(5))).toEqual([
      'progress',
      'load',
      'loadend',
    ]);
  });

  it.each<[string, () => XMLHttpRequestBodyInit, number]>([
    ['an ASCII string', () => 'hello', 5],
    ['a Uint8Array', () => new Uint8Array(3), 3],
    ['an ArrayBuffer', () => new ArrayBuffer(4), 4],
    ['a Blob', () => new Blob(['blob']), 4],
    ['URLSearchParams', () => new URLSearchParams('q=é'), 8],
    ['FormData', () => new FormData(), 0],
  ])('reports the upload total of %s', (_reason, makeBody, total) => {
    hangingFetch();
    const xhr = new NitroXMLHttpRequest();
    const totals: Array<[number, boolean]> = [];
    xhr.upload.onloadstart = (event) => {
      totals.push([event.total, event.lengthComputable]);
    };
    xhr.open('POST', 'https://example.com/upload');
    xhr.send(makeBody());
    xhr.abort();

    expect(totals).toEqual([[total, total > 0]]);
  });

  it('sends a string whose size cannot be counted without throwing', async () => {
    // React Native's Blob counts a string's bytes with encodeURI, which throws
    // on a lone surrogate.
    const globals = globalThis as { Blob: typeof Blob };
    const NodeBlob = globals.Blob;
    globals.Blob = class extends NodeBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        for (const part of parts ?? []) {
          if (typeof part === 'string') encodeURI(part);
        }
        super(parts, options);
      }
    };
    try {
      mockNitroFetch.mockResolvedValue(
        makeResponse([new TextEncoder().encode('ok')])
      );
      const xhr = new NitroXMLHttpRequest();
      const events = recordProgressEvents(xhr);
      xhr.open('POST', 'https://example.com/upload');
      const completed = waitForEvent(xhr, 'loadend');
      expect(() => xhr.send('a\uD800b')).not.toThrow();
      await completed;

      const upload = events.filter(
        (event) =>
          event.name.startsWith('upload.') && event.name !== 'upload.progress'
      );
      expect(upload.map((event) => [event.name, event.readyState])).toEqual([
        ['upload.loadstart', 1],
        ['upload.load', 1],
        ['upload.loadend', 1],
      ]);
      expect(eventNames(events).slice(-2)).toEqual(['load', 'loadend']);
      expect(mockNitroFetch).toHaveBeenCalledWith(
        'https://example.com/upload',
        expect.objectContaining({ body: 'a\uD800b' })
      );
    } finally {
      globals.Blob = NodeBlob;
    }
  });

  it('measures and reports the upload only if it had listeners at send()', async () => {
    const globals = globalThis as { Blob: typeof Blob };
    const NodeBlob = globals.Blob;
    let blobs = 0;
    globals.Blob = class extends NodeBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        blobs += 1;
      }
    };
    try {
      mockNitroFetch.mockResolvedValue(
        makeResponse([new TextEncoder().encode('ok')])
      );
      const xhr = new NitroXMLHttpRequest();
      xhr.open('POST', 'https://example.com/upload');
      const completed = waitForEvent(xhr, 'loadend');
      xhr.send('body');
      const events = recordProgressEvents(xhr);
      await completed;

      expect(blobs).toBe(0);
      // A listener added after send() is too late to ask for progress.
      expect(eventNames(events)).toEqual(['load', 'loadend']);
    } finally {
      globals.Blob = NodeBlob;
    }
  });

  it('reports a FormData upload without progress, as its size is unknown', async () => {
    mockNitroFetch.mockResolvedValue(
      makeResponse([new TextEncoder().encode('ok')])
    );
    const form = new FormData();
    form.append('message', 'hello');
    const xhr = new NitroXMLHttpRequest();
    const events = recordProgressEvents(xhr);
    xhr.open('POST', 'https://example.com/upload');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send(form);
    await completed;

    const unknown = {
      readyState: 1,
      loaded: 0,
      total: 0,
      lengthComputable: false,
    };
    expect(events.filter((event) => event.name.startsWith('upload.'))).toEqual([
      { name: 'upload.loadstart', ...unknown },
      { name: 'upload.load', ...unknown },
      { name: 'upload.loadend', ...unknown },
    ]);
  });

  it.each(['load', 'loadend'])(
    'reports the bytes received to an on%s property alone',
    async (type) => {
      const response = makeResponse([new Uint8Array(1024)], {
        headers: { 'content-length': '1024' },
      });
      mockNitroFetch.mockResolvedValue(response);

      const xhr = new NitroXMLHttpRequest();
      const fieldsOf = (event: ProgressEvent) => ({
        loaded: event.loaded,
        total: event.total,
        lengthComputable: event.lengthComputable,
      });
      let loadstart: unknown;
      xhr.onloadstart = (event) => {
        loadstart = fieldsOf(event);
      };
      const done = new Promise((resolve) => {
        if (type === 'load') xhr.onload = (event) => resolve(fieldsOf(event));
        else xhr.onloadend = (event) => resolve(fieldsOf(event));
      });
      xhr.open('GET', 'https://example.com/bytes');
      xhr.send();

      expect(loadstart).toEqual({
        loaded: 0,
        total: 0,
        lengthComputable: false,
      });
      expect(await done).toEqual({
        loaded: 1024,
        total: 1024,
        lengthComputable: true,
      });
    }
  );

  it.each([
    'loadstart',
    'progress',
    'load',
    'loadend',
    'abort',
    'error',
    'timeout',
  ])('fires upload events for an upload.on%s property alone', async (type) => {
    if (type === 'error') {
      mockNitroFetch.mockRejectedValue(new Error('network failed'));
    } else if (type === 'abort' || type === 'timeout') {
      hangingFetch();
    } else {
      mockNitroFetch.mockResolvedValue(makeResponse([]));
    }
    const xhr = new NitroXMLHttpRequest();
    const calls: string[] = [];
    (xhr.upload as unknown as Record<string, unknown>)[`on${type}`] = () => {
      calls.push(type);
    };
    if (type === 'timeout') xhr.timeout = 5;
    xhr.open('POST', 'https://example.com/upload');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send('body');
    if (type === 'abort') xhr.abort();
    await completed;

    expect(calls).toEqual([type]);
  });

  it('does not count removed upload listeners', async () => {
    mockNitroFetch.mockResolvedValue(makeResponse([]));
    const xhr = new NitroXMLHttpRequest();
    const calls: string[] = [];
    const listener = () => calls.push('upload.progress');
    xhr.upload.addEventListener('progress', listener);
    xhr.upload.removeEventListener('progress', listener);
    xhr.upload.onload = null;
    xhr.open('POST', 'https://example.com/upload');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send('body');
    // Added after send(), so it does not count either.
    xhr.upload.addEventListener('loadend', () => calls.push('upload.loadend'));
    await completed;

    expect(calls).toEqual([]);
    expect(
      (xhr.upload as unknown as { _isObserved(): boolean })._isObserved()
    ).toBe(true);
  });

  it('stops the upload events when upload.onprogress aborts', async () => {
    mockNitroFetch.mockResolvedValue(
      makeResponse([new TextEncoder().encode('ok')])
    );
    const xhr = new NitroXMLHttpRequest();
    const events: string[] = [];
    xhr.onreadystatechange = () => {
      events.push(`readystatechange.${xhr.readyState}`);
    };
    xhr.upload.onloadstart = () => events.push('upload.loadstart');
    xhr.upload.onprogress = () => {
      events.push('upload.progress');
      xhr.abort();
    };
    xhr.upload.onload = () => events.push('upload.load');
    xhr.upload.onloadend = () => events.push('upload.loadend');
    xhr.onabort = () => events.push('abort');
    const done = new Promise<void>((resolve) => {
      xhr.onloadend = () => {
        events.push('loadend');
        resolve();
      };
    });
    xhr.open('POST', 'https://example.com/upload');
    xhr.send('body');
    await done;
    // Anything the response would still have delivered.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(events).toEqual([
      'readystatechange.1',
      'upload.loadstart',
      'upload.progress',
      'readystatechange.4',
      'abort',
      'loadend',
    ]);
    expect(xhr.status).toBe(0);
  });

  it('fires the upload loadstart once when a loadstart listener sends again', async () => {
    mockBuffered([new TextEncoder().encode('ok')]);
    const xhr = new NitroXMLHttpRequest();
    const events = recordProgressEvents(xhr);
    let restarted = false;
    xhr.addEventListener('loadstart', () => {
      if (restarted) return;
      restarted = true;
      xhr.abort();
      xhr.open('POST', 'https://example.com/second');
      xhr.send('second');
    });
    xhr.open('POST', 'https://example.com/first');
    const completed = new Promise((resolve) => {
      xhr.addEventListener('load', resolve);
    });
    xhr.send('first');
    await completed;

    expect(mockNitroFetch).toHaveBeenCalledTimes(1);
    expect(mockNitroFetch).toHaveBeenCalledWith(
      'https://example.com/second',
      expect.objectContaining({ body: 'second' })
    );
    expect(eventNames(events)).toEqual([
      'loadstart',
      'upload.abort',
      'upload.loadend',
      'abort',
      'loadend',
      'loadstart',
      'upload.loadstart',
      'upload.progress',
      'upload.load',
      'upload.loadend',
      'progress',
      'load',
      'loadend',
    ]);
  });

  it('keeps sending when a progress listener throws', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockBuffered([new TextEncoder().encode('ok')]);
      const boom = new Error('boom');
      const xhr = new NitroXMLHttpRequest();
      const events = recordProgressEvents(xhr);
      xhr.onloadstart = () => {
        throw boom;
      };
      xhr.upload.onprogress = () => {
        throw boom;
      };
      xhr.open('POST', 'https://example.com/upload');
      const completed = waitForEvent(xhr, 'loadend');
      expect(() => xhr.send('body')).not.toThrow();
      await completed;

      expect(xhr.status).toBe(200);
      expect(eventNames(events)).toEqual([
        'loadstart',
        'upload.loadstart',
        'upload.progress',
        'upload.load',
        'upload.loadend',
        'progress',
        'load',
        'loadend',
      ]);
      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith(boom);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('ends a failed upload when a readystatechange listener sends again', async () => {
    mockNitroFetch.mockRejectedValueOnce(new Error('network failed'));
    mockNitroFetch.mockImplementationOnce(
      buffered([new TextEncoder().encode('ok')])
    );
    const xhr = new NitroXMLHttpRequest();
    const events = recordProgressEvents(xhr);
    let retried = false;
    xhr.addEventListener('readystatechange', () => {
      if (xhr.readyState !== NitroXMLHttpRequest.DONE || retried) return;
      retried = true;
      xhr.open('POST', 'https://example.com/second');
      xhr.send('second');
    });
    xhr.open('POST', 'https://example.com/first');
    const completed = new Promise((resolve) => {
      xhr.addEventListener('load', resolve);
    });
    xhr.send('first');
    await completed;

    expect(eventNames(events)).toEqual([
      'loadstart',
      'upload.loadstart',
      // The second request starts in the first one's readystatechange.
      'loadstart',
      'upload.loadstart',
      'upload.error',
      'upload.loadend',
      'error',
      'loadend',
      'upload.progress',
      'upload.load',
      'upload.loadend',
      'progress',
      'load',
      'loadend',
    ]);
  });

  it('fires no upload events without a request body', async () => {
    mockNitroFetch.mockResolvedValue(makeResponse([]));
    const xhr = new NitroXMLHttpRequest();
    const events = recordProgressEvents(xhr);
    xhr.open('POST', 'https://example.com/upload');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(eventNames(events)).toEqual(['loadstart', 'load', 'loadend']);
  });

  it.each(['abort', 'error', 'timeout'] as const)(
    'ends the upload, then the request, on %s',
    async (type) => {
      if (type === 'error') {
        mockNitroFetch.mockRejectedValue(new Error('network failed'));
      } else {
        hangingFetch();
      }
      const xhr = new NitroXMLHttpRequest();
      if (type === 'timeout') xhr.timeout = 5;
      const events = recordProgressEvents(xhr);
      xhr.addEventListener('readystatechange', () => {
        events.push({ name: 'readystatechange', readyState: xhr.readyState });
      });
      xhr.open('POST', 'https://example.com/upload');
      const completed = waitForEvent(xhr, 'loadend');
      xhr.send('body');
      if (type === 'abort') xhr.abort();
      await completed;

      const none = {
        readyState: 4,
        loaded: 0,
        total: 0,
        lengthComputable: false,
      };
      expect(eventNames(events.slice(0, 3))).toEqual([
        'readystatechange',
        'loadstart',
        'upload.loadstart',
      ]);
      expect(events.slice(3)).toEqual([
        { name: 'readystatechange', readyState: 4 },
        { name: `upload.${type}`, ...none },
        { name: 'upload.loadend', ...none },
        { name: type, ...none },
        { name: 'loadend', ...none },
      ]);
    }
  );

  it('does not end a finished upload again when the request is aborted', async () => {
    openNative([new TextEncoder().encode('partial')]);

    const xhr = new NitroXMLHttpRequest();
    const events = recordProgressEvents(xhr);
    xhr.addEventListener('progress', () => xhr.abort());
    xhr.open('POST', 'https://example.com/upload');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send('body');
    await completed;

    expect(eventNames(events)).toEqual([
      'loadstart',
      'upload.loadstart',
      'upload.progress',
      'upload.load',
      'upload.loadend',
      'progress',
      'abort',
      'loadend',
    ]);
  });

  it('sends nothing when a loadstart listener aborts', () => {
    hangingFetch();
    const xhr = new NitroXMLHttpRequest();
    const events = recordProgressEvents(xhr);
    xhr.addEventListener('loadstart', () => xhr.abort());
    xhr.open('POST', 'https://example.com/upload');
    xhr.send('body');

    expect(mockNitroFetch).not.toHaveBeenCalled();
    expect(eventNames(events)).toEqual([
      'loadstart',
      'upload.abort',
      'upload.loadend',
      'abort',
      'loadend',
    ]);
    expect(xhr.readyState).toBe(NitroXMLHttpRequest.UNSENT);
  });

  it('omits credentials when withCredentials is false', async () => {
    mockNitroFetch.mockResolvedValue(makeResponse([]));

    const xhr = new NitroXMLHttpRequest();
    xhr.open('GET', 'https://example.com/cookies');
    xhr.withCredentials = false;
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(mockNitroFetch).toHaveBeenCalledWith(
      'https://example.com/cookies',
      expect.objectContaining({ credentials: 'omit' })
    );
  });

  it('clears the response after an error and puts the cause in nitroError', async () => {
    const { fail } = stalledNative();

    const xhr = new NitroXMLHttpRequest();
    let atLoadend: ReturnType<typeof responseState> | undefined;
    let errorEvent: { message?: string; nitroError?: string } | undefined;
    xhr.onprogress = () => fail(new Error('connection lost'));
    xhr.addEventListener('error', (event) => {
      errorEvent = event as unknown as typeof errorEvent;
    });
    xhr.addEventListener('loadend', () => {
      atLoadend = responseState(xhr);
    });
    xhr.open('GET', 'https://example.com/drip');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(errorEvent?.nitroError).toBe('connection lost');
    // axios reports a message, when set, instead of "Network Error".
    expect(errorEvent?.message).toBeUndefined();
    expect(atLoadend).toEqual(CLEARED_STATE);
    expect(responseState(xhr)).toEqual(CLEARED_STATE);
  });

  it('has no binary response after an error', async () => {
    const { fail } = stalledNative();

    const xhr = new NitroXMLHttpRequest();
    xhr.onprogress = () => fail(new Error('connection lost'));
    xhr.open('GET', 'https://example.com/drip');
    xhr.responseType = 'arraybuffer';
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(xhr.response).toBeNull();
  });

  it('clears the response after a timeout', async () => {
    stalledNative();

    const xhr = new NitroXMLHttpRequest();
    const events: string[] = [];
    let atLoadend: ReturnType<typeof responseState> | undefined;
    // Watching the request gets it the head and the partial body.
    xhr.onreadystatechange = () => {};
    xhr.addEventListener('timeout', () => events.push('timeout'));
    xhr.addEventListener('loadend', () => {
      atLoadend = responseState(xhr);
    });
    xhr.timeout = 20;
    xhr.open('GET', 'https://example.com/slow');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(events).toEqual(['timeout']);
    expect(atLoadend).toEqual(CLEARED_STATE);
    expect(responseState(xhr)).toEqual(CLEARED_STATE);
  });

  it('clears the response when aborted after the headers', async () => {
    stalledNative();

    const xhr = new NitroXMLHttpRequest();
    let atLoadend: ReturnType<typeof responseState> | undefined;
    xhr.onprogress = () => xhr.abort();
    xhr.addEventListener('loadend', () => {
      atLoadend = responseState(xhr);
    });
    xhr.open('GET', 'https://example.com/drip');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(atLoadend).toEqual(CLEARED_STATE);
    expect(responseState(xhr)).toEqual(CLEARED_STATE);
  });

  it.each(['', 'document'] as const)(
    'returns a null responseXML for responseType %p',
    async (responseType) => {
      const encoder = new TextEncoder();
      mockNitroFetch.mockResolvedValue(
        makeResponse([encoder.encode('<a/>')], {
          headers: { 'content-type': 'text/xml' },
        })
      );

      const xhr = new NitroXMLHttpRequest();
      xhr.open('GET', 'https://example.com/xml');
      xhr.responseType = responseType;
      expect(xhr.responseXML).toBeNull();
      const completed = waitForEvent(xhr, 'loadend');
      xhr.send();
      await completed;

      expect(xhr.responseXML).toBeNull();
    }
  );

  it.each(['text', 'json', 'arraybuffer', 'blob'] as const)(
    'throws InvalidStateError from responseXML for responseType %p',
    (responseType) => {
      const xhr = new NitroXMLHttpRequest();
      xhr.open('GET', 'https://example.com/xml');
      xhr.responseType = responseType;

      let error: unknown;
      try {
        xhr.responseXML;
      } catch (caught) {
        error = caught;
      }
      expect((error as Error | undefined)?.name).toBe('InvalidStateError');
    }
  );

  async function expectUTF8Length(text: string, length: number) {
    const { utf8Length } = await import('../utf8');
    expect(new TextEncoder().encode(text).byteLength).toBe(length);
    expect(utf8Length(text)).toBe(length);
    // Without encodeInto, the length is counted in JS.
    const { encodeInto } = TextEncoder.prototype;
    Object.defineProperty(TextEncoder.prototype, 'encodeInto', {
      configurable: true,
      value: undefined,
    });
    try {
      expect(utf8Length(text)).toBe(length);
    } finally {
      Object.defineProperty(TextEncoder.prototype, 'encodeInto', {
        configurable: true,
        value: encodeInto,
        writable: true,
      });
    }
  }

  it.each([
    ['a', 1],
    ['é', 2],
    ['日', 3],
    ['\uD83D\uDE80', 4],
    ['\uD800', 3],
    ['\uDC00', 3],
    ['\uD800\uD800\uDC00', 7],
    ['a\uD800b', 5],
  ])('counts %p as %p bytes, like TextEncoder', (text, length) =>
    expectUTF8Length(text, length)
  );

  // utf8Length encodes 65536 UTF-16 units at a time.
  it.each([
    [
      'a surrogate pair across a slice boundary',
      'a'.repeat(0xffff) + '\uD83D\uDE80',
      0xffff + 4,
    ],
    [
      'a lone surrogate at a slice boundary',
      'a'.repeat(0xffff) + '\uD800b',
      0xffff + 4,
    ],
    ['several slices', 'é'.repeat(0x28000), 0x50000],
  ])('counts %s like TextEncoder', (_name, text, length) =>
    expectUTF8Length(text, length)
  );

  it('sends a string body with a lone surrogate', async () => {
    // React Native's Blob measures a string with encodeURI, which throws on a
    // lone surrogate.
    const globals = globalThis as { Blob: typeof Blob };
    const OriginalBlob = globals.Blob;
    globals.Blob = class extends OriginalBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        for (const part of parts ?? []) {
          if (typeof part === 'string') encodeURI(part);
        }
        super(parts, options);
      }
    };
    try {
      mockNitroFetch.mockResolvedValue(
        makeResponse([new TextEncoder().encode('ok')])
      );

      const xhr = new NitroXMLHttpRequest();
      const events: string[] = [];
      const uploaded: Array<[number, number]> = [];
      xhr.addEventListener('load', () => events.push('load'));
      xhr.addEventListener('error', () => events.push('error'));
      xhr.upload.addEventListener('progress', (event) => {
        const { loaded, total } = event as ProgressEvent;
        uploaded.push([loaded, total]);
      });
      xhr.open('POST', 'https://example.com/post');
      const completed = waitForEvent(xhr, 'loadend');
      // Sent as a, U+FFFD, b: 1 + 3 + 1 bytes.
      xhr.send('a\uD800b');
      await completed;

      expect(events).toEqual(['load']);
      expect(uploaded).toEqual([[5, 5]]);
    } finally {
      globals.Blob = OriginalBlob;
    }
  });

  it.each([false, true])(
    'measures the body only for upload listeners (listening: %p)',
    async (listening) => {
      mockNitroFetch.mockResolvedValue(makeResponse([]));

      const body = new URLSearchParams('a=1');
      const serialize = jest.spyOn(body, 'toString');
      const xhr = new NitroXMLHttpRequest();
      const uploaded: number[] = [];
      if (listening) {
        xhr.upload.onprogress = (event) => uploaded.push(event.total);
      }
      xhr.open('POST', 'https://example.com/post');
      const completed = waitForEvent(xhr, 'loadend');
      xhr.send(body);
      await completed;

      expect(serialize).toHaveBeenCalledTimes(listening ? 1 : 0);
      expect(uploaded).toEqual(listening ? [3] : []);
    }
  );

  it('skips the upload progress of a body it cannot measure', async () => {
    mockNitroFetch.mockResolvedValue(makeResponse([]));

    const body = new URLSearchParams('a=1');
    jest.spyOn(body, 'toString').mockImplementation(() => {
      throw new URIError('URI malformed');
    });
    const xhr = new NitroXMLHttpRequest();
    const events: string[] = [];
    xhr.addEventListener('load', () => events.push('load'));
    xhr.addEventListener('error', () => events.push('error'));
    xhr.upload.onprogress = () => events.push('upload.progress');
    xhr.open('POST', 'https://example.com/post');
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send(body);
    await completed;

    expect(events).toEqual(['load']);
  });
});

describe('nitroFetchRaw', () => {
  let nitroFetchRaw: typeof import('../fetch-core/raw').nitroFetchRaw;
  const nativeResponse = {
    url: 'https://example.com/',
    status: 200,
    statusText: '',
    ok: true,
    redirected: false,
    headers: [],
    bodyString: 'ok',
  };

  beforeAll(async () => {
    ({ nitroFetchRaw } = await import('../fetch-core/raw'));
  });

  beforeEach(() => {
    mockClient.request.mockReset();
    mockClient.request.mockResolvedValue(nativeResponse);
    mockClient.requestWithEvents.mockReset();
    mockClient.requestWithEvents.mockResolvedValue(nativeResponse);
  });

  it('sends a plain fetch with request() and nothing else', async () => {
    await nitroFetchRaw('https://example.com/', { method: 'POST', body: 'x' });

    expect(mockClient.request).toHaveBeenCalledTimes(1);
    expect(mockClient.request.mock.calls[0]).toHaveLength(1);
    expect(mockClient.requestWithEvents).not.toHaveBeenCalled();
  });

  it('sends what the XMLHttpRequest polyfill asks for with requestWithEvents()', async () => {
    const onData = () => {};
    await nitroFetchRaw('https://example.com/', {
      method: 'PROPFIND',
      _withEvents: { options: { customMethod: 'PROPFIND' }, onData },
    } as RequestInit);

    expect(mockClient.request).not.toHaveBeenCalled();
    const [req, options, onResponseStarted, data, onProgress] =
      mockClient.requestWithEvents.mock.calls[0];
    expect(req.method).toBeUndefined();
    expect(options).toEqual({ customMethod: 'PROPFIND' });
    expect(onResponseStarted).toBeUndefined();
    expect(data).toBe(onData);
    expect(onProgress).toBeUndefined();
  });
});
