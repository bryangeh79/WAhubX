# WAhubX · 本地开发指南

> 从零起一台干净 Windows/Mac/Linux 把 WAhubX 跑起来。

---

## 前置依赖

| 工具 | 版本 | 验证 |
|---|---|---|
| Node.js | ≥ 20 | `node -v` |
| pnpm | ≥ 9 | `pnpm -v` (没有就 `npm i -g pnpm@9`) |
| Docker Desktop | 最新稳定 | `docker compose version` |
| Git | 任意 | `git --version` |

---

## 首次搭建（5 分钟）

```bash
# 1. 拉代码
git clone https://github.com/bryangeh79/WAhubX.git
cd WAhubX

# 2. 起 PostgreSQL (host :5434, 避开 FAhubX 的 5432/5433) + Redis (:6381, 避 6379/6380)
docker compose -f docker-compose.dev.yml up -d

# 3. 装依赖 (monorepo 根一次性安装所有 packages)
pnpm install

# 4. 准备后端 .env
cp packages/backend/.env.example packages/backend/.env
#    默认值匹配 docker-compose.dev.yml, 无需修改即可开发

# 5. 跑 migration 建表
pnpm --filter @wahubx/backend migration:run

# 6. 启动 (两个终端)
pnpm dev:backend         # http://localhost:9700/api/v1
pnpm dev:frontend        # http://localhost:5173
```

浏览器访问 **http://localhost:5173** → 应看到"系统健康"卡片，status = OK。

---

## 常用命令

### 根目录（workspace 聚合）
```bash
pnpm dev:backend                # 启动后端 (nest start --watch)
pnpm dev:frontend               # 启动前端 (vite dev)
pnpm build                      # 构建所有 package
pnpm typecheck                  # 所有 package 类型检查
pnpm test                       # 所有 package 跑测试
pnpm lint                       # 所有 package 跑 lint
```

### 后端专属
```bash
pnpm --filter @wahubx/backend dev            # 开发模式
pnpm --filter @wahubx/backend build          # 编译到 dist/
pnpm --filter @wahubx/backend migration:generate src/database/migrations/<Name>
pnpm --filter @wahubx/backend migration:run
pnpm --filter @wahubx/backend migration:revert
pnpm --filter @wahubx/backend migration:show
pnpm --filter @wahubx/backend test:e2e       # 需 PG 运行
```

### 前端专属
```bash
pnpm --filter @wahubx/frontend dev           # Vite dev server (:5173)
pnpm --filter @wahubx/frontend build         # 产物到 dist/
pnpm --filter @wahubx/frontend preview       # 预览 build 产物
```

### Docker
```bash
docker compose -f docker-compose.dev.yml up -d       # 启动 PG
docker compose -f docker-compose.dev.yml down        # 停止 (保留数据)
docker compose -f docker-compose.dev.yml down -v     # 停止 + 删卷 (⚠️ 清库)
docker exec -it wahubx-dev-pg psql -U wahubx -d wahubx   # 进入 psql
```

---

## 端口清单

| 服务 | 端口 | 说明 |
|---|---|---|
| Backend (NestJS) | 3000 | `/api/v1/...` |
| Frontend (Vite dev) | 5173 | 代理 `/api` 到 3000 |
| PostgreSQL (dev docker) | **5434** | 主机侧 5434 → 容器 5432 (避 FAhubX 占用的 5432/5433) |
| Redis (dev docker) | **6381** | 主机侧 6381 → 容器 6379 (避 FAhubX 的 6380) |
| Backend HTTP | **9700** | 原 3000 迁至 9700 (避 FAhubX 9600) |
| Redis (未启用) | 6379 | M3 任务调度阶段加入 |

---

## 目录结构

