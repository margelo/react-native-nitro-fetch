import type { NitroFetch as NitroFetchModule } from '../NitroFetch.nitro';
import { NitroFetch as NitroFetchSingleton } from '../NitroInstances';

export const NitroFetchHybrid: NitroFetchModule = NitroFetchSingleton;

let client: ReturnType<NitroFetchModule['createClient']> | undefined;
let lastCreateError: unknown;

export function ensureClient() {
  if (client) return client;
  try {
    client = NitroFetchHybrid.createClient();
    lastCreateError = undefined;
  } catch (err) {
    lastCreateError = err;
    console.error('Failed to create NitroFetch client', err);
    // native not ready; keep undefined
  }
  return client;
}

// Why ensureClient() came back empty, e.g. an invalid nitro-fetch-pinning.json on Android.
export function clientUnavailableError(): Error {
  return lastCreateError instanceof Error
    ? lastCreateError
    : new Error('NitroFetch client not available');
}
