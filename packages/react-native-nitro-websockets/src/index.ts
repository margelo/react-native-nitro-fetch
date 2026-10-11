import { NitroModules } from 'react-native-nitro-modules'
import { TextDecoder } from 'react-native-nitro-text-decoder'
import type {
  HybridWebSocket,
  HybridWebSocketMessageEvent,
  WebSocketCloseEvent as NitroWSCloseEvent,
} from './NitroWebSocket.nitro'

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

function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

function generateWsId(): string {
  return 'ws-' + String(Date.now()) + '-' + String(Math.random()).slice(2, 8)
}

/**
 * Browser-compatible WebSocket wrapper backed by a Nitro HybridObject
 * using libwebsockets + mbedTLS under the hood.
 */
export class NitroWebSocket {
  private _ws: HybridWebSocket
  private _inspectorId: string | undefined

  constructor(
    url: string,
    protocols?: string | string[],
    headers?: Record<string, string>
  ) {
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
  set onmessage(fn: ((e: WebSocketMessageEvent) => void) | null) {
    if (fn == null) {
      this._ws.onMessageBatch = undefined
      return
    }
    const inspectorId = this._inspectorId
    const deliver = (item: string | HybridWebSocketMessageEvent) => {
      if (typeof item === 'string') {
        if (inspectorId && _inspector?.isEnabled()) {
          _inspector._recordWsMessage(
            inspectorId,
            'received',
            item,
            utf8ByteLength(item),
            false
          )
        }
        fn({
          data: item,
          isBinary: false,
        })
      } else if (item.isBinary) {
        const size = item.data.byteLength
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
          binaryData: item.data,
        })
      } else {
        const buf = item.data
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
    this._ws.onMessageBatch = (items) => {
      let failed = false
      let error: unknown
      for (let i = 0; i < items.length; i++) {
        try {
          deliver(items[i]!)
        } catch (e) {
          if (!failed) {
            failed = true
            error = e
          }
        }
      }
      if (failed) throw error
    }
  }
  set onclose(fn: ((e: NitroWSCloseEvent) => void) | null) {
    if (fn == null) {
      this._ws.onClose = undefined
      return
    }
    const inspectorId = this._inspectorId
    this._ws.onClose = (e: NitroWSCloseEvent) => {
      if (inspectorId && _inspector?.isEnabled()) {
        _inspector._recordWsClose(inspectorId, e.code, e.reason)
      }
      fn(e)
    }
  }
  set onerror(fn: ((error: string) => void) | null) {
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
