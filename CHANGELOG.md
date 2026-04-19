# Changelog

按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 约定，版本按 [SemVer](https://semver.org/lang/zh-CN/)。

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
