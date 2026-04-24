# WAhubX · 新 Agent 完整接手簿 v2

> 产出: 2026-04-23 · 新 session 接手自检 + 旧 agent 问答后整合
> 本文件是**自给自足**的 — 读完即可无缝接手, 不用翻其他文档
> 产出 agent: Claude Opus 4.7 (1M context) · 主路径作业

---

## 0. 本文件用法

- 新 session 上来先读: `CLAUDE.md` → 本文件 → 按需翻 `WAhubX_技术交接文档.md`
- 标 ✅ = 确认事实 / ◐ = 部分知 / ❌ = 未知需查 / ⚠️ = 血泪教训
- "需要现查" 的条目, 用户没叫就不要擅自跑

---

## 1. 项目身份

| 项 | 值 |
|---|---|
| 名称 | **WAhubX** · WhatsApp 多账号自动化运营 SaaS |
| 定位 | 本地桌面应用 (Windows) · 马来华语市场优先 · 架构预埋多国 |
| 仓库 | https://github.com/bryangeh79/WAhubX.git (**Private**) |
| 主分支 | `main` |
| 最新 commit (时点) | `bd98f8a chore(ports): migrate WAhubX to 5434/6381/9700 to coexist with FAhubX` |
| 本地主路径 | `C:\AI_WORKSPACE\Whatsapp Auto Bot\` |
| 启动日期 | 2026-04-19 |
| 里程碑 | M1 已结束 · V1 功能约 90% · 进入稳定性调优 + 真机测试阶段 |
| V1 GA 周期 | 设计约 27 周 / 6.5 月 (M1-M11) |
| 用户 | Bryan · 马来西亚 · 华语流利 · email `bryangeh79@gmail.com` |

### FAhubX 只读参考
- 路径: `C:\AI_WORKSPACE\Facebook Auto Bot\`
- 仓库: https://github.com/bryangeh79/FAhubX.git
- 铁律: **只读参考 · 绝不 commit/push FAhubX 仓**
- 复用方式: 拷贝代码过来, 改 Facebook/FB 关键字 → whatsapp/WA, 去 Swagger 装饰器, 去 FB 业务字段 (maxAccounts/plan on user)

---

## 2. Worktree 情况

- 当前活跃 worktree (新 agent 作业区): `.claude\worktrees\optimistic-clarke-1be022\` · 分支 `claude/optimistic-clarke-1be022`
- 上一个 session 留的 worktree: `.claude\worktrees\elated-mendel-694e0a\` (HANDOVER_2026-04-23.md 提到的)
- **Read/Edit 读写的是主路径** · worktree 只是分支沙盒
- 主路径 `git status` (2026-04-23 接手时): **92 个未提交文件** (含 HANDOVER_2026-04-23.md)

---

## 3. 技术栈

| 层 | 技术 | 版本/备注 |
|---|---|---|
| 后端 | NestJS 10 + TypeORM + pino | TS strict |
| 前端 | React 18 + Vite 5 + antd 5 | 品牌绿 `#25d366` · **中文单语言 V1** |
| DB | PostgreSQL 16 | Docker 本地 port **5434** |
| 缓存/队列 | Redis 7-alpine + BullMQ | port **6381** |
| WA 协议 | @whiskeysockets/baileys **6.7.21** | 不要乱升 |
| License server | Cloudflare Worker + D1 | 已部署生产 |
| 包管理 | pnpm@9.15.0 monorepo workspace | |
| 认证 | JWT 双 token (access 15m / refresh 7d) + bcryptjs round=12 | 登录 5 次锁 15 分钟 |
| 代码混淆 | javascript-obfuscator | `installer/obfuscate.js` 写了但未实测跑过 |
| 打包 | Inno Setup 6 | 脚手架齐 · 未打过 exe |
| AI 文本 | DeepSeek/Gemini/OpenAI/Claude 可选 | **租户自填 key**, 平台不配 |
| AI 图片 | Flux 本地 (ComfyUI) / Replicate | M6-M7 |
| AI 语音 | Piper 本地 / ElevenLabs | M6-M7 |
| 日志 | Pino + 本地文件 | |

### Monorepo 结构
```
packages/
├─ backend/           NestJS app (port 9700)
├─ frontend/          Vite React (port 5173)
└─ shared/            预留
license-server/       Cloudflare Worker (独立部署)
scripts/              seed-assets / pilot kit build
docs/                 中文文档 + i18n
staging/              待办清单 (_done 存完成的)
data/                 PG 卷挂在 docker · assets/slots 落这
installer/            Inno Setup 相关
```

---

## 4. 部署拓扑

```
  [本地桌面 · 客户机器]            [Cloudflare]
  Windows + Docker                 Cloudflare Worker + D1
  ┌──────────────────────┐         ┌────────────────────────┐
  │ WAhubX backend :9700 │ ◄────► │ License Server         │
  │ Vite dev     :5173   │ HTTPS  │ wahubx-license.star... │
  │ PG           :5434   │        │ D1: wahubx-license-db  │
  │ Redis        :6381   │        └────────────────────────┘
  │ data/slots/* sessions│
  └──────────────────────┘
          │
          │ WebSocket · 经代理 / 直连
          ▼
      WhatsApp 服务器
```

**无独立 VPS · 无 Termius host** — 所有控制平面都在 Cloudflare Workers (serverless).

---

## 5. Cloudflare 全量资料 ✅

