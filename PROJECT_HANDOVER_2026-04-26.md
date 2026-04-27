# PROJECT_HANDOVER_2026-04-26.md · WAhubX

> 这份是 WAhubX 项目的**完整交接总文档**.
> 任何新 Claude / 工程师打开此文件后, 应能立即接手开发 / 部署 / debug / 维护 / 迭代.
> 最后更新: **2026-04-26** (D11 · WA Status / Profile 真功能落地 + R9-bis facade 收尾日)

---

## 🎯 1. 项目基本信息

| 字段 | 值 |
|---|---|
| **项目名称** | **WAhubX** — WhatsApp 多账号自动化运营 SaaS |
| **项目用途** | 让小型营销公司在自己机器上运营 10/30/50 个 WhatsApp 号, 含养号 / 广告群发 / 智能客服自动回复 / 接管 |
| **当前版本** | `0.1.0` (见 `package.json`) |
| **当前完成状态** | M1 框架完成 → M2-M11 部分完成 · 推进到 **D12** (per-slot 子进程隔离 · runtime-chromium 路径正在主战场化) |
| **是否可卖 / 可交付** | ❌ **未到生产可卖** · 内部 pilot 阶段 · 5 个号在跑养号 |
| **是否已生产部署** | ❌ **无生产部署** · 当前仅本地开发机器 · VPS 端 license 服未上线 |
| **当前线上域名** | TODO / NEEDS VERIFY · 设计文档定: `wahubx.com` (主站) + `license.wahubx.com` (license 服) · 实际未购未指 |
| **后台地址** | 本地 dev: `http://localhost:5173/admin` (前端) / `http://localhost:9700/api/v1/admin` (后端 API) |
| **下载地址** | TODO · 设计: Inno Setup 打包 → VPS `update.wahubx.com/releases/` 分发 · 当前未上线 |
| **GitHub repo** | `https://github.com/bryangeh79/WAhubX.git` |
| **当前稳定 branch** | `main` (远端) · 当前工作 branch: `claude/goofy-mendel-3f5881` (worktree) |
| **当前最新 commit** | `43311de feat(runtime-process): D12-3 · active slot auto-spawn` (本地 worktree HEAD · 52 个文件 modified 未提交) |
| **开发起始日** | 2026-04-19 |
| **开发节奏** | V1.0 约 6.5 个月 / 27 周 / 11 个里程碑 (M1-M11) |
| **目标市场** | 马来西亚优先 · 架构预埋多国 (`country/timezone/language` 字段) |
| **作者 / 联系** | Bryan Geh `<bryangeh79@gmail.com>` |

**FAhubX 只读参考路径** (Facebook 版 · 同套架构):
```
C:\AI_WORKSPACE\Facebook Auto Bot\
https://github.com/bryangeh79/FAhubX.git
```
🔒 **铁律**: 只读复用 · 永不 commit / push FAhubX 仓库.

---

## 📊 2. 当前系统状态

### 2.1 已完成且测试通过 ✅
- M1 基础骨架 (auth / users / tenants / licenses / proxies)
- License 激活流程 (machine_fingerprint 绑定 + JWT 双 token 颁发)
- Slot CRUD / 50 槽位上限按套餐 (Basic 10 / Pro 30 / Enterprise 50)
- Baileys runtime 路径 (老路径 · 现降为 fallback)
- 任务调度 (NestJS dispatcher · 60s tick · 6 槽位并发 · 夜间窗口 02-06)
- 18 种 task executor (chat / send_image / status_post / ...)
- 100 剧本包导入 + 复用 (M4)
- AI 改写 (DeepSeek/Gemini/OpenAI/Claude/Piper/Flux 6 provider · 租户自填 key · M6)
- 智能客服 V1 (KB / FAQ Jaccard / smart RAG · 8 层闸门 decider · M? · `intelligent-reply` 模块)
- Takeover 接管锁 + chat / send / inbound 实时 (M9)
- 群养号 plan (group_warmup_plan · v1_7day / v1_14day_full 模板)
- 广告投放向导 + 客户群 + 文案变体 (Campaigns 模块)
- **Chromium runtime 路径** (D7-D12 · 替代 Baileys 主战场):
  - puppeteer-core spawn per-slot
  - WS bridge (port 9711) cmd/ack/event 协议
  - sendText / sendMedia (image/file) DOM 自动化
  - inbound 高保真 (P0.11 chat-reader · `schemaVersion='p0.11-hifi'`)
  - CDP screencast 嵌入 5173 接管 canvas (P0.10++)
  - WA Status / Profile 真功能 (D11 · 2026-04-26 落地)
- **R9-bis facade 收敛** (2026-04-26): 全部 send/isOnline 走 `SlotsService` facade · 双 mode 兼容

### 2.2 初步完成但**未充分实测** ⚠
- D11 · WA Status / Profile (`postStatusText/Media`, `browseStatuses`, `reactStatuses`, `updateProfileAbout`) 选择器**未用真号 devtools 校准** · 上线前必须过一遍
- D12 · per-slot Chromium 子进程独立 fingerprint / TLS 隔离 · 设计已完 · 真稳定性 24h+ soak 还没跑
- 子进程崩溃 auto-respawn watchdog · 写了但没遇到真崩溃验过
- `reactivateAndRespawn` baileys 模式自愈 · chromium 模式没等价 · 离线只能用户手动重连
- 5 个 R9-bis 修复点 (ChatExecutor / ScriptRunner / ReplyExecutor / SendAdExecutor / AutoReplyExecutor) — TS 通过, 用户号还在养号期, 真发未实测

### 2.3 暂时不可用 / 待后续 ❌
- **VPS 端 license 服 + 升级分发** — 设计完成, 无部署
- Inno Setup 打包 → 安装包分发链路 — `installer/wahubx-setup.iss` 写好但未真出过发布版
- WA Status / 浏览 / 点赞 / Profile 在 chromium 路径 (代码完成, 选择器未实测)
- video status 发送 (chromium 路径未实现 · 留 D11+)

### 2.4 未来优化项
- **Phase 2** (D12 完成后): 24h soak 验证 chromium 多账号稳定性 · 反检测三件套 (stealth / human-behavior / fingerprint) 加强
- 多语言 i18n (V1 锁中文)
- VPS license 服 + 升级分发上线
- Inno Setup 打包 + 自动更新管道
- 监控 / 告警接口 (当前只有日志)
- Mobile 端 / Electron native window

### 2.5 已知技术债
- **52 个文件未提交** (worktree 状态, 见 git status). 包含 D11 + R9-bis + UI 改造. 需要梳理拆 commit
- **VPS 部署链路 0%** · 当前所有 "生产" 操作仅指本地桌面应用形态
- 单元测试覆盖率低 · 关键路径仅集成测试
- baileys.service.ts 仍是 1100+ 行单文件 · pool 管理 + worker 路径同居 · 后续要拆
- chrome-runtime selector 多 fallback 写到了但每个选择器没真号验证过版本漂移率
- Status 浏览/点赞 chromium 实现是 "进 viewer + 等 dwell + esc" 简单循环 · 没实现"按 author 找特定 status"
- 老 baileys workerManager Phase 2 代码还在 · D12 子进程上线后该清理

### 2.6 已知 bug / workaround
- **440 死循环** (老 baileys 路径已知): WA 标记多次, 换 IP 也不回血. Workaround: 不再用同账号扫码, 换号
- 长时间运行 sock 失效 → P0.6 加了 mutex + hard timeout 兜底, 但偶发 page.$ hang · 25s 强制 abort 兜底
- chat-list watchdog SOAK_MODE 移除 (P1.5) · 当前持续监控不仅 soak
- chrome 用户偶有 "headless: true 模式找不到 file chooser" · 用 `page.waitForFileChooser()` + `chooser.accept(path)` 解决
- TaskRun "stuck Running" 偶发 · dispatcher 60s 抢夺逻辑兜底
- 接管 lock 跨用户冲突: 当前 admin 强抢 · viewer/operator 403

---

## 🏗 3. 整体架构蓝图

