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
    const entries = NetworkInspector.getEntries();
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
    const entries = NetworkInspector.getEntries();
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
    const entries = NetworkInspector.getEntries();
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
