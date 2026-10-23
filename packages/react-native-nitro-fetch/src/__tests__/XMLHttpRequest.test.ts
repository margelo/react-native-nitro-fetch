// Dynamic imports do not mark this file as a TypeScript module. Keep generated
// test declarations module-scoped so they cannot collide with the source file.
export {};

jest.mock('../fetch-core/fetch', () => ({
  nitroFetch: jest.fn(),
}));

type NitroFetchFunction = typeof import('../fetch-core/fetch').nitroFetch;
type NitroXMLHttpRequestConstructor =
  typeof import('../XMLHttpRequest').NitroXMLHttpRequest;
type NitroXMLHttpRequestInstance = InstanceType<NitroXMLHttpRequestConstructor>;

let mockNitroFetch: jest.MockedFunction<NitroFetchFunction>;
let NitroXMLHttpRequest: NitroXMLHttpRequestConstructor;

function makeResponse(
  chunks: Uint8Array[],
  init: {
    headers?: Record<string, string>;
    status?: number;
    statusText?: string;
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
  return {
    body: stream,
    headers: new Headers(init.headers),
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    url: init.url ?? 'https://example.com/result',
  } as Response;
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

  it('streams response state, headers, text, and download progress', async () => {
    const encoder = new TextEncoder();
    const firstChunk = encoder.encode('{"ok":');
    const secondChunk = encoder.encode('true}');
    const response = makeResponse([firstChunk, secondChunk], {
      headers: {
        'content-length': '11',
        'content-type': 'application/json',
      },
    });
    mockNitroFetch.mockResolvedValue(response);

    const xhr = new NitroXMLHttpRequest();
    const states: number[] = [];
    const progress: number[] = [];
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.getAllResponseHeaders()).toBeNull();
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
    expect(xhr.getResponseHeader('Content-Type')).toBe('application/json');
    expect(xhr.getAllResponseHeaders()).toContain(
      'content-type: application/json\r\n'
    );
    expect(mockNitroFetch).toHaveBeenCalledWith(
      'https://example.com/source',
      expect.objectContaining({
        credentials: 'include',
        method: 'GET',
        stream: true,
      })
    );
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
      expect.objectContaining({ body: form, method: 'POST', stream: false })
    );
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
        expect.objectContaining({ body: 'body', stream: false })
      );
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
      'onprogress is set',
      'GET',
      (xhr) => {
        xhr.onprogress = () => {};
      },
    ],
    [
      'a progress listener is added',
      'GET',
      (xhr) => {
        xhr.addEventListener('progress', () => {});
      },
    ],
    [
      'the response is an arraybuffer',
      'GET',
      (xhr) => {
        xhr.responseType = 'arraybuffer';
      },
    ],
    [
      'the response is a blob',
      'GET',
      (xhr) => {
        xhr.responseType = 'blob';
      },
    ],
    ['the buffered client cannot send the method', 'PROPFIND', () => {}],
  ])('streams when %s', async (_reason, method, setUp) => {
    const encoder = new TextEncoder();
    const response = makeResponse([encoder.encode('ok')]);
    mockNitroFetch.mockResolvedValue(response);

    const xhr = new NitroXMLHttpRequest();
    xhr.open(method, 'https://example.com/streamed');
    setUp(xhr);
    const completed = waitForEvent(xhr, 'loadend');
    xhr.send();
    await completed;

    expect(mockNitroFetch).toHaveBeenCalledWith(
      'https://example.com/streamed',
      expect.objectContaining({ method, stream: true })
    );
  });

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
});