### 3.1 文字描述
WAhubX 是一个**本地桌面 SaaS** — 租户在自己机器装一个 Inno Setup 打包的安装程序, 跑起来后:
- 后端 NestJS 监听 `localhost:9700` (HTTP API + WS)
- 前端 Vite 监听 `localhost:5173`, 浏览器打开就是控制台
- 数据库 PostgreSQL 16 跑在本地 Docker (`localhost:5434`), Redis 跑 6381
- WhatsApp 操作通过 **runtime-chromium 子进程** 跑 puppeteer-core 控制 Chrome WA Web
- License 服在 VPS (未上线 · 设计中) 验激活码 + 派发更新
- 多账号 → 一个机器多个 chromium 子进程 → 每号独立 user-data-dir + 独立 TLS

### 3.2 模块关系图 (text)

```
┌──────────── 本地桌面 (租户机器) ────────────┐
│                                            │
│  Browser (Chrome/Edge)                     │
│   └──→ http://localhost:5173 (Vite frontend)│
│         └──→ http://localhost:9700/api/v1   │
│                ↓                            │
│         NestJS Backend (Node.js)            │
│         ├── PostgreSQL :5434 (Docker)       │
│         ├── Redis :6381 (BullMQ)            │
│         ├── License 验证 (本地 cache + 远端)│
│         └── runtime-bridge :9711 (WS)       │
│                ↓                            │
│         runtime-chromium (per-slot child)   │
│         ├── puppeteer-core                  │
│         ├── 独立 user-data-dir              │
│         ├── WA Web https://web.whatsapp.com │
│         └── stealth + human-behavior 反检测 │
│                                            │
└────────────────────────────────────────────┘
            ↑ HTTPS (license / 升级)
            ↓
┌──────────── VPS (TODO 未上线) ──────────────┐
│  license.wahubx.com (Express + SQLite)     │
│    POST /verify  POST /activate  GET /version│
│  update.wahubx.com (Nginx 静态)             │
│    /releases/wahubx-setup-1.0.0.exe         │
└────────────────────────────────────────────┘
```

