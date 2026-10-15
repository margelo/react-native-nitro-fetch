import type { NitroHeader } from '../NitroFetch.nitro';
import type { RequestPriority } from '../Request';
import { NitroFetchHybrid } from './client';
import { buildNitroRequestPure } from './request';
import { nitroFetchRaw } from './raw';

/** Turns a response into your own value. Runs on the worklet runtime. */
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

/** Makes a request and runs `mapWorklet` off the JS thread, if `react-native-worklets` is installed. */
export async function nitroFetchOnWorklet<T>(
  input: RequestInfo | URL,
  init:
    | (RequestInit & {
        /** Fails the request if no data arrives for this many milliseconds. */
        timeoutMs?: number;
        /** How urgent the request is. Default `'auto'`. */
        priority?: RequestPriority;
      })
    | undefined,
  mapWorklet: NitroWorkletMapper<T>,
  options?: {
    /** Pass the body to `mapWorklet` as `bodyBytes` instead of `bodyString`. Default `false`. */
    preferBytes?: boolean;
    /** Name of the worklet runtime. Default `'nitro-fetch'`. */
    runtimeName?: string;
  }
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
