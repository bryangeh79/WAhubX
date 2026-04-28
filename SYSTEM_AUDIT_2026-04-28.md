# WAhubX 系统现状审计 · 2026-04-28

> 项目: WAhubX (WhatsApp 多账号自动化 SaaS · 马来西亚/东南亚)
> 仓库: https://github.com/bryangeh79/WAhubX.git
> 当前分支: `claude/goofy-mendel-3f5881`
> 审计时间: 2026-04-28 (PM)
> 状态: M1 启动后第 9 天 · 客服功能开发中 · 还在测试期, 未上线

---

## A. 当前 Bot 基础架构

### A1. 连接方式

**Chromium + WhatsApp Web DOM 自动化** (基于 puppeteer-core).

- 用 `puppeteer-extra` + `puppeteer-extra-plugin-stealth` 启动 Chromium
- 直接打开 `https://web.whatsapp.com` · 用 MutationObserver + DOM selector 抓 chat-list
- 不用 baileys 等 WA 协议库 (2026-04-28 全栈拔除 baileys, 走 D11 Chromium per-slot 路线)
- 文件: `packages/runtime-chromium/src/index.ts` (主入口) + `packages/runtime-chromium/src/wa-web/*`

**已知问题**:
- WA Web DOM 频繁变 (这次 2026-04-28 实测 row 选择器从 `[role="listitem"]` 漂到 `div[role="row"][data-testid^="list-item-"]` · 见 commit `65d4749`)
- 反检测靠 stealth plugin + UA/locale/timezone 一致性 (D5/D7-2/D7-3) · 不是真协议级伪装

### A2. 客服号 / 广告号 worker 隔离

**每个 slot 一个独立 chromium 进程** (per-slot runtime, 物理隔离).

- backend NestJS 主进程 (`packages/backend`) 不直接操作 chromium
- 通过 `RuntimeProcessManagerService` (D12) spawn 每个 slot 一个 node 子进程
- 子进程跑 `packages/runtime-chromium/dist/index.js` · 内部 launch 一个 chromium browser
- backend ↔ runtime 通过 WebSocket 双向通信 (`packages/backend/src/modules/runtime-bridge`)
- 多个客服号或广告号都是各自独立的 chromium · 互不污染 cookie/IndexedDB/proxy

文件:
- `packages/backend/src/modules/runtime-process/runtime-process-manager.service.ts`
- `packages/backend/src/modules/runtime-bridge/runtime-bridge.service.ts`
- `packages/runtime-chromium/src/index.ts`

**协议**: 见 `packages/shared/src/runtime-protocol.ts` (RuntimeCommand / RuntimeEvent / WS 协议 v1)

### A3. Session 持久化

**本地 chromium 用户数据目录** (per-slot 独立 profile).

- 路径: `C:\Users\<user>\AppData\Roaming\wahubx\slots\<slotIndex>\profile\`
- chromium 用 `--user-data-dir` 加载 · 包括:
  - IndexedDB (WA Web 真正存登录态的地方)
  - Cookies, LocalStorage, ServiceWorker
- WA 登录后, IndexedDB 里有 `device_id` / `client_token` · rehydrate 时不用重扫
- 不存 DB · 不用 Redis 存 session

文件: `packages/backend/src/common/storage.ts` `getSlotDir()`

**注意**:
- "恢复出厂" (`clear()` in `slots.service.ts`) 会 `rm -rf` 整个 profile 目录 · 13 步流程 (见 commit `f746611`)
- 同一 slot 重启 · 加载同一 profile · 自动 rehydrate (无需扫码)

### A4. 掉线检测

**两层检测**:

1. **进程级** (runtime crash): `child.on('exit')` 在 backend 监听
   - 文件: `runtime-process-manager.service.ts` `classifyExit()` line ~488
   - 触发 `unexpected-exit` → C1 auto-respawn (见 A7)
2. **WA Web 级** (chat-list 不见): runtime 内 `chatListWatchdog` 周期 60s 检测
   - 文件: `runtime-chromium/src/index.ts` line ~615 `startChatListWatchdog`
   - 连续 2 次 (60s) `[data-testid="chat-list"]` 选择器找不到 → emit `connection-close` category=`wa-logged-out`
3. **Watcher 级** (DOM observer 失效): 30s healthcheck (commit `4da334a`)
   - 探 `__wahubxObserver` / `__wahubxPollTimer` / `__wahubxOnIncoming` / pane 4 项
   - 不健康自动 reinstall

### A5. 重新扫码通知

**前端 dashboard 实时显示 QR**:

- runtime 探测到 page 状态 = qr 时, 通过 CDP 提 canvas dataURL
- 通过 WS event `qr` 推 backend
- backend 通过 SSE (`/qr-stream`) 推前端
- 前端 (槽位页) 显示 QR 大图 · 用户用手机扫
- 文件: `packages/frontend/src/pages/slots/components/QrCanvas.tsx`

**没有的**:
- ❌ Telegram / WhatsApp / Email 通知 (没接外部告警)
- ❌ 系统级 toast 通知
- 用户必须主动看前端 dashboard

### A6. Health Check

| 类型 | 间隔 | 检查内容 | 位置 |
|---|---|---|---|
| Runtime heartbeat | 30s | runtime → backend WS 推 `pageState` (qr/chat-list/closed) | `runtime-chromium/src/runtime-ws-client.ts` |
| chat-list watchdog | 60s | `[data-testid="chat-list"]` 在不在 | `index.ts` `startChatListWatchdog` |
| heartbeat keep-alive | 60s | scroll chat-list 1px + 5min focus event 防 idle purge | `index.ts` `startHeartbeatKeepalive` |
| Inbound watcher healthcheck | 30s | observer / pollTimer / callback / pane 4 项 | `index.ts` `startInboundWatcherHealthcheck` (新加) |
| TakeoverLock idle sweep | 30s | 接管态 idle timer (28min 警告 / 30min 自动释放) | `takeover-lock.service.ts` |
| Handoff timeout sweep | 60s | 5min 没人工跟的 conv 补一次通知 | `auto-reply-decider.service.ts` (新加) |

### A7. 自动重连

**3 层自愈**:

1. **C1 auto-respawn** (进程崩) — `runtime-process-manager.service.ts`
   - 1s/3s/10s exponential backoff
   - 3 次失败 → quarantine 60s 不再重启
2. **wa-logged-out 自愈** (Use here 顶号) — `slots.service.ts` (新加 commit `bdff134`)
   - 客服号 (role=customer_service) · 8s 后自动 startBind
   - 广告号不自动重连 (避免 WA 风控)
3. **D12-3 auto-spawn** (backend 启动) — 客服号优先 1s 间隔, 广告号 5s 间隔

---

## B. 消息接收与处理流程

### B8. 完整流程 (客户消息 → AI 回复)

```
客户在手机端发 "想多了解 fahubx 这个产品"
  ↓
