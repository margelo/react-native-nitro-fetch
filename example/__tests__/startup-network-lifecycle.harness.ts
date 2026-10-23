import { describe, expect, it } from 'react-native-harness';
import {
  fetch as nitroFetch,
  NetworkInspector,
  XMLHttpRequest as NitroXMLHttpRequest,
} from 'react-native-nitro-fetch';
import { BASE } from '../test-utils/server';

type XMLHttpRequestConstructor = new () => XMLHttpRequest;
type Implementation = 'nitro' | 'stock';
type LifecycleResult = {
  bodyMatches: boolean;
  elapsedMs: number;
  loaded: number;
  states: number[];
};
// This benchmark is run by path so the global remains React Native's stock XHR.
const StockXMLHttpRequest = globalThis.XMLHttpRequest;
const NitroXMLHttpRequestClass =
  NitroXMLHttpRequest as unknown as XMLHttpRequestConstructor;

const BLOCK_MS = 750;
const CHUNK_SIZE = 16_384;
const STARTUP_CHUNK_COUNT = 4;
const EXPECTED_BYTES = STARTUP_CHUNK_COUNT * CHUNK_SIZE;

function now(): number {
  return Date.now();
}

function blockJsThread(durationMs: number): void {
  const end = now() + durationMs;
  while (now() < end) {
    // Model the non-yielding work and microtask checkpoint of cold app startup.
  }
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function logEvent(implementation: Implementation, event: string): void {
  const wallTime = now();
  const renderedWallTime = String(wallTime);
  const message = `[HannoDebug][Harness][${implementation}] ${event} wall=${renderedWallTime}`;
  console.log(message);
}

function bodyMatchesExpectedPattern(response: ArrayBuffer): boolean {
  const bytes = new Uint8Array(response);
  for (let index = 0; index < bytes.length; index++) {
    const chunkIndex = Math.floor(index / CHUNK_SIZE);
    const expectedByte = 0x61 + chunkIndex;
    const actualByte = bytes[index];
    if (actualByte !== expectedByte) {
      const renderedIndex = String(index);
      const renderedExpected = String(expectedByte);
      const renderedActual = String(actualByte);
      const message = `[HannoDebug][Harness][body-mismatch] index=${renderedIndex} expected=${renderedExpected} actual=${renderedActual}`;
      console.log(message);
      return false;
    }
  }
  return true;
}

async function runLifecycle(
  implementation: Implementation,
  XMLHttpRequestClass: XMLHttpRequestConstructor,
  chunkCount = STARTUP_CHUNK_COUNT
): Promise<LifecycleResult> {
  const xhr = new XMLHttpRequestClass();
  const requestStartedAt = now();
  const states: number[] = [];
  let resolveResult!: (result: LifecycleResult) => void;
  let rejectResult!: (error: Error) => void;
  const resultPromise = new Promise<LifecycleResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  xhr.onreadystatechange = () => {
    const previousState = states[states.length - 1];
    if (previousState === xhr.readyState) return;
    states.push(xhr.readyState);
    const readyState = String(xhr.readyState);
    logEvent(implementation, `ready-state-${readyState}`);
  };
  xhr.onprogress = (event) => {
    const loaded = String(event.loaded);
    logEvent(implementation, `progress-${loaded}`);
  };
  xhr.onerror = () => {
    const error = new Error(`${implementation} XMLHttpRequest failed`);
    rejectResult(error);
  };
  xhr.onloadend = () => {
    const elapsedMs = now() - requestStartedAt;
    const response = xhr.response as ArrayBuffer;
    const bodyMatches = bodyMatchesExpectedPattern(response);
    const loaded = response.byteLength;
    const renderedElapsed = String(elapsedMs);
    logEvent(implementation, `load-end elapsed=${renderedElapsed}`);
    resolveResult({ bodyMatches, elapsedMs, loaded, states });
  };

  const url = `${BASE}/startup-stream?chunks=${String(
    chunkCount
  )}&chunkSize=${String(CHUNK_SIZE)}&headerDelayMs=100&intervalMs=1`;
  xhr.open('GET', url, true);
  xhr.responseType = 'arraybuffer';
  logEvent(implementation, 'request-start');
  xhr.send();

  // Let Nitro's async request preparation reach native before modeling the
  // long startup task. The endpoint delay keeps headers inside that task.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  logEvent(implementation, 'js-block-start');
  blockJsThread(BLOCK_MS);
  logEvent(implementation, 'js-block-end');

  return resultPromise;
}

function expectLifecycle(result: LifecycleResult): void {
  expect(result.loaded).toBe(EXPECTED_BYTES);
  expect(result.bodyMatches).toBe(true);
  expect(result.states).toEqual([1, 2, 3, 4]);
}

describe('startup network lifecycle scheduling', () => {
  it('compares repeated XHR lifecycle runs without cold-start claims', async () => {
    const nitroFirstResult = await runLifecycle(
      'nitro',
      NitroXMLHttpRequestClass
    );
    const stockAfterNitroResult = await runLifecycle(
      'stock',
      StockXMLHttpRequest
    );
    const stockRepeatResult = await runLifecycle('stock', StockXMLHttpRequest);
    const nitroRepeatResult = await runLifecycle(
      'nitro',
      NitroXMLHttpRequestClass
    );

    const nitroFirstSummary = JSON.stringify(nitroFirstResult);
    const stockAfterNitroSummary = JSON.stringify(stockAfterNitroResult);
    const stockRepeatSummary = JSON.stringify(stockRepeatResult);
    const nitroRepeatSummary = JSON.stringify(nitroRepeatResult);
    const summary = `[HannoDebug][Harness][summary] nitro-first=${nitroFirstSummary} stock-after-nitro=${stockAfterNitroSummary} stock-repeat=${stockRepeatSummary} nitro-repeat=${nitroRepeatSummary}`;
    console.log(summary);

    expectLifecycle(nitroFirstResult);
    expectLifecycle(stockAfterNitroResult);
    expectLifecycle(stockRepeatResult);
    expectLifecycle(nitroRepeatResult);
  });

  it('completes native reads while the JS thread is blocked', async () => {
    const timestamp = now();
    const id = `native-timeline-${String(timestamp)}`;
    const url = `${BASE}/startup-stream?id=${id}&chunks=4&chunkSize=${String(
      CHUNK_SIZE
    )}&headerDelayMs=100&intervalMs=1`;
    NetworkInspector.clear();
    NetworkInspector.enable();
    const pendingResponse = (nitroFetch as any)(url, { stream: true });
    await wait(0);
    const blockStartedAt = now();
    blockJsThread(BLOCK_MS);
    const blockEndedAt = now();
    const response = (await pendingResponse) as Response;
    const body = await response.arrayBuffer();
    const entries = NetworkInspector.getHttpEntries();
    const entry = entries.find((candidate) => candidate.url === url);
    NetworkInspector.disable();
    const timeline = JSON.stringify({
      blockEndedAt,
      blockStartedAt,
      nativeCompletedAtMs: entry?.nativeCompletedAtMs,
      nativeFirstReadAtMs: entry?.nativeFirstReadAtMs,
      nativeResponseStartedAtMs: entry?.nativeResponseStartedAtMs,
    });
    console.log(`[HannoDebug][Harness][native-timeline] ${timeline}`);

    expect(bodyMatchesExpectedPattern(body)).toBe(true);
    expect(entry).toBeDefined();
    expect(entry?.nativeResponseStartedAtMs).toBeGreaterThan(blockStartedAt);
    expect(entry?.nativeResponseStartedAtMs).toBeLessThan(blockEndedAt);
    expect(entry?.nativeFirstReadAtMs).toBeGreaterThan(blockStartedAt);
    expect(entry?.nativeFirstReadAtMs).toBeLessThan(blockEndedAt);
    expect(entry?.nativeCompletedAtMs).toBeGreaterThan(blockStartedAt);
    expect(entry?.nativeCompletedAtMs).toBeLessThan(blockEndedAt);
  });
});
