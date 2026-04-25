# WAhubX 交接文档 · 2026-04-25 Session 4

> **新 session 接手请先读这一份 + CLAUDE.md** · 这次 session 投入巨大 · 总 commits 12

---

## 0 · 一句话定位

**Phase 1 + Phase 2 稳定性重构全部完成 + push** · 子进程级隔离对标 FAhubX · slot 1 已绑新号 (UK SIM 447746513981) 跑 worker 模式 · 等 24h 验证.

---

## 1 · 本 session 完成的事 (2026-04-25)

### 1.1 Phase 1 · 行为层稳定 (5 支柱 · 已运行)

| 支柱 | 落地 |
|---|---|
| 状态真相 | `suspended_until` + `socket_last_heartbeat_at` + UI 三色灯 |
| 440 智能判死 | 连续 2 次 440 → Quarantine · 不再烧号 |
| 指数退避 + jitter | 60s × 2^n × ±30% · 替代线性 30/60/90s |
| Baileys options 随机化 | fingerprint.baileysOpts 种子派生 · 每 slot 独立 |
| 绑号纪律 | 租户级 10 min cooldown + 24h 静默期 + 强警告 UI |

### 1.2 Phase 2 · 子进程隔离 (11 commits · 全部完成)

**核心思路**: 每 slot 独立 Node 子进程 · 独立 TLS / DNS / baileys 实例. 对标 FAhubX 每账号独立 Chromium.

**架构**:
```
Parent (NestJS)
  ├── BaileysService (facade · 路由)
  ├── BaileysWorkerManagerService (orchestrator)
  └── EventEmitter2 (baileys.worker.* 事件)
         ↓ IPC (process.send)
  Worker #N (独立 Node 进程 · 每 slot 一个)
```

**17 IPC 命令** (init / rehydrate / start-bind / cancel-bind / send-text / send-media / send-presence / send-react / read-messages / newsletter-metadata / newsletter-follow / group-get-invite-info / group-accept-invite / profile-picture-url / update-profile-status / fetch-status / shutdown / force-evict)

**11 事件类型** (qr / pairing-code / bind-state / connection-open/close / creds-updated / message-upsert / status-upsert / heartbeat / worker-error / worker-log)

**executor 全 worker 化**:
- Phase 0: send-ad / intelligent-reply (内调 sendText) ✅
- Phase 2.8: add-contact / auto-accept / auto-reply / follow-channel ✅
- Phase 2.10: status-react / status-browse-bulk / join-group / profile-refresh ✅
- Phase 2.11: groupGetInviteInfo 预览 (join-group 完整) ✅

**自管功能**:
- Worker 自管重连 (指数退避 60×2^n)
- Worker 内连续 2 次 440 → emit fatal worker-error → 父进程 markSlotQuarantined
- Worker 崩溃 24h 内 ≥ 3 次 → quarantine
- Backend 重启 worker 模式 rehydrate · 不掉隔离

**详细运维**: `packages/backend/src/modules/baileys/worker/README.md` (完整 12 节)

### 1.3 fix · Reply Wizard + Campaign Clone

- `fix(reply-wizard)`: 检测已存在公司 KB 跳过填写
- `fix(campaigns)`: clone 补 createdBy + targets 深拷贝

---

## 2 · 12 个 commits (按时间顺序)

```
4f86a38 Phase 2.11 · groupGetInviteInfo + 运维 README
4cbf4de Phase 2.10 · 全 executor worker 化 · 5 个 worker 命令补齐
8b8bbab Phase 2.9 · 打磨剩余 worker 兼容点 (statusCache + file 媒体)
4ef07f8 Phase 2.8 · worker 自管重连 + M5 executors 全迁
8fdfd09 Phase 2.7 · 扫平 4 个 caveat · 绝对隔离就绪
acf41f3 Phase 2.5b · startBind/cancelBind/getStatus facade
529c9a8 Phase 2.5 · BaileysService facade · sendText + msg event bridge
15883bc Phase 2.2-2.3 · worker 完整命令集 (bind/rehydrate/media/presence)
fcae108 Phase 2.1 MVP · worker entry + manager (send-text only)
f118254 Phase 2 骨架 · IPC 协议 + 迁移策略
bd6f961 Phase 1 稳定性重构 · 状态真相 + 440 判死 + 绑号纪律
79a3e73 fix(reply-wizard): 引导检测已存在公司通用 KB · 跳过重复填写
fd4f608 fix(campaigns): clone 补 createdBy + targets 深拷贝
```

**全部 push 到** `origin/claude/goofy-mendel-3f5881` (未合 main · 等 slot 1 稳定再 PR).

---

## 3 · 当前 running 状态

| 服务 | PID | 端口 | 备注 |
|---|---|---|---|
| Backend Parent | **30156** | :9700 | dist 是 **Phase 2.7** (后续 commits 未加载) |
| Worker Child | **17592** | - | slot 1 服务进程 · ~96 MB |
| Frontend Vite | 8736 | :5173 | worktree HMR |
| PG | docker | :5434 | wahubx-dev-pg |
| Redis | docker | :6381 | wahubx-dev-redis |
| FAhubX docker | - | :5432/:6379 | 独立 · 不影响 |

**WA_WORKER_MODE=true** 已设. **保护 slot 1 没重启** · 上面运行的还是 Phase 2.7 dist · Phase 2.8-2.11 在 disk 但未加载.

---

## 4 · 测试状态

### Slot 1 真机绑定中 · 持续观察

