// 本地 HTTP CONNECT 转发代理 (仅 dev 验证 slot 出口是否真的走代理)
// 用法:
//   LABEL=P8080 PORT=8080                      npx ts-node scripts/dev-proxy.ts
//   LABEL=P8081 PORT=8081 BIND_ADDR=127.0.0.2  npx ts-node scripts/dev-proxy.ts (另一终端)
//
// BIND_ADDR (可选, Linux only)  把上游 TCP 连接绑到指定本地地址 (e.g. 127.0.0.2).
// Windows 对 net.connect localAddress=127.0.0.* 返 EINVAL, 请不要设该变量.
// 路由隔离由"每个代理是独立进程 + 独立 TCP 连接"天然保证, 生产不同出口 IP
// 靠真实住宅代理.
//
// 日志格式:
// [LABEL ts] CONNECT host:port · client=IP:port · upstream=localSrcIP:port → remoteIP:port
import * as http from 'node:http';
import * as net from 'node:net';

const PORT = Number(process.env.PORT ?? 8080);
const LABEL = process.env.LABEL ?? `P${PORT}`;
const BIND_ADDR = process.env.BIND_ADDR;

const server = http.createServer((_req, res) => {
  res.statusCode = 501;
  res.end(`${LABEL} 只支持 CONNECT, 收到普通 HTTP`);
});

server.on('connect', (req, clientSocketRaw, head) => {
  // http.Server 'connect' 声明 clientSocket 为 Duplex; 实际总是 net.Socket, 转型取 remoteAddress/Port.
  const clientSocket = clientSocketRaw as net.Socket;
  const target = req.url ?? '';
  const [hostname, portStr] = target.split(':');
  const port = Number(portStr) || 443;
  const ts = new Date().toISOString();
  const clientEnd = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;

  const connectOpts: net.NetConnectOpts = BIND_ADDR
    ? { host: hostname, port, localAddress: BIND_ADDR }
    : { host: hostname, port };

  const serverSocket = net.connect(connectOpts, () => {
    const upstreamSrc = `${serverSocket.localAddress}:${serverSocket.localPort}`;
    const upstreamDst = `${serverSocket.remoteAddress}:${serverSocket.remotePort}`;
    console.log(
      `[${LABEL} ${ts}] CONNECT ${hostname}:${port} · client=${clientEnd} · upstream=${upstreamSrc} → ${upstreamDst}`,
    );
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
  if (BIND_ADDR) {
    console.log(`[${LABEL}] upstream will bind to ${BIND_ADDR} (source-IP isolation)`);
  }
  console.log(`[${LABEL}] 任何 CONNECT 会记录 client / upstream-src / upstream-dst`);
});