| 项 | 值 |
|---|---|
| 账号邮箱 | `bryangeh79@gmail.com` |
| Account ID | `0c20504aabb62d0f56b7746e7cc5022f` |
| 账号名 | `Bryangeh79@gmail.com's Account` |
| wrangler 登录状态 | **已登录** · OAuth Token |
| Worker URL | `https://wahubx-license.starbright-solutions.com` |
| Worker 配置 | `license-server/wrangler.toml` |
| Worker 代码 | `license-server/src/` |
| D1 DB 名 | `wahubx-license-db` |
| D1 DB ID | `777a5f69-dbb2-490f-a121-a10fa4b42a1f` |
| D1 Schema 文件 | `license-server/src/db/schema.sql` (已 init) |
| 生产 secrets | **1 条**: `ADMIN_API_KEY` (secret_text) |
| 本地 dev .dev.vars | **不存在** (目前用 wrangler secret 方式) |
| 域名 | `starbright-solutions.com` 在此 Cloudflare 账号 |
| Registrar | ❌ 未查 · 让 Bryan 自己确认 (Cloudflare Registrar? 别家?) |
| 健康检查 | `GET /health` |
| 部署命令 | `cd license-server && npx wrangler deploy` |

### 常用 wrangler 命令
```bash
cd license-server
npx wrangler whoami                                     # 看当前登录
npx wrangler secret list                                # 列 secrets
npx wrangler d1 execute wahubx-license-db --remote \
  --command "SELECT key, machine_fingerprint, status FROM licenses"
npx wrangler deploy                                     # 部署生产
npx wrangler tail                                       # 实时日志
```

---

## 6. License 机制 ◐

| 项 | 值 |
|---|---|
| 签发入口 | 平台超管 `platform@wahubx.local / Test1234!` 登录前端 |
| 前端页 | `/admin/licenses` (`packages/frontend/src/pages/AdminLicensesPage.tsx`) |
| 签发 API | `POST /api/admin/licenses` (`admin-licenses.controller.ts`) |
| 吊销 API | `DELETE /api/admin/licenses/:id` (同 UI 有 revoke 按钮) |
| 后端管理密钥 | `LICENSE_ADMIN_KEY` 存 `packages/backend/.env` (实值已打码, 无其他保险库) |
| 激活流程 | 原子事务: 校验 key → 创建首个 admin user → 绑 machine_fingerprint → 返 tokens |
| 生产 active key 数 | ❌ 未查 · 跑 `wrangler d1 execute` 命令查 (见 §5) |
| 已知历史数据 | `acme-admin@acme.com` (tenant_id=2, Pro 套餐) 真实激活过, license 已 revoke (dev 测试残留) |

### 套餐硬映射
| 套餐 | 槽位数 (PLAN_SLOT_LIMIT) |
|---|---|
| Basic | 10 |
| Pro | 30 |
| Enterprise | 50 |

---

## 7. Dev 账号 (本地 PG) ✅

| Email | 密码 | tenant_id | Role | 用途 |
|---|---|---|---|---|
| `platform@wahubx.local` | `Test1234!` | NULL | admin | 平台超管 · 生成/吊销 license |
| `admin@wahubx.local` | `Test1234!` | 1 | admin | dev 租户 admin, Basic 套餐 10 槽 |
| `admin@waautobot.com` | `Admin123!` | 5 | admin | 真机测试租户, 绑了 4 号数据 |
| `acme-admin@acme.com` | `AcmeAdmin1234!` | 2 | admin | 激活流程残留, Pro 套餐, license 已 revoke |

清空 dev DB: `docker compose -f docker-compose.dev.yml down -v`

---

## 8. 端口分配 (强制 · 不碰 FAhubX) ✅

| 服务 | WAhubX | FAhubX (避开) |
|---|---|---|
| Backend | **9700** | 9600 |
| Frontend (vite) | **5173** | 5173 (FAhubX 自己) |
| Postgres | **5434** | 5433 |
| Redis | **6381** | 6380 |

---

## 9. 本地部署方式 ✅ dev / ❌ 生产

### Dev (当前跑法)
```bash
cd "C:\AI_WORKSPACE\Whatsapp Auto Bot"

# 1. Docker 起 pg + redis
docker compose -f docker-compose.dev.yml up -d
docker ps | grep wahubx   # 看 wahubx-dev-pg + wahubx-dev-redis healthy

# 2. 后端 (主路径 · 不是 worktree)
cd packages/backend
pnpm dev                   # nest start --watch

# 3. 前端 (另一 terminal)
cd packages/frontend
pnpm dev                   # vite dev

# 浏览器
http://localhost:5173
```

### Migration
```bash
cd packages/backend
pnpm migration:run         # 跑最新 migration
```

