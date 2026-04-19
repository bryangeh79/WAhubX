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

# 2. 起 PostgreSQL (host :5433, 避开 FAhubX 的 5432)
docker compose -f docker-compose.dev.yml up -d

# 3. 装依赖 (monorepo 根一次性安装所有 packages)
pnpm install

# 4. 准备后端 .env
cp packages/backend/.env.example packages/backend/.env
#    默认值匹配 docker-compose.dev.yml, 无需修改即可开发

# 5. 跑 migration 建表
pnpm --filter @wahubx/backend migration:run

# 6. 启动 (两个终端)
pnpm dev:backend         # http://localhost:3000/api/v1
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
| PostgreSQL (dev docker) | **5433** | 主机侧 5433 → 容器 5432 (避让 FAhubX 占用的 5432) |
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

**后端启动 `ECONNREFUSED 127.0.0.1:5433`**
→ docker 容器没起来。`docker compose -f docker-compose.dev.yml up -d` 后等 5 秒（healthcheck）。

**migration:run 报 `relation ... already exists`**
→ 数据库被手动改过。最快: `docker compose down -v && docker compose up -d && pnpm migration:run`。

**`pnpm --filter @wahubx/backend` 提示 `No projects matched`**
→ 从仓库根目录跑，不是从 `packages/backend/`。

**5432 端口冲突**
→ 本机已有 PG 占用；docker-compose 已把 WAhubX 映射到 5433，若还冲突改 `docker-compose.dev.yml` 里的 `'5433:5432'` 首字段。

---

## 开发节奏（M1 Week 2 起）

- 每张表新增 → `pnpm migration:generate src/database/migrations/<语义化名字>` → review 生成 SQL → commit 实体和 migration 一起
- **绝不手改已 merge 的 migration 文件**；要改就再发一个新 migration
- 提 commit 前：`pnpm typecheck && pnpm --filter @wahubx/backend build`
- 前端改页面前：看看 `packages/frontend/src/pages/HealthPage.tsx` 是最小可运行模板

---

## 参考文档

- [WAhubX_技术交接文档.md](../WAhubX_技术交接文档.md) · DB schema / API / 状态机 · **最权威**
- [WAhubX_产品介绍书.html](../WAhubX_产品介绍书.html) · 业务全景
- [START_M1.md](../START_M1.md) · M1 启动说明 + 已拍板决策清单
