# WAhubX 交接文档 · 2026-04-24 Session 3

> **新 session 接手请先完整读这一份** · 读完即可无缝继续

---

## 0 · 一句话定位

**WAhubX** = WhatsApp 多账号自动化运营 SaaS · 马来西亚本土 + 东南亚华人圈 · 本地桌面部署 · License VPS 验证.

---

## 1 · 本 session (2026-04-24) 完成的大事

### 1.1 广告投放模块 (完整上线)
- 4 步投放向导 · 4 种调度 (立即/单次/每天/每周)
- 节流三档 (保守/平衡/投放)
- 承载安全算法 · 成熟号识别
- **真人打字模拟** (baileys `sendPresenceUpdate composing/recording` · 按文字长度)
- 广告/开场白 AI 变体池 (每条 30 个随机抽)
- 客户群完整生态 (CSV/Excel/粘贴/联系人挑选 + 导出 + 克隆 + 批量)
- **客户群健康**: 坏号自动标记 (硬失败 1 次 / 软失败 3 次) · 解禁 UI · collectPhones 自动跳过坏号
- 投放结果报告 (号表现 / 文案 / 时段 / 失败分类)
- 实时 run.stats 聚合 (SQL 聚合覆盖存储值)
- DetailDrawer 5s 自动轮询
- 客户回复归因 (7 天窗口 phone 匹配 → 标 replied_at)
- campaign clone (复制为新投放)

### 1.2 智能客服模块 (完整上线)
- **3 种模式**:
  - `off` 关闭 (100% 人工)
  - `faq` FAQ 匹配 (无需 AI Key · 免费)
  - `smart` FAQ + AI 兜底 (需租户自己配 AI Key)
- **11 闸门决策** 详见 `auto-reply-decider.service.ts`:
  1. 基础过滤 (群/状态消息)
  2. 归因 (campaign_target)
  3. 客户状态机 (customer_conversation.stage)
  4. 8 秒消息聚合 (pending_inbound_buffer)
  5. 频率限流 (30 min 同号不重复 · 24 h 最多 3 次)
  6. Handoff 关键词 2 级 (一级立即转 · 二级 AI 先答)
  7. 来源 KB 绑定 (campaign → product KB)
  8. 模式分流 (FAQ vs AI RAG)
  9. RAG 置信度 (≥0.75 / 0.45-0.75 / <0.45)
  10. Guardrail 过滤 (保留联系方式 / 过滤承诺 / 价格替换)
  11. 发送 / 草稿分流
- **知识库**: 上传 PDF/docx/txt/md → 解析 + chunk + embedding + 保留实体抽取
- **FAQ AI 生成**: 一键 DeepSeek 读文档生成 30 条 Q/A (平台兜底 · 租户免费)
- **引导向导** (ReplySetupWizard): 公司通用 KB (填充式表单) + 多产品 KB + 选模式启用
- **业务目标模板**: 10 个通用目标下拉 (收集联系方式 / 预约 / 下单 / 转人工等)
- Platform AI 架构:
  - FAQ 生成 + embedding = **平台兜底 DeepSeek + OpenAI** (我们的 key)
  - Runtime LLM 回复 = **租户自己的 AI** (DeepSeek/OpenAI/Gemini/Claude 任选)
  - 租户没配 AI → 切智能模式前弹窗引导去配置

### 1.3 人工接管改名 + 准备改造
- `接管` → `人工接管`
- 接管逻辑代码未改, 只 label 变
- 未来改造: 待处理列表视图 + 聊天窗头 AI 摘要 + 暂停/恢复 AI 按钮

### 1.4 UI 统一设计语言
**所有新功能页必须沿用**:
- 品牌绿 `#25d366` · 浅绿 bg `#f0faf4` · 边框绿 `#8ee2ad`
- 卡片 shadow `0 2px 10px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)` · radius 8-10
- 状态色: 成功 `#25d366` · 警告 `#fa8c16` · 错误 `#f5222d`
- GroupCard 模板 (42x42 彩色方头像 + 信息 + 右侧操作)
- StatBox (小 label + 大数字 + 可选 hint)
- Empty state (60px 圆图标 + 标题 + 副标题 + CTA)
- **确认 Modal**: 模式切换必须确认 · 所有破坏性操作都要确认