[runtime · WA Web chat-list] · MutationObserver 抓到 row 出现 unread badge
  + 5s poll 兜底
  ↓
[runtime · onIncoming hint] · 抽 phone/displayName/lastMsgPreview/unread
  ↓
candidateQueue.push(...) · 推到 chat-reader 队列
  ↓
[runtime · drainCandidateQueue] · 串行进每个 chat
  enterChat(rowSelector) → readLatestMessages(N=5, phoneE164, displayName)
  → 抽真消息 text + waMessageId + direction (in/out)
  → exitChat (Escape 回 chat-list)
  ↓
WS event `message-upsert` schemaVersion='p0.11-hifi' · 推 backend
  ↓
[backend · runtime-bridge.service] · 校验 + emit 'runtime.bridge.message-upsert'
  ↓
[backend · slots.service onChromiumMessageUpsert]
  - 看 slot.role · broadcast 直接丢
  - customer_service · persistMessage(direction=in, content, phone)
    → 写 chat_message 表 + emit 'takeover.message.in'
  ↓
[backend · auto-reply-decider onInbound]
  - 11 闸门:
    1. 基础过滤 (跳群/非 text)
    2. slotRole 校验
    3. ConversationStage 校验 (HumanTakeover/Closed/DoNotReply 跳)
    4. settings.mode 校验 (off 跳)
    5. 频率限流 (3s debounce + 24h 30 条)
    6. tenant.dailyAiReplyLimit 校验 (默认 200)
    7. 夜间静默
    8. Handoff 关键词 (一级立即转人工)
  - 写 pending_inbound 表 (8s 聚合 buffer)
  - 启 8s 聚合 timer (同 conv 后续消息合并)
  ↓
[8s 后 · flushConversation]
  - 拉同 conv 所有未 flush 的 pending_inbound
  - 合并 content 用 \n 拼
  - 调 reply-executor.handle(convId, mergedQuestion)
  ↓
[backend · reply-executor.handle]
  - 双层 KB Fallback:
    - 产品名 keyword pre-filter (kb.name 子串命中)
    - primaryKbIds = conv.kbId 或 tenant 所有产品 KB
    - secondaryKbId = 通用 KB (default_kb_id)
  - 1A · FAQ Jaccard 跨 primary KBs · score >= 0.55 → 命中即返
  - 1B · FAQ 跨 secondary 通用 KB · 命中即返
  - mode=faq → 没命中 markHandoff
  - mode=smart · RAG:
    - platform embed query (DeepSeek/OpenAI)
    - cosine in primary chunks · top-3
    - score < 0.75 + 没 KB pre-filter → 试 secondary KB
  - score < 0.45 + 没 KB pre-filter → AI clarify (不 markHandoff)
  - score >= 0.45 → 喂 chunks 给 LLM 答 (DeepSeek/Claude/Gemini/OpenAI)
  - applyGuardrail (限长 / 删 100% 承诺 / 价格替换)
  ↓
[backend · slots.service.sendText]
  - 写 ai_reply_audit 表
  - 调 runtime WS cmd `send-text` · phoneE164 + replyText
  ↓
[runtime · openChatByPhone + sendTextInOpenChat]
  - human-typing simulator (50-150ms/char + 偶尔 typo + Shift+Enter for \n)
  - Enter 发送 · 等单勾 (msg-check icon) max 10s
  - 单勾出现 → ok=true
  - 没单勾 + input 已清空 → ok=true unconfirmed=true
  - 没单勾 + input 残留 → ok=false 上层重试
  - 发完 Escape + SPA hashchange 返 chat-list (让下条 unread badge 能被检测)
  ↓