### 3.3 用户激活流程 (端到端)
1. 用户从 `update.wahubx.com/releases/` 下载 `wahubx-setup-X.X.X.exe`
2. 运行安装程序 (Inno Setup) → 装到 `C:\Program Files\WAhubX\`
3. 安装期间起本地 PostgreSQL + Redis (Docker compose) + Backend + Frontend (PM2 / Windows Service)
4. 浏览器打开 `localhost:5173` → 看到 `<ActivatePage>` 让填 license key
5. 前端 POST `/api/v1/licenses/activate` `{ key, machineFingerprint }`
6. 后端先调 VPS license 服 `POST license.wahubx.com/verify` 验 key
7. 验过后**事务性**: 创建第一个 admin user (`admin@wahubx.local`) → 写 `licenses` 表 → 绑 machine_fingerprint → 颁 JWT 双 token
8. 前端跳 `<DashboardPage>` → 用户开始绑 WA 号扫码

### 3.4 Admin 管理 license 流程
1. 平台超管 (`tenant_id=null` · 跑在 license 服那台) 登录 admin 面板
2. `POST /api/v1/admin/licenses` 创建 license · 填套餐 (Basic/Pro/Enterprise) · 有效期
3. 系统生成 license key (uuid + crypto signature) · 推到 SQLite
4. 销售把 key 给客户
5. 客户激活后, license 表标 `activatedAt` + `machineFingerprint`
6. Admin 可 `PATCH /admin/licenses/:id { revoked: true }` 吊销
7. 客户端下次 `verify` (启动时 + 每 24h) 收到 revoked → 锁前端 + 弹换 key

### 3.5 任务调度 / WhatsApp 自动化流程
1. 用户在 `<SchedulerPage>` 创建任务 (e.g. `chat`, `send_image`, `status_post`)
2. 后端 `tasks` 表写 `pending`
3. `DispatcherService` 每 60s tick · 拉 pending · 6 槽位并发限制
4. 派给某 slot 的 executor (e.g. `ChatExecutor.execute(ctx)`)
5. Executor 调 `SlotsService.sendText/sendMedia` facade
6. Facade 按 `RUNTIME_MODE` 路由:
   - `chromium` → `runtimes.current().sendCommand('send-text', ...)` → WS 桥 → runtime-chromium 子进程 → puppeteer DOM 操作
   - `baileys` → `BaileysService.sendText` → socket pool / worker
7. 结果回写 `task_runs` (success/fail/error)
8. 失败按指数退避重试

### 3.6 接管 (人工介入) 流程
1. 客户在 WA Web 给客服号发消息 → runtime-chromium `inbound-watcher.ts` MutationObserver 捕到
2. P0.11 高保真路径: `enterChat → readLatestMessages → exitChat` → 推 `message-upsert` 事件
3. WS 桥转发 backend `runtime.bridge.message-upsert`
4. `SlotsService.onChromiumMessageUpsert` 处理:
   - 角色 gate (D11-3): 仅 `customer_service` slot 走持久化 + emit `takeover.message.in`
5. `AutoReplyDeciderService` 听 `takeover.message.in` · 8 层闸门 (mode/stage/24h limit/keywords)
6. 决定回复 → `ReplyExecutorService` 走 FAQ Jaccard 匹配或 RAG+LLM
7. 回复走 `slots.sendText` → 真发出去
8. 用户主动接管时: 前端 `<TakeoverPage>` → `acquireLock` → CDP screencast 实时画面 → 用户 mouse/key 反向注入

---

## 📂 4. 真实项目路径

> **注意**: 本项目当前**只在本地开发机**, 没有 VPS 部署. 下表里的 "VPS 路径" 全标 TODO.

### 4.1 本地开发机 (Windows)

| 用途 | 路径 |
|---|---|
| **项目根** (主) | `C:\AI_WORKSPACE\Whatsapp Auto Bot\` |
| **项目根** (当前 Claude worktree) | `C:\AI_WORKSPACE\Whatsapp Auto Bot\.claude\worktrees\goofy-mendel-3f5881\` |
| 后端代码 | `packages/backend/src/` |
| 前端代码 | `packages/frontend/src/` |
| Shared 共享类型 | `packages/shared/src/` |
| Runtime Chromium | `packages/runtime-chromium/src/` |
| Backend build 输出 | `packages/backend/dist/` |
| Frontend build 输出 | `packages/frontend/dist/` |
| Backend `.env` | `packages/backend/.env` (开发用) |
| Backend `.env.example` | `packages/backend/.env.example` (模板, 入仓) |
| 数据库 migration | `packages/backend/src/database/migrations/` (28 个 ts 文件) |
| Backend 日志 | (NestJS pino 默认 stdout) · 重定向到文件需 PM2 配置 |
| Slot session 数据 | `packages/backend/data/slots/<slotId>/wa-session/` |
| Chromium 用户数据 | `packages/backend/data/chromium-profiles/<slotId>/` (D12+) |
| Diagnostic 截图 | `packages/backend/data/diagnostics/` |
| Inno Setup 打包配置 | `installer/wahubx-setup.iss` |
| Installer 打包 staging | `installer/staging/` (gitignore) |
| 100 剧本包源 | `scripts/` (M4 用) |
| 文档 | `docs/` |

### 4.2 VPS 路径 (TODO · NEEDS VERIFY · 未部署)

设计意图 (从 `docs/RELEASE-V1.0.md` 和设计文档汇总):

| 用途 | 设计路径 |
|---|---|
| License 服项目根 | `/srv/wahubx/license-server/` (TODO 未建) |
| 升级文件分发 | `/var/www/update.wahubx.com/releases/` (TODO 未建) |
| Nginx 配置 | `/etc/nginx/sites-available/wahubx-license.conf` (TODO) |
| PM2 app 名 | `wahubx-license` (TODO) |
| SQLite license DB | `/srv/wahubx/license-server/data/licenses.sqlite` (TODO) |
| 日志 | `/var/log/wahubx/license-server/` (TODO) |
| SSL | Let's Encrypt · `/etc/letsencrypt/live/license.wahubx.com/` (TODO) |

### 4.3 永远不要乱删的路径
- `packages/backend/data/slots/*/wa-session/` — WA 会话密钥, 删了号要重扫码
- `packages/backend/.env` — JWT secret + DB 密码
- `packages/backend/data/diagnostics/` — Chromium 失败截图证据
- `keys/` (gitignore) — M11 dev/prod 签名密钥对
- migration 文件 (即使重命名 ts) — 跑过的 migration 在 DB 有记录, 改名会乱

### 4.4 启停命令 (本地)

```bash
# 前置: Docker + pnpm 已装
cd "C:\AI_WORKSPACE\Whatsapp Auto Bot\.claude\worktrees\goofy-mendel-3f5881"

# 启动数据库 + Redis
docker compose -f docker-compose.dev.yml up -d

# 启动后端 (端口 9700)
pnpm dev:backend

# 启动前端 (端口 5173) - 另一个终端
pnpm dev:frontend

# 启动 runtime-chromium (现在 backend 自动 spawn per-slot · 不用手起)
# 但调试可独立起一个: cd packages/runtime-chromium && npm run dev
```

---

## 📁 5. 代码结构说明

### 5.1 根目录
```
Whatsapp Auto Bot/
├── packages/                  # pnpm workspace
│   ├── backend/               # NestJS API
│   ├── frontend/              # React + Vite
│   ├── shared/                # 共享 TS 类型 (runtime-protocol 等)
│   └── runtime-chromium/      # puppeteer-core 子进程
├── docs/                      # 设计文档 / 交接 / known-limitations
├── installer/                 # Inno Setup 打包
├── scripts/                   # 100 剧本包源数据 (M4)
├── docker-compose.dev.yml     # PG + Redis 本地依赖
├── pnpm-workspace.yaml        # workspace 声明
├── package.json               # 根 (pnpm 脚本)
├── CLAUDE.md                  # Claude 工作守则 (项目契约)
├── START_M1.md                # M1 启动说明
├── WAhubX_技术交接文档.md      # DB schema + API + 调度状态机 (权威)
├── WAhubX_产品介绍书.html      # 业务全景
└── PROJECT_HANDOVER_2026-04-26.md  # 本文件
```

### 5.2 Backend (`packages/backend/src/`)
```
src/
├── main.ts                    # 入口 · NestFactory · 全局异常 safety net
├── app.module.ts              # 根 module · 拼装所有子模块
├── common/                    # 跨模块工具 (storage / fingerprint)
├── database/
│   ├── data-source.ts         # TypeORM datasource (CLI 用)
│   └── migrations/            # 28 个 ts migration
└── modules/                   # 业务模块 (25 个)
    ├── auth/                  # JWT + bcrypt + 5-fail lock
    ├── users/                 # 1:N tenant · admin/operator/viewer
    ├── tenants/               # 租户实体 · 套餐限额
    ├── licenses/              # license 激活 / 验证 / fingerprint 绑定
    ├── slots/                 # 50 槽位 + facade (sendText/sendMedia/isOnline 路由)
    ├── proxies/               # 代理池
    ├── baileys/               # 老 WA 路径 (现 fallback)
    ├── runtime-bridge/        # WS 桥 + screencast.gateway
    ├── runtime-process/       # per-slot 子进程管理 (D12)
    ├── slot-runtime/          # ISlotRuntime 抽象 + Baileys/Chromium 实现
    ├── tasks/                 # dispatcher + 18 种 executor
    │   └── executors/         # chat/send_image/status_react/etc
    ├── warmup/                # 养号计划 + status-post/browse executor
    ├── scripts/               # 100 剧本包 + AI 改写
    ├── ai/                    # 6 provider 适配 + tenant key
    ├── intelligent-reply/     # KB / FAQ / 8 层闸门 decider / RAG
    ├── campaigns/             # 广告投放 + 客户群 + send-ad executor
    ├── takeover/              # 接管锁 + chat / send / inbound 转发
    ├── channel-items/         # 频道+群手填项
    ├── execution-groups/      # 槽位分组
    ├── account-health/        # 健康度 / suspended 检测
    ├── assets/                # 媒体素材池
    ├── signing/               # M11 数字签名
    ├── update/                # 版本检查
    ├── backup/                # 备份导出
    └── health/                # GET /health
```

### 5.3 Frontend (`packages/frontend/src/`)
```
src/
├── main.tsx                   # React 入口
├── index.css                  # 全局样式
├── app/
│   └── App.tsx                # 路由 + 顶部菜单 + 鉴权 Layout
├── auth/                      # AuthContext + 登录态
├── lib/                       # api 客户端 (axios) + extractErrorMessage
└── pages/
    ├── LoginPage.tsx
    ├── ActivatePage.tsx       # license key 激活
    ├── DashboardPage.tsx      # 仪表盘 (本次 UI 重做)
    ├── SlotsPage.tsx          # 账号槽位 (本次 UI 重做)
    ├── SchedulerPage.tsx      # 任务调度
    ├── TakeoverPage.tsx       # 客服接管中心
    ├── SettingsPage.tsx       # 设置 / AI key
    ├── AdminPage.tsx          # 平台超管
    ├── HealthPage.tsx
    ├── MonitoringPage.tsx
    ├── ads/                   # 广告投放页 (AdsHomePage 等)
    ├── reply/                 # 智能客服 (ReplyPage 等)
    ├── takeover/              # 接管子组件 (TakeoverEmbeddedWindow / CustomerArchivePanel)
    ├── bind/                  # 绑号 modal (BindExistingModal)
    ├── chat/                  # 接管聊天 modal
    ├── sim/                   # SIM 信息 modal
    └── admin/                 # admin 子组件
```

### 5.4 关键文件用途
| 文件 | 作用 |
|---|---|
| `packages/backend/src/main.ts` | 入口, 全局 unhandledRejection 拦, 全局 ValidationPipe, body 25MB |
| `packages/backend/src/app.module.ts` | 装配所有 25 个模块 |
| `packages/backend/src/modules/slots/slots.service.ts` | **核心 facade** · `sendText/sendMedia/isOnline/postStatus*/etc` 双 mode 路由 |
| `packages/backend/src/modules/slot-runtime/slot-runtime.registry.ts` | RUNTIME_MODE env 路由 baileys/chromium |
| `packages/backend/src/modules/runtime-bridge/runtime-bridge.service.ts` | WS 桥 cmd/ack/event 协议实现 |
| `packages/backend/src/modules/runtime-process/runtime-process-manager.service.ts` | per-slot child_process.spawn 管理 |
| `packages/backend/src/modules/tasks/dispatcher.service.ts` | 60s tick · 6 并发 · 夜间窗口 |
| `packages/backend/src/modules/intelligent-reply/services/auto-reply-decider.service.ts` | 8 层闸门 + 8s 聚合窗 |
| `packages/runtime-chromium/src/index.ts` | runtime 入口 · cmd handlers · 1100+ 行 |
| `packages/runtime-chromium/src/wa-web/actions.ts` | sendText/sendMedia DOM 自动化 |
| `packages/runtime-chromium/src/wa-web/chat-reader.ts` | 高保真 inbound (P0.11) |
| `packages/runtime-chromium/src/wa-web/status.ts` | **D11 新** · WA Status DOM 自动化 (post/browse/react) |
| `packages/runtime-chromium/src/wa-web/profile.ts` | **D11 新** · 改签名 |
| `packages/runtime-chromium/src/wa-web/wa-web-selectors.ts` | 选择器中央表 |
| `packages/shared/src/runtime-protocol.ts` | WS cmd/ack/event 类型 (双端唯一来源) |
| `packages/shared/src/slot-runtime.ts` | ISlotRuntime 接口 |

---

## 🔐 6. 环境变量与密钥

### 6.1 Backend `.env` (`packages/backend/.env`)

| 字段 | 必填 | 用途 | dev 值 | 生产值 |
|---|---|---|---|---|
| `NODE_ENV` | ✅ | 环境标识 | `development` | `production` |
| `PORT` | ✅ | 后端端口 | `9700` | `9700` (本地桌面应用 · 不公网) |
| `LOG_LEVEL` | ✅ | pino 日志级别 | `debug` | `info` |
| `DB_HOST` | ✅ | PG 主机 | `localhost` | `localhost` |
| `DB_PORT` | ✅ | PG 端口 | `5434` | `5434` |
| `DB_USERNAME` | ✅ | PG 用户 | `wahubx` | `<DB_USER_HERE>` |
| `DB_PASSWORD` | ✅ | PG 密码 | `wahubx` | `<DB_PASSWORD_HERE>` |
| `DB_DATABASE` | ✅ | DB 名 | `wahubx` | `wahubx` |
| `JWT_ACCESS_SECRET` | ✅ | access token 签名 | `dev_access_secret_change_me_32_chars_min` | `<JWT_ACCESS_SECRET_HERE>` (32+ 字节随机) |
| `JWT_REFRESH_SECRET` | ✅ | refresh token 签名 | `dev_refresh_secret_change_me_32_chars_min` | `<JWT_REFRESH_SECRET_HERE>` |
| `JWT_ACCESS_TTL` | ✅ | access 过期 | `15m` | `15m` |
| `JWT_REFRESH_TTL` | ✅ | refresh 过期 | `7d` | `7d` |
| `LOGIN_MAX_ATTEMPTS` | ✅ | 失败锁阈值 | `5` | `5` |
| `LOGIN_LOCKOUT_SECONDS` | ✅ | 锁时长 | `900` | `900` |
| `BCRYPT_ROUNDS` | ✅ | 密码 hash | `12` | `12` |
| `REDIS_HOST` | ✅ | Redis 主机 | `localhost` | `localhost` |
| `REDIS_PORT` | ✅ | Redis 端口 | `6381` | `6381` |
| `REDIS_PASSWORD` | ⬜ | Redis 密码 | (空) | `<REDIS_PASSWORD_HERE>` |
| `REDIS_DB` | ⬜ | Redis DB 号 | `0` | `0` |
| `SCHEDULER_MAX_CONCURRENCY` | ✅ | 并发槽 | `6` | `6` |
| `SCHEDULER_POLL_INTERVAL_MS` | ✅ | tick 间隔 | `3000` | `3000` |
| `SCHEDULER_NIGHT_WINDOW_START` | ✅ | 夜间窗起 | `02:00` | `02:00` |
| `SCHEDULER_NIGHT_WINDOW_END` | ✅ | 夜间窗止 | `06:00` | `06:00` |
| `APP_ENCRYPTION_KEY` | ✅ | AI key 加密 主密钥 | `__GENERATE...__` | `<openssl rand -hex 32 OUTPUT>` |
| `AI_TEXT_ENABLED` | ⬜ | AI 改写冷启动 | `false` | `false` |
| `RUNTIME_MODE` | ⬜ | runtime 路由 | (默认 baileys) | `chromium` (推荐) |
| `RUNTIME_HEADED` | ⬜ | chromium 是否 headed | `false` | `false` |

### 6.2 密钥生成
```bash
# JWT secret (32 字节 hex)
openssl rand -hex 32