### 生产版 (未完全确定) ❌
- 计划: `installer/build-backend.bat` 编译 dist/ 再打 Inno Setup
- 没实测过完整流程
- PG / Redis 生产怎么起不知道 (可能安装包内带 portable, 可能让用户装, 看 `installer/wahubx-setup.iss` 才确定)
- `data/slots/` 生产路径: 代码里是相对 backend cwd 的 `./data/slots/<slotIndex>/`, 安装后可能 `%APPDATA%\WAhubX\` 或 Program Files 子目录 (未读 iss 确认)

---

## 10. 安装包 · Inno Setup ◐

| 项 | 状态 |
|---|---|
| `installer/` 目录 | ✅ 存在 |
| `wahubx-setup.iss` | ✅ 已写 |
| `build.bat` / `build-backend.bat` / `build-frontend.bat` | ✅ 存在 |
| `obfuscate.js` | ✅ 写了 · ❌ 未实测跑过 |
| `deps/` / `assets/` / `scripts/` / `staging/` | ✅ 存在 · 内容未 audit |
| `installer/output/` | **空** (只有 .gitkeep) |
| 已打的 .exe | ❌ 无 |
| 输出预期 | `wahubx-installer-v1.0.exe` ~400MB (含 Piper) / ~1.5GB (含 Flux) |
| 第一个安装包目标日 | ❌ 用户未拍板 (HANDOVER 提 "V1 GA 前要 ship") |

### Pilot Kit (不是安装包, 是文档 zip)
- 文件: `build/pilot-kit-v1.0.0-rc2.zip` (58.6KB)
- 内装 6 份中文用户手册: 安装 / 快速启动 / 部署模式 / 故障排查 / 视频脚本 / V1 限制
- 构建日志: `staging/pilot-kit-build-log-rc2.md`
- 用途: 给 pilot 客户阅读, 不是可执行程序

---

## 11. 关键凭据位置 (不要贴对话)

| 凭据 | 位置 |
|---|---|
| DB / JWT / bcrypt rounds | `packages/backend/.env` |
| `LICENSE_SERVER_URL` | `packages/backend/.env` = `https://wahubx-license.starbright-solutions.com` |
| `LICENSE_ADMIN_KEY` | `packages/backend/.env` |
| `APP_ENCRYPTION_KEY` (AES-GCM master) | `packages/backend/.env` |
| `AI_TEXT_ENABLED` + 各 AI provider 预留字段 | `packages/backend/.env` · **实际 AI key 未配** (租户自填) |
| Cloudflare Worker ADMIN_API_KEY | Cloudflare secret (wrangler secret) |
| Pexels API Key | ⚠️ Bryan 曾贴对话里: `FQsgBS0TzrVGLkNI9O6FyZzSNzolvQKEAxqRt6uotMhlflx52OlBcx80` · **建议吊销重发** (是否已重置未知) |
| GitHub token | gh CLI **未安装** · git credential 状态未知 · push 用 HTTPS + PAT |

---

## 12. 数据库 · 已应用 migrations (最新 6 条)

```
1788 · ChatMessageVideo           · chat_message.msg_type enum 加 'video'
1787 · AssetKindVideo             · asset.kind enum 加 'video'
1786 · MatureOperation            · group_warmup_plan.mature_level 字段
1785 · GroupWarmupPlan            · group_warmup_plan 表 + warmup_plan.group_plan_id
1784 · ExtendProxyTypeEnum        · proxy_type enum 加 http/https/socks4/socks5
1783 · (前一条 · 未详记)
```

### 核心表速查 (见 `WAhubX_技术交接文档.md` §3 权威版)
- `tenant` · `license` · `account_slot` · `wa_account` · `sim_info` · `account_health` · `risk_event` · `proxy`
- `execution_group` · `execution_group_member`
- `script_pack` · `script` · `asset` · `rewrite_cache`
- `task` · `task_run` · `warmup_calendar` · `group_warmup_plan` · `warmup_plan`
- `wa_contact` · `chat_message`
- `app_setting` (k-v 全局配置)

---

## 13. 当前已交付的功能 (2026-04-22/23 session) ✅

### 13.1 SIM 信息录入 (完整)
- 16 国 + 85 telco 预置库 (SEA 全套)
- 单号 Modal 自动推国家 + 默认 telco
- 批量填 SIM Modal
- DB 扩字段: `country_code / carrier_id / custom_carrier_name / iccid_suffix`

### 13.2 代理 / VPN 管理 (完整 CRUD)
- 添加 / 编辑 / 删除 / 测速 / 批量测
- 占用槽位显示 `#3 #4` 而非 "2 号"
- enum 从 residential_* 扩到 http/https/socks4/socks5
- 路径: 设置 → 代理管理 (`ProxyPanel.tsx`)

### 13.3 执行组 (Group)
- M:N 关系 · 槽位可加多组
- 槽位卡显 "📁 养号组 [×]" + 退出按钮
- 槽位卡菜单 "📁 管理执行组" Modal 勾选加入/退出

### 13.4 素材池系统 (大工程)
- 3 类 · 9 voice pools · 5 image pools · 5 video pools
- **200 条 TTS 语音** (Google Translate TTS · `scripts/seed-assets/gen-voices.js`)
- **97 张 Pexels 图** (CC0 · `gen-images.js`)
- **100 条 Pexels 视频** (`gen-videos-api.js` 需 PEXELS_KEY)
- 3 个新 executor: `send_voice` / `send_image` / `send_video` (池随机 + 自动去重)
- Assets Tab UI: 池浏览 + 媒体预览 (audio/video controls) + 重扫磁盘
- 落盘: `packages/backend/data/assets/{voices,images,videos}/<pool>/*` · 约 **700MB**

### 13.5 14 天托管 + 7 天养号 + 成熟运营
- Group-based warmup plan (`group_warmup_plan` 表)
- Warmup pair picker (随机配对避免重复)
- Calendar service group-aware tick
- `V1_14DAY_FULL_TEMPLATE` · Day 1-14 完整日程
- V1.1 待做: `mature_level` 3 档 (light/standard/aggressive) · **字段已加, 日历未分档**

