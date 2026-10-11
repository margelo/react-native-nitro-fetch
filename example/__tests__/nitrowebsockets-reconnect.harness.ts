import { describe, it, expect } from 'react-native-harness';
import { createWebSocket } from 'react-native-nitro-websockets';
import type { HybridWebSocket } from 'react-native-nitro-websockets';
import { WS_BASE } from '../test-utils/server';

const ECHO = `${WS_BASE}/ws/echo`;

function record(ws: HybridWebSocket) {
  const events: string[] = [];
  let waiter: { prefix: string; resolve: () => void } | null = null;
  const push = (event: string) => {
    events.push(event);
    if (waiter && event.startsWith(waiter.prefix)) {
      const { resolve } = waiter;
      waiter = null;
      resolve();
    }
  };
  ws.onOpen = () => push('open');
  ws.onError = () => push('error');
  ws.onClose = (e) => push(`close ${e.code}`);
  const next = (prefix: string) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`No ${prefix} event: ${events.join(', ')}`)),
        5_000
      );
      waiter = {
        prefix,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      };
    });
  return { events, next };
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(() => resolve(), ms));

describe('HybridWebSocket - connect() again', () => {
  it('replaces an open connection without events from the old one', async () => {
    const ws = createWebSocket();
    const { events, next } = record(ws);
    let opened = next('open');
    ws.connect(ECHO, [], {});
    await opened;
    opened = next('open');
    ws.connect(ECHO, [], {});
    await opened;
    await sleep(300);
    const closed = next('close');
    ws.close(1000, '');
    await closed;
    expect(events).toEqual(['open', 'open', 'close 1000']);
  });

  it('opens and closes again after a close', async () => {
    const ws = createWebSocket();
    const { events, next } = record(ws);
    let step = next('open');
    ws.connect(ECHO, [], {});
    await step;
    step = next('close');
    ws.close(1000, '');
    await step;
    step = next('open');
    ws.connect(ECHO, [], {});
    await step;
    step = next('close');
    ws.close(1000, '');
    await step;
    expect(events).toEqual(['open', 'close 1000', 'open', 'close 1000']);
  });
});
