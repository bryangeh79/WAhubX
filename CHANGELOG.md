# Changelog

按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 约定，版本按 [SemVer](https://semver.org/lang/zh-CN/)。

---

## [v0.5.0-m5] · 2026-04-20 · M5 养号日历 + Phase 机 + 4 种 warmup executor 交付

M5 里程碑: 14 天 phase 机 (§5.3 严守) + 1h setInterval 日历引擎 + 4 层 Status 素材降级 + script_chat 运行时配对过滤链 + min_warmup_stage 真 gate (承接 M4 刻意延后的 gate) + §B.16 预置素材骨架.

### 收工标准 (全绿)

| # | 项 | 证据 |
|---|---|---|
| 1 | Phase 机: Day 1-3=0/4-7=1/8-14=2/15+=3 正确映射 + 阈值跨日升 phase | `computePhaseForDay` 3 ut + `tickDay` 5 ut |
| 2 | `risk_level=high` → 强制 Phase 0 + day=1 + regress_reason 记录 | 6 ut covers high/medium/low/null/bottom 边界 + smoke verified |
| 3 | `skip-to-next` 推到目标 phase 起始日, Mature 不能再升 | 2 ut + smoke API 0→1@day4 / 1→2@day8 |
| 4 | M4 挂起的 min_warmup_stage gate 真开启 (双边都必须 ≥ min) | `ScriptRunnerService.run` gate + 3 ut 覆盖 reject/pass/single-side + live smoke: acc=stage0, script=min1 → `warmup_stage 不足` |
| 5 | Pair 过滤链 5 条全生效 (exclude self + IP 组互斥 + takeover + !suspended + stage 门槛) | `WarmupPairService` + 7 ut covers base + 5 filters + null-proxy 保守 · smoke: 2 null-proxy slot → NO_PAIR_AVAILABLE ✓ |
| 6 | 4 层 Status 素材降级 (persona → builtin → pack text → skip); Phase 0-1 硬 block | `StatusPostExecutor` · smoke: Phase 2 → layer4-skip 成功空过; Phase 0 → PHASE_GATE 拒 |
| 7 | dev-only `/admin/debug/set-risk-level` 生产 build 自动 403 | `AdminDebugController.isProd` @ OnModuleInit + smoke |
| 8 | Calendar 1h setInterval · tick 幂等 (payload _warmupPlanId+_planDay+_windowAt 去重) | `WarmupCalendarService.onModuleInit` 日志 + `isDuplicate` JSONB 查询 |
| 9 | 56/56 unit test green | dispatcher 17 + pack-loader 9 + runner 10 + phase 13 + pair 7 |

### Added (M5)

**数据模型** — migration `CreateWarmupPlan1776700000000`
- `warmup_plan`: SERIAL pk · account_id FK wa_account CASCADE uniq · template text default 'v1_14day' · current_phase int · current_day int · started_at · last_advanced_at · regressed_at · regress_reason · paused bool · history jsonb[] · idx_phase_day

**Phase 机** (`warmup-phase.service.ts`)
- `tickDay(planId)`: current_day + 1, 跨阈值升 phase, 同步更新 `wa_account.warmup_stage`
- `maybeRegress(plan)`: 读 `account_health.risk_level`, high → 强制 Phase 0 · day=1 · 记 regress_reason
- `skipToNextPhase(planId, reason)`: 手动跳, day 推到目标 phase 起始日
- `pause` / `resume`: expert mode 暂停推进
- `computePhaseForDay(day, thresholds)`: 纯函数, 单测易测
- 所有变更落 `history` JSONB 流水 (上限 100 条)

**Plan 模板** (`warmup-plan.templates.ts`)
- `V1_14DAY_TEMPLATE`: 14 天完整日程, 每天 3-4 个窗口, windows 内嵌 `WarmupTaskSpec[]`
- Phase 阈值: 0→Day1, 1→Day4, 2→Day8, 3→Day15
- §B.2 Day 4 "破壳仪式" 的 status_post **去掉**, 改 `status_browse` reactive (对齐 §B.20 "Phase 0-1 禁 status_post")
- `MATURE_DAILY_WINDOWS`: Phase 3 常态模板 (每天 1 status_post 上限, §B.20)

**Pair 过滤链** (`warmup-pair.service.ts`, 技术决策 §B.15)
- 候选池 = 同租户其他槽位. 硬过滤 5 条:
  1. exclude self (accountId 相同跳过)
  2. `takeoverActive=false` (M3 rejection #4 对齐)
  3. `status != suspended/empty` (只要 active 或 warmup)
  4. `proxy_id != initiator.proxy_id` (**IP 组互斥 §B.15 #1 — dev 里两个 null proxy 保守视为同组**)
  5. `warmupStage >= requiredWarmupStage` (剧本门槛)
- 空集返 `null`, 绝不强配. ScriptChatExecutor 接 `NO_PAIR_AVAILABLE` error_code.

**Calendar 引擎** (`warmup-calendar.service.ts`)
- 1h setInterval (和 M3 dispatcher 风格一致, 不引 BullMQ repeatable — M3 也没用, 保持一致)
- 每 tick: regress check → 跨 24h 推 day → 读今日 schedule → 找 [now, now+1h) 窗口 → 创建 task 带 ±15-30min jitter
- 幂等: `_warmupPlanId + _planDay + _windowAt` JSONB 条件去重
- env 开关 `WARMUP_CALENDAR_ENABLED=false` + `WARMUP_CALENDAR_INTERVAL_MS=...` (smoke/test 调 600s)

**4 种 Executor**
- `WarmupExecutor` (从 M3 stub 升级): presence tick, 更新 `wa_account.last_online_at`
- `StatusPostExecutor` (新): Phase gate (<2 → PHASE_GATE) + 4 层素材降级硬编码 1→2→3→4
- `StatusBrowseExecutor` (新, stub): Day 4-5 reactive 动作占位. Baileys status feed API 在 M5 scope 内留 stub, M8 健康分接真 ws listener
- `ScriptChatExecutor` (M4 扩展): 新增 `_needPair=true` 模式, 运行时调 `WarmupPairService.pickPartner`. 兼容 M4 手动 `roleBaccountId` 模式

**Runner gate** (`script-runner.service.ts`)
- 承接 M4 刻意延后的 `min_warmup_stage` gate — 现 **真开启**
- 双边 (A + B) `warmupStage` 必须 ≥ `script.minWarmupStage`, 否则 throw `warmup_stage 不足: script=... 要求≥X, A=... B=...`
- 单测覆盖: reject-both-low / reject-single-side / pass-exactly-at-threshold

**API**
- `GET /warmup/plans` — 租户视角 list (join 手机号)
- `GET /warmup/plans/:accountId` — 单 plan 详情含 history
- `POST /warmup/plans/:accountId/init` — 建 Day 1 plan
- `POST /warmup/plans/:accountId/skip-phase` — 手动跳
- `POST /warmup/plans/:accountId/pause` / `resume`
- `POST /warmup/calendar/tick` — 手动触发 tick (仅 platform admin, dev 验证用)
- **DEV-ONLY** `POST /admin/debug/set-risk-level` — `NODE_ENV='production'` 自动 403, 否则接受 `{accountId, riskLevel}` 写 `account_health`. M5 期间 regress 链路唯一可测入口; M8 真健康分引擎上线后此端点保留作模拟工具

**Admin UI `WarmupTab`** (`packages/frontend/src/pages/admin/WarmupTab.tsx`)
- Table 列租户所有 plan · 列 Phase tag / Day 进度条 / 暂停/回退 badge / 回退原因
- 行内按钮: 详情 (Modal 显 history JSON) / 跳到下一 Phase / 暂停 / 恢复
- `AdminPage.tsx` Tabs 新增 "养号计划"

**§B.16 预置素材骨架** (`data/assets/_builtin/`)
- 10 空子目录 (personas / voices/zh / voices/en / images/{food,life,scenery,shopping,pets,selfies} / stickers) · 每个含 `.gitkeep`
- 总 README 说明命名约定 + 4 层消费顺序 + installer M11 打包 TODO
- 实物素材 (200MB) 留给 M7 `asset-studio` 生成并填充

### Verified (smoke)

- 5 executor 注册: `chat, warmup, script_chat, status_post, status_browse`
- Plan init API: account 1/2 各建 Day 1 Phase 0 计划
- Skip-phase chain: 0→1@day=4, 1→2@day=8 (threshold 对齐)
- dev debug endpoint: 设 `risk_level=high` → calendar tick 自动 regress account 1 到 Phase 0 day 1, `regressReason='risk_level=high · score=20'` ✓
- status_post PHASE_GATE: Phase 0 下创建 status_post → error_code=PHASE_GATE
- status_post 4 层降级: Phase 2 下, 所有池空 → layer4-skip success (不算失败, 空过)
- script_chat runner gate: account stage=0, script=s001 min=1 → error_code=RUNNER_THREW / `warmup_stage 不足`
- script_chat _needPair: 两 slot 都 null proxy_id → NO_PAIR_AVAILABLE (per §B.15 保守规则)

### Constraints (M5 范围边界)

- **dev 两 slot 同 null proxy_id 配对必失败** — 按 §B.15 设计正确. 真生产每个 slot 绑不同代理就解锁 pair 流
- **Baileys Status feed API 未接真** — `StatusBrowseExecutor` 当前是 stub · M8 健康分阶段接 ws `messages.upsert` / `presence.update` 监听
- **Phase 3 (Mature) 无 day-by-day 模板** — 用 `MATURE_DAILY_WINDOWS` 固定套餐 · 个性化日历 (按 persona peak_hours 动态生成) 留给 M6+
- **账号注册后 auto-init plan 未接入** — M2 W3.5 新号注册推迟到 V1.1, 所以 M5 只开 `/warmup/plans/:accountId/init` 手动端点. V1.1 注册流程收尾时 auto-init 加到 `slots.service.registerAccount`
- **calendar setInterval 不是 BullMQ repeatable** — 偏离最初 M5 plan A (BullMQ repeatable 1h). 原因: M3 dispatcher 也用 setInterval, BullMQ 装了没用, 保持一致不引额外复杂度

### Rationale (存档关键决策)

- **Phase 升级同步写 wa_account.warmup_stage** — 让 ScriptRunner gate 只读 `wa_account` 一张表, 不跨 `warmup_plan` 查. 保 hot path 快
- **history JSONB 上限 100 条 slice** — 防 JSONB 膨胀. Phase 事件一年才 ~20 条, 100 条覆盖账号整个生命周期 + 几次 regress
- **pair null-proxy 保守归同组** — §B.15 不允许"我猜它们真实出口 IP 可能不同". dev 必须用显式 proxy_id (哪怕同一代理分 2 row) 才能跑多槽互聊
- **status_post layer4-skip 视为 success** — executor 成功完成 "今天不发" 的判定, 不是失败. 失败视角只留给 SEND_FAILED / PHASE_GATE / NO_PLAN 这些需要 retry/alert 的情况
- **dev debug endpoint 单独 controller, 不藏在现有 admin** — `NODE_ENV=production` 检查只保护写方法, M8 或 staging 要插入健康事件有稳定端点. 合并到 admin-tenants 会让"dev 入口"被意外暴露

---

## [v0.4.0-m4] · 2026-04-19 · M4 剧本引擎 + 包导入交付

M4 里程碑: 剧本包结构化存储 (pack_id 主包 + pack_ref 增量 batch) + 内容池运行时随机抽 + AI 改写缓存 schema (M6 换真 AI) + 资源池 on_disabled 降级 + script_chat 执行器替代 M3 chat stub.

### 收工标准 (全绿)

| # | 项 | 证据 |
|---|---|---|
| 1 | 剧本 JSON 落 DB, schema 允许 100+ 剧本无膨胀 | `script_pack` + `script` 两表, content JSONB · 导入仓库自带 5 文件 → 100 scripts · migration `CreateScriptTables` |
| 2 | 增量包格式 (pack_ref) 不独立成包, 追加已有 pack | `PackBatchJson` + `importBatchJson` + 两遍扫 (主包先, batch 后) · batch2-5 追加 80 scripts 到 official_my_zh_basic_v1 |
| 3 | 内容池随机抽 + 同 persona cache 命中 | `ScriptRunnerService.resolveText` · `rewrite_cache` uniq(script_id,turn,persona_hash) · 二次跑命中复用 `used_count++` (7 ut covers) |
| 4 | 资源池空时按 on_disabled 降级 (skip / send_fallback_text) | `pickAsset` 返 null + `caption_fallback` 分支 · 2 ut 覆盖两条路径 |
| 5 | script_chat executor 接 runner, 单 turn 失败不中断 session | `ScriptChatExecutor` · runner `turnsExecuted/turnsSkipped/errors[]` · smoke: 28 chat_message 真发出, 9 cache 条目, task status=done |
| 6 | 33/33 unit test green | dispatcher 17 + pack-loader 9 + runner 7 |

### Added (M4)

**数据模型** — migration `CreateScriptTables1776614410555`
- `script_pack`: SERIAL pk · pack_id uniq text · name · version · language · country text[] · author · asset_pools_required text[] · signature text · enabled bool · installed_at
- `script`: SERIAL pk · pack_id FK CASCADE · script_id text · uniq(pack_id, script_id) · name · category · total_turns · min_warmup_stage · ai_rewrite · content jsonb (完整剧本, 含 sessions/turns/safety) · idx_category
- `rewrite_cache`: SERIAL pk · script_id · turn_index · persona_hash text · uniq 三联 · variant_text · used_count · source text default 'm4_pool_pick' · idx_used
- `asset`: SERIAL pk · pool_name text · kind enum(voice/image/file/sticker) · file_path text (相对 data/) · meta jsonb · source enum · generated_for_slot int · 2 索引

**PackLoaderService** (`packages/backend/src/modules/scripts/pack-loader.service.ts`)
- `importJson(PackJson)`: 主包 (pack_id 必需). 幂等 — 存在则更新 version + upsert scripts (按 pack_id + script_id 唯一)
- `importBatchJson(PackBatchJson)`: 增量 batch (pack_ref 必需). 找不到主包抛 404
- `importFromDirectory(dir)`: 两遍扫. 主包先, batch 后 — 保证主包先落盘 batch 才能 attach
- 校验: pack_id/version/language/country 必填, 包内 script_id 去重, total_turns 正整数, sessions 数组
- 测试: 9/9 (`pack-loader.service.spec.ts`) — minimal valid / missing field reject / dup script id / 幂等 version 升级 / 追加 script

**ScriptRunnerService** (`packages/backend/src/modules/scripts/script-runner.service.ts`)
- `run({scriptId, roleAaccountId, roleBaccountId, sessionIndex?, fastMode?})` — 跑 session 下所有 turns, 返 `{turnsExecuted, turnsSkipped, errors[]}`
- `resolveText`: cache 命中复用 + `used_count++`; miss 则 `content_pool` 随机抽 + 写 cache (source=`m4_pool_pick`, M6 换真 AI 只改 source + 抽法)
- `pickAsset`: `asset_pool` 查表随机抽; 空池按 `on_disabled` 降级 (skip / send_fallback_text 发 caption_fallback)
- `personaHash`: sha1(accountId|scriptDbId|turnIndex).substring(0,16) — 不同 A 账号走不同 cache 槽
- `typing_delay_ms` + `send_delay_sec`: fastMode=true (dev smoke) 跳过, 生产永开
- 单 turn 失败记入 `errors[]` 不中断整 session
- 测试: 7/7 (`script-runner.service.spec.ts`) — pool 抽 + cache miss 写 / 二次命中 + used_count++ / 空 pool skip / asset 空+skip / asset 空+fallback / turn 失败不中断 / 不同 persona 不同 cache 条目

**ScriptChatExecutor** (`packages/backend/src/modules/scripts/script-chat.executor.ts`)
- taskType=`script_chat` · allowedInNightWindow=false
- payload: `{scriptId, roleAaccountId, roleBaccountId, sessionIndex?, fastMode?}`
- 验 payload 缺字段 → `INVALID_PAYLOAD`; runner 抛 → `RUNNER_THREW`; 有 turn 错 → `TURN_ERRORS` (附明细)
- 注册进 `TASK_EXECUTORS` (tasks.module.ts) — 替代 M3 chat stub 真跑剧本

**API** (`packages/backend/src/modules/scripts/scripts.controller.ts`)
- `GET /script-packs` · `GET /script-packs/:id/scripts` · `PATCH /script-packs/:id/toggle` · `DELETE /script-packs/:id`
- `POST /script-packs/import-bundled` — 扫 `scripts/` 目录导入
- `POST /script-packs/import` body 传 PackJson / PackBatchJson
- Guard: 平台超管 (tenantId === null) 才能改, 普通 admin 只读

**Admin UI** (`packages/frontend/src/pages/admin/ScriptsTab.tsx`)
- Collapse 列所有包 · 行内 enable/disable Switch · 删除 Popconfirm
- "导入仓库自带包" 按钮一键灌数据
- 展开后按需加载包内剧本 Table · 每行 `预览 JSON` Modal 显示完整 content

### Verified (smoke)

导入仓库自带 5 文件 → `official_my_zh_basic_v1` v1.0.0 合计 **100 scripts** (主包 20 + batch2-5 各 20).

真 script_chat 任务: `scriptId=1` (s001_morning_simple) · slot #1 ↔ slot #2 (delta 租户, 真绑号) · fastMode=true.
- task.status = `done` · lastError = null
- `chat_message` +28 行 (out/in 双写, session 共 ~14 text turns 双向)
- `rewrite_cache` +9 行 (session turns, source=m4_pool_pick, persona_hash 对齐 A/B 各自)

### Constraints (M4 范围边界)

- **无真 AI 改写** — `source='m4_pool_pick'` 仅 content_pool 随机抽. M6 接入真 AI (OpenAI / DeepSeek / Gemini / Claude) 时只替换 resolveText 的 miss 分支 + cache source 改对应引擎名, schema 不改
- **无真资源文件** — asset 表 schema 就位, 实际文件生成留给 M7 asset-studio. 当前 voice/image/file turn 按 on_disabled 降级 (fallback 文本 / skip)
- **单 session 执行** — 目前只跑 `sessionIndex` 指定的一个 session, 多 session 自动衔接 + delay_from_start 留给 M5 养号日历接 (跨 task 串)
- **warmup_stage 未 gate** — min_warmup_stage 只存没强制. M5 养号推进器会按 warmup_day 自动放开剧本池

### Rationale (存档关键决策)

- **turns 不拆表** — 剧本是"原子包", 跨 turn 编辑极少. 拆表后加载 100 剧本 × 20 turns = 2000 行, JSONB 单列查询 < 100ms. 详 script.entity.ts 头注释
- **content_pool + cache 双写而非只 cache** — content_pool 是人工写的底稿, cache 是运行时产物. M6 换 AI 也只改 miss 路径, content_pool 仍是 ground truth, 用户可 UI 编辑
- **script_chat 分开 chat** — chat executor 是 M3 dev stub (TaskExecutor 契约验证), M4 不是"接 chat 逻辑", 是引入真剧本引擎新 type. 未来 chat 可能演化去掉 (任何真对话都应过剧本)
- **两遍扫主包 + batch** — batch 必须 attach 已存在 pack, 一遍扫容易排序依赖出错. 两遍保主包必先落

---

## [v0.3.0-m3] · 2026-04-19 · M3 任务调度 + 6 并发仲裁交付

M3 里程碑: BullMQ 基础设施 + 3s 轮询 dispatcher + 5 种拒绝路径 + 夜间窗口 + executor registry 抽象.

### 收工标准 (全绿)

| # | 项 | 证据 |
|---|---|---|
| 1 | Redis 7 加入 docker-compose.dev.yml, 不污染系统 | host :6380 (避 6379 占用) · wahubx-dev-redis-data 卷 · healthcheck PONG |
| 2 | Executor registry 模式, 未知 type 保 pending + warn | `ExecutorRegistry.get()` 返 null, dispatcher `leave-pending-unknown-type` |
| 3 | 5 rejection paths + 夜间窗口 + unknown type 全部单测覆盖 | 17/17 tests in `dispatcher.service.spec.ts` ✅ |
| 4 | Admin '任务队列' Tab: 6 并发槽 + 排队 + 最近失败 · 3s 轮询 | `QueueTab.tsx` · 无 WebSocket · 无 CRUD |

### Added (M3)

**基础设施**
- `redis:7-alpine` 加到 `docker-compose.dev.yml`, 主机 :6380 (避 6379 已占), 命名卷 `wahubx-dev-redis-data`, `redis-cli ping` healthcheck
- 依赖: `bullmq@5` + `ioredis@5`
- env: `REDIS_HOST/REDIS_PORT/REDIS_DB/REDIS_PASSWORD` + `SCHEDULER_MAX_CONCURRENCY=6` + `SCHEDULER_POLL_INTERVAL_MS=3000` + `SCHEDULER_NIGHT_WINDOW_START/END`

**数据模型** — migration `CreateTasksAndTakeover1776612590751`
- `task`: SERIAL pk · tenant_id · task_type (varchar, 非 enum 方便扩展) · priority · scheduled_at · repeat_rule · target_type enum · target_ids int[] · payload jsonb · status enum (pending/queued/running/done/failed/cancelled/skipped) · last_error · 2 索引 (status+scheduled, tenant+status)
- `task_run`: SERIAL pk · task_id FK CASCADE · account_id · started_at · finished_at · status enum · error_code/error_message · logs jsonb (结构化步骤: [{at, step, ok, meta}])
- `account_slot.takeover_active` boolean (rejection #4 用; M9 接管 UI 置 true)

**Executor 抽象**
- `executor.interface.ts`: `TaskExecutor` 接口 (taskType / allowedInNightWindow / execute) · `TaskExecutorContext` (task + accountId + log fn) · `TASK_EXECUTORS` Symbol DI token
- `ExecutorRegistry`: Map<taskType, TaskExecutor> · `get/has/isAllowedInNightWindow/listTypes` · 重复注册抛
- **约束**: 未注册 type → dispatcher 保 pending + warn log, 绝不 reject (用户 2A 约束)
- M3 内置 stubs: `ChatExecutor` (dev stub, M4 剧本引擎接真逻辑) · `WarmupExecutor` (dev stub, M5 养号日历接真逻辑)

**Dispatcher (技术交接文档 § 5.2)**
- 3s `setInterval` 轮询 · 防并发 `busy` 锁 · `tick(now?)` 纯函数风格便于测试
- `decide(task, ctx, now)` 返 union type, 8 种可能:
  - `run` · `skip-global-capacity` (#1) · `skip-account-busy` (#2) · `skip-ip-group-busy` (#3) · `skip-takeover-active` (#4) · `skip-night-window` · `leave-pending-unknown-type` · `soft-warn-warmup-stage` (#5)
- IP 组判定: `slot.proxy_id` 相同 = 同组 mutex; `proxy_id=null` 归到 "-1 null 组" (dev 直连多槽会互斥)
- `warmup_stage` 软锁: `MIN_WARMUP_STAGE_BY_TASK_TYPE` 表 (warmup=0, chat=Prewarm, status=Active), 不够只 warn 不拒
- 夜间窗口: `SCHEDULER_NIGHT_WINDOW_START/END` 默认 02:00-06:00 · 跨午夜支持 (22:00→04:00)
- `buildContext` 一次 tick 内快照所有 running state, 避免同轮决策交叉
- `executeInBackground` 真正执行 executor, 异步不阻塞 tick

**API**
- `POST /api/v1/tasks` 创建任务 (CreateTaskDto)
- `GET  /api/v1/tasks?status=xxx` 列表
- `GET  /api/v1/tasks/:id` 详情
- `POST /api/v1/tasks/:id/cancel` 取消
- `GET  /api/v1/tasks/queue/running` 运行中 (admin queue tab 用)
- `GET  /api/v1/tasks/queue/pending` 排队
- `GET  /api/v1/tasks/queue/failed-recent` 最近 20 条失败

**Admin UI · "任务队列" Tab** (`pages/admin/QueueTab.tsx`)
- **6 并发槽视图**: 6 格 Card, 每格显示 idle / running · task_id · account · 运行时长 mm:ss
- **排队列表**: id/type/target/priority/scheduled_at/created_at · 按优先级排序
- **最近失败 20 条**: id/type/target/updated_at/error
- **3s 轮询** (setInterval, 无 WebSocket 按 4A 约束)
- 不做: CRUD / search / filter / pagination (留 M11)

### 实测证据 (M3 smoke)

```
Registered 2 executors: chat, warmup
Dispatcher started, poll interval=3000ms, max concurrency=6

POST /tasks chat (account 2 = warmup_stage 0 < Prewarm)  → status=pending (soft warn)
POST /tasks warmup (account 1)                            → status=pending
POST /tasks mystery_type                                  → status=pending

[3s tick]
  task 1 (chat, account 2) → running → success (stub, 300ms)
  task 3 (mystery_type)    → WARN "Unknown task_type... left pending"
[6s tick — task 1 已完]
  task 2 (warmup, account 1) → running → success (stub, 500ms)
  # 关键: task 2 没在 tick-1 跑, 因 account 1 和 account 2 都 proxy_id=null = 同 null IP 组互斥 (rejection #3)

DB task_run.logs:
  task 1: [{step: "chat-prepared"}, {step: "chat-sent"}]
  task 2: [{step: "warmup-start"}, {step: "warmup-tick"}]
```

Unit tests: **17 passed, 17 total** (`pnpm test dispatcher`)
- 5 rejection paths (#1 global / #2 account / #3 proxy group incl. null / #4 takeover / #5 soft-warmup)
- 夜间窗口 (chat 拒 / warmup 放行 / 跨午夜)
- Unknown task_type 不 reject
- Ghost account (slot 找不到) 保 pending
- Group target (M4 才支持) 保 pending
- Registry 重复注册抛

### Known Issues (M3)

- 任务取消当前只改 status, 不中断已跑 executor (长任务无强制中止). 可接受: M3 stubs 都 <1s.
- 定时任务 (repeat_rule cron) 未实装; 字段已在, M5 养号日历会接.
- Dispatcher 单例, 多实例部署未做 Redis 分布式锁. V1 本地单进程可以, V2 拆 VPS 调度器时补.
- BullMQ 当前未实际用 (Redis 已起). 第一版 dispatcher 直接走 DB 查询 + 异步 executeInBackground 足够; M11 前若并发规模上去再接 BullMQ 真正的 Queue/Worker.

---

## [v0.2.0-m2] · 2026-04-19 · M2 Baileys 集成 + 槽位独立交付

M2 里程碑: 可绑真实 WA 号并收发消息 · 每槽位独立 (fingerprint + proxy + session) · 具备 M3 调度所需的隔离基础.

### 收工标准 (所有绿)

| # | 项 | 状态 | 证据 |
|---|---|---|---|
| 1 | Baileys 协议层 (消息/连接/重连/媒体) | ✅ | 真机扫码 2 号 · 收发文本 + 收图片 · restartRequired 自动重启处理 |
| 2 | 槽位创建生成 fingerprint.json 注入 Baileys browser | ✅ | `data/slots/<N>/fingerprint.json` · DEVICE_POOL 10 机型 · `baileysBrowser` 喂 makeWASocket |
| 3 | Baileys socket 按 slot.proxy_id 走代理 | ✅ | `resolveIsolation` + `HttpsProxyAgent` / `SocksProxyAgent` · `agent/fetchAgent` 传 Baileys |
| 4 | 2 个本地 dev-proxy 验证槽位走不同代理 | ✅ | `scripts/dev-proxy.ts` · P8080 / P8081 各自独立 CONNECT 日志 |
| 5 | Smoke: 两槽 Baileys 连接路径不相同 | ✅ | 独立进程 · 独立 TCP socket · 不同 client:port 不同 upstream:port · 见下方"技术细节" |

### Added (M2 W1-W3)

### Added (M2 W1-W3)

**W1 · 扫码绑定**
- `BaileysService` 扫码绑定现有号 (takeover 模式)
- `GET/POST /slots/:id/bind-existing{/status,/cancel}`
- 2 分钟绑定超时 + QR 轮询 + `fetchLatestBaileysVersion` 动态协议版本
- 前端 `BindExistingModal` · QR 渲染 · 5 态状态机

**W2 · 常驻 socket + 文本消息**
- 新表: `wa_contact` (UNIQUE account_id+remote_jid) · `chat_message` (BIGSERIAL · direction/msg_type enum)
- migration `CreateChatMessages1776600662633`
- Pool: `Map<slotId, WASocket>` 常驻 socket
- `onModuleInit` rehydrate: `status in (warmup, active)` + session 文件存在 → 自动续连
- `sendText` 发文本 · `messages.upsert` 入库 (去重 fromMe)
- `slots.clear` 完整清理: pool 踢出 + CASCADE 删 wa_account + rm -rf `data/slots/<N>/`
- 新端点: `POST /send` · `GET /contacts` · `GET /messages` · `GET /online-status`
- 前端 `ChatModal` 3 tab: 发消息 / 联系人 / 最近消息

**W3 · 自动重连 + 配对码 + 媒体消息**
- **自动重连**: 非 loggedOut 断线自动重连 · 指数退避 5s/10s/20s/40s/80s · 5 次达上限标 suspended · 重连成功清计数
- **Pairing Code (W3.2)**: `POST /slots/:id/bind-existing { phoneNumber }` 走 8 位配对码 (WA 原生替代 QR, 相机不便时用); 前端 `BindExistingModal` 加模式选择 Radio
- **媒体消息接收 (W3.3)**: `messages.upsert` 自动 `downloadMediaMessage` → 落 `data/slots/<N>/media/<msgId>.<ext>` → `chat_message.media_path` 存相对路径
- **媒体消息发送 (W3.4)**: `POST /slots/:id/send-media { to, type, contentBase64, mimeType?, filename?, caption? }` · 支持 image/voice/file · 16MB WA 限 · JSON body 上限调至 25MB (`app.useBodyParser`)
- 前端 `ChatModal` 新增"发图片" tab · antd Upload + base64 转换

**W3.5 · 槽位独立基础 (fingerprint + proxy wiring)**
- `common/fingerprint.ts`: DEVICE_POOL 10 机型 (Samsung/Xiaomi/Oppo/Vivo) · seed-based 稳定生成 · `baileysBrowser: [model · S{slotIndex}, Desktop, chromeMajor]`
- `common/proxy-config.ts`: `ProxyDescriptor` + `buildProxyAgent` (HttpsProxyAgent / SocksProxyAgent)
- `slots.service.seedForTenant`: 租户激活时为 N 个槽位各生成一份 `data/slots/<N>/fingerprint.json` (幂等)
- `PATCH /slots/:id/proxy { proxyId }`: 绑定/解绑代理 · 租户隔离 · 切换自动踢 pool
- `BaileysService.resolveIsolation`: bind + rehydrate 两路径统一读 fingerprint + proxy, 喂 `makeWASocket({ browser, agent, fetchAgent })`
- `onBindConnectionOpen` 同步把 fingerprint JSON 写 `wa_account.device_fingerprint` DB 列
- `POST /slots/backfill-fingerprints`: 升级回填 — 幂等补齐 fingerprint.json + DB 字段

**W3.6 · Admin 代理 CRUD**
- `POST /admin/proxies` · `GET /admin/proxies` · `DELETE /admin/proxies/:id` (RolesGuard=admin + 租户隔离)
- `CreateProxyDto` (proxyType / host / port / username? / password? / country? / city?)

**开发工具**
- `scripts/dev-proxy.ts`: 轻量 HTTP CONNECT 转发代理, 记录每条 CONNECT 的 client/upstream src-dst. 用法:
  ```
  LABEL=P8080 PORT=8080 npx ts-node scripts/dev-proxy.ts
  LABEL=P8081 PORT=8081 npx ts-node scripts/dev-proxy.ts
  ```

### 技术细节 · 槽位路由隔离实测

真实 smoke (commit `TBD`):
```
P8080 CONNECT web.whatsapp.com:443 · client=127.0.0.1:54021 · upstream=[IPv6]:54022 → WA
P8081 CONNECT web.whatsapp.com:443 · client=127.0.0.1:54026 · upstream=[IPv6]:54027 → WA

→ 2 个 slot 经 2 个独立代理进程 · 2 条独立 TCP 连接 · 不同 client port + 不同 upstream port
→ 从代码到网络栈完整隔离链通
```

**真实生产中"不同出口 IP 到 WA"的来源**:
- dev smoke 两代理都在 localhost → WA 看到同一个 NAT 出口. **不是 bug, 是 dev 限制**.
- 生产部署: 每个 proxy 行的 host/port 对应真实住宅代理供应商, 每个供应商给出独立 IP. WA 侧看到的 source IP 自然 distinct.
- 代码层面已保证: 不同 proxy_id → 不同 proxy row → 不同 HttpsProxyAgent 实例 → 不同 TCP 上游目标主机.

**M3 仲裁的 "IP 组" 判定**:
- 用 `proxy_id` / `proxy.bound_slot_ids` DB 字段决定组, 非实时 IP 比对
- 相同 proxy_id 的 slots = 同 IP 组 (M3 互斥)
- 不同 proxy_id 的 slots = 不同 IP 组 (可并发)
- dev 测试: 分配同一 proxy_id 给多槽即可构造"同组"场景, 无需真实 IP 相同

### Deferred (明确推迟)

- **W3.5 新号注册**: 推迟到 V1.1 单独里程碑. 每次失败永久烧 SIM 卡, 需实物 SIM 及谨慎测试流程.
- **多代理池健康检查 Cron**: M3 调度器阶段做
- **代理 IP 组错峰调度**: M3 仲裁器做
- **指纹轮换策略 / 深度反检测 stealth**: M5 养号日历阶段做
- **接管 UI**: M9

### Known Issues (M2)

- 媒体文件无 HTTP 服务入口 (前端暂无法直接看/下载) — M9 接管 UI 时加 `/slots/:id/media/<file>` 端点
- 没有消息去重 (接收方 `wa_message_id` 重复 upsert 会入多条) — M9 加唯一索引
- 没做发消息速率限制 / 养号节流 — M3 调度器 + M5 养号日历会统一管
- 视频消息当前归到 Image 枚举 — 待 MessageType 枚举扩展 Video
- Windows dev: `scripts/dev-proxy.ts` 的 BIND_ADDR 选项 EINVAL (Linux 可用)

### 真机验收 (带用户一起实测)

- 扫码绑定 2 个真号: 60168160836 + 60186888168 — 两个独立槽位, 独立 Oppo Reno11 / A78 指纹
- 接收文本消息 · 发送文本消息 (loopback slot1 → slot2) · 接收图片
- ChatModal UI 三 Tab 全部展示正确 (发文本 / 发图片 / 联系人 / 最近消息)
- 遇到并修复的坑:
  1. `restartRequired(515)` 误判失败 → 改为自动 respawn socket
  2. 同 DEVICE_POOL 条目碰撞 → browser label 加 `· S{slotIndex}` 后缀去重
  3. `requestPairingCode` 太早调返 "Connection Closed" → 改到首次 qr 事件触发
  4. getLocalStatus 返回已吊销 license → 加 `revoked ASC, issued_at DESC` 排序
  5. express 直接 import 崩溃 → 改用 `app.useBodyParser`
  6. Windows net.connect localAddress EINVAL → BIND_ADDR 文档注明 Linux only

---

## [v0.1.0-m1] · 2026-04-19 · M1 基础骨架交付

M1 里程碑：从零搭到"单租户可登录、看到自己的 N 个空槽位"的骨架。不含 Baileys / 任务调度 / 剧本引擎（后续里程碑）。

### Added

**Infra**
- pnpm monorepo workspace (`packages/backend` + `packages/frontend` + `installer`)
- NestJS 10 + TypeORM + PostgreSQL 16 (docker-compose host :5433)
- Vite 5 + React 18 + Ant Design 5 (zh-CN, WhatsApp 绿 `#25d366`)
- pino 结构化日志 (dev pretty / 生产 JSON + redact Authorization/Cookie/密码/license_key)
- class-validator env schema（DB/JWT/锁定参数必填校验）

**数据模型**（10 张表）
- `tenant / license / proxy` (§ 3.1+3.3)
- `users / user_sessions` (auth)
- `account_slot / wa_account / sim_info / account_health` (§ 3.2)
- `migrations` (TypeORM 内部)
- 3 个 migration: `InitCoreTables` / `CreateUsersAndSessions` / `CreateSlotsAndAccounts`
- 9 个 PG enum: tenant_plan / tenant_status / proxy_type / proxy_status / users_role / users_status / account_slot_status / sim_type / account_health_risk_level

**认证 + 授权**
- JWT 双 token（access 15m / refresh 7d），`/auth/{login,refresh,logout,logout-all,sessions,change-password,profile,has-users}`
- bcryptjs round=12，失败 5 次锁 15 分钟（DB 级 `locked_until`）
- 3 级 role: `admin` / `operator` / `viewer`
- 平台超管 `tenant_id=null` 跨租户；租户 admin 仅本租户
- 全局 `JwtAuthGuard`，`@Public()` 解豁免

**License 模块**
- 机器指纹：SHA-256(物理 MAC + CPU 型号)，持久化到 `data/config/machine-fingerprint.txt`
- License Key 格式 `WA-XXXX-XXXX-XXXX-XXXX`（base32-ish 16 字符，去易混 O/0/I/1）
- 公开端点：`GET /license/status`、`POST /license/activate`（原子事务：创建 admin user + 绑定指纹 + 自动开 N 槽）、`POST /license/verify`
- Admin 端点：`GET/POST /admin/licenses`、`POST /admin/licenses/:id/revoke`（平台超管独占）

**Slots 模块**（Week 3）
- 激活时自动开 N 条 empty 槽位（N = `PLAN_SLOT_LIMIT[plan]` → Basic 10 / Pro 30 / Enterprise 50）
- `GET /slots` 租户隔离列表、`GET /slots/:id`、`POST /slots/:id/clear` (M2 前 stub)
- `UNIQUE(tenant_id, slot_index)` 防重复

**Admin 后台**（Week 4）
- `GET /admin/tenants` / `:id` / `:id/slots` — 跨租户视图（平台超管）/ 自查（租户 admin）
- 前端 AdminPage 3 tab：租户管理 / License 管理（生成 modal + 吊销 popconfirm）/ 用户管理

**前端页面**
- `/activate` — License 激活页，显示本机指纹，自动登录
- `/login` — JWT 登录
- `/` — 仪表盘（tenant/plan/user/M1 脚手架状态）
- `/slots` — N 张卡片 grid，空槽位虚线灰化；注册/管理按钮 disabled（M2 启用）
- `/admin` — admin only 后台
- `/settings` — 5 面板空壳（账号资料实装 · AI/代理/备份 占位 · 关于页）
- `/health` — 系统健康
- AuthContext 管 user/licenseStatus/tokens；路由 Gate (ActivateGuard/LoginGuard/ProtectedRoute)

**构建管线**
- `installer/obfuscate.js` — javascript-obfuscator 选择性混淆 5 个敏感文件（license/machine-id/auth/session/users service），Nest DI/TypeORM 兼容配置
- `installer/build-backend.bat` / `build-frontend.bat` — Windows 一键构建 + stage 到 `installer/staging/`

**文档**
- `CLAUDE.md` — 工作汇报铁律 + 进程杀政策 + 核心决策速查
- `docs/DEVELOPMENT.md` — 零到一本地搭建 / 端口清单 / troubleshooting
- `README.md` — 快速启动 + 里程碑进度
- `START_M1.md / WAhubX_技术交接文档.md / WAhubX_产品介绍书.html`（用户提供，入库）

### M1 Week 进度

- **Week 1** (`v0.1.0-m1-w1`) — 仓库初始化 + 脚手架 + DB + 首 migration
- **Week 2** (`v0.1.0-m1-w2`) — auth/users/license/admin-licenses/前端登录激活
- **Week 3** (`v0.1.0-m1-w3`) — slots 数据模型 + 激活开槽 + 前端槽位列表
- **Week 4** (`v0.1.0-m1`) — Settings/Admin 页 + 混淆管线 + M1 发版

### Known Limitations / TODO（记录，后续里程碑处理）

| # | 项 | 目标里程碑 |
|---|---|---|
| 1 | Refresh token 自动续期（401 当前直接清会话） | M5 或更早 |
| 2 | `proxy.password` 明文 → AES-GCM at-rest | M10 |
| 3 | `user_sessions.access_token/refresh_token` 明文 → sha256 fingerprint | M10 |
| 4 | VPS License Server 拆分（当前 local DB 一体化） | V2 |
| 5 | antd bundle 741 KB 无 code-split | v1.0 前 |
| 6 | i18n 完全未接（决策：V1 单中文）| V1.1 |
| 7 | Password reset 端点未实现 | M11 前 |
| 8 | Inno Setup 完整打包（当前仅 build 脚本 + stage）| M11 |
| 9 | 前端改密码 / 改昵称 / 改语言 UI（后端已就绪）| M1 Week 5+ |
| 10 | 预 Week 3 创建的租户 (Dev #1, Acme #2) 无槽位（seeding hook 之前的活动数据）| 生产不存在此问题，手动 `DELETE FROM tenant WHERE id IN (1,2)` + 重建可清理 |

### Dev 数据（本机 PG 里已存，方便新 session 接手）

| 记录 | 用途 | 密码 |
|---|---|---|
| `platform@wahubx.local` (tenantId=NULL, role=admin) | 平台超管 | `Test1234!` |
| `admin@wahubx.local` (tenantId=1 Dev Tenant, Basic) | 租户 admin dev | `Test1234!` |
| `acme-admin@acme.com` (tenantId=2 Acme, Pro, License revoked) | 历史激活演示 | `AcmeAdmin1234!` |
| `beta-admin@beta.com` (tenantId=3 Beta, Basic, 10 槽已开) | Week 3 验证 | `BetaAdmin1234!` |
| `delta-admin@delta.com` (tenantId=4 Delta, Enterprise, 50 槽) | Week 4 E2E 验证 | `DeltaAdmin1234!` |

清库: `docker compose -f docker-compose.dev.yml down -v`

---

## 版本链

```
v0.1.0-m1      ← 本次 (M1 基础骨架发版)
  ├── v0.1.0-m1-w3
  ├── v0.1.0-m1-w2
  └── v0.1.0-m1-w1  (M1 起点)
```

下一里程碑: **M2 · Baileys 集成**（3 周）— 注册新号 + 扫码登录 + 发消息 + 接收消息。
