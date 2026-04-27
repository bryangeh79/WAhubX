# PHASE D+H COMPLETE · 2026-04-28

> **执行 agent**: Claude Opus 4.7 (1M ctx) overnight session 续
> **commit**: 7190714 (push 到 origin/claude/goofy-mendel-3f5881)
> **完工硬条件 5 项全 PASS** · 4 个 build exit 0 · `modules/baileys/` 不存在 · 包卸了

---

## 5 项 grep 自验

| 检查 | 结果 |
|---|---|
| `grep -rn 'BaileysService' packages/backend/src --include="*.ts"` | 0 命中 |
| `grep -rn 'BaileysModule'` 实质命中 | 0 (仅 3 行历史注释) |
| `grep -rn "from.*'.*baileys"` import | 0 命中 |
| `grep '@whiskeysockets' package.json` | 0 命中 |
| `ls packages/backend/src/modules/baileys/` | 不存在 (GONE) |

## 4 个 build

| package | 结果 |
|---|---|
| `pnpm --filter shared build` | exit 0 |
| `pnpm --filter runtime-chromium build` | exit 0 |
| `pnpm --filter backend build` | exit 0 |
| `pnpm --filter frontend build` | exit 0 (vite warn chunk size 是历史 · 非本任务引入) |

---

## 改了哪些文件 (按模块分组)

### 新建 — `modules/messaging/`
- `chat-message.entity.ts` — 从 `modules/baileys/` 迁出 (entity 表 schema 完全没变)
- `wa-contact.entity.ts` — 从 `modules/baileys/` 迁出
- `messaging-persistence.service.ts` — `persistMessage()` 抽出 · runtime 中性 · 持久化 + emit `takeover.message.in`
- `jid.util.ts` — `normalizeJid()` 纯函数版
- `messaging.module.ts` — exports `MessagingPersistenceService` + `TypeOrmModule`

### 重写 — `modules/slot-runtime/`
- `baileys-slot-runtime.ts` 删
- `slot-runtime.registry.ts` 改: `runtimeFor(slot)` 永久返 `chromium` · API 形态保留兼容老调用点
- `slot-runtime.module.ts` providers 去掉 `BaileysSlotRuntime`

### 重写 — `modules/slots/`
- `slots.service.ts` 大改:
  - constructor 删 `BaileysService` 注入 (含 forwardRef) · 加 `MessagingPersistenceService`
  - `sendText` / `sendMedia` 整体改 chromium-only · 持久化走 `this.persistence.persistMessage`
  - `postStatusText/Media` `browseStatuses` `reactStatuses` `updateProfileAbout` 全 chromium-only · 删 baileys fallback
  - `isOnline` 改 `RuntimeBridge.hasConnection + heartbeat` (90s 内)
  - `clear` / `assignProxy` `evictFromPool` 改 `runtimeProcess.stop`
  - **新增方法 (收编原 BaileysService 公开 API)**: `listContacts` / `listMessages` (改纯 SQL · 不依赖 entity Repository) / `reactivateAndRespawn` / `getConnectionDiagnosis` / `isInPool`
  - `getCurrentMode()` 永久返 `'chromium'`
- `slots.controller.ts`: 删 `BaileysService` 注入 · 全部走 `this.slots.*`
- `slots.module.ts`: 删 `forwardRef(BaileysModule)` · 加 `MessagingModule`
- `handover.service.ts`: entity 路径改 `messaging/`

### 重写 — `modules/tasks/executors/`
- `join-group.executor.ts`: chromium runtime 暂不支持 group-invite · 直接 `NOT_SUPPORTED` · B3 留给真机验证. 删 `BaileysService` / `SlotsService` / `slotRepo` 注入 (整 executor 不再需依赖)
- `status-browse-bulk.executor.ts`: 走 `slots.browseStatuses` facade · 删 `BaileysService` · 删 baileys 老路径 (StatusCache)
- `status-react.executor.ts`: 走 `slots.reactStatuses` facade · 删 `BaileysService`
- `send-media.executor-base.ts`: 删 `BaileysService` 注入 · video/voice 全开 (B1+B2)
- `auto-accept` / `auto-reply` / `group-chat`: entity import 路径 `baileys/` → `messaging/`

### 重写 — `modules/warmup/`
- `status-browse.executor.ts`: 走 `slots.browseStatuses` · 删 `BaileysService`
- `warmup.module.ts`: 删 `BaileysModule` import

### 重写 — `modules/backup/`
- `backup.module.ts`: 删 `BaileysModule` · 加 `RuntimeProcessModule`
- `backup-import.service.ts`: `baileys.evictFromPool(slotId)` → `runtimeProcess.stop(slotId, { graceful: true, timeoutMs: 5000 }).catch(() => {})`
- `per-slot-restore.service.ts`: 同上替换

### 重写 — `modules/takeover/`
- `chats.controller.ts`: 删 `BaileysService` · `listContacts/listMessages` 走 `slots.*`
- `takeover.module.ts`: 删 `BaileysModule`

### 重写 — `modules/campaigns/`
- `campaigns.module.ts`: 删 `BaileysModule`
- entity import 路径 `baileys/` → `messaging/`

### 重写 — `modules/intelligent-reply/`
- `intelligent-reply.module.ts`: 删 `BaileysModule`

### 重写 — `modules/scripts/`
- `scripts.module.ts`: 删 `BaileysModule`
- `script-runner.service.spec.ts`: jest.mock baileys 路径删