[backend · persistMessage(direction=out)] · 写 chat_message
```

**总耗时**: 8s 聚合窗 + AI 调用 (DeepSeek 3-15s) + sendText (3-8s) ≈ **15-30s**

### B9. 消息入库时机

**两次写**:

1. **inbound persist** (slots.service.onChromiumMessageUpsert) · 收到客户消息立刻写
   - schemaVersion='p0.11-hifi' 路径: 用真 waMessageId
   - fallback hint 路径: waMessageId=null + 5s synthetic dedupe
2. **outbound persist** (slots.service.sendText) · sendText 成功立刻写
   - waMessageId = `local-<ts>-<rand>` (WA Web 不暴露真 messageId)

文件: `packages/backend/src/modules/messaging/messaging-persistence.service.ts`

### B10. message_id 去重

**两层**:

1. **runtime 内** · `recentSeenMessageIds` Map (60s 滑动窗口) · `index.ts` line ~540
2. **backend 持久层** · `chat_message.wa_message_id` UNIQUE 约束 + 应用层 `existsByWaMessageId` 预查
   - 文件: `slots.service.ts` line 648-660 P0.11 hifi 路径

**Inbound watcher 内 dedupe**:
- `dedupeMap` (60s) by `dedupeKey = rowDataId|lastMsg|unread`
- 同 row 同 unread count 60s 内不重 fire (commit `50f1e4a`)

### B11. 队列

**没有外部 queue (Redis/BullMQ/RabbitMQ)**.

- `pending_inbound` 是 **Postgres 表** · 当 8s 聚合 buffer 用 (decider 写, executor 取)
- runtime 内 `candidateQueue` 是**进程内数组** · chat-reader 串行消费
- AI 调用没有外部 queue · 直接同步调

文件:
- `packages/backend/src/modules/intelligent-reply/entities/pending-inbound.entity.ts`
- `auto-reply-decider.service.ts` `flushConversation()`

### B12. AI 同步 vs 异步

**AI 调用是 listener 里同步处理** (没 worker 模式).

- `flushConversation()` 内 `await executor.handle()` 同步等
- LLM 调用阻塞当前 event handler · 没并发限制
- 多个 conv 同时 flush 会同时打 LLM API · 取决于 tenant AI provider 限速

**风险**: 真生产 50+ conv 并发 · LLM API 可能限流 · 没排队. 这是 V2 要补的.

### B13. 同一客户连发多条

**8s 聚合窗合并答**:

- 第 1 条进来 · 启 8s timer · 写 pending_inbound
- 第 2 条进来 · 重置 timer · 也写
- 8s 后 timer fire · merge 所有 pending → 1 个 LLM 调用 → 1 条回复
- 设计意图: 客户 "你好/在吗/有人吗" 连发不发 3 次答

**已知问题** (用户实测): 多主题混合 (`Hi / Hi / 这个产品是什么名字 / 妳好`) 合并后 token 杂 · FAQ 不命中 · RAG 低分 · 走 clarify 答非所问.

### B14. Debounce / 冷却

| 限制 | 值 | 位置 |
|---|---|---|
| 同 conv 之间 debounce | 3s | `auto-reply-decider.service.ts` `RATE_DEBOUNCE_MS` |
| 单 conv 24h 上限 | 30 条 | `RATE_24H_LIMIT` (命中先发系统通知 + handoff) |
| Tenant 24h 上限 | 200 条 (env: `daily_ai_reply_limit`) | 同上 |
| 8s 聚合窗 | 8s | `AGGREGATION_WINDOW_MS` |
| Watcher dedupe | 60s | `inbound-watcher.ts` |

---

## C. AI 回复逻辑

### C15. AI 模型

**租户自配** (M6 设计 · tenant 自费):

- `openai` (gpt-3.5/gpt-4)
- `deepseek` (deepseek-chat / deepseek-reasoner) — **当前 dev tenant 用的就是这个**
- `custom_openai_compat` (Ollama / SiliconFlow / OpenRouter / Azure 等 OpenAI 兼容 endpoint)
- `gemini` (skeleton 实装, 未充分验证)
- `claude` (skeleton 实装, 未充分验证)

文件:
- `packages/backend/src/modules/ai/ai-provider.entity.ts`
- `packages/backend/src/modules/ai/adapters/*.ts`

**Embedding** (RAG 用): 平台默认 + 租户可覆盖
- 默认: `bge-m3` 或 OpenAI text-embedding-3-small
- 文件: `platform-ai.service.ts`

### C16. System Prompt

`reply-executor.service.ts` line ~250:

```typescript
const systemPrompt = `你是该公司的 WhatsApp 客服代表. 保持友善/简洁/口语化.
业务目标: ${goal}
重要规则:
- 只根据"资料"内容回答, 不编造
- 资料里有的联系方式 (电话/网址/邮箱) 必须保留原样
- 不报具体价格数字 (若客户问价 · 引导留联系方式)
- 不承诺 "100%" / "保证" / "绝对"
- 回复 ${MAX_REPLY_LENGTH=200} 字以内
- 不提及竞品${blackList ? `\n- 禁止话题: ${blackList}` : ''}
- 当前产品 = "${targetedKbName}" · 资料里可能用旧名/英文名/简称 · 答客户时统一用客户的称呼

输出严格 JSON: {"reply": "回复文字", "intent": "curious|interested|buying|complaint|handoff", "handoff": true|false}`;
```

**clarify (低置信) prompt**:
```
你是该公司 WhatsApp 客服 · 友善亲切口语化 · 80 字以内
客户问: "${mergedQuestion}"

我这边资料不全 · 不能直接答. 请你:
1. 礼貌致歉 (一句话)
2. 引导客户说更多 (例如: 想了解产品具体哪方面 · 您是哪家公司 · 已有订单号吗 · 等)
3. 提示如需立即联系真人请回复"人工"

直接输出回复文本 · 不要 JSON · 不超 80 字.
```

### C17. AI 资料源

按优先级:
1. **FAQ** (Jaccard 字符匹配 · 阈值 0.55)
2. **RAG chunks** (cosine 向量检索 · top-3)
3. KB metadata (`kb.goalPrompt` 注入 system prompt 当业务目标)
4. tenant `settings.blacklistKeywords` 注入 system prompt

不读: chat history (没拿历史消息当 context)
不读: 产品 metadata 之外的数据库内容

### C18. FAQ 存储

**Postgres 表 `knowledge_base_faq`**:

```sql
id, kb_id, question, answer, tags (text[]), 
status ('enabled'/'disabled'/'draft'), source ('manual'/'manual_bulk'/'starter'/'starter-customized'/'ai-generated'),
hit_count, created_at
```

**前后台支持**:
- ✅ 后台 CRUD (controller endpoints 见 D27)
- ✅ 批量导入 (`POST /knowledge-base/:id/faqs/bulk`)
- ✅ AI 自动生成 (`POST /knowledge-base/:id/faqs/generate`)
- ✅ Starter FAQ seed (`POST /knowledge-base/:id/faqs/seed-common`) · 52 条通用问候/转人工/价格 fallback
- ✅ AI 优化 starter (`POST /knowledge-base/:id/faqs/customize-starter`) · 用 tenant 业务上下文重写

文件:
- `packages/backend/src/modules/intelligent-reply/data/starter-common-faq.ts` (52 条 V1 starter)
- `packages/backend/src/database/migrations/1798000000000-CommonKbStarter.ts` (建通用 KB + 灌 starter)

### C19. RAG / 向量

**有 · 平台 embed + 内置 cosine 搜索** (没用外部向量库).

- chunks 存 Postgres 表 `knowledge_base_chunk` · `embedding float8[]` 列
- 检索: 全表扫 + 应用层 cosine · 不用 pgvector
- top-3 喂 LLM
- 文件: `reply-executor.service.ts` `cosine()` line 388

**注意**:
- 50 KB / 几千 chunks 全表扫还能撑
- 如果上 10 万 chunks 必须迁 pgvector (V2)

### C20. Intent Classification

**LLM 内置** · 不单独跑 classifier.

- system prompt 要求 LLM 输出 `{intent: "curious|interested|buying|complaint|handoff"}`
- 应用层根据 intent 切 conv stage:
  - `buying` → `HotLead`
  - `interested` → `Interested`
  - `handoff` → `markHandoff`

不在 AI 前做意图分类 (会增加 1 次 LLM 调用 · 成本 + 延迟).

### C21. Confidence Score

**两层**:

1. **FAQ Jaccard** · 阈值 0.55 (`FAQ_MATCH_THRESHOLD`)
2. **RAG cosine** · 阈值:
   - `RAG_CONF_HIGH = 0.75` · 高于直接答, 不附加 handoff
   - `RAG_CONF_LOW = 0.45` · 低于走 clarify (除非 KB pre-filter 命中)

中区 0.45-0.75 · 答 + log 警告 · 不强制 handoff (commit `c7bcd4c`)

### C22. AI 不知道答案

**当前行为**:
- 走 `clarify_low_confidence` 路径 (RAG score < 0.45 且没 KB pre-filter)
- LLM 生成礼貌追问 (例如 "您具体想了解哪方面? 公司名? 订单号?")
- conv stage 保持 'new' · 客户继续答能再触发新一轮 reply
- 不 markHandoff (老逻辑会 mark · 已改, commit `2dd2cd8`)

兜底回复 (LLM 调用失败时):
```
您好! 关于这个问题我需要更多信息才能帮到您. 请问能再具体说说您想了解什么吗? 也可以回复"人工"联系真人客服.
```

### C23. 客户问无关问题

跟 C22 一样路径. 没有专门的 "off-topic" 检测器.

**已知问题**: 客户问 "你吃饱了吗" / "今天天气如何" 这类闲聊 · 走 RAG 在产品 KB 找不到 → clarify "请告诉我您想了解哪个产品". 答非所问.

### C24. 客户要求转人工

**两层关键词**:

1. **Level 1 (一级 · 立即 markHandoff)** — `auto-reply-decider.service.ts`:
   ```
   投诉 / 退款 / 退货 / 律师 / 报警 / 骂 / 操 / 傻逼 / 滚 / 垃圾 / 骗子
   scam / refund / lawyer / sue
   ```
2. **Level 2 (二级 · 询价/具体需求)**:
   ```
   多少钱 / 报价 / 套餐 / 怎么收费 / 价格 / 价钱 / 优惠 / 折扣
   demo / 试用 / 试一下 / 合同 / 见面 / 预约
   ```
   仅作为 LLM 提示 · 不直接 handoff

3. **租户自定义关键词** (`tenant_reply_settings.custom_handoff_keywords`)
4. **starter FAQ 内含 "人工" / "客服" / "真人"** · 命中后 LLM 答 + 客户能继续打字触发更深 handoff

### C25. 人工接管模式

**有, 但 AI 不会自动停**.

- TakeoverLockService (M9) · `takeover_active` 字段在 `account_slot` 表
- 操作员前端点 [接管] · acquire 锁 · 看 chrome 屏幕 (CDP screencast)
- **当前 AI 自动回复不检查 takeoverActive** (用户拍板"先不修", 见 commit 历史讨论)
- 操作员只看不动 · AI 仍正常工作 (会切走 page URL · 操作员视野跳走但不丢字)
- 操作员正在打字 · 同时 AI 切 chat → 字会丢

**ConversationStage='HumanTakeover' 才会停 AI**:
- 用户在前端 conv 列表手动 mark "已转人工"
- 或者 LLM 输出 intent='handoff' 自动 mark
- 一旦 stage='HumanTakeover' · reply-executor.handle 开头 return

### C26. Fallback Reply

**3 个层级**:

1. **LLM clarify 失败兜底** (C22 已贴)
2. **handoff 通知** (G 自救路径 · `system_notice_handoff_ack`):
   ```
   您的问题已记录, 我们已转交真人客服, 请稍候, 我们会尽快回复您.
   ```
3. **24h 上限通知** (`system_notice_conv_24h_cap`):
   ```
   今日咨询较多, 已为您转接真人客服, 请稍候, 我们会尽快回复您.
   ```
4. **5min 超时通知** (`system_notice_handoff_timeout`):
   ```
   我们已记录您的问题, 真人客服会在工作时间内尽快回复您, 请稍候.
   ```

---

## D. FAQ / 知识库管理

### D27. 后台 FAQ CRUD

**全支持** · `packages/backend/src/modules/intelligent-reply/controllers/knowledge-base.controller.ts`:

```
GET  /api/v1/knowledge-base                       # KB 列表
GET  /api/v1/knowledge-base/:id                   # KB 详情
GET  /api/v1/knowledge-base/:id/stats             # 统计
POST /api/v1/knowledge-base                       # 建 KB
PATCH /api/v1/knowledge-base/:id                  # 改 KB metadata
DELETE /api/v1/knowledge-base/:id                 # 删 KB

POST /api/v1/knowledge-base/:id/sources           # 上传产品资料 (PDF/Word/txt/md)
GET  /api/v1/knowledge-base/:id/sources           # 资料列表
DELETE /api/v1/knowledge-base/:id/sources/:sourceId

GET  /api/v1/knowledge-base/:id/faqs              # FAQ 列表
POST /api/v1/knowledge-base/:id/faqs              # 单条新增
POST /api/v1/knowledge-base/:id/faqs/bulk         # 批量
POST /api/v1/knowledge-base/:id/faqs/generate     # AI 自动生成
POST /api/v1/knowledge-base/:id/faqs/approve-all-drafts
POST /api/v1/knowledge-base/:id/faqs/seed-common  # 灌 52 条 starter
POST /api/v1/knowledge-base/:id/faqs/customize-starter  # AI 优化 starter
PATCH /api/v1/knowledge-base/:id/faqs/:faqId      # 改单条
DELETE /api/v1/knowledge-base/:id/faqs/:faqId

GET  /api/v1/knowledge-base/:id/protected         # protected 字段 (产品 metadata)
POST /api/v1/knowledge-base/:id/protected         # 设
```

前端 UI: `packages/frontend/src/pages/reply/components/KnowledgeBasePanel.tsx` + `KbFaqTab.tsx`

### D28. FAQ 关键词 / 分类 / 优先级

| 字段 | 支持 |
|---|---|
| 关键词 (tags) | ✅ `tags: text[]` · 用作 starter FAQ 分类 (greeting/identity/handoff/price 等) |
| 分类 | ⚠️ 通过 tags 软实现 · 没有正式 category 字段 |
| 优先级 | ❌ 没显式 priority 列 · 但 starter='starter' 来源会被识别为系统兜底 |
| status | ✅ enabled/disabled/draft (draft 不参与匹配) |

### D29. FAQ 多语言

| 字段 | 状态 |
|---|---|
| 中文 | ✅ 全支持 (含简繁归一化, commit `4bab999`) |
| 英文 | ✅ 全支持 (Jaccard 按词切) |
| 马来文 | ⚠️ Jaccard 按拉丁词切勉强用 · 没专门做 stemming |
| 多语言 FAQ matching | ✅ 同语言 score×1.2 boost · 异语言 ×0.8 降权 (commit `65d4749`) |
| 简繁归一化 | ✅ 50 字内联映射 (妳→你 · 們→们 · 麼→么 等) |

### D30. 产品资料上传

**支持**: `POST /knowledge-base/:id/sources` · multipart/form-data:

| 格式 | 解析器 | 状态 |
|---|---|---|
| PDF | `pdf-parse v2.4.5` (PDFParse class) | ✅ (commit `9015f0b` 修了 v2 API 兼容) |
| Word .docx | `mammoth` | ✅ |
| txt | 直接读 | ✅ |
| md | 直接读 | ✅ |

文件: `packages/backend/src/modules/intelligent-reply/services/file-parser.service.ts`

### D31. 自动切分 / 索引

**有, 但是同步阻塞**:

1. 上传 source → `parseFile()` 拿到全文
2. `chunkText()` 切 · 默认 chunk_size=600 字符 · overlap=80
3. 每个 chunk 调 platform embed → 拿向量 (1024-dim)
4. 写 `knowledge_base_chunk` 表

如果 PDF 几百页 · embed 几千 chunks · API 限流可能跑几分钟阻塞 HTTP 请求.

文件: `packages/backend/src/modules/intelligent-reply/services/knowledge-base.service.ts` `addSourceAndChunk()`

### D32. AI 回答质量问题 (用户实测)

**当前最大表现**:

1. **8s 聚合窗合并多主题消息** → 答非所问 (B13 已述)
2. **chunks 内文跟客户用词不一致** → RAG 余弦低
   - 用户案例: KB 内文写 "Facebook Auto Bot" (旧名) · 客户问 "fahubx" (新名) · cosine < 0.45
   - 已加 KB pre-filter + LLM system prompt 别名提示 (commit `d140d48`)
3. **客户闲聊 (吃饱了吗 / 天气) 没专门处理** → 走 RAG 找产品资料找不到 → clarify
4. **简繁体差异** → "妳好" 不命中 starter "你好" (commit `4bab999` 已修)
5. **回复有时偏长** · max 200 字但 LLM 经常贴近上限
6. **不会主动收集 lead 信息** (没主动问姓名/公司/预算)
7. **没销售流程编排** · 答完一条客户问下一个不知道的, AI 又 clarify 一次, 体验循环

### D33. 真实客户问题 + Bot 当前回答

**截图 1 (60199341431, conv 3)** — 全部正常:
| 问 | 答 | 评 |
|---|---|---|
| "多少钱" | "请问您想了解 FAhubX、M33 Lotto Bot 还是 WAhubX 的价格呢? 告诉我具体产品..." | ✅ 通用 FAQ 反问哪个产品 |
| "fahubx 系统多少钱" | "您好, 感谢您对 FAhubX 自动养号系统的关注! 关于具体价格, 我需要请您留下联系方式..." | ✅ guardrail 不报价 + 引导留联系 |

**截图 2 (60186888168, conv 2)** — 第一条问题, 后面正常:
| 问 | 答 | 评 |
|---|---|---|
| "Hi/Hi/这个产品是什么名字/妳好" (8s 内 4 条) | "抱歉暂时查不到产品名称, 请问您能提供订单号或公司名吗?" | ❌ 4 条合并后 token 杂 → RAG 0.380 → clarify |
| "你好" | "你好呀! 欢迎来了解我们的产品 ~ 您想先看看 FAhubX、M33 Lotto Bot 还是 WAhubX 呢?" | ✅ 通用 FAQ score 1.0 |
| "我想了解 wahubx" | "您好! WAhubX 是专为马来西亚及东南亚华人圈打造的 WhatsApp 多账号自动化运营平台..." | ✅ kb=11 RAG 命中 |

**真实客户问题 (8:22 那条 audit)** — 已修:
| 问 | 旧答 (修前) | 新答 (修后) |
|---|---|---|
| "想多了解 fahubx 这个产品" | "抱歉, 我手上关于 fahubx 的资料不多" (clarify) | "您好! 感谢您对 FAhubX 自动养号系统的关注! 它是一套面向 Facebook 账号暖化与长期维护..." |

---

## E. 安全与边界控制

### E34. 禁止 100% / 保证 / 绝对

**有 · 两层**:

1. **System prompt 提示**:
   ```
   - 不承诺 "100%" / "保证" / "绝对"
   ```
2. **applyGuardrail 后处理** (兜底删):
   ```typescript
   out = out.replace(/100%|百分百|绝对|保证你|一定|绝不/g, '');
   ```

文件: `reply-executor.service.ts` line ~395

### E35. 敏感问题处理

**轻量** · 没专门 moderation:

1. tenant 可配 `blacklistKeywords` (注入 system prompt "禁止话题") — 但靠 LLM 自己遵守
2. Level 1 handoff 关键词 (投诉/律师/报警/骂)
3. ❌ 没违法/政治/赌博/成人内容主动检测
4. ❌ 没平台规避检测 (e.g. 防 LLM 教用户怎么用机器人逃过 WA 风控)

### E36. 编造价格 / 优惠 / 服务承诺

**有 guardrail 替换**:

```typescript
// 价格替换
out = out.replace(/(RM|MYR|\$|USD|¥|CNY|RMB)\s?\d+[\d,]*/gi, '具体价格请联系顾问');
```

System prompt:
```
- 不报具体价格数字 (若客户问价 · 引导留联系方式)
- 只根据"资料"内容回答, 不编造
```

但 LLM 仍可能编造资料里没的优惠 (e.g. "首月 7 天免费体验" — 这条 KB 里有, 但 LLM 也可能在不该说的时候说). 没 zero-tolerance 实施.

### E37. 资料库没答案时

走 `clarify_low_confidence` 路径 (C22 已述). LLM 主动追问 + 提示"回复人工".

### E38. 黑名单 / 风险词

**有, 弱**:
- `tenant_reply_settings.blacklist_keywords` (注入 system prompt)
- Level 1 / Level 2 handoff 关键词 (硬编码)
- ❌ 没真正的"禁止 LLM 输出某些词" 后置 filter
- ❌ 没竞品名称屏蔽 (e.g. 客户问 "这个比 X 公司好吗" · LLM 可能正面回应 X)

---

## F. 转人工与客服后台

### F39. 转人工通知渠道

**1 个**: SaaS 后台 takeover 页面 · 实时 WS 推

- 没接 Telegram / Email / SMS / 站外
- 操作员必须 login WAhubX 后台 + 打开 takeover 页

文件:
- `packages/backend/src/modules/takeover/takeover.gateway.ts` (WS)
- `packages/frontend/src/pages/TakeoverPage.tsx`

### F40. 人工客服回复方式

**SaaS 后台 + chrome screencast** (不用手机):

- 操作员前端 click [接管] → backend acquire takeoverLock
- 前端打开 CDP screencast viewer (实时 jpeg 流) · 1280×800
- 操作员在前端用鼠标键盘操作 chrome (event 转 CDP `Input.dispatchMouseEvent` / `dispatchKeyEvent`)
- 操作员是用电脑前端**间接操作**客服号那个 chrome 浏览器
- 不是直接用手机 WhatsApp

### F41. 人工接管 AI 是否暂停

**部分**:

- ✅ ConversationStage='HumanTakeover' → reply-executor.handle 开头 return
- ❌ takeoverLock 接管整个 slot · 但 AI 不检查 takeoverActive (用户拍板不修)
- 操作员需要在前端把 conv 手动 mark 'HumanTakeover' 才停 AI · 否则 AI 继续答

恢复:
- 30min idle (TakeoverLock idle timer · 28min 警告 / 30min 自动释放)
- 操作员手动点 [释放]
- 关 tab/窗口 (10s grace · disconnect timer)

### F42. Conversation Status

**枚举**: `customer_conversation.stage`

```typescript
enum ConversationStage {
  New = 'new',                       // 新对话, AI 接手
  Interested = 'interested',         // LLM 判 intent=interested
  HotLead = 'hot_lead',              // LLM 判 intent=buying
  HandoffRequired = 'handoff_required', // 自动 / 客户主动转人工 · AI 暂停
  HumanTakeover = 'human_takeover',  // 操作员真接管 · AI 暂停
  Closed = 'closed',                 // 对话结束
  DoNotReply = 'do_not_reply',       // 黑名单, 永远不答
}
```

### F43. 客户资料

**有**: 两张表

1. `wa_contact` — 单 WA 联系人 (per slot)
   - account_id / remote_jid / display_name / last_message_at
2. `customer_conversation` — 业务对话维度 (聚合多条 inbound/outbound)
   - tenant_id / slot_id / phone_e164 / kb_id (产品归因) / stage
   - last_inbound_at / last_ai_reply_at / ai_reply_count_24h
   - last_campaign_target_id (campaign 来源归因)
   - opened_at / closed_at

**前端**: takeover 页面右侧客户档案区 (见 `TakeoverPage.tsx` 块 D)

---

## G. 日志、监控与调试

### G44. AI 回复日志

**全有 · 表 `ai_reply_audit`**:

```
id / tenant_id / conversation_id / created_at
mode (faq/ai/handoff/skipped)
kb_id / matched_faq_id / matched_chunk_ids (int[])
confidence (decimal 0-1)
model (LLM 模型名)
intent (curious/interested/buying/complaint/handoff/clarify_low_confidence/system_notice_*)
handoff_triggered (bool)
reply_text (实际发送内容)
sent_message_id (sendText 返的 pseudoMessageId)
draft (bool · 没真发)
cost_tokens_in / cost_tokens_out
```

但**不存 prompt 全文** (system + user prompt 没单独存) · 调试时只能从 stage + reply_text 反推.

### G45. AI 失败原因记录

**部分**: ai-text.service.ts 调 LLM 失败时返:
```typescript
{ ok: false, errorCode: 'NO_PROVIDER' | 'TIMEOUT' | 'RATE_LIMIT' | 'API_ERROR', errorMessage: string }
```

reply-executor 收到 errorCode=NO_PROVIDER · markHandoff('租户未配置 AI'). 其他 errorCode · markHandoff(`LLM 失败: ${errorCode}`).

但**不存 errorCode/errorMessage 到 audit 表** · 只 logger.warn · 没结构化告警.

### G46. WhatsApp 发送状态

| 状态 | 记录方式 |
|---|---|
| 单勾 (sent) | runtime log + `chat_message.wa_message_id` 写入 |
| 双勾 (delivered) | ❌ 没追踪 (老逻辑 Codex 锁: 不做"等已送达" 二次确认) |
| 蓝勾 (read) | ❌ 没追踪 |
| 失败 (input 没清空) | runtime log · backend SlotsService.sendText 抛 throw · audit `sent_message_id=null` |
| unconfirmed (单勾没出但 input 清了) | runtime log · ok=true unconfirmed=true · audit 仍写 sent_message_id |

### G47. Dashboard

**有, 部分**:

- `/api/v1/slots` · 槽位状态 (online/offline/role/phoneNumber)
- 前端 `SlotsPage.tsx` 显示
- ❌ 没"今日消息量 / 转人工量 / AI 失败量" dashboard
- ❌ 没"客服号 always-on 状态红绿灯"
- ❌ 没"24h 内 AI 回复 vs handoff 比例"

### G48. 错误报警

| 类型 | 状态 |
|---|---|
| Worker crash | ✅ pino log + C1 auto-respawn (但没外部告警) |
| Session logout (wa-logged-out) | ✅ runtime emit + backend log + 客服号自愈 (commit `bdff134`) · 但前端不主动通知 |
| AI API error | ⚠️ logger.warn · 没站内/外通知 |
| Queue 堵塞 | ❌ 没监控 (因为没有外部 queue) |
| Inbound watcher 假死 | ✅ 30s healthcheck (commit `4da334a`) |

---

## H. 多语言与销售流程

### H49. 支持语言

| 语言 | starter FAQ | RAG 答 (LLM 多语) | UI |
|---|---|---|---|
| 中文 (简体) | ✅ ~30 条 | ✅ | ✅ |
| 中文 (繁体) | ⚠️ 通过简繁归一化 (commit `4bab999`) | ✅ (LLM 自适应) | ❌ |
| 英文 | ✅ ~15 条 | ✅ | ❌ (UI 全中文) |
| 马来文 | ❌ | ⚠️ (LLM 可能能答, 但没 starter) | ❌ |

V1 锁定中文单语言 UI · M1 启动决策.

### H50. 中英马混合提问

**LLM 能 handle** (DeepSeek/Claude/GPT 都多语). 但:
- FAQ Jaccard 命中率低 (跨语言 token 不重)
- 客户用 "saya nak tahu fahubx ni" (马来) · FAQ 不命中 · 走 RAG · 大概率 cosine 低 · clarify
- 没 lang-detect 路由

### H51. 销售流程

❌ **没显式编排** · 全靠 LLM 即兴.

理想:
1. 客户问候 → AI 自我介绍 + 询问需求
2. AI 主动询问业务规模 (账号数, 用途, 预算)
3. 推荐方案 (Basic 10 / Pro 30 / Enterprise 50)
4. 确认意向 → 转销售收集联系方式

实际:
- 走 FAQ + RAG 各打各的 · 客户引导路径不连贯
- 客户主动问 "多少钱" 才进入价格引导 (FAQ 命中 "多少钱" → 反问产品)
- 客户问 "我有 30 个号怎么搞" · 没专门套餐推荐流程 · 走 RAG 看资料里有没有提到 30 号

### H52. Lead Collection

❌ **没**.
- 没主动收集表单
- 没在 chat_message / customer_conversation 之外的"客户档案"表
- 客户留下的信息 (手机/email/公司) 散在 chat_message · 没结构化抽取

### H53. 套餐 / 报价资料

**部分**:
- 产品 KB 文档里 (PDF/Word) **可能有** 套餐描述 · 取决于用户上传什么
- 没单独"pricing" 表 / 不在代码 / 不在数据库 schema 里
- 系统硬编码套餐限制: Basic 10 / Pro 30 / Enterprise 50 (`packages/backend/src/common/plan.ts`)
  - 这是用来限制 tenant 能开多少 slot · 不是给客户看的报价
- 价格被 guardrail 强制替换为 "具体价格请联系顾问"

### H54. Bot 主动推荐方案

❌ **没**. 全靠 LLM 看 RAG 资料临场回答.

理想 (V2):
- 客户问 "新号怎么搞" → KB 自动检 P1+P2 段 → 答推荐 P1+P2
- 客户说 "我有 14 天的成熟号了" → 自动推 P3
- 这要在 KB 加 "intent → 推荐路径" 元数据 · 当前 schema 没.

---

## I. 当前代码与部署

### I55. 后端技术栈

- **NestJS 10** + TypeScript strict
- TypeORM (Postgres)
- pino (logger)
- bcryptjs round=12 (密码)
- JWT 双 token (access 15m / refresh 7d)
- 启动: `pnpm --filter @wahubx/backend run dev` (`nest start --watch`)
- 端口: 9700 (`/api/v1/*`)
- WS bridge: 9711 (`/runtime`)

文件: `packages/backend/`

### I56. 前端技术栈

- **React 18** + Vite 5
- antd 5 (UI 库)
- 品牌绿 #25d366
- TypeScript strict
- 启动: `pnpm --filter @wahubx/frontend run dev`
- 端口: 5173

文件: `packages/frontend/`

### I57. 数据库

- **PostgreSQL 16** (Docker 本地 5434)
- Container: `wahubx-dev-pg` · user `wahubx` / pass `wahubx` / db `wahubx`
- 没用 pgvector (RAG 走应用层 cosine)
- M10 计划支持 SQLite (本地部署小用户)

### I58. 队列 / 缓存

- **Postgres 当队列** (`pending_inbound` 8s 聚合 buffer · `task_run` 广告任务)
- **Redis 6381** (Docker · 但目前**只用作 dispatcher 心跳锁**, 不当 queue)
- 没 BullMQ / RabbitMQ
- 没 Redis 缓存 (KB / FAQ 都直接打 Postgres)

### I59. 部署

**当前 (开发期)**: 本地 Docker + pnpm dev

**计划 (产品期)**: 单机本地桌面应用 (Inno Setup 打包)
- 客户买 license · 在自己电脑跑 (单 tenant)
- VPS 只做 license 发放 + 升级分发
- M1 决策: 不做 SaaS 中央部署

### I60. 核心模块路径

```
packages/runtime-chromium/
  src/index.ts                          # WhatsApp session worker (主入口)
  src/wa-web/
    inbound-watcher.ts                  # message listener (DOM observer)
    chat-reader.ts                      # 高保真消息读取
    actions.ts                          # send-text / send-media / openChat
    wa-web-selectors.ts                 # 集中所有 DOM selector

packages/backend/src/modules/
  intelligent-reply/
    services/
      auto-reply-decider.service.ts     # 11 闸门决策流水 + 8s 聚合
      reply-executor.service.ts         # FAQ + RAG + LLM 调 (核心)
      tenant-reply-settings.service.ts  # 租户 reply 配置
      knowledge-base.service.ts         # KB / FAQ CRUD + AI 优化
      file-parser.service.ts            # PDF/Word/txt/md 解析
      platform-ai.service.ts            # embedding (平台兜底)
    controllers/
      knowledge-base.controller.ts      # KB API
      tenant-reply-settings.controller.ts
      conversations.controller.ts
    entities/
      customer-conversation.entity.ts   # ConversationStage enum 定义在这
      knowledge-base.entity.ts
      kb-faq.entity.ts
      kb-chunk.entity.ts
      ai-reply-audit.entity.ts
    data/
      starter-common-faq.ts             # 52 条 V1 starter

  ai/
    ai-text.service.ts                  # 租户 LLM 调用 facade
    ai-provider.entity.ts               # 支持 openai/deepseek/claude/gemini
    adapters/                           # 各 provider 实现

  slots/
    slots.service.ts                    # send-text/send-media facade · message-upsert handler
    account-slot.entity.ts              # AccountSlotRole (customer_service / broadcast)

  takeover/
    takeover-lock.service.ts            # 接管锁状态机
    takeover.gateway.ts                 # WS 推 screencast frame
    takeover.controller.ts

  runtime-bridge/
    runtime-bridge.service.ts           # backend ↔ runtime WS server
  runtime-process/
    runtime-process-manager.service.ts  # spawn child runtime process · auto-respawn

  messaging/
    messaging-persistence.service.ts    # chat_message + wa_contact upsert

packages/shared/src/
  runtime-protocol.ts                   # WS 协议 v1 + RuntimeCommand/RuntimeEvent
```

---

## J. 总结

### J61. 已完成

✅ **基础架构**:
- Chromium per-slot · 物理隔离 · 反检测 (UA/locale/timezone/stealth)
- WS bridge 双向 · WS protocol v1
- C1 auto-respawn + wa-logged-out 自愈 + chat-list watchdog
- D12-3 auto-spawn 客服号优先

✅ **消息流水**:
- inbound watcher (MutationObserver + 5s poll + 30s healthcheck reload 自救)
- 8s 聚合窗 + pending_inbound buffer
- 11 闸门决策 (基础过滤 / role / stage / mode / 频率 / 夜间 / handoff 关键词)
- send-text mutex + 动态 timeout + Escape 返 chat-list

✅ **AI 客服**:
- 双层 KB Fallback (产品 KB → 通用 KB)
- 跨多产品 KB FAQ + RAG (conv 没归因时自动跨)
- 产品名 keyword pre-filter (锁 KB)
- KB pre-filter 命中绕过 RAG 低分 clarify (commit `d140d48`)
- LLM system prompt 别名提示 (chunks 旧名 vs 客户新名)
- 简繁体单字归一化 (commit `4bab999`)
- 多语言 FAQ matching boost (zh/en 同语言 ×1.2)
- Guardrail (限长 / 删 100% / 替换价格)
- Handoff 自救 (客户在 handoff 状态再发补一次 ack + 5min 超时通知)

✅ **数据**:
- 52 条通用 starter FAQ (问候/身份/转人工/价格 fallback)
- AI 自动生成 FAQ 流程
- AI 优化 starter (用 tenant 上下文重写)
- PDF/Word/txt/md 解析 + chunking + 平台 embed

✅ **后台**:
- KB / FAQ / source 完整 CRUD
- Reply Setup Wizard (5 步引导)
- 租户级 reply settings (mode/blacklist/handoff keywords/quiet hours/daily limit/default KB)

### J62. 最大技术问题

1. **WA Web DOM 漂移** · 是定时炸弹 · WA 改一次前端我们就要追改 selectors. 已有 healthcheck 自救, 但 selector 失配时业务就停.

2. **AI 调用同步阻塞 listener** · 50+ conv 并发会打死 LLM API · 没排队. 真上线必须加 worker queue (BullMQ).

3. **没 WA Web 真消息 ID** · 用 `local-<ts>-<rand>` 当 pseudoMessageId · 双勾/已读/失败追踪都不准.

4. **8s 聚合窗合并多主题** · 实测翻车 (用户截图 2 第一条) · 但短了又会拆.

### J63. 最影响 AI 回答质量的原因

按权重:

1. **KB 内文跟客户用词不一致** (40%): 旧产品名 / 行业术语 / 客户用昵称 → 余弦低
   - 修方向: KB 加 alias 元数据 + LLM prompt 提示别名 (已部分修)
2. **8s 聚合窗合并多主题** (20%): 客户连发 4 条主题不同 → 答非所问
3. **没 intent 路由 / 销售流程编排** (15%): 全靠 LLM 即兴 · 不连贯
4. **客户闲聊没专门处理** (10%): 走产品 KB 找不到 → clarify
5. **System prompt 不够强** (10%): 只让 LLM "友善简洁", 没引导主动收集 lead
6. **没 chat history 当 LLM context** (5%): 每条独立答, 不知道 5 分钟前说过什么

### J64. 优先改 5 个地方

按 ROI 倒序:

1. **AI 异步 worker** (BullMQ + Redis): 解决 50+ conv 并发 LLM 限流问题. 必须 V1 上线前做.
2. **chat history 当 context** 喂 LLM: 拿最近 5-10 条 in/out 给 LLM 当对话上下文. 显著提升连贯性. 改 reply-executor 不到 30 行.
3. **KB alias 元数据** (kb.aliases text[]): 每 KB 配 ["fahubx", "Facebook Auto Bot", "FAhubX 系统"]. 客户问任一 alias 都能命中. 替代当前 keyword pre-filter normalize 的脆弱方式.
4. **lead collection 强引导** · system prompt 加 "客户表现兴趣时 · 引导留 WhatsApp 号 / 公司名 / 账号需求量 · 三选一". 改 prompt 不到 5 行.
5. **客服号在线 dashboard** · 前端加红绿灯 + WS 实时心跳显示. 用户能看到客服号是不是真在跑. 用户已多次强调 "客服号必须 24h online".

### J65. 高风险改动

⚠️ **下面这些改要慎重**:

1. **碰 8s 聚合窗** · 改短客户体验更差, 改长更糟. 当前 trade-off 是测过的.
2. **碰 WA Web DOM selector** · 跟 WA 版本绑死, 改一次必须真号实测过 (本次 commit `65d4749` 就是 Codex 实测后才敢改).
3. **碰 sendText hard timeout / mutex** · 之前踩过 race · inner promise 在 timeout 后 settle · mutex 不放导致下条卡死. 现状 `withSendMutexAndHardTimeout` 是反复迭代后稳的.
4. **碰 puppeteer launch args** · 反检测三件套 (UA/locale/timezone) 全栈联动 · 改一处可能让 WA 直接踢号.
5. **碰 takeoverLock 状态机** · M9 设计了 acquire/release/hardKill/heartbeat/disconnect grace · 改 timer 顺序容易锁不释放.

### J66. 离稳定可卖版本还缺

**P0 (必须有)**:
- [ ] AI 异步 queue (BullMQ + Redis)
- [ ] chat history 当 LLM context (提升连贯性)
- [ ] 客服号在线 dashboard (红绿灯 + 实时心跳)
- [ ] 站外告警 (Telegram/Email): wa-logged-out / runtime crash / quarantine 都得能 push 给运维
- [ ] Lead collection 表 + 销售流程显式编排
- [ ] 50 号 24h soak 测试 (压力)

**P1 (强烈建议)**:
- [ ] KB alias 元数据 (替代脆弱 keyword pre-filter)
- [ ] pgvector (chunks 上 10k 后 cosine 全表扫扛不住)
- [ ] AI prompt 全文存 audit (调试关键)
- [ ] 转人工通知 (Telegram bot · 操作员手机收推送)
- [ ] 接管 vs AI 互斥锁 (per-conv 而非 per-slot · 当前用户拒绝修, 但生产场景必须)
- [ ] 报错码体系 (errorCode 入 audit · 不只 logger.warn)

**P2 (可选)**:
- [ ] OpenCC 全字符简繁
- [ ] 马来文 starter FAQ + lang detect
- [ ] AI 主动 follow-up (客户 1h 没回 · AI 主动推一条 "上次的问题需要继续吗")
- [ ] 套餐报价单独 schema (不靠 LLM 即兴)
- [ ] 客户标签 / 分群

---

## 今晚 commit 历史 (今天的核心修复)

```
4bab999 FAQ 加简繁体单字归一化 · 妳好/您好/咩/這 不再翻车
9015f0b pdf-parse v2 API 兼容 (修 'pdfParse is not a function')
bdff134 客服号 24h online 保障 · auto-spawn 优先 + wa-logged-out 自愈
d140d48 KB pre-filter 命中时绕过 RAG 低分 clarify · 加产品别名提示
c7bcd4c 取消 RAG 中区强制 handoff + 加产品名 keyword pre-filter
7c12f0d conv 没绑产品 KB 时, 跨 tenant 所有产品 KB 检索 (修"资料不全"误判)
4da334a watcher reload 自救 + sendText unconfirmed 改 fail-on-input-not-cleared
65d4749 Codex 执行单 P0+D-H · WA Web DOM 漂移修 + 客服质量补强 (9 文件 992+/431-)
2dd2cd8 客服质量审计修 4 项 · 时时刻刻响应不再静默
8acfd77 限速放宽 · 30min→3s + 24h cap 3→30 (turn-by-turn 客服可用)
```

---

文档版本: 1.0
最后更新: 2026-04-28 21:25 PM (UTC+8)
