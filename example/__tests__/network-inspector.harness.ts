import { describe, it, expect } from 'react-native-harness';
import {
  fetch as nitroFetch,
  NetworkInspector,
  generateCurl,
} from 'react-native-nitro-fetch';

const BASE = 'https://httpbin.org';

// ---------------------------------------------------------------------------
// NetworkInspector
// ---------------------------------------------------------------------------
describe('NetworkInspector - basics', () => {
  it('is disabled by default', () => {
    expect(NetworkInspector.isEnabled()).toBe(false);
  });

  it('getEntries() is empty when disabled', () => {
    expect(NetworkInspector.getEntries().length).toBe(0);
  });

  it('does not capture entries when disabled', async () => {
    NetworkInspector.disable();
    await nitroFetch(`${BASE}/get`);
    expect(NetworkInspector.getEntries().length).toBe(0);
  });
});

describe('NetworkInspector - capture', () => {
  it('captures entry when enabled', async () => {
    NetworkInspector.enable();
    NetworkInspector.clear();
    await nitroFetch(`${BASE}/get`);
    const entries = NetworkInspector.getHttpEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]!.url).toContain('/get');
    expect(entries[0]!.method).toBe('GET');
    expect(entries[0]!.status).toBe(200);
    expect(entries[0]!.duration).toBeGreaterThan(0);
    NetworkInspector.disable();
    NetworkInspector.clear();
  });

  it('entry contains curl command', async () => {
    NetworkInspector.enable();
    NetworkInspector.clear();
    await nitroFetch(`${BASE}/get`);
    const entries = NetworkInspector.getHttpEntries();
    expect(entries[0]!.curl).toContain('curl');
    expect(entries[0]!.curl).toContain('/get');
    NetworkInspector.disable();
    NetworkInspector.clear();
  });

  it('captures POST with body', async () => {
    NetworkInspector.enable();
    NetworkInspector.clear();
    await nitroFetch(`${BASE}/post`, {
      method: 'POST',
      body: '{"test":true}',
      headers: { 'Content-Type': 'application/json' },
    });
    const entries = NetworkInspector.getHttpEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]!.method).toBe('POST');
    expect(entries[0]!.requestBody).toContain('test');
    expect(entries[0]!.requestBodySize).toBeGreaterThan(0);
    NetworkInspector.disable();
    NetworkInspector.clear();
  });

  it('onEntry callback fires', async () => {
    NetworkInspector.enable();
    NetworkInspector.clear();
    let captured: any;
    const unsub = NetworkInspector.onEntry((entry) => {
      captured = entry;
    });
    await nitroFetch(`${BASE}/get`);
    expect(captured).toBeDefined();
    expect(captured.status).toBe(200);
    unsub();
    NetworkInspector.disable();
    NetworkInspector.clear();
  });

  it('clear() empties entries', async () => {
    NetworkInspector.enable();
    await nitroFetch(`${BASE}/get`);
    expect(NetworkInspector.getEntries().length).toBeGreaterThan(0);
    NetworkInspector.clear();
    expect(NetworkInspector.getEntries().length).toBe(0);
    NetworkInspector.disable();
  });

  it('respects maxEntries', async () => {
    NetworkInspector.enable({ maxEntries: 2 });
    NetworkInspector.clear();
    await nitroFetch(`${BASE}/get`);
    await nitroFetch(`${BASE}/get`);
    await nitroFetch(`${BASE}/get`);
    expect(NetworkInspector.getEntries().length).toBe(2);
    NetworkInspector.disable();
    NetworkInspector.clear();
  });
});

// ---------------------------------------------------------------------------
// CurlGenerator
// ---------------------------------------------------------------------------
describe('CurlGenerator', () => {
  it('generates basic GET curl', () => {
    const cmd = generateCurl({ url: 'https://example.com', method: 'GET' });
    expect(cmd).toBe('curl https://example.com');
  });

  it('generates POST with headers and body', () => {
    const cmd = generateCurl({
      url: 'https://api.example.com/data',
      method: 'POST',
      headers: [{ key: 'Content-Type', value: 'application/json' }],
      body: '{"key":"value"}',
    });
    expect(cmd).toContain('-X POST');
    expect(cmd).toContain('-H');
    expect(cmd).toContain('Content-Type: application/json');
    expect(cmd).toContain('-d');
    expect(cmd).toContain('key');
  });

  it('shell-escapes special characters', () => {
    const cmd = generateCurl({
      url: "https://example.com/path?q=hello world&x=it's",
      method: 'GET',
    });
    expect(cmd).toContain("'");
  });
});

