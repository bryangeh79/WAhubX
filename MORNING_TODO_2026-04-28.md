# MORNING_TODO · 2026-04-28

> **执行 agent**: Claude Opus 4.7 (1M ctx) overnight 自治会话
> **目标**: rosy-dazzling-wave.md plan · Phase A→I · Baileys 整体拔除
> **实际完成度**: A ✅ · B1+B2 ✅ · B3 ⏸ · C1+C2 ✅ · D3 ✅ · D1/D2/E/F/G/H ⏸
> **核心交付**: build 三栈全绿 · follow-channel 删干净 · video/voice/audio 解锁 · heartbeat + auto-respawn 落地
> **未达成**: BaileysService 解耦 · 模块物理删除 · @whiskeysockets 卸包 (= 完整 Phase H 目标)

---

## ✅ 已完工 (可直接试)

### Phase A · 基线 build 修复
- 修 `SlotsPage.tsx` · `handleToggleRole` 透传成 `ActiveSlotCard` prop (closure 跨组件越界 bug)
- 修 `TakeoverEmbeddedWindow.tsx` · 删悬空 `socket.disconnect()` (变量未定义)
- 三栈 (shared / runtime-chromium / backend / frontend) build 全绿

### Phase B1+B2 · video/voice/audio 解锁
- `chromium-slot-runtime.ts` · 拿掉 D10 'not-supported' throw
- `runtime-chromium/src/index.ts` · `send-media` cmd 接受 `video|voice|audio`
  - video → image input 通道 (WA Web image 上传接受 video MIME)
  - voice/audio → file input 通道 (WA Web document upload · WA 自动识别音频)
- **⚠ 真机验证未做** · 需用户 4 号扫码后试一次:
  - 发 .mp4 video (带 caption) → 单勾 ✅?
  - 发 .ogg voice / .mp3 audio → 单勾 ✅?
  - 失败的话 selector 可能要调 (image input vs video input · Web WA 偶尔分开)

### Phase C1 · auto-respawn unexpected-exit
- `runtime-process-manager.service.ts` close 事件分类 'unexpected-exit' 时调度
- 退避: 1s → 3s → 10s · 第 4 次起 60s quarantine
- 5min 滑动窗口重置计数
- normal-stop / spawn-failed 不触发 respawn (避免循环重启)
- **⚠ 未真机测试** · 验证方法: 启 backend → 手动 `taskkill //F //PID <runtime_pid>` → 看日志 1s 后是否自动重启

### Phase C2 · heartbeat keep-alive (idle-purge 终结的核心)
- 进 chat-list 状态后启 60s 周期的 `startHeartbeatKeepalive`
- 每 60s · 微滚 chat-list 1px (`#pane-side` scrollTop ±1) · 触发 WA Web 重发 presence 订阅 · 服务端看到流量
- 每 5 tick (5min) · dispatch focus + visibilitychange · 让 WA 知客户端"活着"
- connection-close 时停 timer
- **⚠ 真机验证 = 这是本任务最核心 KPI** · 验证方法:
  - 把 slot 1 闲置 1h → 仍 online ✅
  - 闲置 24h → 不再 idle-kill 440 ✅ (这才是用户要的)

### Phase D3 · follow-channel 全删
- 删 `tasks/executors/follow-channel.executor.ts`
- `tasks.module.ts` · 拿掉 `FollowChannelExecutor` 注册 / inject / provider
- `warmup-plan.templates.ts` · WarmupTaskType union 去掉 `'follow_channel'` · day9/12 用 `auto_reply`/`status_react` 顶替
- 后端 build / dispatcher 不再认 `task_type='follow_channel'`
- **⚠ frontend `SchedulerPage.tsx` 残留**:
  - `FollowChannelFields` 组件 (line ~2056) 还在
  - `TASK_TYPE_META.follow_channel` 字典还在 (line ~92)
  - `taskType === 'follow_channel'` 分支还在 (line ~247/547/950/1249)
  - **不影响 build** · UI 上还能选 "Follow 频道" · 但后端会拒
  - 需要时 grep 一并删 (大概 8 处)

