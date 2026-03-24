import { type HybridObject, NitroModules } from 'react-native-nitro-modules'

const WS_PREWARM_KEY = 'nitro_ws_prewarm_queue'

type PrewarmEntry = {
  url: string
  protocols?: string[]
  headers?: Record<string, string>
}

interface NativeStorage extends HybridObject<{
  ios: 'swift'
  android: 'kotlin'
}> {
  getString(key: string): string
  setString(key: string, value: string): void
  removeString(key: string): void
}

function getStorage(): NativeStorage {
  return NitroModules.createHybridObject<NativeStorage>('NativeStorage')
}

function readQueue(storage: NativeStorage): PrewarmEntry[] {
  try {
    const raw = storage.getString(WS_PREWARM_KEY)
    if (!raw) return []
    return JSON.parse(raw) as PrewarmEntry[]
  } catch {
    return []
  }
}

function writeQueue(storage: NativeStorage, queue: PrewarmEntry[]): void {
  storage.setString(WS_PREWARM_KEY, JSON.stringify(queue))
}

/**
 * Persist a WebSocket URL (with optional protocols and headers) to storage so
 * the native auto-prewarmer connects to it on every subsequent app launch —
 * before React Native even boots.
 *
 * Call this once, e.g. after the user logs in. The setting survives app
 * restarts; remove it with `removeFromPrewarmQueue` on logout.
 */
export function prewarmOnAppStart(
  url: string,
  protocols?: string[],
  headers?: Record<string, string>
): void {
  const storage = getStorage()
  const queue = readQueue(storage)
  const idx = queue.findIndex((e) => e.url === url)
  const entry: PrewarmEntry = {
    url,
    ...(protocols ? { protocols } : {}),
    ...(headers ? { headers } : {}),
  }
  if (idx >= 0) {
    queue[idx] = entry
  } else {
    queue.push(entry)
  }
  writeQueue(storage, queue)
}

/**
 * Remove a URL from the prewarm queue. No-op if the URL isn't in the queue.
 */
export function removeFromPrewarmQueue(url: string): void {
  const storage = getStorage()
  const queue = readQueue(storage).filter((e) => e.url !== url)
  writeQueue(storage, queue)
}

/**
 * Remove all entries from the prewarm queue.
 */
export function clearPrewarmQueue(): void {
  const storage = getStorage()
  storage.removeString(WS_PREWARM_KEY)
}