### 13.6 17 个 executor 已注册
```
chat, warmup, script_chat, status_post, status_browse,
join_group, follow_channel, status_react, auto_accept,
status_browse_bulk, auto_reply, add_contact, group_chat,
profile_refresh, send_voice, send_image, send_video
```

### 13.7 账号转出到手机
- 3 个 export 端点: chats.txt / contacts.csv / channels-groups.txt
- 槽位卡 "📤 转出到手机" 菜单 + Modal
- 设计决策: SIM+OTP 即可转, 不需扫老设备 QR, 聊天历史要租户提前导出

### 13.8 Baileys 连接稳定性修复 ⚠️ 关键
- `spawnPooledSocket` 先 end 旧 sock (避免自己踢自己)
- attempts 归 0 延迟 10 秒 (不被 WA 瞬开秒断骗)
- Rehydrate 错开 10s 启动 (避免多 sock 同 IP 瞬时触发风控)
- `connectTimeoutMs: 60s` · `defaultQueryTimeoutMs: 120s`
- 自动重连: 线性 30/60/90/120/150s · MAX 5 次 · 7.5 min 放弃
- Smooth online (10 min 窗口) · UI 平滑不抖
- Gap 1-3: dispatcher 跳 suspended 槽 / slot.suspended 事件中断任务 / 每 20 min 定时自愈
- 诊断 modal + 批量重连 UI: 槽位卡 🔄/💡 · 顶部 "需处理槽位" 批量面板

### 13.9 UX 改进
- "封禁" → "未连接" (不吓人)
- `send_media` success=false 当 sent=0 (不骗人)
- `friendlySlotName()`: 错误信息显 `#2 · 60186888168` 而非 `槽位 62`
- 任务调度下拉分组 (📅 计划 / 💬 消息 / 📢 朋友圈 / 👥 社群 / 🎯 运营 / 📤 素材)
- 联系人目标 2 组: 📇 已聊过 + 📱 系统内其他号

---

## 14. 号绑定状态 (文档时点 2026-04-23 14:00 · 需现查验实时)

| 槽 | 手机号 | 代理 | 状态 |
|---|---|---|---|
| #1 | `60186888168` | 代理 #5 | warmup · 稳定运营 ✅ |
| #2 | `60168160836` | 直连 | warmup · 稳定运营 ✅ |
| #3 | (扫码中) | 同代理 #5 (第 3 号同 IP 压测) | 扫码中 ⏳ |
| #4 | (空) | — | 待绑 |

### E2E 测试通过的任务类型 ✅
- `send_voice` · `send_image` · `send_video` · `script_chat` · `chat` · 14 天托管计划

### 唯一未测
- 14 天托管跑满完整周期 (租户要等 14 天才能验完)
- 一键养号 E2E (HANDOVER 写过)

### 现查命令 (需要时跑)
```sql
SELECT slot_index, phone_number, connection_state, last_online_at
FROM account_slot
ORDER BY slot_index;

SELECT * FROM warmup_plan WHERE status='active';
SELECT * FROM group_warmup_plan WHERE status='active';
```

---

## 15. Git 状态 (2026-04-23 接手时点)

- 主分支: `main` · 最新 commit `bd98f8a`
- 未提交文件: **92 个** (含 HANDOVER_2026-04-23.md, 本次 session 新增功能)
- 建议 5-6 个 batch commit 拆分 (HANDOVER 原提议):
  1. `feat: SIM info registry + quick entry UI`
  2. `feat: assets pool library + 3 send executors + seed scripts`
  3. `feat: group warmup + 14-day pilot template`
  4. `feat: auto-reply / add-contact / group-chat / profile-refresh executors`
  5. `fix: baileys reconnect stability (end old sock, stagger rehydrate, timeouts)`
  6. `feat: scheduler tab full + 17 executors registered`

### 新增主要文件/目录
- `packages/backend/src/modules/assets/asset-pool.service.ts`
- `packages/backend/src/modules/slots/sim-info.service.ts` + handover
- `packages/backend/src/modules/tasks/executors/send-*.executor.ts` (voice/image/video)
- `packages/backend/src/modules/tasks/executors/add-contact / group-chat / profile-refresh / auto-reply`
- `packages/backend/src/modules/warmup/group-warmup.service.ts` · `group-warmup-plan.entity.ts`
- `packages/backend/src/data/telco-registry.ts` · `status-post-seeds.ts`
- `packages/backend/src/database/migrations/1783-1788*.ts`
- `scripts/seed-assets/*`
- `packages/frontend/src/pages/admin/ProxyPanel.tsx`
- `packages/frontend/src/pages/sim/*`
- `packages/frontend/src/pages/bind/RegisterNewNumberModal.tsx` (已弃)

---

## 16. 核心拍板决策 (不要再讨论) ✅

