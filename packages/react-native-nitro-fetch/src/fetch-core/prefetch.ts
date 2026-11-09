import { NativeStorage as NativeStorageSingleton } from '../NitroInstances';
import type { RequestPriority } from '../Request';
import { base64FromBytes } from '../blob';
import { NitroFetchHybrid, ensureClient } from './client';
import { resolveRequestBody, resolveBlobBody } from './body';
import { buildNitroRequest } from './request';

/** Start a native prefetch. Requires a `prefetchKey`, as a header or in `init`. */
export async function prefetch(
  input: RequestInfo | URL,
  init?: RequestInit & {
    /** Fails the request if no data arrives for this many milliseconds. */
    timeoutMs?: number;
    /** How urgent the request is. Default `'auto'`. */
    priority?: RequestPriority;
  }
): Promise<void> {
  // If native implementation is not present yet, do nothing
  const hasNative =
    typeof (NitroFetchHybrid as any)?.createClient === 'function';
  if (!hasNative) return;

  init = await resolveRequestBody(input, init);
  init = await resolveBlobBody(init);

  // Build NitroRequest and ensure prefetchKey header exists
  const req = buildNitroRequest(input, init);
  const hasKey =
    req.headers?.some((h) => h.key.toLowerCase() === 'prefetchkey') ?? false;
  // Also support passing prefetchKey via non-standard field on init
  const fromInit = (init as any)?.prefetchKey as string | undefined;
  if (!hasKey && fromInit) {
    req.headers = (req.headers ?? []).concat([
      { key: 'prefetchKey', value: fromInit },
    ]);
  }
  const finalHasKey = req.headers?.some(
    (h) => h.key.toLowerCase() === 'prefetchkey'
  );
  if (!finalHasKey) {
    throw new Error('prefetch requires a "prefetchKey" header');
  }

  // Ensure client and call native prefetch
  const client = ensureClient();
  if (!client || typeof (client as any).prefetch !== 'function') return;
  await client.prefetch(req);
}

/** Clear in-memory prefetch responses and pending entries. Saved startup registrations are preserved. */
export function clearPrefetchCache(): void {
  ensureClient()?.clearPrefetchCache?.();
}

const AUTOPREFETCH_QUEUE_KEY = 'nitrofetch_autoprefetch_queue';

// Every secure read or write of the queue is a synchronous Keystore (Android) or
// Keychain (iOS) round trip on the JS thread. The decrypted queue is reused while the
// stored ciphertext it was decrypted from is unchanged; reading that is cheap.
let cachedQueue: { stored: string; entries: any[] } | undefined;

function readQueue(): any[] {
  try {
    const stored = NativeStorageSingleton.getString(AUTOPREFETCH_QUEUE_KEY);
    if (cachedQueue && cachedQueue.stored === stored)
      return cachedQueue.entries;
    const raw = NativeStorageSingleton.getSecureString(AUTOPREFETCH_QUEUE_KEY);
    let entries: any[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(entries)) entries = [];
    // `stored` is from before decrypting, so a native `registerPrefetch` save
    // meanwhile makes the next read decrypt again.
    cachedQueue = { stored, entries };
    return entries;
  } catch {
    cachedQueue = undefined;
    return [];
  }
}

function writeQueue(entries: any[]): void {
  // Not cached: native `registerPrefetch` can save between this write and a read-back.
  cachedQueue = undefined;
  NativeStorageSingleton.setSecureString(
    AUTOPREFETCH_QUEUE_KEY,
    JSON.stringify(entries)
  );
}

/** Save a request so native code can prefetch it on app start. */
// Entries embed request headers (may hold credentials) — stored encrypted at rest.
export async function prefetchOnAppStart(
  input: RequestInfo | URL,
  init?: RequestInit & {
    /** Key that a later `fetch` uses to pick up the result. Can also be set as a header. */
    prefetchKey?: string;
    /** Fails the request if no data arrives for this many milliseconds. */
    timeoutMs?: number;
    /** How urgent the request is. Default `'auto'`. */
    priority?: RequestPriority;
  }
): Promise<void> {
  // Resolve request and prefetchKey
  init = await resolveRequestBody(input, init);
  init = await resolveBlobBody(init);
  const req = buildNitroRequest(input, init);
  const fromHeader = req.headers?.find(
    (h) => h.key.toLowerCase() === 'prefetchkey'
  )?.value;
  const fromInit = (init as any)?.prefetchKey as string | undefined;
  const prefetchKey = fromHeader ?? fromInit;
  if (!prefetchKey) {
    throw new Error(
      'prefetchOnAppStart requires a "prefetchKey" (header or init.prefetchKey)'
    );
  }

  // Convert headers to a plain object for storage
  const headersObj = (req.headers ?? []).reduce(
    (acc, { key, value }) => {
      acc[String(key)] = String(value);
      return acc;
    },
    {} as Record<string, string>
  );

  const entry: Record<string, any> = {
    url: req.url,
    prefetchKey,
    headers: headersObj,
  };
  if (req.method && req.method !== 'GET') entry.method = req.method;
  if (req.bodyString !== undefined) entry.bodyString = req.bodyString;
  if (req.bodyBytes && req.bodyBytes.byteLength > 0)
    entry.bodyBytesBase64 = base64FromBytes(new Uint8Array(req.bodyBytes));
  if (req.bodyFormData && req.bodyFormData.length > 0)
    entry.bodyFormData = req.bodyFormData;
  if (typeof req.timeoutMs === 'number') entry.timeoutMs = req.timeoutMs;
  if (req.priority) entry.priority = req.priority;
  if (req.followRedirects === false) entry.followRedirects = false;
  if (req.credentials && req.credentials !== 'same-origin')
    entry.credentials = req.credentials;
  if (typeof req.prefetchCacheTtlMs === 'number')
    entry.prefetchCacheTtlMs = req.prefetchCacheTtlMs;

  // Write or append to storage queue
  try {
    const queue = readQueue();
    const existing = queue.find((e) => e && e.prefetchKey === prefetchKey);
    // Apps usually register the same requests on every launch; skip rewriting them.
    if (existing && JSON.stringify(existing) === JSON.stringify(entry)) return;
    writeQueue([
      ...queue.filter((e) => e && e.prefetchKey !== prefetchKey),
      entry,
    ]);
  } catch (e) {
    console.warn('Failed to persist prefetch queue', e);
  }
}

/** Remove one entry (by prefetchKey) from the auto-prefetch queue. */
export async function removeFromAutoPrefetch(
  prefetchKey: string
): Promise<void> {
  try {
    const queue = readQueue();
    const next = queue.filter((e) => e && e.prefetchKey !== prefetchKey);
    if (next.length === 0) {
      cachedQueue = undefined;
      NativeStorageSingleton.removeSecureString(AUTOPREFETCH_QUEUE_KEY);
    } else if (next.length !== queue.length) {
      writeQueue(next);
    }
  } catch (e) {
    console.warn('Failed to remove from prefetch queue', e);
  }
}

/** Remove all entries from the auto-prefetch queue. */
export async function removeAllFromAutoprefetch(): Promise<void> {
  try {
    cachedQueue = undefined;
    NativeStorageSingleton.removeSecureString(AUTOPREFETCH_QUEUE_KEY);
  } catch (e) {
    console.warn('Failed to clear prefetch queue', e);
  }
}

/** @internal Reads the app-start prefetch list. */
export function __readAutoPrefetchQueue(): Array<Record<string, any>> {
  try {
    const raw = NativeStorageSingleton.getSecureString(AUTOPREFETCH_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Optional off-thread processing using react-native-worklets
