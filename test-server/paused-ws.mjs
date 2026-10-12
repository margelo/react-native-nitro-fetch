import { createHash } from 'node:crypto';
import net from 'node:net';

export function listenPausedWebSocket(port) {
  net
    .createServer((socket) => {
      socket.on('error', () => {});
      let request = '';
      const onData = (data) => {
        request += data.toString('latin1');
        if (!request.includes('\r\n\r\n')) return;
        socket.off('data', onData);
        socket.pause();
        const key = /sec-websocket-key: *(\S+)/i.exec(request)?.[1] ?? '';
        const accept = createHash('sha1')
          .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest('base64');
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
        );
      };
      socket.on('data', onData);
    })
    .listen(port, '0.0.0.0');
}
