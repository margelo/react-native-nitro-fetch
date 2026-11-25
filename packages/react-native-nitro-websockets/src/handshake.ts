const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const INVALID_VALUE = /[\0\r\n]/

export function assertValidHandshake(
  protocols: string[],
  headers?: Record<string, string>
): void {
  for (let i = 0; i < protocols.length; i++) {
    const protocol = protocols[i]!
    if (!TOKEN.test(protocol) || protocols.indexOf(protocol) !== i) {
      throw new SyntaxError(
        `Invalid WebSocket subprotocol: ${JSON.stringify(protocol)}`
      )
    }
  }
  if (!headers) return
  for (const name of Object.keys(headers)) {
    if (!TOKEN.test(name)) {
      throw new TypeError(`Invalid header name: ${JSON.stringify(name)}`)
    }
    if (INVALID_VALUE.test(String(headers[name]))) {
      throw new TypeError(`Invalid header value for ${JSON.stringify(name)}`)
    }
  }
}
