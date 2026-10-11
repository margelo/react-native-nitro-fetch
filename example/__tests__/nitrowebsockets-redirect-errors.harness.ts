import { describe, it, expect } from 'react-native-harness';
import { NitroWebSocket } from 'react-native-nitro-websockets';
import { WS_BASE } from '../test-utils/server';

function events(url: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const seen: string[] = [];
    const timer = setTimeout(
      () => reject(new Error(`No close event: ${seen.join(', ')}`)),
      10_000
    );
    const ws = new NitroWebSocket(url);
    ws.onopen = () => seen.push('open');
    ws.onerror = () => seen.push('error');
    ws.onclose = (e) => {
      seen.push(`close ${e.code}`);
      clearTimeout(timer);
      setTimeout(() => resolve(seen), 500);
    };
  });
}

describe('NitroWebSocket - Redirects that are not followed', () => {
  it('reports one error and one close after too many redirects', async () => {
    const seen = await events(`${WS_BASE}/ws/redirect?n=25&to=%2F`);
    expect(seen).toEqual(['error', 'close 1006']);
  });

  it('reports one error and one close for a non-WebSocket Location', async () => {
    const seen = await events(
      `${WS_BASE}/ws/redirect?to=${encodeURIComponent('ftp://127.0.0.1/x')}`
    );
    expect(seen).toEqual(['error', 'close 1006']);
  });
});
