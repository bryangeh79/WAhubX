# Baileys Worker · Phase 2 子进程隔离 (Operations Guide)

> **状态**: Phase 2.1-2.10 已完成 · 进入运维 + 测试阶段
> 启用: `WA_WORKER_MODE=true` 在 `.env` 文件 · 重启 backend

---

## 1. 为什么有这个

**Phase 1 行为层稳定**: jitter / 440 判死 / 24h 静默 / 状态真相 · 但所有 slot 共用同一 Node 进程 · 同一 TLS 库 / DNS / baileys 实例 · WA 可能跨 IP 通过协议层指纹关联多号.

**Phase 2 进程级隔离**: 每 slot 独立 Node 子进程 · 独立 TLS / DNS / baileys / 内存 · 对标 FAhubX 每账号独立 Chromium 进程的隔离思路.

---

## 2. 架构

```
┌─────────────────────────────────────────────────────┐
│  NestJS Backend Parent Process (orchestrator)       │
│  ├── BaileysService (facade · 老路径 + worker 路由) │
│  ├── BaileysWorkerManagerService                    │
│  │   ├── workers: Map<slotId, ChildProcess>         │
│  │   ├── pending: Map<requestId, {resolve, reject}> │
│  │   └── lifecycle (fork / kill / respawn / quarantine) │
│  └── EventEmitter2 (baileys.worker.* 事件转发)      │
└──────┬──────────────────┬──────────────────────────┘
       │ IPC              │ IPC
       ↓                  ↓
┌─────────────────┐  ┌─────────────────┐
│  Worker #61     │  │  Worker #62     │
│  (独立 Node)    │  │  (独立 Node)    │
│  ├── WASocket   │  │  ├── WASocket   │
│  ├── 独立 TLS   │  │  ├── 独立 TLS   │
│  ├── 自管重连   │  │  ├── 自管重连   │
│  ├── pino 独立  │  │  ├── pino 独立  │
│  └── creds 自存 │  │  └── creds 自存 │
└─────────────────┘  └─────────────────┘
```

## 3. 文件位置

```
packages/backend/src/modules/baileys/worker/
├── worker-protocol.ts                    # IPC 类型定义 (17 命令 · 11 事件)
├── baileys-worker.ts                     # 子进程 entry · 编译为 dist/.../worker/baileys-worker.js
├── baileys-worker-manager.service.ts     # 父进程 orchestrator
└── README.md                             # 本文件
```

## 4. 启动 / 停止

### 启动 (worker 模式)

```bash
# .env 必须有 WA_WORKER_MODE=true
cd packages/backend
node --enable-source-maps dist/main
```

观察日志:
- `WAhubX backend listening on http://localhost:9700/api/v1` 父就绪
- 每 slot rehydrate 时打 `worker for slot N initialized · pid=PID`

### 验证子进程已 fork

```powershell
# Windows
tasklist | findstr node
# Linux/Mac
ps -f --forest | grep node
```

预期: parent + N 个 child (N = bound slots)

### 停止

```powershell
# 父进程 SIGTERM 时会广播 shutdown 给所有 worker · 等 5s · 超时 SIGKILL
taskkill /PID <parent_pid>
```

## 5. 故障排查

### 5.1 worker 没起来

**症状**: 绑号成功但 `tasklist` 看不到 child node 进程

**排查**:
1. `.env` 是否有 `WA_WORKER_MODE=true`?
2. 父进程日志找 `WORKER_MODE not enabled` warning
3. 父进程日志找 `worker for slot N init failed`
4. 检查 `dist/modules/baileys/worker/baileys-worker.js` 是否存在 (build 是否跑过)

### 5.2 worker 起来但绑号超时

**症状**: 父日志 `worker command timeout after 30000ms` · slot 状态 starting

**排查**:
1. 子进程是否还在? `tasklist | findstr <child_pid>`
2. 子进程日志 (转发到父日志, prefix `[worker#N]`)
3. WA 协议握手超时 - 看 `init queries Timed Out` (网络 / proxy 问题)
4. 重启 backend (worker 会重新 fork)

### 5.3 worker 频繁崩溃

**症状**: 父日志 `worker slot N exit code=X` 多次

**自动机制**:
- 24h 内崩 < 3 次: respawn (5s delay)
- 24h 内崩 >= 3 次: 标 quarantine · 不再 respawn · 需人工换号

**人工干预**:
- DB: `UPDATE account_slot SET status = 'empty', account_id = NULL WHERE id = X` (原厂重置)
- 删 session: `rm -rf packages/backend/data/slots/0X/wa-session/*`
- 重新绑号

### 5.4 slot 1 看 socket_last_heartbeat_at 不更新

**症状**: UI 三色灯红 · DB 心跳很久前

**worker 模式应**:
- 每 30s 心跳事件 worker → parent (在 manager.handleEvent 写 DB)
- 检查 worker 进程是否还活
- 检查 baileys 内部 ws.readyState (应=1 OPEN)