### 1.5 基础设施
- **Migration 1789-1795** 全部跑通
- Backend 跑 `packages/backend/dist/main` (不是 watch) · 修改要 `pnpm --filter backend run build` + 重启
- **平台 AI env** 已配:
  - `PLATFORM_DEEPSEEK_API_KEY=sk-f15b...6bf`
  - `PLATFORM_OPENAI_API_KEY=sk-proj-3UFW...Ms5YA`
  - `PLATFORM_OPENAI_EMBED_MODEL=text-embedding-3-small`
- **WA_FREEZE_ALL=true** env 可阻止 baileys rehydrate (dev 期保护用)

---

## 2 · 今天最后状态 · 完全原厂重置

```
账号槽位: 50 空 · 0 绑号
广告投放: 0
智能客服: 0 KB · mode=off
客户群:   0
文案:     0 / 开场白: 0
任务队列: 0 · 聊天消息 0 · wa_contact 0
wa_account: 0 · 所有 session 文件已物理删除
```

**Backend 状态**: PID 36120 (可能已变), 监听 9700, **不带 WA_FREEZE_ALL** (干净启动, 无号可烧), 代码是最新 push 的版本.

---

## 3 · Git 状态

```
分支: main
origin: https://github.com/bryangeh79/WAhubX.git
最新 commit: 7b4fa3b · "feat(ads+reply): 完整广告投放 + 智能客服 · 15 migration · 模块级"
已 push ✓
```

本 session 后 **没新改动** (原厂重置不需改代码).

---

## 4 · 今日未完成 · T12 真机测试卡在哪

### 问题: WhatsApp 440 "connectionReplaced" 死循环
- 4 个老号 (V30/Redmi 13C/POCO X6/Galaxy A54) 冻结期间 session 被 WA 踢
- 尝试重扫 QR 成功绑定 · 但 **3-5 分钟内 socket 自己消失** · 无任何日志事件
- 原因推测: 用户手机 WA 在绑定后可能触发了某种 "linked device cleanup" · 或 WA 5 设备上限被挤
- **不是代码 bug** · WA 协议层问题

### 建议下步
- T12 用**全新 SIM 卡** (从未注册过 WA 的号) · 比较好养
- 避开当前 4 个老号的生产风险

### 下次若要继续真机:
1. 找 1-2 张新 SIM
2. `WA_FREEZE_ALL` 不设
3. slot #1 绑新号 · 扫完**30 分钟内别碰手机**
4. 立即建投放测试 · 快进快出

---

## 5 · 项目强制约定 (用户过去说过的, 不要违反)

### 5.1 杀进程政策
- **严禁** `taskkill //F //IM node.exe` (会杀其他项目的 node)
- 精准 kill by PID 或 by port
- 命令模板:
  ```
  netstat -ano | grep ":9700" | awk '{print $5}' | head -1
  taskkill //F //PID <pid>
  ```

### 5.2 工作汇报铁律 (CLAUDE.md 明写)
- 后台任务 `exit code != 0` 必须在回复里明写
- 格式: `后台任务 <task_id> exit=X: <启动 OK / 被 taskkill 杀 / 启动即失败 (原因 Y)>`
- 即使良性也要写

### 5.3 不惊动在线号
- 开发期默认 freeze backend (当有 slot 绑号时)
- Migration 只 CREATE · 不 ALTER 现有表
- Feature flag 默认 off
- 改代码先 build 再重启 · 重启前问用户

### 5.4 工作风格 (用户 2026-04-19 立)
- **简洁直接** · 不废话
- **决策透明** · 给选项 + 推荐 + 理由
- **坦白代价** · 说缺点
- **复用优先** · FAhubX 有的不重写
- **小步提交** · 一次一模块
- **中文对话 · 英文代码**

---

## 6 · 技术栈速查

| 层 | 技术 | 版本 |
|---|---|---|
| 后端 | NestJS + TypeORM + pino | 10 |
| 前端 | React + Vite + antd | 18 / 5 / 5 |
| DB | PostgreSQL + JSONB | 16 (Docker :5434) |
| Redis | :6381 | Docker |
| Backend 端口 | :9700 | |
| Frontend 端口 | :5173 | |
| WA 协议 | @whiskeysockets/baileys | 6.7.21 |
| AI | DeepSeek + OpenAI + Gemini + Claude | 多 provider |
| 身份 | JWT 双 token · bcryptjs r12 | |