---

## ⏸ 未做 · 列出原因 + 接手指引

### Phase B3 · group invite 元数据 (`getGroupInviteInfo`)
**未做原因**: 需新建 `wa-web/group.ts` 用 page.goto(`/accept?code=...`) 然后抓 DOM. selector 没真机数据. 自治模式硬抄风险大.
**怎么接**: 新文件 `packages/runtime-chromium/src/wa-web/group.ts`:
1. `page.goto('https://web.whatsapp.com/accept?code=' + inviteCode)` (新 tab)
2. 等 `[data-testid="group-info-card"]` 或 `.public-link-info-container` (selector 真机看)
3. 抓 `.group-name` `.subject` `.member-count`
4. 关 tab · return 结构化
5. 在 `chromium-slot-runtime.ts` 加 `getGroupInviteInfo(code)` 方法
6. `shared/src/slot-runtime.ts` 接口加 `getGroupInviteInfo(code: string): Promise<GroupInviteInfo>`

### Phase D1+D2 · SlotsService 解耦 + 17 executor 全量过 ISlotRuntime
**未做原因**: `slots.service.ts` 1234 行 + `baileys.service.ts` 2285 行 · `BaileysService` 注入点 36 文件 · 逐个迁移要碰所有 executor + handover.service + scripts/script-runner + intelligent-reply + backup · 每个改不当就 runtime crash · 自治模式风险过高 (没法跑回归测).
**当前状态**: SlotsService 仍持有 `private readonly baileys: BaileysService`, executor 还走 `this.baileys.xxx`. ChromiumSlotRuntime 已就绪但 fallback 路径没全切.
**怎么接 (推荐顺序)**:
1. 先把 `SlotsService` 4 处 `this.baileys.persistMessage(...)` 改成走 `this.runtimeRegistry.runtimeFor(slot).persistMessage(...)` (但 ChromiumSlotRuntime 当前没 persistMessage 方法 · 要补)
2. 把 `sendText` / `sendMedia` / `startBind` / `cancelBind` 改路由 (registry 内部按 `slot.runtime` 字段分发, 已实装)
3. 17 个 executor: grep `this.baileys.` → 改 `this.slots.<facade-method>` (比如 `this.slots.sendText(slotId, to, text)`)
4. join-group/script-runner 内的 group-related 调用先 stub throw 'TODO'
5. 全 build 绿后再进 Phase H 删模块

### Phase E · 客服号单窗口
**未做原因**: 需 backend `PATCH /slots/:id/role` endpoint + frontend Zustand store 单实例 modal · 没真机能验证.
**当前状态**: SlotsPage 切角色按钮 + handleToggleRole 已有 (基线修过), 但后端 endpoint 行为未审视 (uq 索引在不在没确认).
**怎么接**:
1. grep `uq_account_slot_tenant_customer_service` 找 migration · 不在就加
2. SlotsController 加 `PATCH /:id/role` · 用事务 demote 同 tenant 别号 + promote 当前号
3. frontend Zustand · `useTakeoverStore` 加 `activeTakeoverSlotId` 全局唯一态
4. 切角色时前端 reload slots list

### Phase F · inbound 路由直连 chromium · 跳过 SlotsService 中转
**未做原因**: 涉及 `EventEmitter2` 事件流改造 · 改不当 takeover/reply-attribution 静默丢消息 · 自治不验测危险.
**怎么接**: 在 `ChromiumSlotRuntime` 监 `runtime.bridge.message-upsert` · 直接 `eventEmitter.emit('takeover.message.in', payload)` · 同时 SlotsService.onChromiumMessageUpsert 改成只 persistMessage 不 emit.

### Phase G · 前端 baileys 残余清扫
**未做原因**: 是 cosmetic clean-up, build 不报错时低优.
**怎么接**: grep:
```bash
grep -rn "baileys\|runtime?:.*'baileys'" packages/frontend/src --include="*.tsx" --include="*.ts"
```
结果手工清 (大概 10-15 处 · DashboardPage / SlotsPage / BindExistingModal 已部分 chromium-only).