**老路径应**:
- 每 60s heartbeatTick 父进程扫 pool
- worker 模式下 heartbeatTick 直接 return (避免空跑)

### 5.5 切换 worker 模式

**老路径 → worker**:
1. 设 `WA_WORKER_MODE=true`
2. 重启 backend
3. onModuleInit 自动用 workerManager.rehydrate 起 slots
4. session dir 不需动 · creds 兼容

**worker → 老路径**:
1. 删 / 注释 `WA_WORKER_MODE`
2. 重启 backend
3. onModuleInit 走 spawnPooledSocket · slots 重新进父进程 pool

> ⚠️ 切换瞬间 socket 重建 · WA 可能视作新设备登录触发 440 · 慎重切换

## 6. IPC 协议命令清单 (17)

| 命令 | 用途 |
|---|---|
| `init` | 初始化 worker 配置 (sessionDir / fingerprint / proxy) |
| `rehydrate` | 已有 session · 起 pool socket |
| `start-bind` | 空 session · 走 QR 或 pair code |
| `cancel-bind` | 取消 bind |
| `send-text` | 发文本 |
| `send-media` | 发媒体 (image/video/voice/audio/file) |
| `send-presence` | composing/recording/paused/available |
| `send-react` | 表情反应 (status@broadcast 或聊天) |
| `read-messages` | 标已读 |
| `newsletter-metadata` | 查频道 metadata (invite/jid) |
| `newsletter-follow` | follow 频道 |
| `group-get-invite-info` | 预览群邀请 |
| `group-accept-invite` | 加群 |
| `profile-picture-url` | 取头像 URL |
| `update-profile-status` | 改 About 签名 |
| `fetch-status` | 查当前 worker / socket 状态 |
| `shutdown` / `force-evict` | 优雅 / 强制关闭 |

## 7. 事件清单 (11)

Worker → Parent (通过 EventEmitter2 转发为 `baileys.worker.<type>`):

| 事件 | 触发 |
|---|---|
| `qr` | bind 流 · 新 QR 生成 |
| `pairing-code` | bind 流 · pair code 生成 |
| `bind-state` | bind 流状态变化 (qr/connecting/connected/failed/cancelled) |
| `connection-open` | socket OPEN (sock.user.id) |
| `connection-close` | socket 关闭 (code + reason) |
| `creds-updated` | creds 变化 (worker 自落盘) |
| `message-upsert` | 消息入站 (转发 raw WAMessage 数组) |
| `status-upsert` | 状态消息 |
| `heartbeat` | 30s 主动心跳 (wsOpen 标志) |
| `worker-error` | 内部异常 (fatal=true 触发 quarantine) |
| `worker-log` | 日志转发 (level + message) |

## 8. 已知未做

| 项 | 影响 | 优先级 |
|---|---|---|
| worker IPC 集成测试 | 无自动化覆盖 · 靠手动冒烟 | 中 |
| E2E 自动化冒烟 (新 SIM) | 同 | 中 |
| takeover.gateway 心跳 worker 联动 | UI 接管面板可能延迟显示 | 低 |
| pgvector 升级 (Phase 2 无关 · M10) | 知识库语义搜索性能 | V2 |

## 9. 性能 / 资源

| 指标 | 数值 |
|---|---|
| 单 worker 内存 | ~80-120 MB (Node + baileys + deps) |
| 50 slot 总内存 | ~5 GB |
| IPC 延迟 | <5ms per round-trip (本机) |
| Heartbeat 频率 | 30s (worker 主动) |
| 命令超时 | 30s (无 ACK 即失败) |
| Worker 崩溃恢复 | 5s respawn delay |
| Quarantine 阈值 | 24h 内 ≥ 3 次崩溃 |

## 10. 应急按钮

```sql
-- 强制重置某 slot (worker 会被 force-evict · 数据库清干净)
UPDATE account_slot SET status='empty', account_id=NULL, suspended_until=NULL WHERE id=X;
DELETE FROM wa_account WHERE id=Y; -- 配合上面的 account_id

-- 清绑号 cooldown (默认 600s)
UPDATE tenant SET last_bind_at=NULL WHERE id=Z;

-- 把 quarantined slot 重新放出来 (慎用 · 通常号已废)
UPDATE account_slot SET status='active', suspended_until=NULL WHERE id=X AND status='quarantine';
```

```bash
# 强制 kill 某 worker (父会 auto-respawn)
taskkill /F /PID <worker_pid>     # Windows
kill -9 <worker_pid>              # Linux/Mac

# 完全清 session 让 slot 重新走 QR 绑号
rm -rf packages/backend/data/slots/<slotIndex>/wa-session/*
```

---

> **维护者**: 任何 Phase 2 改动需更新本文件 · 协议命令变化也要写到 § 6
