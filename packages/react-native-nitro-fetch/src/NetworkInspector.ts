import { generateCurl } from './CurlGenerator';

/** One HTTP request recorded by {@link NetworkInspector}. */
export interface NetworkEntry {
  /** ID of this entry. Pass it to `getEntry()`. */
  id: string;
  /** Always `'http'`. */
  type: 'http';
  /** Request URL. */
  url: string;
  /** HTTP method. */
  method: string;
  /** Headers sent with the request. */
  requestHeaders: Array<{ key: string; value: string }>;
  /** Request body, cut to `maxBodyCapture` characters. */
  requestBody: string | undefined;
  /** Length of the full request body text. */
  requestBodySize: number;
  /** `0` if the request failed. */
  status: number;
  /** Empty if the request failed. */
  statusText: string;
  /** Headers received with the response. */
  responseHeaders: Array<{ key: string; value: string }>;
  /** Response body, cut to `maxBodyCapture` characters. */
  responseBody?: string;
  /** Length of the full response body text. */
  responseBodySize: number;
  /** From `performance.now()`, in milliseconds. */
  startTime: number;
  /** From `performance.now()`, in milliseconds. */
  endTime: number;
  /** In milliseconds. */
  duration: number;
  /** The request as a `curl` command. */
  curl: string;
  /** Error message if the request failed. */
  error?: string;
}

/** One WebSocket message recorded by {@link NetworkInspector}. */
export interface WebSocketMessage {
  /** Whether the app sent or received the message. */
  direction: 'sent' | 'received';
  /** Message text, cut to `maxBodyCapture` characters. Binary messages show their size instead. */
  data: string;
  /** In bytes, except sent text, which is its length in characters. */
  size: number;
  /** Whether it was a binary message. */
  isBinary: boolean;
  /** From `performance.now()`, in milliseconds. */
  timestamp: number;
}

/** One WebSocket connection recorded by {@link NetworkInspector}. */
export interface WebSocketEntry {
  /** ID of this entry. Pass it to `getEntry()`. */
  id: string;
  /** Always `'websocket'`. */
  type: 'websocket';
  /** WebSocket URL. */
  url: string;
  /** Subprotocols the app asked for. */
  protocols: string[];
  /** Headers sent when connecting. */
  requestHeaders: Array<{ key: string; value: string }>;
  /** From `performance.now()`, in milliseconds. */
  startTime: number;
  /** From `performance.now()`, in milliseconds. `0` while open. */
  endTime: number;
  /** In milliseconds. `0` while open. */
  duration: number;
  /** `'CONNECTING'`, `'OPEN'` or `'CLOSED'`. */
  readyState: string;
  /** Every message sent and received, oldest first. */
  messages: WebSocketMessage[];
  messagesSent: number;
  messagesReceived: number;
  /** Total `size` of sent messages. */
  bytesSent: number;
  /** Total `size` of received messages. */
  bytesReceived: number;
  /** Set when the connection closes. */
  closeCode?: number;
  /** Set when the connection closes. */
  closeReason?: string;
  /** The last error message. */
  error?: string;
}

/** An HTTP request or a WebSocket connection recorded by {@link NetworkInspector}. */
export type InspectorEntry = NetworkEntry | WebSocketEntry;

/** Called when an HTTP request finishes, or when a WebSocket connection opens, gets a message, closes or fails. */
export type NetworkEntryCallback = (entry: InspectorEntry) => void;

class NetworkInspectorImpl {
  private _enabled: boolean = false;
  private _entries: InspectorEntry[] = [];
  private _maxEntries: number = 500;
  private _maxBodyCapture: number = 4096;
  private _listeners: Set<NetworkEntryCallback> = new Set();

  /** Starts recording. By default keeps the last 500 entries and 4096 characters of each body. */
  enable(options?: { maxEntries?: number; maxBodyCapture?: number }): void {
    this._enabled = true;
    if (options?.maxEntries != null) this._maxEntries = options.maxEntries;
    if (options?.maxBodyCapture != null)
      this._maxBodyCapture = options.maxBodyCapture;
  }

  /** Stops recording. Recorded entries are kept. */
  disable(): void {
    this._enabled = false;
  }

  /** Whether it is recording. */
  isEnabled(): boolean {
    return this._enabled;
  }

  /** All recorded entries, oldest first. */
  getEntries(): ReadonlyArray<InspectorEntry> {
    return this._entries;
  }

  /** Recorded HTTP requests, oldest first. */
  getHttpEntries(): ReadonlyArray<NetworkEntry> {
    return this._entries.filter((e): e is NetworkEntry => e.type === 'http');
  }

  /** Recorded WebSocket connections, oldest first. */
  getWebSocketEntries(): ReadonlyArray<WebSocketEntry> {
    return this._entries.filter(
      (e): e is WebSocketEntry => e.type === 'websocket'
    );
  }

  /** The entry with this `id`, if it is still kept. */
  getEntry(id: string): InspectorEntry | undefined {
    return this._entries.find((e) => e.id === id);
  }

  /** Deletes all recorded entries. */
  clear(): void {
    this._entries = [];
  }

  /** Calls `callback` when an entry changes. Returns a function that stops the calls. */
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

  /** @internal */
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

  /** @internal */
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

  /** @internal */
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

  /** @internal */
  _recordWsConnected(id: string): void {
    if (!this._enabled) return;
    const entry = this._entries.find(
      (e) => e.id === id && e.type === 'websocket'
    ) as WebSocketEntry | undefined;
    if (!entry) return;
    entry.readyState = 'OPEN';
    this._notify(entry);
  }

  /** @internal */
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

  /** @internal */
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

  /** @internal */
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

/** Records HTTP requests and WebSocket connections for debugging. Off until you call `enable()`. */
export const NetworkInspector = new NetworkInspectorImpl();