# 应用加密主密钥 (64 hex chars = 32 字节)
openssl rand -hex 32

# License 服签名密钥对 (M11)
# 见 packages/backend/src/modules/signing/ + keys/ 目录
```

### 6.3 生产部署密钥保护原则
- `.env` **永不入 git** (已在 `.gitignore`)
- 真实 token / secret **不要写进任何文档** · 用 `<XX_HERE>` 占位
- 密钥更换:
  1. 改 `.env`
  2. `pm2 restart wahubx-backend`
  3. JWT 改后所有用户被踢出 (强制重登, 老 token 失效)
  4. APP_ENCRYPTION_KEY 改后**所有 AI provider 配置失效** · 需用户重填

---

## 🔑 7. License Key / 授权系统

### 7.1 概览
- **存储**: `licenses` 表 (PostgreSQL · `LicenseEntity`)
- **本地缓存**: license 服 SQLite (TODO 未建) · 客户机 PG `licenses` 表
- **生成方**: 平台超管在 `<AdminPage>` (license 服那台) 创建
- **验证方**: 客户机本地 backend 启动时 + 每 24h 主动 `verify`

### 7.2 License key 格式
- UUID v4 + crypto signature (RSA / Ed25519 — 见 `signing` 模块, M11)
- 例: `WAHUBX-XXXX-XXXX-XXXX-XXXX-XXXX-CHECKSUM` (TODO 确认实际格式)

### 7.3 字段 (LicenseEntity)
| 字段 | 用途 |
|---|---|
| `id` | 主键 |
| `key` | license key 字符串 |
| `plan` | `basic` / `pro` / `enterprise` |
| `slotLimit` | 派生自 plan (10/30/50) |
| `tenantId` | 关联租户 (激活后写) |
| `machineFingerprint` | 客户机 hash (CPU + MAC + OS UUID) · 激活后绑定 |
| `activatedAt` | 激活时间 |
| `expiresAt` | 过期时间 |
| `revoked` | 是否吊销 |
| `revokedAt` / `revokedReason` | 吊销元数据 |

### 7.4 API
```bash
# 激活 (Public)
POST /api/v1/licenses/activate
Body: { key, machineFingerprint }
Resp: { user, tokens, license }

# 验证 (Public · 启动时跑)
POST /api/v1/licenses/verify
Body: { key, machineFingerprint }
Resp: { valid, plan, expiresAt, revoked, slotLimit }

# 查当前 license 状态 (Auth)
GET /api/v1/licenses/status

# Admin 创建/查/改/吊销
POST /api/v1/admin/licenses
GET  /api/v1/admin/licenses
PATCH /api/v1/admin/licenses/:id
DELETE /api/v1/admin/licenses/:id
```

### 7.5 流程
- **激活**: 见 §3.3
- **续期**: admin `PATCH /admin/licenses/:id { expiresAt: <new date> }` · 客户端下次 verify 收到新过期时间
- **吊销**: admin `PATCH /admin/licenses/:id { revoked: true, revokedReason: "..." }` · 客户端 verify 收到 `revoked=true` → 前端锁界面
- **删除**: 不建议 hard delete (留审计) · 用 revoked 软删

### 7.6 过期 / 错误 license 行为
- **过期**: `expiresAt < now()` → verify 返 `valid: false, reason: 'expired'` → 前端 `<ActivatePage>` 显"过期, 请续期"
- **吊销**: `revoked=true` → 同上 + 显吊销原因
- **错误 key**: verify 返 404 → 前端"无此 license"
- **机器指纹不符**: verify 返 `valid: false, reason: 'fingerprint_mismatch'` → 提示"已在别机激活"

### 7.7 测试 license 示例
```
# 假 key (开发/测试用 · 永不提到生产)
WAHUBX-TEST-1234-5678-9ABC-DEF0-12345678

# 当前 dev 数据库已有的测试 license:
- platform@wahubx.local (tenant_id=NULL, role=admin) · 平台超管
- admin@wahubx.local (tenant_id=1, role=admin, Basic 10) · dev 租户
- acme-admin@acme.com (tenant_id=2, Pro 30, License 已 revoke)
```

---

## 💾 8. 数据库说明

### 8.1 引擎
- **PostgreSQL 16** (强制 · `START_M1.md` 拍板 · 不许换)
- 本地 dev: Docker `wahubx-dev-pg` 容器 (`docker-compose.dev.yml`)
- 端口: **5434** (避开 FAhubX 5433)
- 时区: `Asia/Kuala_Lumpur`
- 客户端连接: `postgresql://wahubx:wahubx@localhost:5434/wahubx`

