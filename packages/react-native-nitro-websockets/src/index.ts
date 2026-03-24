import { NitroModules } from 'react-native-nitro-modules'
import type {
  HybridWebSocket,
  WebSocketMessageEvent as NitroWSMessageEvent,
  WebSocketCloseEvent as NitroWSCloseEvent,
} from './NitroWebSocket.nitro'

export { createWebSocket } from './NitroWebSocket.nitro'
export type {
  HybridWebSocket,
  WebSocketMessageEvent,
  WebSocketCloseEvent,
  WebSocketReadyState,
} from './NitroWebSocket.nitro'

export {
  prewarmOnAppStart,
  removeFromPrewarmQueue,
  clearPrewarmQueue,
} from './prewarm'

/**
 * Browser-compatible WebSocket wrapper backed by a Nitro HybridObject
 * using libwebsockets + mbedTLS under the hood.
 */
export class NitroWebSocket {
  private _ws: HybridWebSocket

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
    this._ws.onOpen = fn ?? undefined
  }
  set onmessage(fn: ((e: NitroWSMessageEvent) => void) | null) {
    this._ws.onMessage = fn ?? undefined
  }
  set onclose(fn: ((e: NitroWSCloseEvent) => void) | null) {
    this._ws.onClose = fn ?? undefined
  }
  set onerror(fn: ((error: string) => void) | null) {
    this._ws.onError = fn ?? undefined
  }

  send(data: string | ArrayBuffer) {
    if (typeof data === 'string') {
      this._ws.send(data)
    } else {
      this._ws.sendBinary(data)
    }
  }

  close(code = 1000, reason = '') {
    this._ws.close(code, reason)
  }
}
