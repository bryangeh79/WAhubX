# 08 · P0.11 高保真 inbound 重做 · 战前拆解

> **状态**: 拆解完毕 · 等明天集中实现
> **代价估**: 4-6h 主实现 + 1-2h 集成测试
> **优先级**: 完成 P0.7 / P0.9 / P0.10 后的最后一项 P0
> **执行**: 明天白天集中跑 · 不夜战

---

## 1. 痛点 · 当前 D10 inbound watcher 的 4 个局限

`packages/runtime-chromium/src/wa-web/inbound-watcher.ts` 当前实装:
- MutationObserver 监听 chat-list pane (`[data-testid="chat-list"]` / `#pane-side`)
- attributeFilter: `['aria-label', 'data-id', 'class']`
- childList + subtree
- 命中 row 后 extractHint: 抽 preview 截断 / unread badge / lastMessagePreview / 试 phone 从 aria-label

| 局限 | 现象 |
|------|------|
| **L1 已存在 row 内容更新不 fire** | row attributes 不变 · 只 textContent 变 → MutationObserver 静默 |
| **L2 chrome 后台 / minimized 减载** | renderer thread 减优先级 · MutationObserver 延迟或丢 |
| **L3 virtual list 滚出视图丢 DOM** | WA Web 长 chat-list 用虚拟滚动 · 不在视口的 row 不在 DOM · 来消息不进 list 顶端 = 不 fire |
| **L4 hint 内容低保真** | 抓的是 chat-list row 截断预览 · 不是消息原文 · 没 sender / 没 timestamp / 没 messageId |

加上 D11 设计层的 broadcast role gate (设计 · 不是 bug · 留): broadcast inbound 即使 fire 也丢.

→ 综合 = 仅 CS 号收消息有"业务级感知" · 而且**保真度极低** · AI / takeover 都看不到完整流.

---

## 2. 新架构 · 6 阶段流程

```
┌─────────────────────────────────────────────────────────────────┐
│  Phase A · TRIGGER  ──────────────────────────────────────────  │
│   保留老 MutationObserver (任何变化都触发)                       │
│   + 加 polling fallback (10s 周期扫 chat-list 的 row state)      │
│   ↓ 检测到任何 chat row "状态变化" 候选                           │
│                                                                  │
│  Phase B · LOCK  ─────────────────────────────────────────────  │
│   排队进 mutex (per-page · 防多 row 并发触发互殴)                 │
│   节流: 同 chat 30s 内只进 1 次                                  │
│                                                                  │
│  Phase C · ENTER CHAT  ───────────────────────────────────────  │
│   click row → 等 chat detail pane 出现 (header / message list)  │
│   超时 5s · 失败放 mutex 走                                      │
│                                                                  │
│  Phase D · EXTRACT  ──────────────────────────────────────────  │
│   读 chat header: 对方 phone / displayName / wid                 │
│   读 message list: 最近 N 条 (默认 5) · 每条:                     │
│     - direction (in/out · 看 message bubble 颜色 / data-pre-plain) │
│     - text                                                       │
│     - timestamp                                                  │
│     - msgKeyId (data-id 属性 · WA 真 messageId)                  │
│                                                                  │
│  Phase E · EXIT  ─────────────────────────────────────────────  │
│   ESC / 点 chat-list / 点 close icon · 回 chat-list              │
│   等 chat-list pane 重出现 · 确认状态                            │
│                                                                  │
│  Phase F · EMIT + RELEASE  ──────────────────────────────────  │
│   推 message-upsert event (包含 N 条真消息 · 高保真 schema)      │
│   释放 mutex                                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 各阶段输入输出 + 失败回退

| Phase | Input | Output | 失败回退 |
|-------|-------|--------|----------|
| A trigger | DOM mutation 或 10s tick | 候选 chat selector | 无 (跑下一 tick) |
| B lock | 候选 row | 拿 mutex 或排队 | mutex busy → 等 5s · 仍 busy 跳 |
| C enter | row element | chat detail visible | 5s 超时 → release mutex · log warn |
| D extract | chat detail DOM | 高保真 messages array | extract fail → emit 至少 chat-level hint (老 watcher fallback) |
| E exit | chat detail | chat-list visible | 5s 超时 → 强 ESC + reload page (last resort) |
| F emit | messages array | event 出 + mutex 释放 | event emit 永不 fail (本地 in-process) |

---

## 3. Selector Inventory · 进 chat / 读消息 / 退 chat

### 3.1 已知锚点 (从 wa-web-selectors.ts · 当前文件)

```
chatList:           [data-testid="chat-list"] / #pane-side / div[role="grid"][aria-label*="Chat"]
messageInput:       div[contenteditable="true"][data-tab="10"] / role="textbox"
sendButton:         button[data-tab="11"] / span[data-icon="send"]
messageStatusTick:  span[data-icon="msg-check"] / msg-time / msg-dblcheck
```

### 3.2 P0.11 待加新锚点 (基于 WA Web 公开 reverse-engineering 知识 · 不试错 · 多 fallback)

#### Chat row in chat-list pane (Phase A → C 用)
```
chatListRow:                # 单条 chat 行 (虚拟 list 的 listitem)
  - 'div[role="listitem"]'
  - 'div[data-testid="cell-frame-container"]'    # WA 自带 testid
  - 'div[data-testid*="cell"]'