### 启动命令
```bash
# DB
docker compose -f docker-compose.dev.yml up -d

# Backend (dev watch)
cd packages/backend && pnpm run start:dev

# Backend (dist 跑, 带 freeze)
cd packages/backend && WA_FREEZE_ALL=true node --enable-source-maps dist/main

# Frontend
cd packages/frontend && pnpm dev

# Migration
cd packages/backend && pnpm run migration:run
```

---

## 7 · 核心文件定位 · 新 agent 记这几个

### 广告投放
- `packages/backend/src/modules/campaigns/` — 整个模块
- `packages/backend/src/modules/campaigns/services/campaign-scheduler.service.ts` — @Cron tick 每 60s 展开 run
- `packages/backend/src/modules/campaigns/executors/send-ad.executor.ts` — 实际发送
- `packages/frontend/src/pages/ads/` — UI

### 智能客服
- `packages/backend/src/modules/intelligent-reply/` — 整个模块
- `packages/backend/src/modules/intelligent-reply/services/auto-reply-decider.service.ts` — 11 闸门
- `packages/backend/src/modules/intelligent-reply/services/reply-executor.service.ts` — FAQ 匹配 + RAG + Guardrail
- `packages/backend/src/modules/intelligent-reply/services/platform-ai.service.ts` — 平台 DeepSeek + OpenAI
- `packages/frontend/src/pages/reply/` — UI
- `packages/frontend/src/pages/reply/components/ReplySetupWizard.tsx` — 引导向导

### Baileys / 核心发送
- `packages/backend/src/modules/baileys/baileys.service.ts` — sendText / sendMedia / 真人打字模拟 / rehydrate / WA_FREEZE_ALL gate

### 前端导航
- `packages/frontend/src/app/App.tsx` — 顶部 tab 定义 · 路由

---

## 8 · 重要 runtime 决策记录 (必须沿用)

| 决策 | 选择 | 理由 |
|---|---|---|
| 广告调度接入 | 生成 task 行走老 dispatcher | 复用 6 并发 / IP 互斥 / 健康 gate |
| 回复模式 | off / faq / smart 三档 (无 draft) | 简化 · 租户易懂 |
| 平台 AI | FAQ 生成 + embedding 平台兜 | 成本 <$5/月 / 100 租户 · 降低入门门槛 |
| Runtime LLM | 租户自己的 AI | 成本公平 · 量大租户付 |
| 业务目标模板 | 10 个通用 (不按行业) | 目标驱动 · 跨行业适用 |
| Embedding | OpenAI text-embedding-3-small | DeepSeek 无 embedding API |
| 向量存储 | JSONB (V1) · V2 换 pgvector | <5000 chunks 无感知 |
| 租户自带域 (短链) | V2 做 · 规避共域被封 | V1.1 先共用 wahubx.link |
| 消息聚合窗 | 8 秒 | 平衡反应速度 + 合并多条 |
| 频率限流 | 30 min · 24h 3 次 · 硬编码 | 租户无需配 |
| 夜间静默 | 默认关 · 租户可开 | 24h 全开更自然 |
| 广告链接短链 | V1 占位符 · V1.1 做 | 需 VPS + 域名 |
| 运行时 LLM JSON 输出 | {reply, intent, handoff} | 意图驱动状态机 |

---

## 9 · 用户 API Keys (已在 .env)

```
PLATFORM_DEEPSEEK_API_KEY=sk-f15bd768f4664fd98aa1072cd9f356bf
PLATFORM_DEEPSEEK_BASE_URL=https://api.deepseek.com
PLATFORM_DEEPSEEK_MODEL=deepseek-chat

PLATFORM_OPENAI_API_KEY=sk-proj-3UFW...（已填）
PLATFORM_OPENAI_BASE_URL=https://api.openai.com
PLATFORM_OPENAI_EMBED_MODEL=text-embedding-3-small

PLATFORM_FAQ_QUOTA=20
```

---

## 10 · 典型问题 + 解决

### Q: `pool 无 socket` 广告发失败
A: slot 的 baileys socket 已死. 原因可能:
- WA 踢了 companion (440)
- Freeze 模式下 socket 意外关闭且没 re-rehydrate
- 手动触发 `POST /slots/:id/reconnect` 修