| # | 决策 |
|---|---|
| 部署 | 本地桌面应用 (Inno Setup), VPS 只做 License + 升级分发. 实际**无 VPS, 用 Cloudflare Workers** |
| 仓库 | Monorepo pnpm workspace |
| DB | PostgreSQL 16 强制, dev port 5434 (SQLite 留到 M10) |
| 后端 | NestJS 10 + TypeORM + pino, TS strict |
| 前端 | React 18 + Vite 5 + antd 5, 品牌绿 `#25d366`, **中文单语言 V1** |
| 认证 | JWT 双 token (15m/7d) + bcryptjs round=12 + 登录 5 次锁 15 分钟 |
| Users:Tenant | 1:N, role `admin/operator/viewer`, 平台超管 tenant_id=null |
| 套餐 | Basic 10 / Pro 30 / Enterprise 50 硬映射 |
| 多国 | V1 只 MY, 但 `country/timezone/language` 字段预埋 tenant+user 两级 |
| 槽位 | `slot_id 1..slot_limit` per tenant, **只显示 slot_limit 张卡** |
| License 激活 | 原子事务, 自动创建首个 admin user |
| 并发 | 全局 6 槽位, 同账号/同 IP 组互斥, 养号阶段软锁 |
| WA 协议 | @whiskeysockets/baileys 6.7.21 |
| AI | 4 provider 选配 + 本地 Piper/Flux, 租户自填 key |
| 接管方案 | 自建聊天 UI, 不搞双模式切换, 永不二次扫 QR |
| 代理 | 1 住宅静态 IP : 3-5 号, 同组 IP 冲突软提示 |
| 养号 | 5 天平衡版默认 (3/5/7 可选), 72h 冷却硬守 |
| 告警 | 桌面弹窗 (node-notifier) |
| 日志 | 永久存储本地数据库, 不导出 |
| 备份 | 每日自动快照 + 手动 .wab 导出 + 原厂重置 |
| 更新 | 手动导入 .wupd 升级包, 自动备份 + 失败回滚 |
| 剧本包 | .wspack 格式, 100 剧本初版 |
| 开源协议 | **Proprietary · UNLICENSED · Private 仓** |

---

## 17. ⚠️ 血的教训 (不要重蹈)

### 17.1 WA 链接设备的真实行为
1. **不要频繁重启 backend** — 每次 reload 所有号同时 spawn · WA 当 bot farm · 封 IP 持续几小时
2. **不要同一秒同 IP 多号 spawn** — 必须错开 10+ 秒
3. **原厂重置 + 重扫码** = 唯一可靠 "WA 认我们是新设备" 方法
4. **手机 WA 彻底关 / 卸载** 才能让 linked device 稳 (用户日常号难做)
5. **代理国家必须和 SIM 国家匹配** — UK 号走 MY 代理 → WA 秒封
6. **同 IP 最多 2-3 号 linked device** — 多了触发 WA 关联风控

### 17.2 2026-04-23 验证的稳定配方
```
1. SIM 插激活手机 · 收 SMS OTP · 激活 WhatsApp
2. 手机 WA "链接设备" 扫系统码
3. 绑完立刻关手机 WA (卸载最稳)
4. 每号间隔 15 分钟扫 · 避免 WA 警觉
5. 代理和 SIM 国家一致 / 或直连本机 IP
6. 绑完别频繁重启 backend
```

### 17.3 CLAUDE.md 工作铁律
1. **后台任务 exit code != 0 必须在回复里明写** — 标明 启动 OK / 启动失败 / cleanup 杀的. 绝不省略. 绝不因"最终冒烟 PASS 了"就忽略
2. **禁用 `taskkill //F //IM node.exe`** — 会杀 FAhubX / MCP. 顺序: TaskStop → 按端口 → 按 PID
3. **FAhubX 只读** — 绝不 commit/push FAhubX 仓

### 17.4 工作风格 (用户 2026-04-19 立)
1. 简洁直接, 别"本方案完美地..."废话
2. 决策透明, 岔路先问用户给选项+推荐+理由
3. 坦白代价, 说清成本/复杂度/风险
4. 复用优先, FAhubX 能抄绝不重写
5. 小步提交, 不一次 1000 行
6. 中文交流, 代码/技术名词英文
7. 先拆清单再写代码, 大任务先 todo

---

## 18. Staging 清单状态

### 未做 / 推迟 V1.1
- `mature-operation-phase.md` — 成熟运营 3 档 (字段有, 日历未分档)
- `group-directory-by-tag.md` — 群素材库
- `m2-w3-new-number-registration.md` — 已弃 (WA HTTP 注册三层 attestation 不可破)

### 参考文档 (非任务)
- `v1.0-release-checklist.draft.md` — **GA 前必读**
- `pilot-kit-build-log-rc2.md` — pilot kit 构建日志
- `m7-day1-drafts/` + `m7-day2-scope.draft.md` — M7 AI 素材草稿
- `day5-smoke/` — 冒烟测试记录

### 已完成归档
- `staging/_done/` · 13 项 (2026-04-23 处理)

---

## 19. V1 GA 发布前待办 ⏳

1. **92 文件 commit** — 拆 5-6 个逻辑 batch (§15)
2. **槽位 #3 绑定收尾 · #4 绑** — 验证同 IP 多号稳定性
3. **一键养号 E2E 测试** — 唯一未跑过的任务类型
4. **`v1.0-release-checklist.draft.md` 过一遍** — 看还缺什么
5. **Pexels API key 吊销重发** — 曾在对话里贴过, 已泄漏
6. **部署文档 · 生产硬件要求** — 一号一手机 / 每号独代理 / 等
7. **Pilot kit 重建** — seed assets 可能要 ship
8. **Inno Setup 第一个安装包** — 时间用户未拍, 等指令
9. **代码混淆实测** — `installer/obfuscate.js` 没跑过
10. **starbright-solutions.com registrar 确认** — 续费/DNS 管理

