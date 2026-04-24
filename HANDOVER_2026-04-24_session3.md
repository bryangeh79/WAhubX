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

> **生成时间**: 2026-04-24 23:05
> **上次 commit**: 7b4fa3b (已 push)
> **Backend 状态**: 干净 · 已重置 · 监听 9700 · 无 freeze
> **Todo 剩余**: 恢复 4 号 + T12 真机 (改为: 新 SIM 跑 T12)
