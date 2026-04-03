import { generateCurl } from './CurlGenerator';

export interface NetworkEntry {
  id: string;
  type: 'http';
  url: string;
  method: string;
  requestHeaders: Array<{ key: string; value: string }>;
  requestBody: string | undefined;
  requestBodySize: number;
  status: number;
  statusText: string;
  responseHeaders: Array<{ key: string; value: string }>;
  responseBody?: string;
  responseBodySize: number;
  startTime: number;
  endTime: number;
  duration: number;
  curl: string;
  error?: string;
}

export interface WebSocketMessage {
  direction: 'sent' | 'received';
  data: string;
  size: number;
  isBinary: boolean;
  timestamp: number;
}

export interface WebSocketEntry {
  id: string;
  type: 'websocket';
  url: string;
  protocols: string[];
  requestHeaders: Array<{ key: string; value: string }>;
  startTime: number;
  endTime: number;
  duration: number;
  readyState: string;
  messages: WebSocketMessage[];
  messagesSent: number;
  messagesReceived: number;
  bytesSent: number;
  bytesReceived: number;
  closeCode?: number;
  closeReason?: string;
  error?: string;
}

export type InspectorEntry = NetworkEntry | WebSocketEntry;

export type NetworkEntryCallback = (entry: InspectorEntry) => void;

class NetworkInspectorImpl {
  private _enabled: boolean = false;
  private _entries: InspectorEntry[] = [];
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

  getEntries(): ReadonlyArray<InspectorEntry> {
    return this._entries;
  }

  getHttpEntries(): ReadonlyArray<NetworkEntry> {
    return this._entries.filter((e): e is NetworkEntry => e.type === 'http');
  }

  getWebSocketEntries(): ReadonlyArray<WebSocketEntry> {
    return this._entries.filter(
      (e): e is WebSocketEntry => e.type === 'websocket'
    );
  }

  getEntry(id: string): InspectorEntry | undefined {
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

  private _notify(entry: InspectorEntry): void {
    for (const cb of this._listeners) {
      try {
        cb(entry);
      } catch {
        // swallow listener errors
      }
    }
  }

  private _trimEntries(): void {
    if (this._entries.length > this._maxEntries) {
      this._entries.shift();
    }
  }

  // --- HTTP recording ---

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
      type: 'http',
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
    this._trimEntries();
  }

  _recordEnd(
    id: string,
    status: number,
    statusText: string,
    headers: Array<{ key: string; value: string }>,
    bodySize: number,
    error?: string,
    responseBody?: string
  ): void {
    if (!this._enabled) return;
    const entry = this._entries.find(
      (e) => e.id === id && e.type === 'http'
    ) as NetworkEntry | undefined;
    if (!entry) return;
    entry.status = status;
    entry.statusText = statusText;
    entry.responseHeaders = headers.map((h) => ({
      key: h.key,
      value: h.value,
    }));
    entry.responseBodySize = bodySize;
    entry.endTime = performance.now();
    entry.duration = entry.endTime - entry.startTime;
    if (error) entry.error = error;
    if (responseBody != null) {
      entry.responseBody = responseBody.slice(0, this._maxBodyCapture);
    }
    this._notify(entry);
  }

  // --- WebSocket recording ---

  _recordWsOpen(
    id: string,
    url: string,
    protocols: string[],
    headers: Array<{ key: string; value: string }>
  ): void {
    if (!this._enabled) return;
    const entry: WebSocketEntry = {
      id,
      type: 'websocket',
      url,
      protocols,
      requestHeaders: headers.map((h) => ({ key: h.key, value: h.value })),
      startTime: performance.now(),
      endTime: 0,
      duration: 0,
      readyState: 'CONNECTING',
      messages: [],
      messagesSent: 0,
      messagesReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,
    };
    this._entries.push(entry);
    this._trimEntries();
    this._notify(entry);
  }

  _recordWsConnected(id: string): void {
    if (!this._enabled) return;
    const entry = this._entries.find(
      (e) => e.id === id && e.type === 'websocket'
    ) as WebSocketEntry | undefined;
    if (!entry) return;
    entry.readyState = 'OPEN';
    this._notify(entry);
  }

  _recordWsMessage(
    id: string,
    direction: 'sent' | 'received',
    data: string,
    size: number,
    isBinary: boolean
  ): void {
    if (!this._enabled) return;
    const entry = this._entries.find(
      (e) => e.id === id && e.type === 'websocket'
    ) as WebSocketEntry | undefined;
    if (!entry) return;
    entry.messages.push({
      direction,
      data: data.slice(0, this._maxBodyCapture),
      size,
      isBinary,
      timestamp: performance.now(),
    });
    if (direction === 'sent') {
      entry.messagesSent++;
      entry.bytesSent += size;
    } else {
      entry.messagesReceived++;
      entry.bytesReceived += size;
    }
    this._notify(entry);
  }

  _recordWsClose(id: string, code: number, reason: string): void {
    if (!this._enabled) return;
    const entry = this._entries.find(
      (e) => e.id === id && e.type === 'websocket'
    ) as WebSocketEntry | undefined;
    if (!entry) return;
    entry.readyState = 'CLOSED';
    entry.closeCode = code;
    entry.closeReason = reason;
    entry.endTime = performance.now();
    entry.duration = entry.endTime - entry.startTime;
    this._notify(entry);
  }

  _recordWsError(id: string, error: string): void {
    if (!this._enabled) return;
    const entry = this._entries.find(
      (e) => e.id === id && e.type === 'websocket'
    ) as WebSocketEntry | undefined;
    if (!entry) return;
    entry.error = error;
    this._notify(entry);
  }
}

export const NetworkInspector = new NetworkInspectorImpl();
