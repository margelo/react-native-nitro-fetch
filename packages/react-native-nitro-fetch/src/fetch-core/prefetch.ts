import { NativeStorage as NativeStorageSingleton } from '../NitroInstances';
import { base64FromBytes } from '../blob';
import { NitroFetchHybrid, ensureClient } from './client';
import { resolveRequestBody, resolveBlobBody } from './body';
import { buildNitroRequest } from './request';

// Start a native prefetch. Requires a `prefetchKey` header on the request.
export async function prefetch(
  input: RequestInfo | URL,
  init?: RequestInit
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

const AUTOPREFETCH_QUEUE_KEY = 'nitrofetch_autoprefetch_queue';

// Persist a request to storage so native can prefetch it on app start.
// Entries embed request headers (may hold credentials) — stored encrypted at rest.
export async function prefetchOnAppStart(
  input: RequestInfo | URL,
  init?: RequestInit & { prefetchKey?: string }
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
  if (req.followRedirects === false) entry.followRedirects = false;
  if (req.credentials && req.credentials !== 'same-origin')
    entry.credentials = req.credentials;
  if (typeof req.prefetchCacheTtlMs === 'number')
    entry.prefetchCacheTtlMs = req.prefetchCacheTtlMs;

  // Write or append to storage queue
  try {
    let arr: any[] = [];
    try {
      const raw = NativeStorageSingleton.getSecureString(
        AUTOPREFETCH_QUEUE_KEY
      );
      if (raw) arr = JSON.parse(raw);
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    if (arr.some((e) => e && e.prefetchKey === prefetchKey)) {
      arr = arr.filter((e) => e && e.prefetchKey !== prefetchKey);
    }
    arr.push(entry);
    NativeStorageSingleton.setSecureString(
      AUTOPREFETCH_QUEUE_KEY,
      JSON.stringify(arr)
    );
  } catch (e) {
    console.warn('Failed to persist prefetch queue', e);
  }
}

// Remove one entry (by prefetchKey) from the auto-prefetch queue.
export async function removeFromAutoPrefetch(
  prefetchKey: string
): Promise<void> {
  try {
    let arr: any[] = [];
    try {
      const raw = NativeStorageSingleton.getSecureString(
        AUTOPREFETCH_QUEUE_KEY
      );
      if (raw) arr = JSON.parse(raw);
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    const next = arr.filter((e) => e && e.prefetchKey !== prefetchKey);
    if (next.length === 0) {
      NativeStorageSingleton.removeSecureString(AUTOPREFETCH_QUEUE_KEY);
    } else if (next.length !== arr.length) {
      NativeStorageSingleton.setSecureString(
        AUTOPREFETCH_QUEUE_KEY,
        JSON.stringify(next)
      );
    }
  } catch (e) {
    console.warn('Failed to remove from prefetch queue', e);
  }
}

// Remove all entries from the auto-prefetch queue.
export async function removeAllFromAutoprefetch(): Promise<void> {
  try {
    NativeStorageSingleton.removeSecureString(AUTOPREFETCH_QUEUE_KEY);
  } catch (e) {
    console.warn('Failed to clear prefetch queue', e);
  }
}

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
