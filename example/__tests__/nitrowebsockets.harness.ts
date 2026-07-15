import { describe, it, expect } from 'react-native-harness';
import { NitroWebSocket } from 'react-native-nitro-websockets';
import type {
  WebSocketMessageEvent,
  WebSocketCloseEvent,
} from 'react-native-nitro-websockets';

const ECHO_URL = 'wss://echo.websocket.org';
const TIMEOUT_MS = 10_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withTimeout<T>(
  p: Promise<T>,
  ms = TIMEOUT_MS,
  label = 'operation'
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Timeout: ${label} did not complete in ${ms}ms`)),
      ms
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/**
 * Open a WebSocket and drain the server's welcome message.
 * echo.websocket.org sends "Request served by <id>" on every new connection.
 */
async function openWebSocket(
  url = ECHO_URL,
  protocols?: string[]
): Promise<NitroWebSocket> {
  const ws = await withTimeout(
    new Promise<NitroWebSocket>((resolve, reject) => {
      const _ws = new NitroWebSocket(url, protocols);
      _ws.onopen = () => resolve(_ws);
      _ws.onerror = (err) => reject(new Error(`Connection error: ${err}`));
    })
  );
  // Drain the greeting the server sends immediately after connect.
  // If no message arrives within 500 ms the server sent none; continue anyway.
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 500);
    ws.onmessage = () => {
      clearTimeout(t);
      resolve();
    };
  });
  ws.onmessage = null;
  return ws;
}

function nextMessage(ws: NitroWebSocket): Promise<WebSocketMessageEvent> {
  return withTimeout(
    new Promise<WebSocketMessageEvent>((resolve, reject) => {
      ws.onmessage = resolve;
      ws.onerror = (err) => reject(new Error(`Unexpected error: ${err}`));
    })
  );
}

function closeAndWait(
  ws: NitroWebSocket,
  code = 1000,
  reason = ''
): Promise<WebSocketCloseEvent> {
  return withTimeout(
    new Promise<WebSocketCloseEvent>((resolve) => {
      ws.onclose = resolve;
      ws.close(code, reason);
    })
  );
}

// ─── Shared connection ────────────────────────────────────────────────────────
// Text and Binary suites share ONE connection to stay under the server's
// per-session connection limit (~7).  Total connections in this file: 6.
//   Connection suite : 2  (lifecycle tests need fresh connections)
//   Text + Binary    : 1  (opened in Text setup, closed in Binary teardown)
//   Close suite      : 2  (close-behaviour tests need fresh connections)
//   Error suite      : 1  (never succeeds → likely not counted)

let _sharedWs: NitroWebSocket | null = null;

// ─── Connection ───────────────────────────────────────────────────────────────

describe('NitroWebSocket - Connection', () => {
  it('connects: readyState is OPEN and url contains server hostname', async () => {
    const ws = await openWebSocket();
    expect(ws.readyState).toBe('OPEN');
    expect(ws.url).toContain('echo.websocket.org');
    await closeAndWait(ws);
  });

  it('readyState is CONNECTING before onopen fires; onopen callback fires', async () => {
    let stateBeforeOpen: string | undefined;
    let openFired = false;
    const ws = await withTimeout(
      new Promise<NitroWebSocket>((resolve, reject) => {
        const _ws = new NitroWebSocket(ECHO_URL);
        stateBeforeOpen = _ws.readyState;
        _ws.onopen = () => {
          openFired = true;
          resolve(_ws);
        };
        _ws.onerror = (err) => reject(new Error(err));
      })
    );
    expect(stateBeforeOpen).toBe('CONNECTING');
    expect(openFired).toBe(true);
    await closeAndWait(ws);
  });
});

// ─── Text Messages ────────────────────────────────────────────────────────────

describe('NitroWebSocket - Text Messages', () => {
  it('setup: open shared connection', async () => {
    _sharedWs = await openWebSocket();
  });

  it('echoes back a sent text message', async () => {
    const ws = _sharedWs!;
    const msgPromise = nextMessage(ws);
    ws.send('hello nitro');
    const event = await msgPromise;
    expect(event.data).toBe('hello nitro');
    expect(event.isBinary).toBe(false);
  });

  it('echoes back a JSON string with correct content', async () => {
    const ws = _sharedWs!;
    const payload = JSON.stringify({ type: 'ping', seq: 1 });
    const msgPromise = nextMessage(ws);
    ws.send(payload);
    const event = await msgPromise;
    expect(event.data).toBe(payload);
    const parsed = JSON.parse(event.data);
    expect(parsed.type).toBe('ping');
    expect(parsed.seq).toBe(1);
  });

  it('echoes back a long text message (1 KB)', async () => {
    const ws = _sharedWs!;
    const longText = 'A'.repeat(1024);
    const msgPromise = nextMessage(ws);
    ws.send(longText);
    const event = await msgPromise;
    expect(event.data.length).toBe(1024);
    expect(event.isBinary).toBe(false);
  });

  it('echoes multiple sequential messages in order', async () => {
    const ws = _sharedWs!;
    const messages = ['alpha', 'beta', 'gamma', 'delta'];
    const received: string[] = [];
    for (const msg of messages) {
      const msgPromise = nextMessage(ws);
      ws.send(msg);
      const event = await msgPromise;
      received.push(event.data);
    }
    expect(received).toEqual(messages);
  });
  // Connection stays open — Binary suite reuses _sharedWs below.
});

// ─── Binary Messages ──────────────────────────────────────────────────────────

describe('NitroWebSocket - Binary Messages', () => {
  it('echoes back an ArrayBuffer as a binary frame', async () => {
    const ws = _sharedWs!;
    const buf = new ArrayBuffer(8);
    const view = new Uint8Array(buf);
    view.set([10, 20, 30, 40, 50, 60, 70, 80]);
    const msgPromise = nextMessage(ws);
    ws.send(buf);
    const event = await msgPromise;
    expect(event.isBinary).toBe(true);
    expect(event.binaryData).toBeDefined();
    const received = new Uint8Array(event.binaryData!);
    expect(received.length).toBe(8);
    expect(received[0]).toBe(10);
    expect(received[7]).toBe(80);
  });

  it('echoes back a single-byte ArrayBuffer', async () => {
    const ws = _sharedWs!;
    const buf = new ArrayBuffer(1);
    new Uint8Array(buf)[0] = 255;
    const msgPromise = nextMessage(ws);
    ws.send(buf);
    const event = await msgPromise;
    expect(event.isBinary).toBe(true);
    expect(event.binaryData).toBeDefined();
    expect(new Uint8Array(event.binaryData!)[0]).toBe(255);
  });

  it('teardown: close shared connection', async () => {
    if (_sharedWs) {
      await closeAndWait(_sharedWs);
      _sharedWs = null;
    }
  });
});

// ─── Close ────────────────────────────────────────────────────────────────────

describe('NitroWebSocket - Close', () => {
  it('close() → onclose with code 1000, wasClean=true, readyState=CLOSED', async () => {
    const ws = await openWebSocket();
    const closeEvent = await closeAndWait(ws, 1000, '');
    expect(closeEvent.code).toBe(1000);
    expect(closeEvent.wasClean).toBe(true);
    expect(ws.readyState).toBe('CLOSED');
  });

  it('onclose callback fires exactly once', async () => {
    const ws = await openWebSocket();
    let count = 0;
    await withTimeout(
      new Promise<void>((resolve) => {
        ws.onclose = () => {
          count++;
          resolve();
        };
        ws.close();
      })
    );
    expect(count).toBe(1);
  });
});

// ─── Error Handling ───────────────────────────────────────────────────────────

describe('NitroWebSocket - Error Handling', () => {
  it('fires onerror or onclose for an unreachable host', async () => {
    let settled = false;
    await withTimeout(
      new Promise<void>((resolve) => {
        const ws = new NitroWebSocket('wss://invalid.nitro.test.nonexistent');
        ws.onerror = () => {
          settled = true;
          resolve();
        };
        ws.onclose = () => {
          settled = true;
          resolve();
        };
      }),
      15_000,
      'error for invalid host'
    );
    expect(settled).toBe(true);
  });
});