### 重写 — `modules/tasks/tasks.module.ts`
- 删 `BaileysModule` · 加 `MessagingModule`

### Spec 修
- `account-health/health-coordinator.service.spec.ts`: jest.mock baileys 路径删

### 物理删除
- `packages/backend/src/modules/baileys/` 7 个文件 全删 (entity 已迁 · service/module/worker 全没)
- `packages/backend/package.json`: `@whiskeysockets/baileys` 卸
- `pnpm-lock.yaml` 同步

---

## SlotsService.persistMessage 新路径

老路径:
```
SlotsService → this.baileys.persistMessage(...)  ← BaileysService 内部转 manager
```

新路径:
```
SlotsService → this.persistence.persistMessage(...)  ← MessagingPersistenceService
                  ↓
       transaction · WaContactEntity upsert · ChatMessageEntity insert
                  ↓
       direction === 'in' 时 emit 'takeover.message.in' (含 slotRole gate)
```

行为完全等价 · 表 schema 没变 · 已有数据 0 影响.

---

## 已留 NotSupported / 待真机的位置

### 1. Group invite 链路 (Phase B3 deferred)
**位置**: `modules/tasks/executors/join-group.executor.ts`
**行为**: 任何 `task_type='join_group'` 一律返 `NOT_SUPPORTED` 错
**怎么接**: 见上一 session MORNING_TODO_2026-04-28.md "Phase B3" 段 · 新建 `wa-web/group.ts` 用 page.goto(`/accept?code=...`) DOM 抓元数据

### 2. video/voice DOM 真机验证
**位置**: `runtime-chromium/src/index.ts` send-media · `chromium-slot-runtime.ts` sendMedia
**行为**: video → image input 通道 · voice/audio → file input 通道 (上一 session B1+B2 落地)
**怎么接**: 用户重扫 4 号后 takeover 试发 .mp4 / .ogg · selector 不通报回来调整

### 3. ChromiumSlotRuntime 老 D8-3 / D11 选择器与 WA Web DOM 真实差异
**位置**: `chromium-slot-runtime.ts` · runtime-chromium/src/wa-web/*
**风险**: WA Web UI 可能改过 selector · backend NotImplemented guard 会兜底抛
**怎么接**: 看 backend log `chromium runtime <方法> 未实现` · 真机调

---

## 已知 cosmetic 残留 (Phase G 没动)

前端 `SchedulerPage.tsx` 还有 follow-channel UI 入口 (`FollowChannelFields` 组件 + lookup table 共 ~8 处). 后端 dispatcher 接到 `task_type='follow_channel'` 会抛 "no executor" · 不影响 build · 不影响其他业务.

清理方法 (用户接手时):
```bash
grep -rn "follow_channel\|FollowChannel" packages/frontend/src/pages/SchedulerPage.tsx
```
约 8 处分布: `TASK_TYPE_META.follow_channel` lookup / 列表显示分支 / 创建表单分支 / `FollowChannelFields` 函数本身.

`packages/frontend/src/pages/DashboardPage.tsx` / `BindExistingModal.tsx` / `SlotsPage.tsx` 的 baileys-specific UI 字段 (Phase G) 也未清扫 · 但这些字段不破坏 build · 仅显示用 (`runtime?: 'baileys' | 'chromium'` 字段判断仍在但永远走 chromium 分支).

---

## 真机验证还是要用户跑

| 测点 | 怎么验 |
|---|---|
| 重扫 4 号 | SlotsPage factory-reset → 重新扫 chromium QR (slot.runtime 必须 chromium · D11 已落) |
| sendText | takeover 发文本 → DB chat_message 出现 + WA 单勾 |
| sendMedia image | takeover 发图 (带 caption) → 单勾 |
| sendMedia video | takeover 发 .mp4 → 单勾 (B1 真机首验) |
| sendMedia voice | takeover 发 .ogg → 单勾 (B2 真机首验) |
| inbound | 客服号收消息 → DB + UI 卡片亮 + 智能回复触发 |
| online 判定 | 60s 内 heartbeat → online 绿 · 90s+ 静默 → 红 |
| auto-respawn | `taskkill //F //PID <runtime_pid>` → 1s 后日志 attempt=1 重启 |
| heartbeat 抗 idle | slot 闲置 24h → 仍 online (核心 KPI · idle-purge 终结) |
| reconnect 按钮 | DashboardPage 点重连 → runtime stop+start (走 slots.reactivateAndRespawn) |

---

## rollback (如需)

本 session 唯一 commit 7190714. 退就:
```bash
cd "C:/AI_WORKSPACE/Whatsapp Auto Bot/.claude/worktrees/goofy-mendel-3f5881"
git revert 7190714
git push
```

但要注意: 这次提交也卸了 `@whiskeysockets/baileys` npm 包. revert 后需:
```bash
cd packages/backend && pnpm add @whiskeysockets/baileys@6.7.21
```
否则 baileys.service.ts 文件回来了但 import 解析失败.

---

## 接下来 (Phase E/F/G 给用户)

E (客服号单窗口) / F (inbound 路由直连 chromium) / G (前端 baileys cosmetic 清扫) 仍 deferred · 不影响系统跑. 看 上一 session MORNING_TODO_2026-04-28.md 对应章节的"怎么接".

---

**结论**: baileys 在代码层 100% 消失 (5/5 grep + dir gone + 包卸) · 4 个 build 绿 · 已 push origin. 用户起床后做真机验证菜单 (上面 10 项) · 重点 KPI = idle 24h 不再 440.
