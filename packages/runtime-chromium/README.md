# @wahubx/runtime-chromium · SaaS Chromium per-slot runtime

> 状态: **W1 D1 (脚手架)**
> 主线产品: **WAhubX SaaS Runtime** (Linux/Docker)
> 不用于: WAhubX Desktop (Desktop 走 Baileys runtime · 见 packages/backend/)

## 目的

容器内跑 1 个 Chromium · 加载 https://web.whatsapp.com · 用真 WA Web 客户端代替 Baileys
协议层模拟. 解决 Baileys 协议指纹 / TLS / DNS 关联问题.

每 slot = 一个独立容器 = 独立 Chromium 进程 = 独立 user-data-dir = 独立 proxy 出口.

## 快速跑 (D1 · about:blank baseline)

```bash
# 1. build image
cd packages/runtime-chromium
docker build -f docker/Dockerfile -t wahubx/runtime-chromium:dev .

# 2. run (no proxy 测最小路径)
docker run --rm \
  -e SLOT_ID=1 \
  -e TENANT_ID=5 \
  -e CONTROL_PLANE_WS_URL=ws://host.docker.internal:9700/runtime \
  --cap-add=NET_ADMIN \
  -v $(pwd)/wa-data-test:/app/wa-data \
  wahubx/runtime-chromium:dev

# 期望 log:
#   [init] iptables UDP/TCP 53 DROP rules applied
#   chromium launched
#   chromium loaded about:blank · D1 baseline OK
#   heartbeat (placeholder)
```

## 后续路线

- D2-3: 加载 https://web.whatsapp.com · QR 提取 · integrity-checks (C7.2/C7.3)
- D4-5: WS 桥接控制面 · 命令处理 (start_bind/send_text/...)
- W2 D1-2: ISlotRuntime 接口实装 · 控制面 SlotRuntimeService 接入
- W2 D3: ProxyAllocator 最小版集成
- W2 D4-5: 单 slot 24h soak · POC 8 项 binary 验收

## 验收标准 (Phase 1 锁定 · 见 HANDOVER session 4)

C1-C8 全过即 POC 通过. 任一不过即 POC 失败 · fallback Baileys (Desktop only).

## 文件

```
runtime-chromium/
├── docker/
│   ├── Dockerfile           # 容器镜像 (Debian + Chromium + Node)
│   └── init.sh              # entrypoint: iptables 53 封 + 启 node
├── src/
│   └── index.ts             # 主入口 · Chromium launch + WS client (D4-5 加)
├── package.json
├── tsconfig.json
└── README.md
```

## C7.3 DNS leak 封死路径

容器层:
- `iptables -I OUTPUT -p udp --dport 53 -j DROP` (init.sh)
- `iptables -I OUTPUT -p tcp --dport 53 -j DROP`
- (v6 同)

Chromium 层:
- `--proxy-server=socks5h://...` (h = hostname-resolution-at-proxy)
- `--host-resolver-rules='MAP * ~NOTFOUND, EXCLUDE proxyHost'`
- `--disable-features=AsyncDns,DnsOverHttps`

平台限定: 此方案仅 Linux SaaS · 容器需 `cap_add: [NET_ADMIN]` · Desktop/Windows 不带这套.

## 已知未做

- WA Web QR 提取 (D2)
- integrity-checks (C7.2 / C7.3 自动跑) (D2)
- WS bridge 协议 (D4-5)
- ISlotRuntime 接口实装 (W2)

不在 SaaS POC 范围 (永久冻结见 HANDOVER 冻结名单):
- status-react / status-browse / newsletter / group-invite / read-messages
- send-react / update-profile-status / profile-picture-url
