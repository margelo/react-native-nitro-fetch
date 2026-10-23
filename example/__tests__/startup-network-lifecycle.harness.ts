import { describe, expect, it } from 'react-native-harness';
import { Platform } from 'react-native';
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
type StartupStreamReport = {
  disconnected: boolean;
  failed: boolean;
  finished: boolean;
  sentBytes: number;
  sentChunks: number;
  totalBytes: number;
};

// This benchmark is run by path so the global remains React Native's stock XHR.
const StockXMLHttpRequest = globalThis.XMLHttpRequest;
const NitroXMLHttpRequestClass =
  NitroXMLHttpRequest as unknown as XMLHttpRequestConstructor;

const BLOCK_MS = 750;
const CHUNK_SIZE = 16_384;
const STARTUP_CHUNK_COUNT = 4;
const WINDOW_CHUNK_COUNT = 80;
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

async function readBodySlowly(
  response: Response,
  delayMs: number
): Promise<ArrayBuffer> {
  const reader = response.body?.getReader();
  if (reader == null) throw new Error('Streaming response has no body');
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
    totalBytes += result.value.byteLength;
    await wait(delayMs);
  }
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

async function readStartupReport(id: string): Promise<StartupStreamReport> {
  const response = await nitroFetch(`${BASE}/startup-stream-report/${id}`);
  return response.json();
}

async function waitForStartupDisconnect(
  id: string
): Promise<StartupStreamReport> {
  const deadline = now() + 3_000;
  while (now() < deadline) {
    const report = await readStartupReport(id);
    if (report.disconnected) return report;
    await wait(50);
  }
  return readStartupReport(id);
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

  it('drains more than the native read window without corrupting chunks', async () => {
    const result = await runLifecycle(
      'nitro',
      NitroXMLHttpRequestClass,
      WINDOW_CHUNK_COUNT
    );

    expect(result.loaded).toBe(WINDOW_CHUNK_COUNT * CHUNK_SIZE);
    expect(result.bodyMatches).toBe(true);
    expect(result.states).toEqual([1, 2, 3, 4]);
  });

  it('preserves bytes while a consumer reads slowly', async () => {
    const chunks = 80;
    const url = `${BASE}/startup-stream?chunks=${String(
      chunks
    )}&chunkSize=${String(CHUNK_SIZE)}&intervalMs=1`;
    const response = await (nitroFetch as any)(url, { stream: true });
    const body = await readBodySlowly(response, 10);

    expect(body.byteLength).toBe(chunks * CHUNK_SIZE);
    expect(bodyMatchesExpectedPattern(body)).toBe(true);
  });

  it('supports native readers without an acknowledgement window', async () => {
    const chunks = 80;
    const url = `${BASE}/startup-stream?chunks=${String(
      chunks
    )}&chunkSize=${String(CHUNK_SIZE)}&intervalMs=0`;
    const response = await (nitroFetch as any)(url, { stream: true });
    await wait(500);
    const body = await response.arrayBuffer();

    expect(body.byteLength).toBe(chunks * CHUNK_SIZE);
    expect(bodyMatchesExpectedPattern(body)).toBe(true);
  });

  it('stalls an unconsumed Android transfer before the full response', async () => {
    if (Platform.OS === 'ios') return;
    const timestamp = now();
    const id = `never-consumed-${String(timestamp)}`;
    const chunks = 1_024;
    const chunkSize = 65_536;
    const totalBytes = chunks * chunkSize;
    const url = `${BASE}/startup-stream?id=${id}&chunks=${String(
      chunks
    )}&chunkSize=${String(chunkSize)}&intervalMs=0`;
    const response = await (nitroFetch as any)(url, { stream: true });
    await wait(750);

    const reportBeforeCancel = await readStartupReport(id);
    // TCP buffers make the exact 1 MiB native window opaque to the server.
    expect(reportBeforeCancel.finished).toBe(false);
    expect(reportBeforeCancel.sentBytes).toBeLessThan(totalBytes);

    await response.body.cancel();
  });

  it('cancels natively after a blocked JS thread delays an abort timer', async () => {
    const timestamp = now();
    const id = `blocked-cancel-${String(timestamp)}`;
    const controller = new AbortController();
    // Keep normal completion far beyond the blocked interval so only cancellation can close it.
    const url = `${BASE}/startup-stream?id=${id}&chunks=4096&chunkSize=65536&intervalMs=5`;
    const response = await (nitroFetch as any)(url, {
      signal: controller.signal,
      stream: true,
    });
    const abortRequest = () => {
      controller.abort();
    };
    setTimeout(abortRequest, 50);
    blockJsThread(500);
    await wait(0);
    const reader = response.body.getReader();
    let error: any;
    try {
      await reader.read();
    } catch (caught) {
      error = caught;
    }

    expect(error?.name).toBe('AbortError');
    const report = await waitForStartupDisconnect(id);
    expect(report.disconnected).toBe(true);
    expect(report.finished).toBe(false);
    expect(report.sentBytes).toBeLessThan(report.totalBytes);
  });

  it('errors a body when native fails with queued chunks', async () => {
    const timestamp = now();
    const id = `queued-failure-${String(timestamp)}`;
    const url = `${BASE}/startup-stream?id=${id}&chunks=32&chunkSize=65536&intervalMs=1&failAfterChunks=8`;
    const response = await (nitroFetch as any)(url, { stream: true });
    await wait(250);
    const reader = response.body.getReader();
    let error: any;
    try {
      await reader.read();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    const report = await readStartupReport(id);
    expect(report.failed).toBe(true);
  });
});