```
WAhubX/
├── packages/
│   ├── backend/              @wahubx/backend · NestJS 10
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── config/       env.validation / logger.config
│   │   │   ├── database/     data-source.ts (CLI), database.module.ts, migrations/
│   │   │   └── modules/
│   │   │       ├── health/
│   │   │       ├── tenants/  (entity only, service/controller 在 Week 2)
│   │   │       ├── licenses/
│   │   │       └── proxies/
│   │   ├── .env.example
│   │   └── package.json
│   │
│   └── frontend/             @wahubx/frontend · React 18 + Vite 5 + antd 5
│       ├── src/
│       │   ├── main.tsx
│       │   ├── app/App.tsx   (路由 + Layout)
│       │   ├── lib/api.ts    (axios instance + token 拦截器)
│       │   └── pages/HealthPage.tsx
│       └── vite.config.ts    (dev proxy /api → :3000)
│
├── installer/                Inno Setup 打包 (M11)
├── scripts/                  100 剧本原始素材 (M4+)
├── docker-compose.dev.yml
├── package.json              workspace 根
└── pnpm-workspace.yaml
```

---

## Troubleshooting

**`Error: Invalid environment variables`**
→ 忘了 `cp packages/backend/.env.example packages/backend/.env` 或 `.env` 少字段。

**后端启动 `ECONNREFUSED 127.0.0.1:5434`**
→ docker 容器没起来。`docker compose -f docker-compose.dev.yml up -d` 后等 5 秒（healthcheck）。

**migration:run 报 `relation ... already exists`**
→ 数据库被手动改过。最快: `docker compose down -v && docker compose up -d && pnpm migration:run`。

**`pnpm --filter @wahubx/backend` 提示 `No projects matched`**
→ 从仓库根目录跑，不是从 `packages/backend/`。

**5434 端口冲突**
→ 本机已有 PG 占用；docker-compose 已把 WAhubX 映射到 5434 (避 FAhubX 的 5433)，若仍冲突改 `docker-compose.dev.yml` 里的 `'5434:5432'` 首字段。

---

## 开发节奏（M1 Week 2 起）

- 每张表新增 → `pnpm migration:generate src/database/migrations/<语义化名字>` → review 生成 SQL → commit 实体和 migration 一起
- **绝不手改已 merge 的 migration 文件**；要改就再发一个新 migration
- 提 commit 前：`pnpm typecheck && pnpm --filter @wahubx/backend build`
- 前端改页面前：看看 `packages/frontend/src/pages/HealthPage.tsx` 是最小可运行模板

---

## M11 · 本地打包 `.wupd` 升级包 (开发者流程)

完整架构见 [UPGRADE.md](./UPGRADE.md). 本节是**开发者**端的 hands-on 手册.

### 一次性准备 · 生成生产密钥对

```bash
node scripts/sign-wupd.js genkey --out-dir ~/wahubx-signing-keys/
```

输出:
- `privkey.pem` (0600 权限) · **离线保管 · 绝不 commit 入仓库**
- `pubkey.pem` · 明文公钥 PEM
- `pubkey.hex` · 64 hex 字符 · 复制到 `packages/backend/src/modules/signing/public-key.ts` 的
  `WAHUBX_UPDATE_PUBLIC_KEY_HEX` 常量.

提交代码 · rebuild · 分发 installer.

### 每次发版 · 打包 + 签名 .wupd

```bash
# 1. build
cd packages/backend && pnpm run build
cd ../frontend && pnpm run build
cd ../../

# 2. 打 app.tar (参考 .wupd apply 路径 · {app}/backend {app}/frontend 等子目录)
tar -cf staging/app.tar \
  -C packages/backend dist/ node_modules/ package.json \
  -C ../frontend dist/

# 3. 组装 .wupd (pack-wupd CLI)
node scripts/pack-wupd.js \
  --from 0.10.0-m10 --to 0.11.0-m11 \
  --app-tar staging/app.tar \
  --migrations "packages/backend/src/database/migrations/1779*.ts" \
  --out output/WAhubX-0.11.0-m11.wupd

# 4. 签名 (就地覆写)
node scripts/sign-wupd.js sign \
  --wupd output/WAhubX-0.11.0-m11.wupd \
  --privkey ~/wahubx-signing-keys/privkey.pem

# 5. Verify sanity
node scripts/sign-wupd.js verify \
  --wupd output/WAhubX-0.11.0-m11.wupd \
  --pubkey-hex <pubkey.hex>

# 6. 分发 · 客户 Admin UI 升级 tab 上传
```