- **绑号时间**: 11:28 (UTC+8)
- **手机号**: 447746513981 (UK · 看似新 SIM)
- **跑 worker 模式**: 是 (PID 17592 子进程)
- **当前**: heartbeat 正常 · status=warmup · suspended_until=NULL · 无 quarantine
- **观察节点**:
  - 12:58 (1.5h) 老号死亡时间 → **已通过** (跑 worker 后没死)
  - 24h 节点 (明天 11:28) **关键** · 真稳就证明 Phase 2 隔离有效

### 老号 (60186888168 · 60168160836)

- 早上跑 Phase 1 (单进程) · 60s 内 init queries timeout → 1.5h 内 440 死
- 这俩号已被 WA 标记 · 不可回收

---

## 5 · 下次 session 接手 · 决策树

### Slot 1 24h 后稳:
- 证明 Phase 2 真有效
- 走 GitHub PR `https://github.com/bryangeh79/WAhubX/pull/new/claude/goofy-mendel-3f5881` 合 main
- 重启 backend (会触发 rehydrate · 通过 worker · 应该不掉隔离)
- 继续测多 slot 隔离 (slot 2 + VPN)

### Slot 1 24h 内挂了:
- Worker 隔离不够 · 还要往 IP / 容器层走
- 看 worker 进程 exit code · 是 connection 问题还是 internal crash
- 考虑 Phase 3: Docker 容器 per slot (FAhubX 用 Chromium 进程级)
- 或: 探索 baileys 协议层指纹随机化 (currently 用 same baileys version + same client payload)

### 任何情况都该做的:
- 把 .env 里的 WA_WORKER_MODE 默认值放到 docs · 让租户知道
- 跑 worker IPC 集成测试 (Phase 2.4 · 估 3h · 用 child_process mock)
- E2E 自动化冒烟 (新 SIM 流程 · 估 2h)

---

## 6 · 项目强制约定 (本 session 又验证一遍)

### 6.1 杀进程 (CLAUDE.md)
- **严禁** `taskkill //F //IM node.exe` (会杀 FAhubX 节点)
- 只杀 PID
- 命令: `netstat -ano | grep ":9700" | awk '{print $5}'` → `taskkill //F //PID <pid>`

### 6.2 后台任务汇报 (CLAUDE.md 铁律)
- exit code != 0 必须明写 + 良性原因
- 本 session 多次手动 taskkill 重启 backend · 都汇报了

### 6.3 工作风格 (用户 2026-04-19 立)
- 简洁直接 · 决策透明 · 坦白代价 · 复用优先 · 小步提交 · 中文对话英文代码

### 6.4 不动 slot 1 的纪律
- 用户原话 "别动到槽位1，别影响"
- 本 session 后期所有改动**不重启 backend** · 让 slot 1 worker 17592 继续跑老 dist 验证

---

## 7 · 关键文件位置 (新 session 记这几个)

### Phase 2 核心
- `packages/backend/src/modules/baileys/worker/worker-protocol.ts` (IPC 类型 · 17 命令)
- `packages/backend/src/modules/baileys/worker/baileys-worker.ts` (子进程 entry)
- `packages/backend/src/modules/baileys/worker/baileys-worker-manager.service.ts` (父 orchestrator)
- `packages/backend/src/modules/baileys/worker/README.md` (完整运维)
- `packages/backend/src/modules/baileys/baileys.service.ts` (facade · WORKER_MODE 路由)

### 配置
- `packages/backend/.env` · `WA_WORKER_MODE=true` 开关
- `packages/backend/.env` · `TENANT_BIND_COOLDOWN_SEC=600` 绑号冷却

### Plan 文档
- `~/.claude/plans/whatsapp-fahubx-suspend-wa-fahubx-cooki-tender-tulip.md` 原始 plan
- `HANDOVER_2026-04-24_session3.md` 上一 session 交接

---

## 8 · 还没做的事

### 阻塞测试 · 无
全核心路径 worker 兼容 · 24h 静默期内不会触发的 M5 executor 也已迁.

### 优化方向
- worker IPC 集成测试 (Phase 2.4) · 3h
- E2E 新 SIM 自动化冒烟 · 2h
- takeover.gateway 心跳与 worker 状态联动 · 1h (低优 · WS 是前后端)
- pgvector 升级 (M10 · V2)

### Phase 3 (假设需要)
- Docker 容器 per slot (终极隔离 · 如 Phase 2 不够)
- 自带域名短链 BYOD (V2)
- 离线安装包 Inno Setup (GA 前)

---

## 9 · 用户 / 租户 身份

- 平台超管: `platform@wahubx.local` (tenant_id=NULL)
- WAAutoBot 租户 admin: `admin@waautobot.com` (tenant_id=5 · enterprise 50 槽)
- License 4 (tenant 5) 绑定 machine fingerprint `776d3d2e...456a` · worktree 已同步指纹文件

---

## 10 · 接手第一动作

1. **读 CLAUDE.md** · 工作守则
2. **读这份 HANDOVER**
3. **查 slot 1**: `docker exec wahubx-dev-pg psql -U wahubx -d wahubx -c "SELECT slot_index, status, socket_last_heartbeat_at FROM account_slot WHERE account_id IS NOT NULL"` + `tasklist | grep "30156\|17592"`
4. **看 git log**: `git log --oneline -15` 在 worktree 看 commits
5. **决策**:
   - slot 1 还活着? → 等到 24h 后再决定
   - slot 1 死了? → 看 worker 退出原因决定下一步

---

> **生成时间**: 2026-04-25 (session 4 收尾)
> **最新 commit**: `4f86a38` (push 到 origin/claude/goofy-mendel-3f5881)
> **总 commits**: 12 (含 2 个 fix + 10 个 Phase 1/2 stability)
> **slot 1 状态**: worker 隔离 · 跑了 ~9.7h · 等 24h 节点验证