### 8.2 主要表 (41 个 entity · 28 个 migration)
| 表 | 用途 |
|---|---|
| `tenants` | 租户 · 1:N users · 套餐 + slot_limit |
| `users` | 1:N tenant · role(admin/operator/viewer) · platform admin tenant_id=null |
| `user_sessions` | refresh token 持久化 |
| `licenses` | license key + 激活元数据 |
| `account_slot` | 1..50 槽位 · phone/role/runtime/online/persona |
| `wa_account` | WA 账号详情 (warmup_stage 等) |
| `sim_info` | SIM 卡信息 (carrier/iccid/country) |
| `account_health` | 健康度 + suspended_until |
| `proxy` | 代理池 (residential/datacenter/wireguard) |
| `wa_contact` | WA 联系人 |
| `chat_message` | 消息 (in/out · waMessageId 唯一) |
| `tasks` | 任务队列 |
| `task_runs` | 单次执行记录 |
| `script` / `script_pack` | 剧本包 (M4) |
| `asset` | 媒体素材池 |
| `warmup_plan` | 单号养号计划 |
| `group_warmup_plan` | 群养号计划 (v1_7day/v1_14day) |
| `execution_group` | 槽位分组 |
| `channel_item` | 频道+群手填表 |
| `proxy` | 代理 |
| `ai_provider_config` | AI key (加密存) |
| `ai_settings` | 全局 AI 开关 |
| `risk_event` | 风险事件审计 |
| `app_setting` | 全局动态配置 |
| `knowledge_base` / `kb_source` / `kb_chunk` / `kb_faq` / `kb_protected` | 智能客服 KB |
| `tenant_reply_settings` | 智能客服模式 (off/faq/smart) |
| `customer_conversation` | 接管会话状态 |
| `pending_inbound` | 8s 聚合窗 buffer |
| `ai_reply_audit` | AI 回复审计 |
| `advertisement` / `opening_line` | 广告文案 + 开场白 (含 AI variants) |
| `customer_group` / `customer_group_member` | 广告受众 |
| `campaign` / `campaign_run` / `campaign_target` | 广告投放 |
| `backup_setting` | 备份配置 |

### 8.3 初始化 / migration / seed
```bash
cd packages/backend

# 跑全部 migration (新机器初始化)
pnpm migration:run

# 看 migration 状态
pnpm migration:show

# 回滚最后一个
pnpm migration:revert

# 创建新 migration
pnpm migration:create src/database/migrations/AddXyzColumn

# 自动 diff (entity 改后)
pnpm migration:generate src/database/migrations/AddXyzColumn
```

### 8.4 备份 / 恢复
```bash
# 备份 (本地 dev)
docker exec wahubx-dev-pg pg_dump -U wahubx wahubx > backup_$(date +%Y%m%d).sql

# 恢复
docker exec -i wahubx-dev-pg psql -U wahubx wahubx < backup_20260426.sql

# 完全清空 + 重 init (dev 用 · 慎)
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
cd packages/backend && pnpm migration:run
```

### 8.5 手动检查数据
```bash
# 进 psql
docker exec -it wahubx-dev-pg psql -U wahubx wahubx

# 常用 query
\dt                                       # 列表
SELECT id, slot_index, status, role, runtime FROM account_slot;
SELECT * FROM licenses ORDER BY created_at DESC LIMIT 5;
SELECT id, task_type, status FROM tasks ORDER BY id DESC LIMIT 20;
```

### 8.6 常见数据问题
| 问题 | 修法 |
|---|---|
| License revoked 但客户端还能用 | 客户端 24h 才 verify · 重启 backend 强 verify · 或 `DELETE FROM user_sessions WHERE tenant_id=X` 强踢登 |
| Slot 状态 stuck "connecting" | `UPDATE account_slot SET status='empty', account_id=NULL WHERE id=X` · 清 wa-session 文件夹 |
| Task 状态 stuck "running" 不动 | dispatcher 60s 抢夺逻辑兜底 · 或 `UPDATE tasks SET status='pending' WHERE id=X AND status='running'` |
| WA 号显示 phone 但 role 错 | `UPDATE account_slot SET role='broadcast' WHERE id=X` (D11-1 unique index 注意) |
| 老号死循环 440 | 本月已彻底标记 · 清空账号: `TRUNCATE wa_account, account_health, wa_contact CASCADE; UPDATE account_slot SET account_id=NULL, status='empty';` + 删 `data/slots/*/wa-session/*` |

---

## 🌐 9. API 完整说明

### 9.1 Base URL
- 本地: `http://localhost:9700/api/v1`
- 生产: TODO

### 9.2 Auth
- 登录后获 `accessToken` (15m) + `refreshToken` (7d)
- 后续请求 header: `Authorization: Bearer <accessToken>`
- access 过期: 用 refreshToken 调 `/auth/refresh`

### 9.3 核心 endpoint (主线)

#### Auth
```
POST /auth/login            { username, password }      → { user, tokens }
POST /auth/refresh          { refreshToken }            → { tokens }
POST /auth/logout           (auth)                      → { ok }
GET  /auth/me               (auth)                      → { user }
```

#### Licenses
```
POST /licenses/activate     { key, machineFingerprint } → { user, tokens, license }
POST /licenses/verify       { key, machineFingerprint } → { valid, plan, expiresAt, revoked }
GET  /licenses/status       (auth)                      → { plan, slotLimit, expiresAt, ... }
```

#### Slots
```
GET    /slots                                  → SlotItem[]
GET    /slots/:id                              → SlotItem
POST   /slots/:id/start-bind   { mode, ... }   → { qrDataUrl?, pairingCode? }
POST   /slots/:id/cancel-bind                  → { ok }
POST   /slots/:id/reconnect                    → { ok, message }
POST   /slots/:id/factory-reset                → { ok }
PATCH  /slots/:id              { role, proxyId, ... }
POST   /slots/:id/bring-to-front               → { ok }              (chromium · P0.10)
GET    /slots/:id/connection-diagnosis         → { online, count440, ... }
```

#### Tasks
```
GET    /tasks                  ?status=pending → TaskItem[]
POST   /tasks                  { taskType, targetIds, payload, scheduledAt? }
PATCH  /tasks/:id              { status: 'paused' | ... }
DELETE /tasks/:id
GET    /tasks/queue/running    → RunningRun[]
GET    /tasks/queue/pending
GET    /tasks/queue/failed-recent
```

#### Takeover (人工接管)
```
POST   /takeover/:accountId/acquire            → { lockId }
POST   /takeover/:accountId/heartbeat
POST   /takeover/:accountId/release
GET    /chats/:accountId/conversations         → ChatContact[]
GET    /chats/:accountId/messages   ?contactId&limit&beforeId
POST   /chats/:accountId/send-text   { to, text }
POST   /chats/:accountId/send-media  multipart (file + meta)
```

#### Intelligent Reply
```
GET    /reply-settings                         → { mode, kbId, ... }
PATCH  /reply-settings         { mode, kbId }
GET    /knowledge-base                         → KB[]
POST   /knowledge-base         { name }        → KB
POST   /knowledge-base/:id/upload-source       multipart (file)
GET    /knowledge-base/:id/faqs                → FAQ[]
POST   /knowledge-base/:id/faqs  { question, answer }
GET    /conversations          → CustomerConversation[]
```

#### Campaigns (广告投放)
```
GET    /campaigns                              → Campaign[]
POST   /campaigns              { adId, openingId, audienceId, schedule, throttleProfile }
POST   /campaigns/:id/start
POST   /campaigns/:id/pause
POST   /campaigns/:id/resume
GET    /campaigns/:id/report                   → CampaignReport
GET    /advertisements / opening-lines / customer-groups (CRUD)
```

#### Health (Public · 用于运维探活)
```
GET    /health                                 → { status, uptime_sec, version }
```

#### Admin (platform admin only · `tenant_id=null`)
```
GET    /admin/users
GET    /admin/tenants
GET    /admin/licenses    POST/PATCH/DELETE
GET    /admin/proxies     POST/PATCH/DELETE
GET    /admin/channel-items
GET    /admin/execution-groups
```

### 9.4 错误码常见
| HTTP | 含义 | 解 |
|---|---|---|
| 401 | token 过期 / 无效 | 跑 refresh 或重登 |
| 403 | 角色不足 (e.g. operator 调 admin endpoint) | 换 admin 账号 |
| 404 | 资源不存在 | 查 ID |
| 422 | DTO validation 失败 | 看 response.message 哪个字段 |
| 423 (custom) | login locked | 等 15min / 改 `LOGIN_LOCKOUT_SECONDS` |
| 500 | 后端崩 | 看 backend log |

### 9.5 curl 测试示例
```bash
# 登录
curl -sX POST http://localhost:9700/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin@wahubx.local","password":"Test1234!"}' | jq

# 拿 access token 后查 slots
TOKEN="..." # 从上一步 .data.tokens.accessToken
curl -s http://localhost:9700/api/v1/slots -H "authorization: Bearer $TOKEN" | jq

# 创建任务
curl -sX POST http://localhost:9700/api/v1/tasks \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"taskType":"chat","targetIds":[101],"payload":{"to":"60123456789","contentType":"text","text":"hi"}}'

# 健康检查
curl -s http://localhost:9700/api/v1/health | jq
```

