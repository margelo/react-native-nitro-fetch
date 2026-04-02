import { generateCurl } from './CurlGenerator';

export interface NetworkEntry {
  id: string;
  url: string;
  method: string;
  requestHeaders: Array<{ key: string; value: string }>;
  requestBody: string | undefined;
  requestBodySize: number;
  status: number;
  statusText: string;
  responseHeaders: Array<{ key: string; value: string }>;
  responseBodySize: number;
  startTime: number;
  endTime: number;
  duration: number;
  curl: string;
  error?: string;
}

export type NetworkEntryCallback = (entry: NetworkEntry) => void;

class NetworkInspectorImpl {
  private _enabled: boolean = false;
  private _entries: NetworkEntry[] = [];
  private _maxEntries: number = 500;
  private _maxBodyCapture: number = 4096;
  private _listeners: Set<NetworkEntryCallback> = new Set();

  enable(options?: { maxEntries?: number; maxBodyCapture?: number }): void {
    this._enabled = true;
    if (options?.maxEntries != null) this._maxEntries = options.maxEntries;
    if (options?.maxBodyCapture != null)
      this._maxBodyCapture = options.maxBodyCapture;
  }

  disable(): void {
    this._enabled = false;
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  getEntries(): ReadonlyArray<NetworkEntry> {
    return this._entries;
  }

  getEntry(id: string): NetworkEntry | undefined {
    return this._entries.find((e) => e.id === id);
  }

  clear(): void {
    this._entries = [];
  }

  onEntry(callback: NetworkEntryCallback): () => void {
    this._listeners.add(callback);
    return () => {
      this._listeners.delete(callback);
    };
  }

  _recordStart(
    id: string,
    url: string,
    method: string,
    headers: Array<{ key: string; value: string }>,
    body?: string
  ): void {
    if (!this._enabled) return;
    const bodySize = body ? body.length : 0;
    const entry: NetworkEntry = {
      id,
      url,
      method,
      requestHeaders: headers.map((h) => ({ key: h.key, value: h.value })),
      requestBody: body ? body.slice(0, this._maxBodyCapture) : undefined,
      requestBodySize: bodySize,
      status: 0,
      statusText: '',
      responseHeaders: [],
      responseBodySize: 0,
      startTime: performance.now(),
      endTime: 0,
      duration: 0,
      curl: generateCurl({ url, method, headers, body }),
    };
    this._entries.push(entry);
    if (this._entries.length > this._maxEntries) {
      this._entries.shift();
    }
  }

  _recordEnd(
    id: string,
    status: number,
    statusText: string,
    headers: Array<{ key: string; value: string }>,
    bodySize: number,
    error?: string
  ): void {
    if (!this._enabled) return;
    const entry = this._entries.find((e) => e.id === id);
    if (!entry) return;
    entry.status = status;
    entry.statusText = statusText;
    entry.responseHeaders = headers.map((h) => ({ key: h.key, value: h.value }));
    entry.responseBodySize = bodySize;
    entry.endTime = performance.now();
    entry.duration = entry.endTime - entry.startTime;
    if (error) entry.error = error;
    for (const cb of this._listeners) {
      try {
        cb(entry);
      } catch {
        // swallow listener errors
      }
    }
  }
}

export const NetworkInspector = new NetworkInspectorImpl();
