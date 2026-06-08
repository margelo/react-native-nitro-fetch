import { NitroModules } from 'react-native-nitro-modules'
import { TextDecoder } from 'react-native-nitro-text-decoder'
import type {
  HybridWebSocket,
  HybridWebSocketMessageEvent,
  WebSocketReadyState as NativeWebSocketReadyState,
  WebSocketCloseEvent as NitroWSCloseEvent,
} from './NitroWebSocket.nitro'

export { createWebSocket } from './NitroWebSocket.nitro'
export type {
  HybridWebSocket,
  HybridWebSocketMessageEvent,
  WebSocketCloseEvent,
} from './NitroWebSocket.nitro'

export type WebSocketReadyState = 0 | 1 | 2 | 3

export type WebSocketMessageEvent = {
  data: string
  isBinary: boolean
  binaryData?: ArrayBuffer
}

type WebSocketEventType = 'open' | 'message' | 'close' | 'error'
type WebSocketEventListener =
  | ((event: any) => void)
  | { handleEvent: (event: any) => void }

export {
  prewarmOnAppStart,
  removeFromPrewarmQueue,
  clearPrewarmQueue,
} from './prewarm'

const utf8Decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })
const readyStateMap: Record<NativeWebSocketReadyState, WebSocketReadyState> = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
}

// Try-import NetworkInspector from fetch package (optional peer dep)
let _inspector: any = null
try {
  _inspector = require('react-native-nitro-fetch').NetworkInspector
} catch {}

function generateWsId(): string {
  return 'ws-' + String(Date.now()) + '-' + String(Math.random()).slice(2, 8)
}

/**
 * Browser-compatible WebSocket wrapper backed by a Nitro HybridObject
 * using libwebsockets + mbedTLS under the hood.
 */
export class NitroWebSocket {
  static readonly CONNECTING = 0 as const
  static readonly OPEN = 1 as const
  static readonly CLOSING = 2 as const
  static readonly CLOSED = 3 as const

  readonly CONNECTING = NitroWebSocket.CONNECTING
  readonly OPEN = NitroWebSocket.OPEN
  readonly CLOSING = NitroWebSocket.CLOSING
  readonly CLOSED = NitroWebSocket.CLOSED

