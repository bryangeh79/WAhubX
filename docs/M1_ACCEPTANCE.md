# M1 基础骨架 · 验收清单 (`v0.1.0-m1`)

**交付日期**: 2026-04-19
**开发周期**: 4 周（实际压缩到若干 session）
**commit 数**: 16+ · tag 版本 4（`-m1-w1` / `-w2` / `-w3` / `-m1`）

本页是 M1 结算的"技术完成度"证据，对照 `START_M1.md` 里 M1 Week 的 5 项交付和核心决策表执行。

---

## § 1. `START_M1.md` 规定的必须交付

### 1.1 项目脚手架 ✅

| 项 | 要求 | 结果 |
|---|---|---|
| 后端框架 | NestJS 10 + TypeScript | ✅ `@nestjs/core@10.4.x` + TS 5.6 strict |
| 前端框架 | React 18 + TypeScript + Vite | ✅ React 18.3 + Vite 5.4 + TS 5.6 |
| 仓库结构 | 单一仓库（monorepo 或并列）| ✅ pnpm monorepo (`packages/backend`, `packages/frontend`, `installer`) |
| 代码混淆 | `javascript-obfuscator` 配置 | ✅ `installer/obfuscate.js` 选择性混淆 5 个敏感文件 |
| 构建脚本 | `build-backend.bat` / `build-frontend.bat` | ✅ `installer/build-*.bat` |

### 1.2 数据库基础 ✅

| 项 | 要求 | 结果 |
|---|---|---|
| DB | PostgreSQL 主 / SQLite 可选 | ✅ PG 16-alpine docker（host :5433）· SQLite 推迟到 M10 |
| 初始 migration | ✅ | 3 个 migration (`Init` / `UsersAndSessions` / `SlotsAndAccounts`) |
| 核心表: `tenant` | ✅ | id / name / email unique / plan enum / slot_limit / status / country/timezone/language |
| 核心表: `license` | ✅ | license_key unique / tenant_id FK / machine_fingerprint / issued_at / expires_at / last_verified_at / revoked |
| 核心表: `account_slot` | ✅ | SERIAL id / tenant_id FK / slot_index (1..slot_limit) / account_id UNIQUE / status enum / persona JSONB |
| 核心表: `wa_account` | ✅ | phone UNIQUE / warmup_stage/day / device_fingerprint JSONB |
| 核心表: `sim_info` | ✅ | carrier / sim_type enum / monthly_cost decimal |
| 核心表: `account_health` | ✅ | health_score / risk_level enum / risk_flags JSONB[] |
| 核心表: `proxy` | ✅ | type enum / bound_slot_ids int[] |

### 1.3 从 FAhubX 复用 4 个模块 ✅

| 模块 | 状态 | 文件 |
|---|---|---|
| `auth` | ✅ 拷贝改造 | `packages/backend/src/modules/auth/` · JWT 双 token · bcryptjs 12 · lockout 5×/15min |
| `users` | ✅ 拷贝改造 | `packages/backend/src/modules/users/` · 加 `tenant_id` FK + role enum(admin/operator/viewer) · 去 FB 业务字段 |
| `license` | ✅ 拷贝改造 | `packages/backend/src/modules/licenses/` · 本地单 DB 版（去 VPS 心跳 + 缓存逻辑）· machine-id.util 移植 |
| `admin-licenses` | ✅ 拷贝改造 | `packages/backend/src/modules/licenses/admin-licenses.controller.ts` · 文案改 WAhubX · 套餐改 basic/pro/enterprise |

### 1.4 新建 1 个模块 ✅

| 模块 | 状态 | 文件 |
|---|---|---|
| `slots` | ✅ | `packages/backend/src/modules/slots/` · 激活自动开 N 槽 · 租户隔离 · GET list/:id, POST :id/clear |

### 1.5 前端 ✅

| 页面 | 状态 | 路由 |
|---|---|---|
| 登录页 | ✅ | `/login` |
| 设置页（空壳，有导航）| ✅ | `/settings` (5 面板，账号资料实装，其他占位) |
| Admin 后台 | ✅ | `/admin` (3 tab: 租户 / License / 用户) |
| 槽位列表页（空壳，显示 N 个空槽位卡片）| ✅ | `/slots` (xs24/sm12/md8/lg6/xl4 响应式 grid) |

---

## § 2. 本里程碑**不做**的（守界线，确认没跑偏）

- ❌ Baileys 集成 → M2 ✅ 没做
- ❌ 任何 WA 协议相关 → M2 ✅ 没做
- ❌ 任务调度、BullMQ → M3 ✅ 没做
- ❌ 剧本引擎 → M4 ✅ 没做
- ❌ AI / 素材生成 → M6-M7 ✅ 没做
- ❌ 接管 UI → M9 ✅ 没做
- ❌ 打包成安装包 → M11（注：build 脚本已有，Inno Setup .iss 没写）✅ 合规