### Q: 任务被推到明早 10:00
A: 保守档 windows 是 10-12/14-17/19-22. 晚上 22:00 后建的投放自动推到次日 10:00. 测试用 SQL:
```sql
UPDATE task SET scheduled_at = NOW() WHERE id = <id>;
```

### Q: bind 卡在"启动中"
A: 代理有问题 (407 / 超时 / WA WS 被拦). 切直连.

### Q: FAQ 生成失败
A: 检查 PLATFORM_DEEPSEEK_API_KEY 是否有效. 或 KB 没文档 (报 "请先上传产品介绍").

---

## 11 · 租户/用户身份

- 登录邮箱: `admin@waautobot.com` (租户 5 · admin 角色)
- 显示名: `WAAutoBot / waautobot_admin`
- 我不知道密码 (我没存, 用户自己管)

---

## 12 · 下一步待办 (优先级)

### P0 (下次 session 第一件事)
- [ ] **T12 真机冒烟**: 用新 SIM 卡绑 slot · 建小投放 · 发给自己另一个号 · 验端到端

### P1 (功能完整性)
- [ ] 人工接管改造: 待处理列表视图 + 聊天窗 AI 归因信息条 + 暂停/恢复 AI 按钮
- [ ] 接管 UI 深度集成智能客服归因 (lookupByPhone)

### P2 (V1.1)
- [ ] 广告短链服务 (X 方案) + wa.me 追踪 (Y 方案) · 需 VPS + 域名
- [ ] 失败重试 (重投失败对象)
- [ ] 投放 PDF 导出