  private _ws: HybridWebSocket
  private _inspectorId: string | undefined
  binaryType: 'blob' | 'arraybuffer' = 'arraybuffer'
  private _onopen: (() => void) | null = null
  private _onmessage: ((event: any) => void) | null = null
  private _onclose: ((event: any) => void) | null = null
  private _onerror: ((event: Event | string) => void) | null = null
  private readonly _listeners: Record<
    WebSocketEventType,
    Set<WebSocketEventListener>
  > = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  }

  constructor(
    url: string | URL,
    protocols?: string | string[],
    headers?: Record<string, string>
  ) {
    const normalizedUrl = typeof url === 'string' ? url : url.toString()
    this._ws = NitroModules.createHybridObject<HybridWebSocket>('WebSocket')
    const protocolList = protocols
      ? Array.isArray(protocols)
        ? protocols
        : [protocols]
      : []
    const headerPairs = headers
      ? Object.entries(headers).map(([key, value]) => ({ key, value }))
      : []

    // Record WS open in inspector
    if (_inspector?.isEnabled()) {
      this._inspectorId = generateWsId()
      _inspector._recordWsOpen(
        this._inspectorId,
        normalizedUrl,
        protocolList,
        headerPairs
      )
    }

    this._ws.onOpen = () => {
      if (this._inspectorId && _inspector?.isEnabled()) {
        _inspector._recordWsConnected(this._inspectorId)
      }
      this._onopen?.()
      this._emitEventListeners('open', new Event('open'))
    }
    this._ws.onMessage = (native: HybridWebSocketMessageEvent) => {
      const event = this._createMessageEvent(native)
      this._onmessage?.(event)
      this._emitEventListeners('message', event)
    }
    this._ws.onClose = (event: NitroWSCloseEvent) => {
      if (this._inspectorId && _inspector?.isEnabled()) {
        _inspector._recordWsClose(this._inspectorId, event.code, event.reason)
      }
      this._onclose?.(event)
      this._emitEventListeners('close', event)
    }
    this._ws.onError = (error: string) => {
      if (this._inspectorId && _inspector?.isEnabled()) {
        _inspector._recordWsError(this._inspectorId, error)
      }
      const event = new Event('error')
      this._onerror?.(error)
      this._emitEventListeners('error', event)
    }

    this._ws.connect(normalizedUrl, protocolList, headers ?? {})
  }

  get readyState(): WebSocketReadyState {
    return readyStateMap[this._ws.readyState]
  }
  get url() {
    return this._ws.url
  }
  get protocol() {
    return this._ws.protocol
  }
  get bufferedAmount() {
    return this._ws.bufferedAmount
  }
  get extensions() {
    return this._ws.extensions
  }

  get onopen() {
    return this._onopen
  }
  set onopen(fn: (() => void) | null) {
    this._onopen = fn
  }

  get onmessage() {
    return this._onmessage
  }
  set onmessage(fn: ((event: any) => void) | null) {
    this._onmessage = fn
  }

  get onclose() {
    return this._onclose
  }
  set onclose(fn: ((event: any) => void) | null) {
    this._onclose = fn
  }

  get onerror() {
    return this._onerror
  }
  set onerror(fn: ((event: Event | string) => void) | null) {
    this._onerror = fn
  }

  send(data: string | ArrayBuffer) {
    if (typeof data === 'string') {
      if (this._inspectorId && _inspector?.isEnabled()) {
        _inspector._recordWsMessage(
          this._inspectorId,
          'sent',
          data,
          data.length,
          false
        )
      }
      this._ws.send(data)
    } else {
      if (this._inspectorId && _inspector?.isEnabled()) {
        _inspector._recordWsMessage(
          this._inspectorId,
          'sent',
          `[binary ${data.byteLength} bytes]`,
          data.byteLength,
          true
        )
      }
      this._ws.sendBinary(data)
    }
  }

  close(code = 1000, reason = '') {
    this._ws.close(code, reason)
  }

  ping() {}

  addEventListener(
    type: WebSocketEventType,
    listener: WebSocketEventListener | null
  ) {
    if (listener == null) return
    this._listeners[type].add(listener)
  }

  removeEventListener(
    type: WebSocketEventType,
    listener: WebSocketEventListener | null
  ) {
    if (listener == null) return
    this._listeners[type].delete(listener)
  }

  dispatchEvent(event: Event) {
    if (event.type === 'open') {
      this._onopen?.()
      this._emitEventListeners('open', event)
      return true
    }
    if (event.type === 'message') {
      const messageEvent = event as unknown as WebSocketMessageEvent
      this._onmessage?.(messageEvent)
      this._emitEventListeners('message', messageEvent)
      return true
    }
    if (event.type === 'close') {
      const closeEvent = event as unknown as NitroWSCloseEvent
      this._onclose?.(closeEvent)
      this._emitEventListeners('close', closeEvent)
      return true
    }
    if (event.type === 'error') {
      this._onerror?.(event)
      this._emitEventListeners('error', event)
      return true
    }
    return false
  }

  private _createMessageEvent(
    native: HybridWebSocketMessageEvent
  ): WebSocketMessageEvent {
    if (native.isBinary) {
      const size = native.data.byteLength
      if (this._inspectorId && _inspector?.isEnabled()) {
        _inspector._recordWsMessage(
          this._inspectorId,
          'received',
          `[binary ${size} bytes]`,
          size,
          true
        )
      }
      return {
        data: '',
        isBinary: true,
        binaryData: native.data,
      }
    }

    const buf = native.data
    const text =
      buf.byteLength === 0 ? '' : utf8Decoder.decode(buf, { stream: false })
    const size = buf.byteLength
    if (this._inspectorId && _inspector?.isEnabled()) {
      _inspector._recordWsMessage(
        this._inspectorId,
        'received',
        text,
        size,
        false
      )
    }
    return {
      data: text,
      isBinary: false,
    }
  }

  private _emitEventListeners(type: WebSocketEventType, event: any) {
    for (const listener of this._listeners[type]) {
      if (typeof listener === 'function') {
        listener(event)
      } else {
        listener.handleEvent(event)
      }
    }
  }
}
