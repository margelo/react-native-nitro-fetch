import type { NitroFetch as NitroFetchModule } from '../NitroFetch.nitro';
import { NitroFetch as NitroFetchSingleton } from '../NitroInstances';

export const NitroFetchHybrid: NitroFetchModule = NitroFetchSingleton;

let client: ReturnType<NitroFetchModule['createClient']> | undefined;

export function ensureClient() {
  if (client) return client;
  try {
    client = NitroFetchHybrid.createClient();
  } catch (err) {
    console.error('Failed to create NitroFetch client', err);
    // native not ready; keep undefined
  }
  return client;
}