---

## 20. 快速启动命令 (新 Agent 上来就能用)

```powershell
# Windows PowerShell
cd "C:\AI_WORKSPACE\Whatsapp Auto Bot"

# 检查 docker
docker ps

# 若没起: pg + redis
docker compose -f docker-compose.dev.yml up -d

# 检查端口
netstat -ano | findstr ":9700.*LISTENING"
netstat -ano | findstr ":5173.*LISTENING"

# 若 backend 没起
cd packages/backend
pnpm dev    # 后台跑 · 不要 close terminal

# 前端
cd packages/frontend
pnpm dev

# 浏览器
http://localhost:5173
登录: admin@waautobot.com / Admin123!  (tenant_id=5 · 4 号数据)
平台超管: platform@wahubx.local / Test1234!  (发 license)
```

---

## 21. 关键文件索引

| 文件 | 作用 |
|---|---|
| `CLAUDE.md` | 工作守则 (铁律 + 杀进程 + 决策速查 + 风格) |
| `HANDOVER_2026-04-23.md` | 上 session 原版交接 (更啰嗦) |
| `HANDOVER_2026-04-23_v2_full.md` | **本文件** · 新 agent 接手合订本 |
| `WAhubX_技术交接文档.md` | DB schema + API + 状态机 · **权威** |
| `WAhubX_产品介绍书.html` | 业务全景 |
| `START_M1.md` | M1 启动说明 + 拍板决策 |
| `docs/DEVELOPMENT.md` | 零到一本地搭建 + troubleshooting |
| `staging/v1.0-release-checklist.draft.md` | GA 前清单 |
| `installer/wahubx-setup.iss` | Inno Setup 主脚本 |
| `license-server/wrangler.toml` | Cloudflare Worker 配置 |
| `license-server/src/db/schema.sql` | D1 schema |
| `packages/backend/.env` | 后端所有 env |
| `packages/backend/src/database/migrations/` | TypeORM migration |

---

## 22. 已知"不知道" · 需要 Bryan 补 或 现查

| # | 条目 | 谁负责 | 怎么解 |
|---|---|---|---|
| 1 | starbright-solutions.com registrar | Bryan 自查 | Cloudflare dashboard → Domain Registration |
| 2 | 生产 active license 数 + 绑定机器 | 现查 | `wrangler d1 execute` (§5) |
| 3 | 4 个槽位实时 connection_state | 现查 | SQL (§14) |
| 4 | 14 天托管跑到 Day 几 | 现查 | `SELECT * FROM warmup_plan` |
| 5 | 新 banned/suspended 事件 | 现查 | `SELECT * FROM risk_event WHERE at > now() - interval '1 day'` |
| 6 | Pexels API key 是否已重置 | Bryan 确认 | 登 pexels.com/api/ 看 |
| 7 | 生产版 PG/Redis 怎么部署 | 读 iss | `installer/wahubx-setup.iss` |
| 8 | 生产版 data/slots/ 路径 | 读 iss | 同上 |
| 9 | 第一个安装包目标日期 | Bryan 拍 | — |
| 10 | Inno Setup 混淆实测 | 跑一次 | `cd installer && node obfuscate.js` 看 output |
| 11 | gh CLI 安装 + GitHub token | Bryan 决定 | 装 gh 或用 git + PAT |
| 12 | Bryan 测试手机型号 / 其他开发机 | Bryan 告知 | — |
| 13 | 真实付费 pilot 客户状态 | Bryan 告知 | — |
| 14 | AI provider key 由谁出钱账号 | Bryan 告知 | V1 决策是租户自填, 平台可能暂时没配 |

---

## 23. 给新 Agent 的一句话

- 用户 **Bryan** 期望: 技术准确 · 商业节奏不拖延 · 不吹牛 · 坦白缺陷 · 代码质量要求高 · 不接受 "凑合能跑"
- 当前阶段: V1 功能 90%+ · **稳定性调优 + 真机测试**
- **不要再加新功能除非用户明确要**
- 重点: 让 4 号稳定跑 14 天托管 · 任务链不出问题
- 读完本文件 + CLAUDE.md 就能干活

---

## 24. 近 3 天 cascade 产出补遗 (2026-04-20 → 2026-04-23)

§13-15 未完整记载 · 补齐如下:

### 24.1 V1.0 Release 准备工具链 (cascade [24]-[33])
- `installer/deps/FETCH-DEPS.md` + `verify-deps.ps1` · deps 下载清单 + SHA256 校验
- `docs/RELEASE-V1.0.md` · 17 节正式 release checklist
- `scripts/demo-fixtures.sql` · 幂等 demo 租户 seed (ON CONFLICT DO NOTHING)
- `scripts/validate-env.ps1` · 客户装机 9 项 pre-flight (PS 5.1/7 双兼容)
- `scripts/e2e-dry-smoke.js` + `.spec.js` · 9 step E2E mock · 10 UT standalone
- `scripts/build-pilot-kit.js` · pilot zip bundler · PS + tar.gz fallback

### 24.2 i18n 英文文档 (cascade [30])
- `docs/user-guide/INSTALLATION.en.md`
- `docs/user-guide/QUICK-START.en.md`
- `docs/user-guide/DEPLOYMENT-MODES.en.md`
- `docs/user-guide/TROUBLESHOOTING.en.md`
- `docs/user-guide/README.md` 加 English Version 段

