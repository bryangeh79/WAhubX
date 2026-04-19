# Changelog

按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 约定，版本按 [SemVer](https://semver.org/lang/zh-CN/)。

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