chatRowDataId:              # row 上 data-id attribute 一般含 jid 形态
  - '[data-id*="@c.us"]'
  - '[data-id*="@s.whatsapp.net"]'
  - '[data-id*="@lid"]'

chatRowUnreadBadge:         # 未读 badge (老 watcher 已用)
  - 'span[aria-label*="unread"]'
  - 'span[data-testid="icon-unread-count"]'
  - 'span[role="status"]'
```

#### Chat detail header (Phase D 用 · 拿对方身份)
```
chatHeader:                 # 进 chat 后顶部 header
  - 'header[data-testid="conversation-header"]'
  - 'header[data-testid*="header"]'
  - 'div[data-testid="conversation-info-header"]'
  - 'header'                                       # 兜底

chatHeaderTitle:            # 对方显示名 (saved contact name 或 phone)
  - 'header [data-testid="conversation-info-header-chat-title"]'
  - 'header span[dir="auto"][title]'
  - 'header span[dir="auto"]:first-of-type'

chatHeaderSubtitle:         # 对方"在线/最后上线" 或 phone 备份
  - 'header [data-testid*="subtitle"]'
  - 'header span[title]:not([data-testid*="title"])'
```

#### Message list & bubbles (Phase D 核心)
```
messageList:                # 消息列表容器
  - 'div[data-testid="conversation-panel-messages"]'
  - 'div[role="application"]'
  - '#main div[role="region"]'

messageBubble:              # 单条消息 bubble · 含 in/out 区分
  - 'div[data-testid*="msg-container"]'
  - 'div[data-id]:not([role="listitem"])'         # data-id 在 message 上 = WA messageKeyId
  - 'div[role="row"]'

messageBubbleIn:            # in (对方发) · 通常左侧 / 颜色不同
  - 'div.message-in'
  - 'div[class*="message-in"]'
  - 'div[data-testid*="msg-container"][data-id*="false_"]'  # data-id 含 'false_' = 对方
  
messageBubbleOut:           # out (我方发)
  - 'div.message-out'
  - 'div[class*="message-out"]'
  - 'div[data-testid*="msg-container"][data-id*="true_"]'   # data-id 含 'true_' = 自己

messageDataId:              # 消息 dataId · 形如 "false_60186888168@c.us_3EB0...HASH"
  attr: 'data-id'           # 直接读

messageText:                # 消息文本内容
  - 'div[data-testid="msg-text"]'
  - 'span.selectable-text'                        # 老版
  - 'span[class*="selectable-text"]'              # 新版 emotion fragment

messageTimestamp:           # 消息发送时间 (本地)
  - 'div[data-testid="msg-meta"] span'
  - 'span[data-testid*="meta"]'
  - 'span[class*="message-time"]'

messageDataPrePlainText:    # 消息 bubble 上的 'data-pre-plain-text' 属性
  attr: 'data-pre-plain-text'
  format: '[HH:MM, DD/MM/YYYY] DisplayName: '     # WA 标准格式 · 含 sender · 用来兜底 sender
```

#### Exit chat (Phase E 用)
```
chatBackButton:             # 返回 chat-list 按钮 (移动 / narrow viewport)
  - 'button[aria-label*="Back"]'
  - 'span[data-icon="back"]'