### 24.3 Dogfood 演练 (cascade [34]-[43])
- `docs/PILOT-READINESS-REPORT.md` · 7/10 评分 · 3 wave pilot 建议
- `docs/DESIGN-SPECS/icon-requirements.md` · wahubx.ico 6 尺寸规格
- `docs/LEGAL-REVIEW-NOTES.md` · PDPA + Pilot 条款审阅要点 (给未来律师用)
- `staging/dogfood-issues.md` · 17 issues 闭环 · 12 已修 · 5 V1.1 延
- fix: validate-env.ps1 英文化 + PS 5.1/7 双兼容
- fix: build-pilot-kit.js + rewriteMdLinks + RC 警告横幅 + MY 双时间
- fix: QUICK-START.md / INSTALLATION.md · pwsh→powershell + 代理空组 + USD/RM

### 24.4 法务起草 (cascade [44]-[47])
| 文件 | 字数 | 用途 |
|---|---|---|
| `docs/legal/DISCLAIMER.md` | ~2700 字 (中+英) · 9 节 | 产品内 About 显示 |
| `docs/legal/USER-AGREEMENT.md` | ~3800 字 (中+英) · 11 节 | 激活 License 时勾选同意 |
| `docs/legal/PILOT-AGREEMENT.md` | ~3400 字 (中+英) · 12 节 + 签字页 | 发给 pilot 客户 |

- 每份头部**固定 AI 起草风险警告 block** · **不允许删除**:
  ```
  ⚠️ 重要声明 · Important Notice
  本文档为 AI 辅助起草 · 未经法律专业人士审阅.
  (4 条风险声明 + 英文版)
  ```
- 条款要点: PDPA 2010 合规 · 责任上限 12 个月年费 · AIAC KL 仲裁 · NDA 24 月 · Bug SLA 4 级 · Pilot → V1 正式 2 年价格锁
- 状态: **用户明确决定不找律师** · 自行承担 AI draft 风险
- 产品内激活流程需引用这 3 份 · UI/API 集成未做 (V1 收尾项)

### 24.5 端口迁移 (最新 commit bd98f8a · 2026-04-23)
- Backend: 3000 → **9700**
- Postgres: 5433 → **5434** (避开 FAhubX 5433)
- Redis: 6380 → **6381** (避开 FAhubX 6380)
- Frontend: 5173 保持 (FAhubX 未占 / 未冲突)
- 改动文件: `docker-compose.dev.yml` + `packages/backend/.env` + `vite.config.ts` + `api.ts`
- 相关 tags: `v1.0.0-rc3.1` (legal) · `v1.0.0-rc3.2` (ports)

### 24.6 Pilot Kit 版本更新
- 当前版: `build/pilot-kit-v1.0.0-rc3.zip` (59.3 KB · FB49F05...)
- 上一版: `build/pilot-kit-v1.0.0-rc2.zip` (58.6 KB)
- 目前仅为文档 zip · installer .exe 未集成 (deps 下载完成后重建)

---

## 25. Cascade 工作模式 · 新 Agent 必读

项目用 **"advisor Claude + executor Claude" 双 session 模式**:

- **用户 Bryan** = 决策者 · 测试者 · 商业拍板
- **Advisor Claude** (另一聊天 · 不是你) = 审核 scope · pushback · 策略规划
- **Executor Claude** (你) = 执行 cascade · 修 bug · 写代码

### 标准工作节奏

1. 用户提需求或新方向
2. 你 propose scope · 格式必须 4 段齐全:
   - **必做** (硬) 清单
   - **不做** (延后) 清单
   - **默认决策** A-F (带推荐 + 理由 + 代价)
   - **拍板项** X/Y/Z (二选一或三选一)
3. 用户转 Advisor Claude review
4. Advisor pushback: 接受哪些 · 改哪些 · 补哪些 scope
5. 用户发**最终合并指令**给你
6. 你一路干 · HALT 触发才停
7. HALT 时贴:
   - 累积 commits SHA + 本地 tags
   - PROGRESS-LOG.md 一行一行追加
   - 候选下一步 (A/B/C/D/E)
8. 循环

### HALT 条件 (标准集合)

1. 任何 smoke / verify 真 FAIL · 无法 self-recover
2. 发现架构级 issue 需重新设计
3. 触碰预定 scope 之外代码
4. 任何不可逆操作 (push remote · 删数据 · 改 production)
5. 用户主动打断

### Stand-by 模式 (等用户 bug report 时)

- 保持 backend + frontend dev 运行
- 每 30min health check (GET /api/v1/health · log grep ERROR · docker ps · 磁盘)
- **异常才主动汇报 · 正常静默**
- 不做新 feature · 不改已稳定代码 · 不自主探索 V1.1 项
- ScheduleWakeup 30min 轮询模式

### 决策风格 (字面对应)

用户用 **A/B/X/Y** 字母答复:
- `A ✓` = 接受默认
- `A ✗ 改写` = 必须重设计
- `A / B / D 接受, C 改, 另 2 条澄清` = 逐条对应回 · 不能糊弄

### 汇报铁律 (CLAUDE.md 对齐)

- **后台任务 exit != 0 必须明写** · 标注 启动 OK / 启动失败 / cleanup 杀的
- 绝不因"最终冒烟 PASS 了"就忽略 exit=1 的中间任务
- 所有 commit SHA · tag 名 · UT 计数 (N/N 格式) 必须精确 (不约数)

