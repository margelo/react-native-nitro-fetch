import { type HybridObject, NitroModules } from 'react-native-nitro-modules'

/** Connection state of a WebSocket. */
export type WebSocketReadyState = 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED'

/** A message as the native WebSocket delivers it. */
export interface HybridWebSocketMessageEvent {
  /** Message bytes. Text messages are UTF-8. */
  data: ArrayBuffer
  /** Whether it is a binary message. */
  isBinary: boolean
}

/** Passed to `onclose`. */
export interface WebSocketCloseEvent {
  /** Close code, such as `1000` for a normal close. */
  code: number
  /** Close reason, if any. */
  reason: string
  /** Whether the connection closed cleanly. */
  wasClean: boolean
}

/** The native WebSocket object. Apps normally use `NitroWebSocket` instead. */
export interface HybridWebSocket extends HybridObject<{
  ios: 'c++'
  android: 'c++'
}> {
  /** Connection state. */
  readonly readyState: WebSocketReadyState
  /** The URL passed to `connect`. */
  readonly url: string
  /** Bytes waiting to be sent. */
  readonly bufferedAmount: number
  /** The subprotocol the server picked. */
  readonly protocol: string
  /** The extensions the server picked. */
  readonly extensions: string

  /** Opens a connection. `headers` are added to the upgrade request. */
  connect(
    url: string,
    protocols: string[],
    headers: Record<string, string>
  ): void
  /** Closes the connection. */
  close(code: number, reason: string): void
  /** Sends a text message. */
  send(data: string): void
  /** Sends a binary message. */
  sendBinary(data: ArrayBuffer): void
  /** Called when the connection opens. */
  onOpen: (() => void) | undefined
  /** Called for each message. */
  onMessage: ((event: HybridWebSocketMessageEvent) => void) | undefined
  /** Called when the connection closes. */
  onClose: ((event: WebSocketCloseEvent) => void) | undefined
  /** Called with an error message when the connection fails. */
  onError: ((error: string) => void) | undefined
}

/** Creates a native WebSocket object. Apps normally use `NitroWebSocket` instead. */
export const createWebSocket = (): HybridWebSocket =>
  NitroModules.createHybridObject<HybridWebSocket>('WebSocket')