---

## 🎨 10. 前端说明

### 10.1 路由 (`packages/frontend/src/app/App.tsx`)

| 路径 | 组件 | 用途 | 鉴权 |
|---|---|---|---|
| `/login` | LoginPage | 登录 | Public |
| `/activate` | ActivatePage | license key 激活 | Public |
| `/` (= /dashboard) | DashboardPage | 仪表盘 (本次 UI 重做) | Auth |
| `/slots` | SlotsPage | 账号槽位 (本次 UI 重做) | Auth |
| `/scheduler` | SchedulerPage | 任务调度 | Auth |
| `/ads` | AdsHomePage | 广告投放 | Auth |
| `/reply` | ReplyPage | 智能客服 | Auth (admin only) |
| `/takeover` | TakeoverPage | 人工接管中心 | Auth (admin only) |
| `/settings` | SettingsPage | 设置 | Auth |
| `/admin` | AdminPage | 平台超管 | Auth (platform admin) |
| `/health` | HealthPage | 系统健康 | Auth |
| `/monitoring` | MonitoringPage | 任务监控 | Auth |

### 10.2 主要组件 / 状态管理
- **AuthContext** (`auth/AuthContext.tsx`): 当前 user / licenseStatus / refresh logic
- **api 客户端** (`lib/api.ts`): axios 实例 + interceptor (auto refresh on 401)
- **antd 5** for UI · 品牌色 `#25d366` · 中文 locale
- **Vite proxy**: `vite.config.ts` 把 `/api` + `/socket.io` 转发到 backend 9700

### 10.3 build / 命令
```bash
# Dev (watch + HMR)
pnpm dev:frontend

# Build (out: packages/frontend/dist/)
pnpm build:frontend

# Preview (production-like serve)
pnpm --filter @wahubx/frontend preview

# Type check
pnpm --filter @wahubx/frontend typecheck
```

### 10.4 前端常见 bug 排查
| 现象 | 排查 |
|---|---|
| 页面白屏 | F12 → Console · 看红错堆栈 · 多半 import 路径 / 类型错 |
| 401 一直跳 login | accessToken 过期但 refresh 也失败 · 看 `Network` tab |
| 接管 canvas 黑屏 | screencast.gateway WS 没连上 · 看 Network → WS 标签 |
| antd 样式错乱 | 多版本 antd · `pnpm why antd` 看是否冲突 |
| 接 modal 卡死 | `React StrictMode` 双 mount · 检查 useEffect cleanup |

---

## ⚙ 11. 后端说明

### 11.1 入口
- 文件: `packages/backend/src/main.ts`
- 启动: `pnpm dev:backend` (nest start --watch)
- 监听: `0.0.0.0:9700`
- API 前缀: `/api/v1`

### 11.2 Middleware 链
1. body parser (25MB JSON / urlencoded)
2. nestjs-pino logger (替代 NestLogger)
3. ValidationPipe (whitelist + transform)
4. JwtAuthGuard (全局 · `@Public()` 装饰器豁免)
5. RolesGuard (controller 级)

### 11.3 Auth 逻辑
- POST `/auth/login` → bcrypt.compare → 颁 JWT 双 token → 写 `user_sessions`
- 失败 5 次 → `LOGIN_LOCKOUT_SECONDS` 锁 user
- access token 短 (15m) · 频繁 refresh 用 refresh token (7d)
- Refresh token 持久化 · 可逐 session 撤

### 11.4 错误处理
- `main.ts` 全局 unhandledRejection / uncaughtException 拦 · 不让单个 ENOENT 拖死整个 backend (Baileys session 文件被外部删的历史 bug)
- ValidationPipe 自动转 422
- BadRequestException / NotFoundException 等 NestJS 标准异常自动 4xx
- 业务错: 自定义 `TakeoverLockError` 等 · 加 errorCode

### 11.5 Logging
- nestjs-pino · stdout 输出 JSON
- 级别: `LOG_LEVEL` env (dev=debug, prod=info)
- 关键事件统一带 slotId / taskId 上下文

### 11.6 PM2 (TODO 生产部署)
```bash
# 设计 (未真用)
pm2 start dist/main.js --name wahubx-backend
pm2 logs wahubx-backend
pm2 restart wahubx-backend
pm2 save  # 持久化
```

---

## 🚀 12. 部署方式

### 12.1 当前状态
- ✅ 本地开发: 可跑
- ❌ 生产 VPS: 0%
- ❌ Inno Setup 打包安装: 未发布过
- ❌ License 服上线: 0%

### 12.2 本地首次部署步骤
```bash
# 1. clone
git clone https://github.com/bryangeh79/WAhubX.git
cd WAhubX

# 2. 装 pnpm (一次性)
npm install -g pnpm@9.15.0

# 3. 装依赖
pnpm install

# 4. 起 PG + Redis
docker compose -f docker-compose.dev.yml up -d

# 5. 复制 .env
cp packages/backend/.env.example packages/backend/.env
# 编辑 .env · 改 JWT_*_SECRET 和 APP_ENCRYPTION_KEY (运行 openssl rand -hex 32 三次)

# 6. 跑 migration
cd packages/backend && pnpm migration:run

# 7. 启动 backend (新终端)
pnpm dev:backend

# 8. 启动 frontend (新终端)
pnpm dev:frontend

# 9. 浏览器打开 http://localhost:5173
# 第一次跑可用 dev 数据 (见 §7.7) 或自己开 license 流程
```

### 12.3 日常更新
```bash
git pull
pnpm install        # 如果 pnpm-lock 改了
pnpm build:backend
pnpm build:frontend

# 如果有新 migration:
cd packages/backend && pnpm migration:run

# 重启
# (本地 dev: 直接 Ctrl+C 重跑 · 生产 PM2 restart)
```

### 12.4 VPS 部署 (TODO 设计中)
```
1. apt update && apt install nodejs nginx postgresql redis docker
2. clone repo to /srv/wahubx
3. pnpm install && pnpm build
4. cp .env.example .env · 改值
5. pm2 start dist/main.js --name wahubx-license
6. nginx 配置 /etc/nginx/sites-available/wahubx-license.conf · proxy_pass localhost:9700
7. certbot --nginx -d license.wahubx.com
8. nginx -t && systemctl reload nginx
9. pm2 save
```

### 12.5 客户机 Inno Setup 打包 (TODO)
```bash
cd installer
build-backend.bat   # 编译 backend → dist/
build-frontend.bat  # 编译 frontend → dist/
build.bat           # 调 ISCC.exe 打 wahubx-setup-X.X.X.exe
```

---

## 🐛 13. Debug 指南

### 13.1 前端打不开
```bash
# 1. 看 vite 是否在跑
netstat -ano | findstr :5173
# 没有 → cd packages/frontend && pnpm dev

# 2. 浏览器 F12 → Console 看错
# 多半: 后端没启 / API 401 / vite proxy 错

# 3. 看 vite 日志
# (它在终端那边输出, scroll up 看最近错)
```

### 13.2 后端 API 不通
```bash
# 1. 端口在没在
netstat -ano | findstr :9700

# 2. 健康检查
curl http://localhost:9700/api/v1/health
# 不通 → backend 没启

# 3. 看 backend 终端日志
# 找 "ERROR" / "FATAL"

# 4. 看是不是 DB 连不上
docker ps | findstr wahubx-dev-pg
# 没跑 → docker compose -f docker-compose.dev.yml up -d
```

### 13.3 License 验证失败
```bash
# 1. 看 DB
docker exec -it wahubx-dev-pg psql -U wahubx wahubx -c "SELECT * FROM licenses;"

# 2. 看前端 ActivatePage Network tab
# POST /licenses/verify 的 response

# 3. machineFingerprint 不匹配:
docker exec wahubx-dev-pg psql -U wahubx wahubx -c \
  "UPDATE licenses SET machine_fingerprint=NULL WHERE id=X;"
# 然后重新激活
```