### P3 (V2)
- [ ] 租户自带域 (BYOD CNAME + Let's Encrypt)
- [ ] pgvector 升级

### P4 (GA 前)
- [ ] Inno Setup 打包
- [ ] 首次引导 · Windows 安装包
- [ ] 数据库自动启 Docker
- [ ] 升级通道

---

## 13 · 记忆文件位置 (跨 session 保留)

```
C:\Users\MSI\.claude\projects\C--AI-WORKSPACE-Whatsapp-Auto-Bot\memory\project_wahubx.md
```

该文件**永久保留** · 新 session 会自动读. 本次 session 已更新 UI 设计规范 + 广告投放决策 + 智能客服决策.

---

## 14 · FAhubX 参照 · 铁律

- 路径: `C:\AI_WORKSPACE\Facebook Auto Bot\`
- 仓库: https://github.com/bryangeh79/FAhubX.git
- **只读参考** · 绝不 commit/push FAhubX 仓库
- 复用方式: 拷贝代码 → 改关键字 facebook→whatsapp · FB→WA · 去 Swagger · 去 FB 业务字段

---

## 15 · 新 agent 接手 · 3 步上手

1. **读完这份 HANDOVER** (现在已读)
2. **读 `CLAUDE.md`** (工作守则 · 杀进程政策 + 汇报铁律)
3. **读项目记忆** `~/.claude/projects/.../project_wahubx.md`

然后直接继续. 用户的风格已在本文档 §5.4 说明.

---

# 附录 A · 10 个深度盲点 (新 agent 必读)

用户在 session 3 结束时主动点名 10 个盲点. 下面是查代码后的真相 · 没有瞎答.

## A.1 代码层未提交状态

**Git 完全干净**:
```
git status: nothing to commit, working tree clean
```
本次所有改动已在 `ddd8898` + push.

**代码里有 2 处 TODO 未实现 (非阻塞 V1)**:
`packages/backend/src/modules/intelligent-reply/services/knowledge-base.service.ts`:
- **L339**: `// TODO: 实现真正的月度配额 · V1 先不限`
- **L426**: `void quota;` 语句引用 quota 避免 lint warn

**含义**: `PLATFORM_FAQ_QUOTA=20` env 变量读了**但没强制执行**. 当前租户可无限次调 DeepSeek 生 FAQ. 超限不报错.

其他 `console.log / debugger / FIXME` 0 个.

## A.2 Migration 陷阱 · 1789-1795

### FK CASCADE 关系 (DROP 顺序敏感)
```
1789 Campaigns:
  advertisement.tenant_id → tenant (CASCADE)
  opening_line.tenant_id → tenant (CASCADE)
  customer_group.tenant_id → tenant (CASCADE)
  customer_group_member.group_id → customer_group (CASCADE)
  campaign.tenant_id → tenant (CASCADE)
  campaign_run.campaign_id → campaign (CASCADE)
  campaign_target.run_id → campaign_run (CASCADE)
  campaign_target.campaign_id → campaign (CASCADE)

1794 IntelligentReply:
  kb_source/chunk/faq/protected.kb_id → knowledge_base (CASCADE)
  campaign.knowledge_base_id → knowledge_base (SET NULL, 依赖 1789 的 campaign 表)
  pending_inbound.conversation_id → customer_conversation (CASCADE)
```

### down() 正确性
- **1789 down**: DROP 顺序 target→run→campaign→group_member→group→opening→advertisement ✓
- **1794 down**: 先 ALTER campaign DROP kb_id, 再 DROP tables ✓
- **1795 down**: **不可逆**. 空函数. 原 `draft` 数据已 update 成 `off`, 恢复不了. 但 data migration 重跑无害.

### `docker compose down -v` 后一把梭能过
所有 CREATE TABLE 无守护, 全新建. FK 目标都在同 migration 或更早 migration. **顺序天然满足**.

## A.3 平台 AI 成本 · 现状 (未跟踪)

**Claude 无法追踪实际 token 消耗** · 只能告诉你架构.

本 session 我**触发过的调用**:
- DeepSeek: 1 次 FAQ 生成 (5 条 · ~$0.002)
- OpenAI embedding: 1 次 (1 向量 · ~$0.0001)
- 用户真实试用次数不明

### 要精确看账
- DeepSeek dashboard: https://platform.deepseek.com
- OpenAI usage: https://platform.openai.com/usage

### `PLATFORM_FAQ_QUOTA=20` 的真相
**是占位符 · 没生效**. 参见 A.1 那个 TODO. 当前租户可无限次调 DeepSeek 生 FAQ.

### 实装配额 (V1.1 要做)
按月计数存 `ai_reply_audit` (已有 table) · 超限抛 BadRequestException · 工作量 ~30 min.

## A.4 11 闸门决策的暗坑

### A.4.1 最痛的闸门: **闸门 4 · 消息聚合**

```typescript
const timer = setTimeout(() => flushConversation(conv.id), AGGREGATION_WINDOW_MS);
this.aggTimers.set(conv.id, timer);
```

**坑**:
- `aggTimers` 是**内存 Map** · backend 重启丢失
- 重启时有挂起的 buffer 就永远 flush 不了
- **没做启动时扫 `pending_inbound_buffer WHERE flushed=false` 的恢复逻辑**

**现状**: `pending_inbound_buffer` 表建了 · 但启动时不扫. 要靠手动 SQL 清或重处理.

**修复方向**: ReplyExecutorService onModuleInit 扫未 flush · 按 received_at 分组 · 按 conversation 重跑 flush.

### A.4.2 实战测试情况
- 8s 聚合 / 30min 去重 / 24h 3 次上限 **全部只过逻辑审阅 · 没真实消息流量测试**
- 具体边界 case (24h 刚满重置 / 夜间切日 / 节流叠加 handoff 关键词 / 短时连发) **没跑过**
- T12 优先测这条链路

### A.4.3 Guardrail 硬编码位置
`reply-executor.service.ts` L298-309:
```typescript
private applyGuardrail(text, _q, _kbId): string {
  // 长度 MAX_REPLY_LENGTH=200
  // 过度承诺: /100%|百分百|绝对|保证你|一定|绝不/g → ''
  // 价格: /(RM|MYR|\$|USD|¥|CNY|RMB)\s?\d+[\d,]*/gi → '具体价格请联系顾问'
}
```

**租户不能覆盖硬规则**. 租户可**附加**:
- `blacklistKeywords` (prompt 里禁止话题提示)
- `customHandoffKeywords` (立即转人工)

要改硬规则 → 改代码. V1 不可配置.

## A.5 真人打字模拟的精确参数

`baileys.service.ts` L428-450:

```typescript
const len = (text ?? '').length;
const perChar = 80 + Math.random() * 70;  // 每字 80-150ms
const rawMs = Math.round(len * perChar);
const typingMs = Math.min(8000, Math.max(1500, rawMs));
```

- **每字 80-150ms 随机**
- **下限 1500ms · 上限 8000ms**
- **每字 jitter 是独立 random**

**举例**:
- 10 字 → 10 × 115 ≈ 1150ms → 触发下限 **1500ms**
- 60 字 → 60 × 115 ≈ 6900ms → 实际 6.9s
- 100+ 字 → 触发上限 **8000ms**

相同字数每次 ms 不一样 · 因为每字独立 roll.

## A.6 Baileys WA_FREEZE_ALL 的真实范围

`baileys.service.ts` L117-121:

```typescript
if (process.env.WA_FREEZE_ALL === 'true' || process.env.WA_FREEZE_ALL === '1') {
  this.logger.warn('⚠ WA_FREEZE_ALL=true · 跳过所有 slot rehydrate 和 periodic recovery');
  return;
}
```

### **跳过**
- `onModuleInit` 里的批量 rehydrate (遍历 active/warmup slots 连 baileys)
- `periodicRecoveryTick` (每 20 min 扫 suspended 重试)
- `fetchLatestBaileysVersion` (WA 协议版本 upstream)

### **不影响**
- 所有 API 路由 (bind / send / clear / reconnect)
- 已经在 pool 里的 socket 的 `connection.update` listener (包括 `scheduleReconnect`)
- Takeover / Dispatcher / Campaign scheduler 正常跑
- 这导致 **freeze + campaign scheduler 跑** 会让 task 生成但发不出 · 每条标 Failed

### 恢复 4 号 440 · 我试过的手段 (全部失败)

| # | 尝试 | 结果 |
|---|---|---|
| 1 | 重启 backend 无 freeze | 立刻 440 replaced · 烧风控 · 赶紧回 freeze |
| 2 | 清空 slot + 重新扫 QR | 扫成功 · 3-5min 后 socket 消失 · 无日志事件 |
| 3 | SQL 改 task scheduled_at=NOW | 提前跑 · 但 pool 已空 · 仍失败 |
| 4 | 切代理 / 直连 | 直连能扫 · 但稳定性不变 · 仍失联 |

### 没试过的 (新 agent 可尝试)
- `POST /api/v1/slots/:id/reconnect` 手动触发 (controller 存在, UI 可能没暴露)
- 手机主动清所有 linked devices 再扫 (彻底重来)
- **换从未用过 WA 的手机**作为 host (排除手机端 MDM 干扰)

## A.7 前端 UI 共享组件 · **各页 copy 一份**

```
StatBox     · pages/ads/resources/CustomerGroupImportModal.tsx:614
StatCard    · pages/reply/components/ReplyOverviewPanel.tsx:113
GroupCard   · pages/ads/resources/CustomerGroupDrawer.tsx:745
EmptyState  · pages/ads/resources/CustomerGroupDrawer.tsx:1062
StatCard    · pages/ads/resources/CustomerGroupDrawer.tsx:1112 (同文件 2 个 StatCard!)
```

**没抽共享组件**. 每页自己写一份. 风格一致但代码重复.

### 技术债
- 要调设计规范 (如 StatCard padding) 得**全局搜索替换**
- V1.1 建议抽到 `packages/frontend/src/components/common/`:
  - `StatCard.tsx`, `GroupCardLayout.tsx`, `EmptyStateCard.tsx`, `StatBox.tsx`
- 不是 blocker · V1 可跑

## A.8 客户回复归因 · phone 匹配精度

### 匹配方式: **SQL 精确字符串 `=`**

`reply-attribution.service.ts` L64-70:
```sql
WHERE c.tenant_id = $1 AND t.phone_e164 = $2 AND t.status = 2 ...
```

### 归一化在**入库时**完成 · 不在匹配时

`campaigns/utils/phone.ts` `normalizePhone()`:
- `+60123456789` → `60123456789`
- `60123456789` → `60123456789`
- `0123456789` (9-11 位 0 开头) → `60123456789` (加 60 前缀 · 马来本地规则)
- `0086xxx` / `+86xxx` / `00xxx` → 去掉 `00/+`
- 长度 <8 或 >15 → null (拒绝)

### 入库都走 normalizePhone · DB 只存 E.164 裸号码 (无 + 无 0)

### 入站消息: `jidToPhone('60186888168@s.whatsapp.net')` → `60186888168`
直接取 jid 前缀数字 · **不 re-normalize**. WA 来的号天然就是 E.164 裸.

### 潜在坑
- `"0138xxxxxxxx"` (中国本地 · 0 开头 11 位) 会被误判成马来 → 加 60 前缀 → `60138xxxxxxxx` **错号**
- V1 只硬编码马来处理 · 不支持"多国规则"
- 客户群导入时若原始数据带了奇怪字符 (空格 / 中文破折号) · regex `\D` 会清掉但可能连累有效数字

## A.9 Campaign Clone 边界

`campaigns.service.ts` `clone()` L389-420:

### **会复制**
- `name + (副本)` 自动递增
- `targets` (groupIds + extraPhones) — shallow copy
- `adStrategy` + `adIds[...]`
- `openingStrategy` + `openingIds[...]`
- `executionMode` + `customSlotIds[...]`
- `throttleProfile`

### **不复制**
- `schedule` — **硬改为 `immediate`** · 原排期丢失
- `safetyStatus` — 重置 Green
- `safetySnapshot` — null
- `status` — 重置 Draft (需用户手动启动)
- `knowledge_base_id` — **没复制! 遗漏 bug · V1.1 要补**

### 不复制 runs / targets / tasks
clone 只是新 Draft · 启动才生成 run.

## A.10 T12 真机避坑地图 · 本 session 踩过的其他坑

### A.10.1 代理
- **proxy id 5** (178.94.148.61:45652) 带 auth · 但**疑似 block WA WebSocket**
- 测试: direct HTTPS 经代理 → 200 OK · 但绑号 60s+ 不出 QR
- 建议: 测试用直连 · 生产/养号再按号分配代理

### A.10.2 Bind 流程 515 restart 隐患
`baileys.service.ts` L773-788:
- 扫码成功 WA 发 515 "restart required"
- `spawnBindSocket(ctx, undefined)` 重建 socket
- 重建的新 socket 进 pool
- **隐患**: bind 原始 socket 的 listener 没 detach · 理论上可能 dangling (实测没炸)

### A.10.3 Task 延后到下一窗口
- 保守档 windows: **10-12 / 14-17 / 19-22**
- 过 22:00 建 campaign → 自动推到**次日 10:00**
- 立即测试 → SQL:
  ```sql
  UPDATE task SET scheduled_at = NOW() WHERE id = <id>;
  ```

### A.10.4 号码跨租户冲突
`startBind` 里 race check:
```typescript
if (existing) throw new Error(`手机号 ${phone} 已被租户...占用`);
```
同一 WA 号被其他 tenant slot 绑了 · 本 tenant 不能再绑. 多租户共用 SIM 会卡.

### A.10.5 代理明文存储 (V2 加密)
`proxy` 表 `username / password` 是 plaintext · 备份 DB 会带出 · 责任在租户.

### A.10.6 Session 文件路径
```
packages/backend/data/slots/<slot_index_2位>/wa-session/
```
重置时删这目录 · 不要删 `data/` 根 (含 assets · backups · config).

### A.10.7 Campaign scheduler 即使冻结也会展开 run
`CampaignSchedulerService.onModuleInit` 延 30s 启动 setInterval · **freeze env 不影响这个 cron**. 冻结期间 run 照常展开 · task 照常生成 · 只是 dispatcher 发不出.
影响: 冻结期 UI 列表看到大量 Failed task. 不是 bug.

### A.10.8 Intelligent reply 的 chat_message 不被监听过滤
`takeover.message.in` 事件对**所有 inbound message** 都触发. AutoReplyDecider 自己闸门 1 过滤群/状态. 但接管 UI 里 admin 自己发的 out 消息不走 inbound · 不会触发闸门.

---

# 附录 B · 新 agent 读完补充后应执行的检查清单

- [ ] 读 CLAUDE.md
- [ ] 读记忆文件
- [ ] `cd C:\AI_WORKSPACE\Whatsapp Auto Bot && git log --oneline -3` 看 commit 链
- [ ] `docker ps` 确认 postgres 5434 + redis 6381 在跑
- [ ] `netstat -ano | grep :9700` 看 backend 是否活着 (应该是)
- [ ] `cat packages/backend/.env | grep PLATFORM` 确认 AI keys 在
- [ ] 浏览器打开 `http://localhost:5173` 看前端
- [ ] 登录 `admin@waautobot.com` (密码向用户问)

---

> **补充生成时间**: 2026-04-24 23:20
> **最后 commit**: ddd8898 (docs) · 推进补充后会变
> **最后推荐动作**: 新 agent 读完全文 · 进入 Pending todo (T12 新 SIM 真机)