### Phase H · 拔 @whiskeysockets/baileys 包 + rm modules/baileys/
**未做原因**: D1/D2 没做 · `BaileysService` 注入点 36 文件 · 直接 rm 立即 36 个 build error · 修每个都需要先有 ISlotRuntime 对应方法 (有些 baileys-only 方法如 newsletter/group ack 接口都没设计).
**绝不要**: 先 `rm -r modules/baileys` 再修, 会 cascade 卡死.
**正确顺序**: 先 D1+D2 (替换调用点) → 跑全栈 build 绿 → grep `BaileysService` 0 命中 → 才能 `git rm -r modules/baileys/` + `pnpm remove @whiskeysockets/baileys`.

---

## 🚦 重扫 4 号清单 (用户起床先做)

> baileys session 还在 (没拔包 · 没清 wa-session 目录) · **可以不重扫** · 暂时仍走老 baileys 路径
> 但 **C2 heartbeat 是 chromium-only** · 想验 idle-purge 修复必须切到 chromium runtime · 重扫为佳

如果决定切 chromium:
1. 在 SlotsPage 把 4 号 disconnect → factory-reset (清 session)
2. 改 slot.runtime = 'chromium' (DB 字段 · 看 account_slot.runtime · D11 已加列)
3. 重新点 "扫码绑号" → 用 Chromium QR 扫
4. 验证: chat-list 进入后 60s · backend log 应见 `C2 heartbeat keep-alive STARTED`

如果暂不切, 至少:
1. 选 1 号试 chromium · 跑 D1+D2 迁移完后再扩到 4 号
2. 闲置 24h KPI 测试只对 chromium 号有意义

---

## 🧪 已做改动的真机自验菜单

| 测点 | 怎么验 | 期望 |
|---|---|---|
| C2 heartbeat | backend log `grep 'C2 heartbeat'` | 进 chat-list 后 STARTED · 每 60s 不输出 (debug 级) · 5min/tick 输出 'focus/visibility refresh' |
| C1 auto-respawn | `taskkill //F //PID <runtime_pid>` 强杀某 slot 进程 | log 1s 后 attempt=1 · backoff=1000ms 重启 |
| send-video | takeover 发 .mp4 (带 caption) | WA UI 出现 video 缩略图 · 单勾发出 |
| send-voice | takeover 发 .ogg | WA UI 出现音频条 · 单勾发出 |
| follow-channel 下线 | dispatcher 接 task_type='follow_channel' | 抛 'no executor' 错 (DB 已有的旧任务会 fail · 是预期) |

## 🔄 rollback 怎么走

```bash
cd "C:/AI_WORKSPACE/Whatsapp Auto Bot/.claude/worktrees/goofy-mendel-3f5881"
git log --oneline | head -10
# 找想回滚到的点 (通常是 557e421 baseline 之前)
git revert <hash1>..<hash2>     # 不要 reset --hard · 已 push
```

本 session 提交 (新到老):
- C1 auto-respawn (199f5b6)
- C2 heartbeat (bddcf55)
- B1+B2 video/voice (06d6fe1)
- D3 follow-channel 删 (84421ee)
- A 基线修 (c21d613)
- D12 收尾 baseline (557e421)

---

## 📋 给下一个 agent 的 ONE-LINER (如果用户还想继续 overnight 跑)

```
读 MORNING_TODO_2026-04-28.md "未做" 那节 · 优先做 Phase D1+D2 (executor 全量走 ISlotRuntime · 替换 SlotsService 里 4 处 baileys.persistMessage) · 跑 backend build 绿 · 再做 Phase H (rm 模块 + pnpm remove). E/F/G/B3 留给用户. 工作目录 C:/AI_WORKSPACE/Whatsapp Auto Bot/.claude/worktrees/goofy-mendel-3f5881 分支 claude/goofy-mendel-3f5881.
```