### 13.4 Admin 登录失败
```bash
# 1. 用户存在吗
docker exec wahubx-dev-pg psql -U wahubx wahubx -c \
  "SELECT id, username, role, locked_until FROM users WHERE username='admin@wahubx.local';"

# 2. 被锁了 (5 次失败):
docker exec wahubx-dev-pg psql -U wahubx wahubx -c \
  "UPDATE users SET locked_until=NULL, failed_login_count=0 WHERE username='admin@wahubx.local';"

# 3. 密码忘:
# 重设 (bcrypt 12 round)
node -e "const b = require('bcryptjs'); console.log(b.hashSync('NewPass1234!', 12));"
docker exec wahubx-dev-pg psql -U wahubx wahubx -c \
  "UPDATE users SET password_hash='<HASH>' WHERE username='admin@wahubx.local';"
```

### 13.5 数据库异常
```bash
# 容器跑了吗
docker ps | grep wahubx-dev-pg

# 没起
docker compose -f docker-compose.dev.yml up -d

# 死透了 (corruption)
docker compose -f docker-compose.dev.yml down -v
# 清卷重起
docker compose -f docker-compose.dev.yml up -d
cd packages/backend && pnpm migration:run
# 然后 dev 用户重建 (见 CLAUDE.md §当前 dev 数据)
```

### 13.6 Nginx 502 / 404 (生产 · TODO)
```bash
# 看 nginx 错日志
tail -f /var/log/nginx/error.log

# 看 PM2
pm2 status
pm2 logs wahubx-backend --lines 100

# nginx 配置错
nginx -t

# upstream 不通
curl localhost:9700/api/v1/health  # PM2 后端死了
```

### 13.7 PM2 crash (生产 · TODO)
```bash
pm2 status                              # 看是否 errored
pm2 logs wahubx-backend --err --lines 200  # 错误日志
pm2 describe wahubx-backend             # 详细状态
pm2 restart wahubx-backend
```

### 13.8 build fail
```bash
# Backend
cd packages/backend
pnpm typecheck   # TS 错
pnpm build       # nest build 错

# Frontend
cd packages/frontend
pnpm typecheck
pnpm build

# 缓存怪
rm -rf node_modules/.cache dist .turbo
pnpm install
```

### 13.9 CORS
- Backend 当前接受 `localhost:5173` (Vite proxy)
- 生产: 配置 `enableCors({ origin: 'https://yourdomain' })` (TODO)
- 异常: 看 backend `app.module.ts` cors 配置

### 13.10 Cloudflare cache (TODO 生产用)
```bash
# 强刷 cache
curl -X POST "https://api.cloudflare.com/client/v4/zones/<ZONE>/purge_cache" \
  -H "authorization: bearer <CF_TOKEN>" \
  -d '{"purge_everything":true}'
```

---

## 📊 14. 日志与监控

### 14.1 命令
```bash
# 本地 dev (日志在终端 stdout)
# 直接看 pnpm dev:backend 那个终端

# PM2 (生产 · TODO)
pm2 logs wahubx-backend                 # 实时所有
pm2 logs wahubx-backend --lines 100     # 最近 100 行
pm2 logs wahubx-backend --err           # 仅错误
pm2 flush                               # 清日志

# Nginx (生产 · TODO)
tail -f /var/log/nginx/access.log       # 实时访问
tail -f /var/log/nginx/error.log        # 实时错误
tail -100 /var/log/nginx/wahubx-license.access.log

# Docker
docker logs -f wahubx-dev-pg            # PG 日志
docker logs -f wahubx-dev-redis
```

### 14.2 服务正常运行的判定
```bash
# Backend
curl http://localhost:9700/api/v1/health
# 期望: {"status":"ok","uptime_sec":1234,"version":"0.1.0"}

# Frontend
curl http://localhost:5173
# 期望: HTML (vite index)

# DB
docker exec wahubx-dev-pg pg_isready -U wahubx
# 期望: accepting connections

# Redis
docker exec wahubx-dev-redis redis-cli ping
# 期望: PONG
```

---

## 🗂 15. Git / 回滚

### 15.1 当前状态 (2026-04-26)
```
Branch (当前 worktree): claude/goofy-mendel-3f5881
Branch (主仓): main (远端)
最新 commit: 43311de feat(runtime-process): D12-3 · active slot auto-spawn
未提交文件: 52 个 (D11 + R9-bis + UI 改造)
```

### 15.2 提交流程
```bash
# 看改动
git status
git diff

# 分批 add (避免 .env 等敏感文件)
git add packages/backend/src/modules/slots/
git add packages/runtime-chromium/src/wa-web/
# ...

# 提交 (中文消息 OK)
git commit -m "feat(d11): WA Status / Profile 真功能 + R9-bis facade 收敛

- 加 5 个新 cmd: post-status-text/media · browse-statuses · react-status · update-profile-about
- 新建 wa-web/status.ts + wa-web/profile.ts (puppeteer DOM 自动化)
- SlotsService 加 facade · 双 mode 兼容
- 4 个 executor 去 chromium guard · 全走 facade
- TS 全绿 (shared / runtime-chromium / backend / frontend)"

# Push
git push origin claude/goofy-mendel-3f5881

# 合 main (PR)
# GitHub web 上发 PR · 走 review
```

### 15.3 回滚
```bash
# 看历史
git log --oneline -20

# 回滚到上一稳定版本 (软 · 保留改动)
git reset --soft <COMMIT_HASH>

# 完全回滚 (硬 · 危险!)
git reset --hard <COMMIT_HASH>

# 个别文件回滚
git checkout <COMMIT_HASH> -- path/to/file

# 回滚已 push 的 commit (用 revert · 保留历史)
git revert <COMMIT_HASH>
git push
```

### 15.4 哪些文件**不要** commit
- `.env` / `.env.*.local` (已 gitignore)
- `keys/` (M11 签名密钥对)
- `dev-snapshots/` (PG dump 备份)
- `node_modules/`
- `dist/` / `.cache/` / `*.tsbuildinfo`
- `staging/` (Inno Setup 临时输出)
- `data/` 任何 (slot session / chromium-profiles / diagnostics)

`.gitignore` 已覆盖以上.

---

## ✅ 16. 测试说明

### 16.1 已做的测试
- ✅ TS strict 全绿 (shared / backend / frontend / runtime-chromium)
- ✅ Backend 单元测试 (jest · 部分模块 · 不全)
- ✅ Sanity smoke: login → activate license → slot CRUD → bind → sendText
- ✅ 5 个真号绑成功 + 跑养号 (M3-M4 完整链路)
- ✅ T2.1-T2.5 image+file 发送 (chromium 路径 P0.5/P0.6)
- ✅ 接管 CDP screencast (P0.10++)
- ✅ 高保真 inbound (P0.11)
- ✅ 群养号 plan 启动 + day 1 分发任务 (R11)

### 16.2 测试账号 / license
```
平台超管: platform@wahubx.local / Test1234! (tenant_id=NULL)
dev 租户: admin@wahubx.local    / Test1234! (tenant_id=1, Basic 10)
真激活案例: acme-admin@acme.com  / AcmeAdmin1234! (tenant_id=2, Pro 30, License 已 revoke 测试)
```

### 16.3 测试步骤 (smoke)
```bash
# 后端
curl -sX POST http://localhost:9700/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"username":"admin@wahubx.local","password":"Test1234!"}' | jq .tokens.accessToken

# 前端
打开 http://localhost:5173/login
登录 admin@wahubx.local / Test1234!
跳到 /slots · 应见 50 槽位 (10 active + 40 empty)
跳到 / · 应见仪表盘 4 张状态卡全绿
```

### 16.4 部署后 smoke checklist
- [ ] `/api/v1/health` 返 status:ok
- [ ] 前端能登录
- [ ] DB migration 全跑过 (`pnpm migration:show`)
- [ ] License `/verify` 通
- [ ] 至少 1 个 slot 能 bind 成功
- [ ] 至少 1 个 task 能跑通 (chat 或 status_post)
- [ ] 接管 CDP screencast 能渲染
- [ ] 智能客服 inbound 能触发回复

### 16.5 还没做的测试
- ❌ 24h soak (chromium 多账号长时间稳定性)
- ❌ D11 status/profile 真号选择器实测
- ❌ R9-bis 修复后 chat task 在 chromium 下真发 (号都在养号期)
- ❌ License revoke → 客户端锁死的端到端
- ❌ Inno Setup 全链路打包 + 安装 + 卸载
- ❌ 多租户隔离 (当前本地部署单租户)

