# 02 Completed Work

跟踪所有已完成的代码改动 + commit · 按时间倒序.

## Session 4 · 2026-04-25 (大架构转向)

### D12 全段完成 (3 commit · Windows native 首次跑通)

#### D12-3 · auto-spawn 生命周期闭环 (commit `43311de`)
- runtime-process-manager.service.ts 加 OnModuleInit
  - `shouldAutoStart(slot)` 保守判定: accountId + role=cs + status in [active, warmup] + 非 suspended 期
  - `autoSpawnActiveSlots()` stagger 启动 · 默认 5s 间隔 · clamp 3-30s
  - 单 slot 失败 try/catch 跳 · 不重试不升级
  - `triggerAutoSpawn()` admin endpoint 手动调试
- runtime-process.controller.ts 加 POST /admin/runtime-process/auto-spawn
- 端到端实测: fake slot 101 → 扫 150 个 → 1 符合 → spawn pid · 顺序日志可观察

#### D12-2 · child_process.spawn + per-slot 进程管理 (commit `3ca5bd7`)
- 新建 modules/runtime-process/:
  - process-state.ts (4 ProcessExitClass · 5 ProcessStatus)
  - runtime-process-manager.service.ts (start/stop/getProcessState/listAll · 单实例约束)
  - runtime-process.controller.ts (admin endpoint · D14 删)
  - runtime-process.module.ts
- spawn args 数组传 · windowsHide:true · NODE_ENV=production 跳 pino-pretty
- Windows 加 SKIP_INTEGRITY_CHECKS=true (iptables Linux only)
- Windows native 首次跑通 (commit message 详细日志)

#### D12-1 · 路径抽象 + Chromium 定位 + RuntimeLaunchConfig (commit `123bf83`)
- 新建 `packages/shared/src/runtime-launch.ts`:
  - `RuntimeLaunchConfig` interface · OS / 路径 / Chromium / 代理 / DNS / 反检测全字段
  - `resolveRuntimeLaunchConfig(input)` resolver
  - `resolveRuntimeLaunchConfigFromEnv()` 从 process.env 自动构建
  - DNS 策略 enum: iptables-hard (Linux Docker) / chromium-soft (Windows) / none
  - Chromium 探测: env 显式 → Windows/Linux/Darwin candidates 顺序探测 → fallback
  - 路径规则: Windows %APPDATA%\wahubx\slots\<idx>\ · Linux container /app/wa-data · Linux host cwd/data/slots/<idx>/
- runtime-chromium index.ts 加 resolver call + log · D12-2 才真接管业务流
- shared 加 @types/node devDep

### D11-3 · Dispatcher + Inbound 角色门禁 (commit `fe5f9b3`)
- dispatcher: TASK_TYPES_ALLOWED_FOR_CUSTOMER_SERVICE 白名单 (warmup/maintenance/profile_refresh)
- DispatchDecision 加 'skip-role-mismatch' · log 明确 reason
- takeover.events.ts: TakeoverMessageEvent.slotRole optional 字段
- baileys.service emit takeover.message.in 注入 slotRole
- auto-reply-decider + reply-attribution: role gate · skip + log

### D11-2 · UI role badge + 切换 + 错误语义 (commit `9106eba`)
- backend PATCH /slots/:id/role · 3 codes (CUSTOMER_SERVICE_EXISTS / INVALID_ROLE / 404)
- frontend SlotsPage 卡片加 role badge (🛎️ 客服 / 📢 广告) + 切换 link
- handleToggleRole · 按 code 派发 message.error

### D11-1 · slot.role migration + entity + 唯一客服号硬约束 (commit `a998b2c`)
- migration 1797 · enum + 字段 + DISTINCT ON 老数据补位 + partial unique index
- entity AccountSlotRole · service setRole + getCustomerServiceSlot
- 端到端: DB 硬约束验证 (UPDATE → ERROR duplicate key)

### D9 · ISlotRuntime + Registry + 单一协议来源 (commit `e5ddce3`)
- 新建 `packages/shared/` workspace · `@wahubx/shared`
  - `runtime-protocol.ts` (升为 source of truth · 删两边 mirror copies)
  - `slot-runtime.ts` (`ISlotRuntime` 9 方法接口 + DTO)
- 新建 `backend/src/modules/slot-runtime/`:
  - `BaileysSlotRuntime` 适配 · `ChromiumSlotRuntime` (sendText/sendMedia stub)
  - `SlotRuntimeRegistry` (按 RUNTIME_MODE 选实装)
- `SlotsService.bindStartBind/Cancel/GetStatus` 改用 Registry
- Docker 改造: build context 改 monorepo root + pnpm workspace

### D8-3 · SlotsService facade + 事件分类 (commit `e5df2dc`)
- runtime: connection-close 4 类 (page-closed/browser-disconnected/wa-logged-out/runtime-fatal)
- backend: BindStateCache 加 lastDisconnect* + bindState/pageState 语义边界
- frontend BindExistingModal: 加 D14 收敛 TODO

### D8-2 · bind 主链路 (commit `c130ebf`)
- runtime: BindStateMachine 严格单向 fsm + onCommand handlers
- runtime: wait-for-login 加 onQrRefresh + cancelSignal
- backend: BindStateCache per-slotId · admin endpoint 端到端验

### D8-1 · WS 桥骨架 (commit `d3fe6d6`)
- runtime: runtime-ws-client.ts (WS client + 重连 + 心跳)
- backend: runtime-bridge module (port 9711 · 鉴权 · slot 路由)

### D7 反检测三件套
- D7-3 (`bdae8fc`): 24 国 country-locale + ipinfo 探测 + CDP setTimezoneOverride/setLocaleOverride
- D7-2 (`3e351e4`): evaluateOnNewDocument 注入 navigator.languages/Intl/permissions/chrome.runtime
- D7-1 (`f1ea94c`): HumanBehaviorSimulator + IdleActivityScheduler + 双护栏

### D6 · Chromium 闭环验证 (commit `c5c080b`)
- 真扫码 LOGIN SUCCESS (88s) + session 落盘 38MB + 重启免扫 11s
- 修 puppeteer userDataDir bug

### Desktop 止血 (commit `d73e2ca`)
- baileys-worker: markOnlineOnConnect=false / shouldSyncHistoryMessage / cachedGroupMetadata /
  shouldIgnoreJid / WA_VERSION_PIN env

## Phase 2 worker · session 3 历史 (10 commit · 现进过渡态)

baileys 子进程隔离 (fork + IPC + auth state per slot · 加 24h respawn 限).
现在 Codex 决定 Baileys 不增强 · 等 Chromium 替换后删.

## Phase 1 五支柱 · session 3 早期 (历史)

- 状态真相 (markSlotSuspended 终态)
- 440 智能判死 + 30min 冷却
- 子进程隔离 (Phase 2)
- baileys options 每 slot 随机化
- 绑号纪律 (10min cooldown + 24h 静默)

## Session 1-3 业务功能 (历史)

- 广告投放完整链 (campaigns / runs / targets / executors)
- 智能客服 (KB / FAQ / RAG · 3 模式)
- 真人打字模拟
- 坏号健康追踪 + 客户回复归因 + 投放报告
- ReplySetupWizard
- UI 设计语言统一 (品牌绿 #25d366)