// ---------------------------------------------------------------------------
// NetworkInspector - HTTP entry type discriminator
// ---------------------------------------------------------------------------
describe('NetworkInspector - HTTP type', () => {
  it('HTTP entries have type "http"', async () => {
    NetworkInspector.enable();
    NetworkInspector.clear();
    await nitroFetch(`${BASE}/get`);
    const entries = NetworkInspector.getEntries();
    expect(entries[0]!.type).toBe('http');
    NetworkInspector.disable();
    NetworkInspector.clear();
  });

  it('getHttpEntries() filters HTTP only', async () => {
    NetworkInspector.enable();
    NetworkInspector.clear();
    await nitroFetch(`${BASE}/get`);
    const httpEntries = NetworkInspector.getHttpEntries();
    expect(httpEntries.length).toBe(1);
    expect(httpEntries[0]!.type).toBe('http');
    const wsEntries = NetworkInspector.getWebSocketEntries();
    expect(wsEntries.length).toBe(0);
    NetworkInspector.disable();
    NetworkInspector.clear();
  });
});

// ---------------------------------------------------------------------------
// NetworkInspector - WebSocket recording
// ---------------------------------------------------------------------------
describe('NetworkInspector - WebSocket', () => {
  it('_recordWsOpen creates websocket entry', () => {
    NetworkInspector.enable();
    NetworkInspector.clear();
    (NetworkInspector as any)._recordWsOpen(
      'ws-test-1',
      'wss://example.com',
      ['proto1'],
      [{ key: 'Authorization', value: 'Bearer tok' }]
    );
    const entries = NetworkInspector.getWebSocketEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]!.type).toBe('websocket');
    expect(entries[0]!.url).toBe('wss://example.com');
    expect(entries[0]!.protocols.length).toBe(1);
    expect(entries[0]!.readyState).toBe('CONNECTING');
    NetworkInspector.disable();
    NetworkInspector.clear();
  });

  it('_recordWsMessage records sent messages', () => {
    NetworkInspector.enable();
    NetworkInspector.clear();
    (NetworkInspector as any)._recordWsOpen(
      'ws-test-2',
      'wss://example.com',
      [],
      []
    );
    (NetworkInspector as any)._recordWsMessage(
      'ws-test-2',
      'sent',
      'hello',
      5,
      false
    );
    const entry = NetworkInspector.getWebSocketEntries()[0]!;
    expect(entry.messagesSent).toBe(1);
    expect(entry.messagesReceived).toBe(0);
    expect(entry.bytesSent).toBe(5);
    expect(entry.messages.length).toBe(1);
    expect(entry.messages[0]!.direction).toBe('sent');
    expect(entry.messages[0]!.data).toBe('hello');
    NetworkInspector.disable();
    NetworkInspector.clear();
  });

  it('_recordWsMessage records received messages', () => {
    NetworkInspector.enable();
    NetworkInspector.clear();
    (NetworkInspector as any)._recordWsOpen(
      'ws-test-3',
      'wss://example.com',
      [],
      []
    );
    (NetworkInspector as any)._recordWsMessage(
      'ws-test-3',
      'received',
      'world',
      5,
      false
    );
    const entry = NetworkInspector.getWebSocketEntries()[0]!;
    expect(entry.messagesReceived).toBe(1);
    expect(entry.messagesSent).toBe(0);
    expect(entry.bytesReceived).toBe(5);
    expect(entry.messages[0]!.direction).toBe('received');
    NetworkInspector.disable();
    NetworkInspector.clear();
  });

  it('_recordWsClose sets closeCode/closeReason and endTime', () => {
    NetworkInspector.enable();
    NetworkInspector.clear();
    (NetworkInspector as any)._recordWsOpen(
      'ws-test-4',
      'wss://example.com',
      [],
      []
    );
    (NetworkInspector as any)._recordWsClose(
      'ws-test-4',
      1000,
      'Normal closure'
    );
    const entry = NetworkInspector.getWebSocketEntries()[0]!;
    expect(entry.closeCode).toBe(1000);
    expect(entry.closeReason).toBe('Normal closure');
    expect(entry.readyState).toBe('CLOSED');
    expect(entry.endTime).toBeGreaterThan(0);
    expect(entry.duration).toBeGreaterThan(0);
    NetworkInspector.disable();
    NetworkInspector.clear();
  });

  it('_recordWsError sets error field', () => {
    NetworkInspector.enable();
    NetworkInspector.clear();
    (NetworkInspector as any)._recordWsOpen(
      'ws-test-5',
      'wss://example.com',
      [],
      []
    );
    (NetworkInspector as any)._recordWsError('ws-test-5', 'Connection refused');
    const entry = NetworkInspector.getWebSocketEntries()[0]!;
    expect(entry.error).toBe('Connection refused');
    NetworkInspector.disable();
    NetworkInspector.clear();
  });

  it('getWebSocketEntries() filters correctly alongside HTTP entries', async () => {
    NetworkInspector.enable();
    NetworkInspector.clear();
    await nitroFetch(`${BASE}/get`);
    (NetworkInspector as any)._recordWsOpen(
      'ws-test-6',
      'wss://example.com',
      [],
      []
    );
    expect(NetworkInspector.getEntries().length).toBe(2);
    expect(NetworkInspector.getHttpEntries().length).toBe(1);
    expect(NetworkInspector.getWebSocketEntries().length).toBe(1);
    NetworkInspector.disable();
    NetworkInspector.clear();
  });
});