---

## 26. 用户即将做的事 · 真 WA 号测试 ⏳

**重要上下文**: 本文件产出时点, 用户 Bryan 正在准备**亲自用真 WA 号测试 V1.0**.

这是 Path A (真 E2E smoke) 的用户自己做版 · 不是 automated dogfood.

### 用户会跑的 Scenario (按优先级)

#### Priority 1 · 核心必测
- [T1] 登录 + Admin UI tour (8 tabs 点一遍不报错)
- [T2] Settings 配置 (可选 AI Key · 可选代理)
- [T3] **注册第一个真 WA 号** (Baileys + 真 SMS 验证码) ← **关键**
- [T4] 启动一键养号
- [T5] 5 天养号观察

#### Priority 2 · 推荐测
- [T6] 多号共存 (第 2-3 个号不同 slot)
- [T7] 手动接管 · 真发消息给真联系人
- [T8] Status 发布 (AI 开则自动 · 或手动触发)
- [T9] 备份 + 恢复往返

#### Priority 3 · 边界
- [T10] 恶意输入 (空格 · 超长 · emoji · injection)
- [T11] 断网断电恢复

### 用户 Bug Report 标准格式

```
🐛 BUG #X
Scenario: [Tn] 名字
Step: 做了什么具体步骤
预期: 应该发生什么
实际: 实际发生什么
截图: [图]
Error log (如有): [日志片段]
环境: Windows 版本 / 代理 / SIM 运营商
```

### 你收到 Bug 后的处理协议

- 一次可能收 **3-5 条批量**
- 按 severity 排: critical > major > minor
- 每条流程: 定位代码 (文件:行号) → 修 → UT → smoke → commit
- 修完贴:
  - commit SHA + 改动文件 + 测试方法
  - 问用户哪条最优先回归
- 继续等下一批 · 不主动追问

### 用户测试期间 backend/frontend 要持续运行

- 如果你需要重启 (改 env 等), 先告诉用户
- 避免在用户正在测试时突然断服务
- 用户会主动说 "停一下, 我等你改完" 才重启

### 已确认的测试前置已就位

- Dev 环境可跑 (PG 5434 + Redis 6381 + backend 9700 + frontend 5173)
- 4 个 dev 账号可登 (§7)
- 真 WA 号由用户自备 (SIM + 手机)
- AI Key / 代理用户可选 (全免费 Free Tier 模式能跑)

---

## 27. 关键文件索引补遗

| 文件 | 作用 |
|---|---|
| `docs/legal/DISCLAIMER.md` | AI 起草免责声明 (带风险 block) |
| `docs/legal/USER-AGREEMENT.md` | AI 起草用户协议 (带风险 block) |
| `docs/legal/PILOT-AGREEMENT.md` | AI 起草 Pilot 合同 (带风险 block) |
| `docs/PILOT-READINESS-REPORT.md` | Dogfood 7/10 评分 + wave 建议 |
| `docs/DESIGN-SPECS/icon-requirements.md` | 给设计师的 ico 规格 |
| `docs/LEGAL-REVIEW-NOTES.md` | PDPA + 合同重点 (未找律师 · 存档) |
| `docs/RELEASE-V1.0.md` | 17 节 GA checklist |
| `docs/user-guide/*.en.md` | 4 份英文 i18n |
| `scripts/e2e-dry-smoke.js` | E2E mock smoke (9 step · 10 UT) |
| `scripts/validate-env.ps1` | 客户装机 pre-flight |
| `scripts/build-pilot-kit.js` | pilot zip bundler |
| `scripts/demo-fixtures.sql` | demo 租户 seed |
| `installer/deps/FETCH-DEPS.md` | Portable Node + Piper + 模型清单 |
| `installer/deps/verify-deps.ps1` | deps SHA256 校验 |
| `staging/dogfood-issues.md` | 17 dogfood issues 追踪 (gitignored) |

---

## 28. Tag 链 (push 远端的)

```
v0.1.0-m1 / v0.1.0-m1-w1/w2/w3                M1 骨架
v0.2.0-m2                                     M2 Baileys
v0.3.0-m3                                     M3 任务调度
v0.4.0-m4                                     M4 剧本引擎
v0.5.0-m5                                     M5 养号日历
v0.6.0-m6                                     M6 AI 层
v0.8.0-m8                                     M8 健康分
v0.9.0-m9 / v0.9.1-m9                         M9 接管 (+ socket patch)
v0.10.0-m10                                   M10 备份
v0.11.0-m11-codecomplete-smoke-pending        M11 升级代码完成 · smoke 待
v0.11.1-m7d1..d7                              M7 Day 1-7
v0.12.0-m7                                    M7 整体完成
v1.0.0-rc1                                    Release Candidate 1
v1.0.0-rc2                                    RC2 · 文档 + i18n + smoke 脚本
v1.0.0-rc3                                    Dogfood validated (7/10)
v1.0.0-rc3-final                              + design/legal notes
v1.0.0-rc3.1                                  + 3 legal drafts (AI)
v1.0.0-rc3.2                                  + 端口迁移 5434/6381/9700
```

未跳过: M7 (并到 M7.x · 原排 M7 挪后了) · Code Signing (明确不做 V1)

---

**EOF · 本文件自给自足 · Advisor Claude (Opus 4.7) 已补近 3 天 cascade 产出 + 工作模式说明**
