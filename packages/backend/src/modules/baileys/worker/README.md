# Baileys Worker · Phase 2 子进程隔离 (未完成)

> **状态**: Phase 2 骨架中 · 仅 IPC 协议已定稿 · **worker entry + manager 未实现**
> **Phase 1 已生产就绪** · 不依赖 Phase 2

## 为什么要 Phase 2

Phase 1 已经把行为层稳定性拉满 (jitter / 440 判死 / 24h 静默 / options 随机化 / 状态真相). 但是:

1. **所有 slot 跑在同 Node 进程** · 共用 TLS 库 / DNS resolver / baileys 库实例 / WA 协议版本
2. WA 能通过 **协议层指纹** + 连接行为 pattern **跨 IP 识别 "同一软件栈多号"** → 触发协同反作弊
3. FAhubX 的稳定性来自每账号**独立 Puppeteer 浏览器进程** → 独立 TLS/DNS/内存状态

**目标**: WAhubX 对标 · 用 Node.js child_process 实现账号级进程隔离.

## 架构

```
┌─────────────────────────────────────────────────────┐
│  NestJS Parent Process (orchestrator)               │
│                                                     │
│  BaileysService (已有 · Phase 2 重构为薄壳)        │
│    ↓                                                │
│  BaileysWorkerManager (Phase 2 新增)                │
│    ├── workers: Map<slotId, ChildProcess>           │
│    ├── pending: Map<requestId, {resolve, reject}>   │
│    ├── 命令分发 → worker.send()                     │
│    ├── 事件聚合 ← worker.on('message')              │
│    └── 生命周期 (fork / kill / respawn)             │
│                                                     │
└─────────────┬───────────────┬───────────────────────┘
              │ IPC           │ IPC
              ↓               ↓
┌─────────────────────┐  ┌─────────────────────┐
│  Worker #61         │  │  Worker #62         │
│  (独立 Node 进程)   │  │  (独立 Node 进程)   │
│                     │  │                     │
│  baileys-worker.ts  │  │  baileys-worker.ts  │
│    ├── WASocket     │  │    ├── WASocket     │
│    ├── 独立 TLS     │  │    ├── 独立 TLS     │
│    ├── 独立 pino    │  │    ├── 独立 pino    │
│    └── process.send │  │    └── process.send │
└─────────────────────┘  └─────────────────────┘
```

## 文件

### ✅ 已落地

- `worker-protocol.ts` — IPC 消息类型 · 命令 / ACK / 事件全定义
  - Commands: init / start-bind / cancel-bind / rehydrate / send-text / send-media / send-presence / fetch-status / shutdown / force-evict
  - Events: qr / pairing-code / bind-state / connection-open/close / creds-updated / message-upsert / status-upsert / heartbeat / worker-error / worker-log

### ⏳ 待实现

- `baileys-worker.ts` — 子进程 entry point
  - 收 `process.on('message', WorkerCommand)` 执行
  - `handleInit()` 建 authState + socket + 注册 listener
  - `handleStartBind()` / `handleSendText()` / 各命令对应函数
  - WASocket 事件转 WorkerEvent 通过 `process.send()` 上报
  - `setInterval(heartbeat, 30s)` 主动心跳
  - `process.on('SIGTERM')` graceful shutdown

- `baileys-worker-manager.service.ts` — 父进程 orchestrator
  - `fork(slotId)` 起 worker · 立发 InitCommand
  - `send(slotId, command)` 带 requestId · 返 Promise<AckData>
  - `on('message')` 分发: ACK → resolve pending · Event → EventEmitter2 / DB 写
  - `child.on('exit')` auto-respawn · 超过 WORKER_MAX_RESPAWN_24H 进 quarantine
  - `shutdownAll()` 模块卸载时广播 ShutdownCommand · 等 graceful · 超时 SIGKILL

## 迁移策略 (不破坏 Phase 1)

1. **Phase 2.1** · 实现 worker entry + manager · 注册到 BaileysModule 但**不调用**
2. **Phase 2.2** · 添加 env flag `WA_WORKER_MODE=true` · true 时走 worker · false 时走旧 BaileysService
3. **Phase 2.3** · 一个 API 接口一个迁移: `sendText` 最简单先做
4. **Phase 2.4** · 广播迁移: `messages.upsert` / `connection.update` 事件路由
5. **Phase 2.5** · `startBind` + `rehydrate` 复杂场景迁移
6. **Phase 2.6** · 充分测试后删除旧 BaileysService 的 socket 相关代码 · 变成纯 worker-manager facade

每阶段可独立 commit + rollback.

## 工作量估计

| 子任务 | 估时 |
|---|---|
| 2.1 worker entry 完整实现 | 6h |
| 2.2 worker-manager 完整实现 | 4h |
| 2.3 API 迁移 + feature flag | 3h |
| 2.4 事件路由 | 3h |
| 2.5 bind/rehydrate 迁移 | 4h |
| 2.6 集成测试 + 清理 | 4h |
| **合计** | **24h** |

## 关键风险

- IPC 序列化开销: WAMessage 有复杂嵌套 · 测过 JSON roundtrip 成本 (<5ms per msg)
- creds.update 竞态: worker 自己 saveCreds · 父不碰磁盘 · 避免双写
- Graceful shutdown: SIGTERM 后 worker 要 flushCreds + sock.logout(false) + process.exit(0) · 10s 内完不成父 SIGKILL
- 内存: 每 worker ~100MB · 50 slot ≈ 5GB · 本地部署可接受 · 云端要评估
- Windows child_process.fork() 在 Windows 用管道 vs Unix socket · 性能差异 · 测实际 IPC 吞吐

## 下一个 session 接手指引

1. 读本文件 + `worker-protocol.ts` 理解协议
2. 先实现 `baileys-worker.ts` 骨架 · 处理 init / shutdown / heartbeat · 让 worker 能 fork 起来不崩
3. 再加 `start-bind` 支持 (拷贝现 BaileysService 的 spawnBindSocket 逻辑)
4. 再加 `send-text` · 最简单的生命周期
5. 父侧同步写 `baileys-worker-manager.service.ts`
6. 加 feature flag gating · 老新并行跑测试