chatCloseButton:            # 关闭 chat (大 viewport)
  - 'button[aria-label*="Close"]'
  - 'span[data-icon="x"]'

# 兜底: 直接 keyboard ESC · WA Web 一般会响应
escFallback: page.keyboard.press('Escape')
```

#### Read receipt control (P0.11 不做 · 留 D12+ · 这里只列范围)
```
markAsReadToggle:           # WA Web 没有真"标已读" 按钮 · 进 chat 自动标
                            # P0.11 默认: 进 chat = 标已读 (无法避免 · 接受 trade-off)
                            # 例外: 长按 row → "Mark as unread" → 但需 puppeteer hover + 上下文菜单 · 复杂
                            # 决策: P0.11 不做"读完保留未读" · D12+ 评估
```

---

## 4. 验收标准 · P0.11 通过条件

```
┌─ AC1 · 高保真 ────────────────────────────
│  外号给 CS 号发一条文本 "hello world"
│  → DB chat_message 出现一行:
│     direction='in'
│     content='hello world'              ← 原文 · 不再是截断 preview
│     wa_message_id='false_<phone>@c.us_<HASH>'  ← 真 WA messageId
│     contact_id 指向真 phone (不是 synthetic JID)
└─

┌─ AC2 · sender 真号 ──────────────────────
│  wa_contact 行:
│     remote_jid='<phone>@s.whatsapp.net' (真号)
│     display_name=对方 saved name 或 push name (不是消息文本)
│  → 不再创 synthetic-XXX@local.synthetic
└─

┌─ AC3 · 不污染 ──────────────────────────
│  同对方连发 5 条不同消息
│  → wa_contact 仍是 1 行 (同 jid)
│  → chat_message 5 行 (5 个不同 wa_message_id)
└─

┌─ AC4 · 入站去重 ─────────────────────────
│  P0.11 watcher 二次进同 chat (节流没生效)
│  → 看到相同 wa_message_id · 不重复 INSERT (用 UNIQUE 约束 或 应用层 dedup)
└─

┌─ AC5 · 不影响 outbound ──────────────────
│  P0.11 启用后 · sendText/sendMedia 仍正常
│  → task #55 类 script_chat 仍能跑通 12 turns
│  → 不出现 chat-list 锁住或 page 崩溃
└─
```

**任一不达 → P0.11 不通过 · 不 ship**.

---

## 5. 明天执行顺序 · 4 phase

```
P0.11-1 · 进入 chat + 读最近一条真消息 (1.5h)
─────────────────────────────────────────
1. inbound-watcher.ts 改: MutationObserver 触发后不再 emit · 改放 candidate queue
2. 新模块 chat-reader.ts:
   - enterChat(rowEl): click row · 等 messageList 出现
   - readLatestMessages(N=5): 扫 messageBubble · 提 dataId / direction / text / timestamp
   - exitChat(): ESC / back / close · 等 chatList 重出现
3. 实测: 单条文本进 / 拿到原文 / 退出 / 不 crash
   ✓ Pass condition: log 出 "P0.11 read N msgs" · DB 有真 wa_message_id

P0.11-2 · 落库替换 preview path (1h)
─────────────────────────────────────────
1. backend SlotsService.onChromiumMessageUpsert 接受新 schema:
   { messages: [{ waMessageId, direction, text, timestamp, senderJid, senderDisplay }] }
2. 替老 hint persist 路径 · 用真 wa_message_id 当 chat_message.wa_message_id
3. wa_contact upsert 用真 phone (从 senderJid 提)
4. 老 hint 路径保留 (作 fallback · enter chat 失败时还能记账)
   ✓ Pass condition: AC1+AC2+AC3 都过

P0.11-3 · 节流 + 回退 chat (1h)
─────────────────────────────────────────
1. 加 mutex per-page · 同时只 1 个 chat 在被读
2. 同 chat dedupe key = wa_message_id 60s 窗口
3. 多 candidate 排队 · 不并发进 chat
4. 失败 chat 退出: ESC 5s 超时 → log + 不重试
   ✓ Pass condition: 连发 3 条不同 chat 消息 · 顺序入库 · 不互殴