### 本地测试 .wupd 格式 + 签名

启动 backend (dev 模式 dry-run 不影响) · 登录拿 token · 上传 `.wupd` 看 preview:

```bash
TOKEN=$(curl -s -X POST http://localhost:9700/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"platform@wahubx.local","password":"Test1234!"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

curl -s -X POST http://localhost:9700/api/v1/version/verify-upd \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@output/WAhubX-0.11.0-m11.wupd" | python -m json.tool
```

期望:
- `signature_valid=true` (前提 public-key.ts 是真公钥, 非全 0 dev placeholder)
- `version_compat` ∈ {ok, major-bump, same, downgrade}
- `can_apply=true` (所有 check 过)

### .wupd 格式快速自查

```bash
# Magic bytes 必须 'WUPD'
xxd -l 4 output/WAhubX-0.11.0-m11.wupd
# 00000000: 5755 5044    WUPD
```

### Bootstrap 端点 (补强 1)

未登录可查:
```bash
curl http://localhost:9700/api/v1/version/bootstrap
# {"fresh_install":false,"platform_admin_exists":true,"license_activated":true,"app_version":"0.1.0"}
```

给 installer + 前端首屏诊断用. Fresh install 时 fresh_install=true · 跳 License Key 流.

### Installer 构建 (Windows only)

```bash
# 1. 准备 portable binaries (一次性 · 详见 installer/deps/README.md)
#    下载放到 installer/deps/{node-lts-embedded, pgsql-portable, redis-windows}/

# 2. 放产品图标 installer/assets/wahubx.ico

# 3. 装 Inno Setup 6 · https://jrsoftware.org/isinfo.php

# 4. 构建
cd installer && build.bat
# 输出: installer/output/WAhubX-Setup-v0.11.0-m11.exe
```

build.bat 9 步编排自动跑 backend/frontend build + deps copy + iscc 编译.

---

## Fingerprint 文件命名约定 (M11 Preamble)

`data/config/` 下 3 份独立 fp 文件 · **用途正交, 不共享**:

| 文件 | 出处 | 算法 | 格式 | 用途 |
|---|---|---|---|---|
| `fp-license.txt` | M1 (M11 改名) | SHA-256(MAC+CPU).slice(32) | 32 hex | License 绑定 |
| `fp-master-key.txt` | M10 (M11 改名) | SHA-256(host\|platform\|arch\|MAC\|CPU\|RAM) | 64 hex | AES 密钥派生 |
| `fp-installer.txt` | M11 新 | JSON · arch/osMajor/ramBucket/createdAt | JSON | Installer 硬件兼容性 |

**不要**起第 4 份 `machine-fingerprint.txt` 之类模糊命名 · 用 `fp-<用途>.txt`.

**旧名自动迁移**: M10 → M11 升级时 `machine-id.util` 和 `MachineBoundMasterKeyProvider` 检测旧名 → atomic rename · 6 个月后 V1.1 可删 fallback.

---

## 参考文档

- [WAhubX_技术交接文档.md](../WAhubX_技术交接文档.md) · DB schema / API / 状态机 · **最权威**
- [UPGRADE.md](./UPGRADE.md) · M11 升级架构完整文档 (10 节 · 发版手册 + 客户 troubleshoot)
- [WAhubX_产品介绍书.html](../WAhubX_产品介绍书.html) · 业务全景
- [START_M1.md](../START_M1.md) · M1 启动说明 + 已拍板决策清单
