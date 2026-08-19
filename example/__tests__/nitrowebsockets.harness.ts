import { describe, it, expect } from 'react-native-harness';
import { NitroWebSocket } from 'react-native-nitro-websockets';
import type {
  WebSocketMessageEvent,
  WebSocketCloseEvent,
} from 'react-native-nitro-websockets';
import { WS_BASE } from '../test-utils/server';

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

// ─── Server-initiated close (issue #137) ─────────────────────────────────────
// These run against the local test-server, which can be told to close or drop
// the connection on demand — the public echo server cannot.

describe('NitroWebSocket - Server-initiated close', () => {
  // 1011, not 1012: NSURLSession maps close codes outside its
  // NSURLSessionWebSocketCloseCode enum (1012/1013/1014) to 1005 and drops the
  // reason, so iOS can never report them.
  it('server close(1011, reason) → onclose with that code+reason, no message event', async () => {
    const messages: WebSocketMessageEvent[] = [];
    const closeEvent = await withTimeout(
      new Promise<WebSocketCloseEvent>((resolve, reject) => {
        const ws = new NitroWebSocket(
          `${WS_BASE}/ws/close?code=1011&reason=server%20shutdown&delay=200`
        );
        ws.onmessage = (e) => messages.push(e);
        ws.onerror = (err) => reject(new Error(`Unexpected error: ${err}`));
        ws.onclose = resolve;
      }),
      5_000,
      'server-initiated close'
    );

    expect(messages).toEqual([]);
    expect(closeEvent.code).toBe(1011);
    expect(closeEvent.reason).toBe('server shutdown');
    expect(closeEvent.wasClean).toBe(true);
  });

  it('server drops the connection without a close frame → onclose 1006, wasClean=false', async () => {
    const closeEvent = await withTimeout(
      new Promise<WebSocketCloseEvent>((resolve) => {
        const ws = new NitroWebSocket(`${WS_BASE}/ws/kill?delay=200`);
        ws.onclose = resolve;
      }),
      10_000,
      'abrupt server drop'
    );

    expect(closeEvent.code).toBe(1006);
    expect(closeEvent.wasClean).toBe(false);
  });

  it('echoes a message against the local server before the close arrives', async () => {
    const ws = await withTimeout(
      new Promise<NitroWebSocket>((resolve, reject) => {
        const _ws = new NitroWebSocket(`${WS_BASE}/ws/echo`);
        _ws.onopen = () => resolve(_ws);
        _ws.onerror = (err) => reject(new Error(err));
      })
    );
    const echoed = await withTimeout(
      new Promise<WebSocketMessageEvent>((resolve) => {
        ws.onmessage = resolve;
        ws.send('ping-payload');
      })
    );
    expect(echoed.data).toBe('ping-payload');
    await closeAndWait(ws);
  });
});

// ─── close() during the handshake (issue #163) ───────────────────────────────
// /ws/stall accepts the TCP connection but never sends its 101, so the socket
// is guaranteed to still be CONNECTING when close() lands. On Android this used
// to abort the process inside lws_close_reason(): the wsi still had an HTTP
// role, so `assert(lwsi_role_ws(wsi))` failed. A regression here kills the
// whole harness process, not just this test.

describe('NitroWebSocket - close during handshake', () => {
  it('close() while CONNECTING terminates the socket instead of crashing', async () => {
    const ws = new NitroWebSocket(`${WS_BASE}/ws/stall`);

    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    expect(ws.readyState).toBe('CONNECTING');

    const terminated = await withTimeout(
      new Promise<'close' | 'error'>((resolve) => {
        ws.onclose = () => resolve('close');
        ws.onerror = () => resolve('error');
        ws.close(1000, 'closing mid-handshake');
      }),
      10_000,
      'close during handshake'
    );

    expect(terminated === 'close' || terminated === 'error').toBe(true);
    expect(ws.readyState).toBe('CLOSED');
  });

  it('close() while CONNECTING still fires onclose with 1006, wasClean=false', async () => {
    const ws = new NitroWebSocket(`${WS_BASE}/ws/stall`);

    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    expect(ws.readyState).toBe('CONNECTING');

    let closeCount = 0;
    const closeEvent = await withTimeout(
      new Promise<WebSocketCloseEvent>((resolve) => {
        ws.onclose = (event) => {
          closeCount++;
          resolve(event);
        };
        ws.close(1000, 'closing mid-handshake');
      }),
      10_000,
      'onclose during handshake'
    );

    expect(closeEvent.code).toBe(1006);
    expect(closeEvent.wasClean).toBe(false);

    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    expect(closeCount).toBe(1);
  });

  it('survives repeated connect+close cycles during the handshake', async () => {
    for (let i = 0; i < 5; i++) {
      const ws = new NitroWebSocket(`${WS_BASE}/ws/stall`);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      ws.close(1000, `cycle ${i}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));

    // Still alive and usable: the service thread survived every teardown.
    const ws = await withTimeout(
      new Promise<NitroWebSocket>((resolve, reject) => {
        const _ws = new NitroWebSocket(`${WS_BASE}/ws/echo`);
        _ws.onopen = () => resolve(_ws);
        _ws.onerror = (err) => reject(new Error(err));
      })
    );
    const echoed = await withTimeout(
      new Promise<WebSocketMessageEvent>((resolve) => {
        ws.onmessage = resolve;
        ws.send('still-alive');
      })
    );
    expect(echoed.data).toBe('still-alive');
    await closeAndWait(ws);
  });
});

describe('NitroWebSocket - Handshake headers', () => {
  function handshake(
    protocols?: string[],
    extraHeaders?: Record<string, string>
  ): Promise<{ ws: NitroWebSocket; headers: Record<string, string> }> {
    return withTimeout(
      new Promise<{ ws: NitroWebSocket; headers: Record<string, string> }>(
        (resolve, reject) => {
          const ws = new NitroWebSocket(
            `${WS_BASE}/ws/headers`,
            protocols,
            extraHeaders
          );
          ws.onmessage = (e) => resolve({ ws, headers: JSON.parse(e.data) });
          ws.onerror = (err) => reject(new Error(`Connection error: ${err}`));
        }
      ),
      5_000,
      'handshake header echo'
    );
  }

  it('sends no Sec-WebSocket-Protocol and no Origin when no protocols requested', async () => {
    const { ws, headers } = await handshake();
    expect(headers['sec-websocket-protocol']).toBe(undefined);
    expect(headers.origin).toBe(undefined);
    expect(ws.protocol).toBe('');
    await closeAndWait(ws);
  });

  it('offers requested subprotocols and reports the negotiated one', async () => {
    const { ws, headers } = await handshake(['chat', 'superchat']);
    expect(headers['sec-websocket-protocol']).toContain('chat');
    expect(headers['sec-websocket-protocol']).toContain('superchat');
    expect(ws.protocol).toBe('chat');
    await closeAndWait(ws);
  });

  it('still sends caller-supplied custom headers', async () => {
    const { ws, headers } = await handshake(undefined, {
      'x-nitro-test': 'handshake',
    });
    expect(headers['x-nitro-test']).toBe('handshake');
    expect(headers['sec-websocket-protocol']).toBe(undefined);
    await closeAndWait(ws);
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
