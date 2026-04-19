// 本地 HTTP CONNECT 转发代理 (仅 dev 验证 slot 出口是否真的走代理)
// 用法: LABEL=P8080 PORT=8080 npx ts-node scripts/dev-proxy.ts
//       LABEL=P8081 PORT=8081 npx ts-node scripts/dev-proxy.ts (另一终端)
// 然后给槽位 PATCH /slots/:id/proxy 指向对应端口,
// 触发 bind/reconnect, 每个代理日志应只看到自己那槽的 CONNECT.
import * as http from 'node:http';
import * as net from 'node:net';

const PORT = Number(process.env.PORT ?? 8080);
const LABEL = process.env.LABEL ?? `P${PORT}`;

const server = http.createServer((_req, res) => {
  // 非 CONNECT 的 HTTP 请求用不上 — WA/Baileys 全走 wss CONNECT tunnel
  res.statusCode = 501;
  res.end(`${LABEL} 只支持 CONNECT, 收到普通 HTTP`);
});

server.on('connect', (req, clientSocket, head) => {
  const target = req.url ?? '';
  const [hostname, portStr] = target.split(':');
  const port = Number(portStr) || 443;

  const ts = new Date().toISOString();
  console.log(`[${LABEL} ${ts}] CONNECT ${hostname}:${port}`);

  const serverSocket = net.connect(port, hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  const onError = (err: Error, which: string) => {
    console.error(`[${LABEL}] ${which} error: ${err.message}`);
    clientSocket.destroy();
    serverSocket.destroy();
  };
  serverSocket.on('error', (e) => onError(e, 'upstream'));
  clientSocket.on('error', (e) => onError(e, 'client'));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[${LABEL}] HTTP CONNECT proxy listening on 127.0.0.1:${PORT}`);
  console.log(`[${LABEL}] 任何 CONNECT 会被记录到本终端, 可用来验证 slot 出口`);
});
