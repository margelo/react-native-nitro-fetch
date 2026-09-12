import type { NitroHeader } from '../NitroFetch.nitro';
import { NitroFetchHybrid } from './client';
import { buildNitroRequestPure } from './request';
import { nitroFetchRaw } from './raw';

export type NitroWorkletMapper<T> = (payload: {
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  redirected: boolean;
  headers: NitroHeader[];
  bodyBytes?: ArrayBuffer;
  bodyString?: string;
}) => T;

let nitroRuntime: any | undefined;
function ensureWorkletRuntime(name = 'nitro-fetch'): any | undefined {
  try {
    const { createWorkletRuntime } = require('react-native-worklets');
    nitroRuntime = nitroRuntime ?? createWorkletRuntime(name);
    return nitroRuntime;
  } catch {
    console.warn('react-native-worklets not available');
    return undefined;
  }
}

export async function nitroFetchOnWorklet<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  mapWorklet: NitroWorkletMapper<T>,
  options?: { preferBytes?: boolean; runtimeName?: string }
): Promise<T> {
  const preferBytes = options?.preferBytes === true; // default true
  let runOnRuntimeAsync: any;
  let rt: any;
  try {
    rt = ensureWorkletRuntime(options?.runtimeName);
    const worklets = require('react-native-worklets');
    runOnRuntimeAsync = worklets.runOnRuntimeAsync;
  } catch {
    // Module not available
  }
  // Fallback: if runtime is not available, do the work on JS
  if (!runOnRuntimeAsync || !rt) {
    console.warn('nitroFetchOnWorklet: no runtime, mapping on JS thread');
    const res = await nitroFetchRaw(input, init);
    const payload = {
      url: res.url,
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      redirected: res.redirected,
      headers: res.headers,
      bodyBytes: preferBytes ? res.bodyBytes : undefined,
      bodyString: preferBytes ? undefined : res.bodyString,
    } as const;
    return mapWorklet(payload as any);
  }
  return await runOnRuntimeAsync(rt, () => {
    'worklet';
    const nitroFetchClient = NitroFetchHybrid.createClient();
    const request = buildNitroRequestPure(input, init);
    const res = nitroFetchClient.requestSync(request);
    const payload = {
      url: res.url,
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      redirected: res.redirected,
      headers: res.headers,
      bodyBytes: preferBytes ? res.bodyBytes : undefined,
      bodyString: preferBytes ? undefined : res.bodyString,
    } as const;

    return mapWorklet(payload as any);
  });
}