---

## 🛡 17. 安全注意事项

### 17.1 强约束
- ✋ 真实 secret / token / 密码 **永远不写进任何 .md / .ts 文件** · 用 `<XX_HERE>` 占位
- ✋ `.env` **永不 commit** (已 gitignore)
- ✋ `keys/` **永不 commit**
- ✋ License key **不放任何文档示例** · 测试用假 key 或 dev 库内的测试账号
- ✋ JWT secret 改后**所有用户登出** · 生产慎重换
- ✋ `APP_ENCRYPTION_KEY` 改后**租户的 AI provider key 全失效**

### 17.2 token 更换流程
```bash
# 生成新 secret
openssl rand -hex 32

# 改 .env
nano packages/backend/.env

# 重启
pnpm dev:backend
# 或生产: pm2 restart wahubx-backend
```

### 17.3 admin 权限保护
- platform admin (`tenant_id=null`) 不暴露给租户登录界面 · 只 license 服自己用
- 租户 admin 也别给外部用户 · 给 operator
- viewer 完全只读

### 17.4 CORS / rate limit / auth
- 当前 CORS 默认 (开发够用)
- ❌ 没有 rate limit (未上线生产前 OK · 上 VPS 必须加 nginx limit_req 或 nestjs throttler)
- 全局 JwtAuthGuard 默认 require · `@Public()` 显式豁免

### 17.5 生产必须
- HTTPS (Let's Encrypt)
- nginx rate limit (尤其 /licenses/verify 和 /auth/login)
- fail2ban
- DB 不暴露公网 (本地桌面应用模式: 都在 127.0.0.1, OK)
- 定期备份 license 服 SQLite + dev PG dump

---

## ⚡ 18. 新 Agent 10 分钟接手指南

### 第 1 分钟 · 看哪里
- 本文件 §1 (项目身份) + §2 (当前状态)
- `CLAUDE.md` (项目契约 · 工作风格)

### 第 2-3 分钟 · 检查路径
```bash
cd "C:\AI_WORKSPACE\Whatsapp Auto Bot\.claude\worktrees\goofy-mendel-3f5881"

# 看根
ls
cat package.json | head -20

# 看 backend modules
ls packages/backend/src/modules/

# 看 frontend pages
ls packages/frontend/src/pages/

# 看当前 git 状态
git status --short | wc -l   # 现在应是 52
git log --oneline -5
```

### 第 4-5 分钟 · 跑命令
```bash
# 起依赖 (如果没跑)
docker compose -f docker-compose.dev.yml up -d
docker ps  # 看 wahubx-dev-pg + wahubx-dev-redis

# TS check (确认无 regress)
cd packages/backend && npx tsc --noEmit -p tsconfig.json
cd ../frontend && npx tsc --noEmit -p tsconfig.json
cd ../runtime-chromium && npx tsc --noEmit -p tsconfig.json
cd ../shared && npx tsc -p tsconfig.json
```

### 第 6-8 分钟 · 启动确认
```bash
# 后端
pnpm dev:backend
# 等 "WAhubX backend listening on http://localhost:9700/api/v1"

# 前端 (另一终端)
pnpm dev:frontend
# 等 "Local: http://localhost:5173"

# Smoke
curl http://localhost:9700/api/v1/health
# 浏览器打开 http://localhost:5173
# 登录 admin@wahubx.local / Test1234!
```

### 第 9-10 分钟 · debug / 开发
- 看 §13 Debug 指南 找到对应症状的命令
- 改代码 → Vite HMR 前端自动 / NestJS watch 后端自动重启
- 跑 TS check 验证
- commit 时按 §15.4 注意敏感文件

---

## ✅ 19. 最终 Checklist

### 19.1 部署 checklist (本地 dev)
- [ ] `git pull` 拉新代码
- [ ] `pnpm install` 装新依赖
- [ ] Docker PG + Redis 跑着 (`docker ps`)
- [ ] `.env` 存在且 secret 不是默认值
- [ ] `pnpm migration:run` (如有新 migration)
- [ ] `pnpm dev:backend` 起 backend (看 9700 监听)
- [ ] `pnpm dev:frontend` 起 frontend (看 5173 监听)
- [ ] `curl /health` 通
- [ ] 浏览器登录通
- [ ] TS 全绿

### 19.2 Debug checklist
- [ ] 看 `git status` 是否有未提交污染
- [ ] backend 终端有无 ERROR / unhandledRejection
- [ ] frontend F12 Console 有无红错
- [ ] DB 容器在跑 (`docker ps`)
- [ ] `/health` 返 ok
- [ ] migration 状态 (`pnpm migration:show` 全 X)
- [ ] 复现步骤 / payload 写下来

### 19.3 Release checklist (TODO 未实操)
- [ ] 全部 TS 全绿
- [ ] migration 跑通 (干净 DB)
- [ ] smoke test (§16.4) 全过
- [ ] 24h soak (chromium · 多账号)
- [ ] CHANGELOG 更新
- [ ] version bump (`packages/*/package.json` + 根 `package.json`)
- [ ] 标 git tag
- [ ] Inno Setup 重打包 (`installer/build.bat`)
- [ ] 测试安装包安装 + 启动 + 卸载
- [ ] License 服更新 release 版本号
- [ ] 上传 setup.exe 到 `update.wahubx.com/releases/`

### 19.4 Handover checklist
- [x] 项目基本信息记录 (§1)
- [x] 当前状态梳理 (§2)
- [x] 架构蓝图 (§3)
- [x] 路径清单 (§4)
- [x] 代码结构 (§5)
- [x] 环境变量 (§6)
- [x] License 系统 (§7)
- [x] 数据库 (§8)
- [x] API (§9)
- [x] 前端 (§10)
- [x] 后端 (§11)
- [x] 部署 (§12)
- [x] Debug (§13)
- [x] 日志 (§14)
- [x] Git (§15)
- [x] 测试 (§16)
- [x] 安全 (§17)
- [x] 10 分钟指南 (§18)
- [x] Checklist (§19)
- [ ] 此交接文档已被新接手人**通读 + 跑通 dev 启动**

---

## 📝 附录 · 重要事件时间线

| 日期 | 事件 |
|---|---|
| 2026-04-19 | 项目启动 · M1 框架 |
| 2026-04-21 | M3 调度器实装 · 6 槽位并发 |
| 2026-04-22 | 18 个 executor + 养号链路 |
| 2026-04-23 | M? 广告投放 + 客户群 + 文案 AI variants |
| 2026-04-24 | M? 智能客服 V1 + KB / FAQ + RAG |
| 2026-04-25 | **大转向**: 抛 Baileys 主战场 → 统一 Chromium WA Web (D6-D9) |
| 2026-04-25 | D6 PASS · D7 反检测三件套完 · D8 WS 桥完 · D9 ISlotRuntime |
| 2026-04-26 | D10 sendText/sendMedia chromium 路径 |
| 2026-04-26 | P0.1-P0.6 · race fix + mutex + hard timeout + file chooser |
| 2026-04-26 | P0.7-P0.11 · file attach + Status seed UI + bringToFront + screencast + 高保真 inbound |
| 2026-04-26 | R5-R13 · UI 残项收尾 (placeholder phone / 卡片 UI / SchedulerPage modal / 养号进度条) |
| 2026-04-26 | **D11 真功能**: WA Status post/browse/react + Profile updateAbout · 5 个 cmd · 选择器多 fallback |
| 2026-04-26 | **R9-bis 收敛**: 全部 baileys 直调点改走 SlotsService facade · 9 处修 (Class A 7 + Class B 2) |
| 2026-04-26 | 仪表盘 / 槽位 / 空槽位区 UI 重做按参考图 (浅绿渐变 + pill + 真插画) |

---

**生成时间**: 2026-04-26
**生成方**: Claude (this session)
**涵盖范围**: 完整项目交接 · 19 个章节 · 设计 + 当前状态 + debug + 部署 + 安全
**下次更新触发**: 任何主线大变 (如 D12 完成 / 生产部署上线 / V1.0 release)