P0.11-4 · takeover/AI 互斥联动 (1.5h)
─────────────────────────────────────────
1. 加 takeover lock 检查: chat enter 前问 takeover-lock.service 该 chat 是否已被人接管
2. 已接管 · 跳进 chat (操作员在用真 chrome 窗口) · 仅 emit "外部 inbound · 操作员处理"
3. 没接管 · 正常进 chat 读 · 触发 auto-reply-decider (AI)
4. AI 决定回复 · 同样经 mutex (送 sendText 时 page 已退出 chat · 重新点 row · 简单复用现有 sendText 路径)
   ✓ Pass condition: 接管期间 P0.11 不 enter chat · 释放期间正常运作
```

**总估**: 5h · 最坏 6h · 真出现 selector 大量不命中再 +1-2h 试错.

**止损点**:
- P0.11-1 失败 (无法稳定 enter/exit chat) → 停 · 接受现状 · 收口为残项 R10 · 不 ship
- P0.11-2 部分通过 (entry/exit OK · 但消息抽取漏字段) → 部分 ship · selector 留待版本更新跟进

---

## 6. 风险 + 应急

| 风险 | 概率 | 应急 |
|------|------|------|
| WA Web DOM 大版本更新 · selectors 全部失效 | 低 | 文档化 selector inventory · 加 capture-evidence · 失败时手动审 |
| enter chat 自动标已读 · 影响业务 | 中 | 接受 · D12+ 评估 long-press unread |
| 多 slot 同时受触发 · page 互殴 | 低 (per-runtime mutex 保护) | mutex 已设计 · 失败回退 chat-list reset |
| 接管 lock 跟 P0.11 watcher 互殴 | 中 | P0.11-4 互斥联动 · 已纳入 |
| 真消息体含 emoji / 多媒体 / 引用 / 撤回 · 不在 P0.11 范围 | 中 | P0.11 只读文本 · 媒体显占位符 "[image]" / "[file]" · D11+ 扩 |

---

## 7. 不做 (显式) · P0.11 范围严格锁

- ❌ 真"读完保留未读" (long-press unread) · 留 D12+
- ❌ 媒体消息 (image/voice) 内容真读取 · 占位符即可
- ❌ 撤回消息 / 编辑消息 · 不处理
- ❌ 群消息 · 单聊先通 · 群留 M11
- ❌ 标星 / 转发 · 不做
- ❌ AI 主动开新对话 · auto-reply 是被动响应

---

## 8. 收口验证脚本 (明天用)

```bash
# 跑完 P0.11-4 后:

# 1. 用真号给 CS slot (60186888168) 发 3 条不同文本
#    "test inbound 1" / "test inbound 2 with emoji 🎉" / "test inbound 3 special@chars"

# 2. 验 DB:
docker exec wahubx-dev-pg psql -U wahubx -d wahubx -c "
  SELECT direction, content, wa_message_id, contact_id 
  FROM chat_message 
  WHERE direction='in' 
  ORDER BY id DESC LIMIT 3;
"
#    期望:
#    - 3 行 · content 全是原文 · wa_message_id 都不同 · 都包含 'false_' + jid 形态
#    - contact_id 都指向同一 wa_contact 行

# 3. 验 wa_contact:
docker exec wahubx-dev-pg psql -U wahubx -d wahubx -c "
  SELECT remote_jid, display_name FROM wa_contact 
  WHERE remote_jid LIKE '%@s.whatsapp.net' 
  ORDER BY id DESC;
"
#    期望: 真 jid · 不再有 synthetic-XXX@local.synthetic

# 4. 验 takeover 互斥:
#    a. 在 5173 接管页点 "打开 WA Web 窗口" (P0.10)
#    b. 操作员在那真 chrome 窗口里点对方 chat
#    c. 这时外号再发一条 → P0.11 不 enter chat (已被人占)
#    d. 操作员退出接管 → 下条入站 P0.11 正常进 chat 读

# 5. 验 script_chat 不破:
#    a. 创 task slot 2 → slot 3
#    b. 期望 12 turns 全过 (跟 task #55 一样)
```

---

## 9. 当天 (2026-04-26 凌晨) 拆解结果总结

- **拆解完毕**: 6 phase · 5h 估时 · 5 项验收标准 · 4 个 风险应急
- **不写代码** · 等明天集中开干
- **明天开工 first task**: P0.11-1 · 写 chat-reader.ts · 实装 enterChat / readLatestMessages / exitChat 三个 function

明天直接照本执行 · 不再讨论方案.
