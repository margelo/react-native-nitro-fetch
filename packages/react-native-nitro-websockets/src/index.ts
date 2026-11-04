import { NitroModules } from 'react-native-nitro-modules'
import { TextDecoder } from 'react-native-nitro-text-decoder'
import type {
  HybridWebSocket,
  HybridWebSocketMessageEvent,
  WebSocketCloseEvent as NitroWSCloseEvent,
} from './NitroWebSocket.nitro'
import { assertValidHandshake } from './handshake'

export { createWebSocket } from './NitroWebSocket.nitro'
export type {
  HybridWebSocket,
  HybridWebSocketMessageEvent,
  WebSocketCloseEvent,
  WebSocketReadyState,
} from './NitroWebSocket.nitro'

export type WebSocketMessageEvent = {
  data: string
  isBinary: boolean
  binaryData?: ArrayBuffer
}

export {
  prewarmOnAppStart,
  removeFromPrewarmQueue,
  clearPrewarmQueue,
} from './prewarm'

const utf8Decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })

// Try-import NetworkInspector from fetch package (optional peer dep)
let _inspector: any = null
try {
  _inspector = require('react-native-nitro-fetch').NetworkInspector
} catch {}

function generateWsId(): string {
  return 'ws-' + String(Date.now()) + '-' + String(Math.random()).slice(2, 8)
}

type Handlers = {
  onopen: (() => void) | null
  onmessage: ((e: WebSocketMessageEvent) => void) | null
  onerror: ((error: string) => void) | null
  onclose: ((e: NitroWSCloseEvent) => void) | null
}

/**
 * Browser-compatible WebSocket wrapper backed by a Nitro HybridObject
 * using libwebsockets + mbedTLS under the hood.
 */
export class NitroWebSocket {
  private _ws: HybridWebSocket
  private _inspectorId: string | undefined
  private _handlers: Handlers = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  }
  private _bound: Handlers = { ...this._handlers }
  private _bindScheduled = false
  private _closed = false

  constructor(
    url: string,
    protocols?: string | string[],
    headers?: Record<string, string>
  ) {
    const protocolList = protocols
      ? Array.isArray(protocols)
        ? protocols
        : [protocols]
      : []
    assertValidHandshake(protocolList, headers)
    this._ws = NitroModules.createHybridObject<HybridWebSocket>('WebSocket')
    const headerPairs = headers
      ? Object.entries(headers).map(([key, value]) => ({ key, value }))
      : []

    // Record WS open in inspector
    if (_inspector?.isEnabled()) {
      this._inspectorId = generateWsId()
      _inspector._recordWsOpen(
        this._inspectorId,
        url,
        protocolList,
        headerPairs
      )
    }

    this._ws.connect(url, protocolList, headers ?? {})
  }

  get readyState() {
    return this._ws.readyState
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

  set onopen(fn: (() => void) | null) {
    this._handlers.onopen = fn
    this._scheduleBind()
  }
  set onmessage(fn: ((e: WebSocketMessageEvent) => void) | null) {
    this._handlers.onmessage = fn
    this._scheduleBind()
  }
  set onerror(fn: ((error: string) => void) | null) {
    this._handlers.onerror = fn
    this._scheduleBind()
  }
  set onclose(fn: ((e: NitroWSCloseEvent) => void) | null) {
    this._handlers.onclose = fn
    this._scheduleBind()
  }

  private _scheduleBind() {
    if (this._bindScheduled) return
    this._bindScheduled = true
    queueMicrotask(() => {
      this._bindScheduled = false
      if (this._closed) return
      const handlers = this._handlers
      const bound = this._bound
      if (handlers.onopen !== bound.onopen) this._bindOpen(handlers.onopen)
      if (handlers.onmessage !== bound.onmessage) {
        this._bindMessage(handlers.onmessage)
      }
      if (handlers.onerror !== bound.onerror) this._bindError(handlers.onerror)
      if (handlers.onclose !== bound.onclose) this._bindClose(handlers.onclose)
      this._bound = { ...handlers }
    })
  }

  private _bindOpen(fn: (() => void) | null) {
    if (fn == null) {
      this._ws.onOpen = undefined
      return
    }
    const inspectorId = this._inspectorId
    this._ws.onOpen = () => {
      if (inspectorId && _inspector?.isEnabled()) {
        _inspector._recordWsConnected(inspectorId)
      }
      fn()
    }
  }
  private _bindMessage(fn: ((e: WebSocketMessageEvent) => void) | null) {
    if (fn == null) {
      this._ws.onMessage = undefined
      return
    }
    const inspectorId = this._inspectorId
    this._ws.onMessage = (native: HybridWebSocketMessageEvent) => {
      if (native.isBinary) {
        const size = native.data.byteLength
        if (inspectorId && _inspector?.isEnabled()) {
          _inspector._recordWsMessage(
            inspectorId,
            'received',
            `[binary ${size} bytes]`,
            size,
            true
          )
        }
        fn({
          data: '',
          isBinary: true,
          binaryData: native.data,
        })
      } else {
        const buf = native.data
        const text =
          buf.byteLength === 0 ? '' : utf8Decoder.decode(buf, { stream: false })
        const size = buf.byteLength
        if (inspectorId && _inspector?.isEnabled()) {
          _inspector._recordWsMessage(
            inspectorId,
            'received',
            text,
            size,
            false
          )
        }
        fn({
          data: text,
          isBinary: false,
        })
      }
    }
  }
  private _bindClose(fn: ((e: NitroWSCloseEvent) => void) | null) {
    if (fn == null) {
      this._ws.onClose = undefined
      return
    }
    const inspectorId = this._inspectorId
    this._ws.onClose = (e: NitroWSCloseEvent) => {
      if (inspectorId && _inspector?.isEnabled()) {
        _inspector._recordWsClose(inspectorId, e.code, e.reason)
      }
      this._closed = true
      this._ws.onOpen = undefined
      this._ws.onMessage = undefined
      this._ws.onError = undefined
      this._ws.onClose = undefined
      fn(e)
    }
  }
  private _bindError(fn: ((error: string) => void) | null) {
    if (fn == null) {
      this._ws.onError = undefined
      return
    }
    const inspectorId = this._inspectorId
    this._ws.onError = (error: string) => {
      if (inspectorId && _inspector?.isEnabled()) {
        _inspector._recordWsError(inspectorId, error)
      }
      fn(error)
    }
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
}