---

## § 3. 已拍板决策（`START_M1.md` § 已拍板决策）落地核验

| 决策 | 落地证据 |
|---|---|
| 部署模式：本地桌面应用 | `LicenseService.machineId` 绑定本机 / 无 VPS 心跳 |
| 套餐档位 Basic 10 / Pro 30 / Enterprise 50 | `tenant.entity.ts::PLAN_SLOT_LIMIT` 常量 + 激活时 `slots.seedForTenant(manager, tenantId, slotLimit)` |
| DB PostgreSQL 主 | `database.module.ts` + `docker-compose.dev.yml` PG16 |
| WA 协议 Baileys | M2，未做（合规）|
| 浏览器隔离独立 user-data-dir | `account_slot.profile_path` 字段预留，M2 填 |
| 全局 6 槽位并发 | M3 实装，字段 `task_status` 待建 |
| 代理 1:3-5 | `proxy.bound_slot_ids int[]` 已建，M3 仲裁实装 |
| 养号 5 天默认 | `wa_account.warmup_stage/warmup_day` 已建，M5 排期 |
| AI 全选配 + Piper + Flux | M6/M7，`settings.json` 结构已在技术交接文档 § 8 定 |
| 语音 Piper 本地免费默认 | 同上 |
| 告警桌面弹窗 | M8，技术交接文档已拍板 |
| 日志本地永久 | pino + 本地文件（生产部署加 rotation）|
| 备份：每日自动 + 手动 .wab + 原厂重置 | M10 |
| 更新：手动 .wupd | M10 |
| 国家预埋 | `tenant.country/timezone/language` + `wa_account.country_code/primary_language` + `users.language` 三级预埋 |
| 剧本包 .wspack + 100 剧本 | 原始素材在 `scripts/`，M4 加载器 |

---

## § 4. 端到端冒烟（实测证据 · 非脑补）

完整 happy path：

```
① docker compose up -d                            → PG :5433 healthy
② 平台超管登录 (platform@wahubx.local / Test1234!)  → 200 access+refresh token
③ POST /admin/licenses {tenantName:"Delta Ent", plan:"enterprise"}
                                                   → 201 · licenseKey=WA-G5SM-VELA-7NG5-SMVE · tenantId=4
④ POST /license/activate {licenseKey, adminEmail, adminUsername, adminPassword}
   原子事务:
     - 校验 key / 未吊销 / 未过期 / 未绑定
     - 创建 admin user (uuid, tenant_id=4, role=admin, bcrypt 12)
     - 写 license.machine_fingerprint=本机 + issued_at=now
     - 调 slots.seedForTenant(manager, 4, 50) 插 50 条 empty 槽 slot_index 1..50
                                                   → 200 返 tenant/user 摘要
⑤ 新 admin 登录                                    → 200
⑥ GET /slots (delta admin)                         → 200 · count=50 · indexes 1..50 · all empty
⑦ POST /license/verify {licenseKey}                → {valid:true}
⑧ GET /slots/1 (delta admin)                       → 200
   GET /slots/1 (tenant 1 admin)                   → 403 "无权限访问该槽位"
⑨ vite 5173 SPA: / /admin /slots /health /settings → 5 路由全 200
   /api/v1/admin/tenants (platform token, via proxy)→ 4 rows
⑩ 混淆后 dist 重启 backend                         → 5 文件混淆 · 所有端点 200
```

DB 终态（`SELECT t.id, t.name, t.plan, COUNT(s.id)`）：

```
 id |   name           |    plan    | slot_count
----+------------------+------------+------------
  1 | Dev Tenant       | basic      |    0    ← 预 Week 3 手播，无槽（期望）
  2 | Acme Sdn Bhd     | pro        |    0    ← 预 Week 3 手播，无槽（期望）
  3 | Beta Corp        | basic      |   10    ← Week 3 seed hook 自动开
  4 | Delta Enterprise | enterprise |   50    ← Week 4 E2E 自动开
```

---

## § 5. 已知限制 / TODO（不是 bug，是 M1 scope 边界）

见 [CHANGELOG.md § Known Limitations](../CHANGELOG.md)，10 项全部登记，每项标明目标里程碑。

---

## § 6. 下一站

**M2 · Baileys 集成（3 周）**
- 注册新号流程（`POST /slots/:id/register { phone, sim_info, proxy_id }`）
- 扫码登录（绑定现有号）
- Baileys session 落盘到 `data/slots/<slotIndex>/wa-session/`
- 基础发消息 / 接消息 webhook
- 启用前端 SlotsPage 的"注册 / 管理"按钮（目前 disabled）

开工前对齐：Baileys 版本选择（@whiskeysockets/baileys latest 还是固定 minor 避免上游 breaking change）、SIM 卡来源与代理预算 SOP。
