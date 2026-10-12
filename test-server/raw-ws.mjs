import { createHash } from 'node:crypto';

export function acceptRawWebSocket(req, socket) {
  const accept = createHash('sha1')
    .update(
      `${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`
    )
    .digest('base64');
  socket.on('error', () => {});
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  return (opcode, payload, fin = true) => {
    const length = payload.length;
    const head = Buffer.alloc(length < 126 ? 2 : length < 65536 ? 4 : 10);
    head[0] = (fin ? 0x80 : 0) | opcode;
    if (length < 126) {
      head[1] = length;
    } else if (length < 65536) {
      head[1] = 126;
      head.writeUInt16BE(length, 2);
    } else {
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(length), 2);
    }
    socket.write(Buffer.concat([head, payload]));
  };
}
