# WAhubX

> WhatsApp 多账号自动化运营平台 · 本地桌面应用 · SaaS 授权

**状态**: 🚧 M1 基础骨架开发中 (2026-04-19 启动)
**版本**: v0.1.0-dev
**授权**: Proprietary — All Rights Reserved (见 [LICENSE](./LICENSE))

---

## 项目简介

WAhubX 是面向马来西亚市场的 WhatsApp 多账号自动化运营 SaaS。

- **套餐**: Basic 10 号 / Pro 30 号 / Enterprise 50 号
- **部署**: 租户本地 Windows 桌面应用，Inno Setup 打包
- **控制平面**: VPS 只做 License 发放 + 升级包 + 剧本包分发
- **执行平面**: 租户本机运行 Baileys + Chromium 接管 + 本地数据库

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | NestJS 10 + TypeScript + TypeORM |
| 前端 | React 18 + TypeScript + Vite + Ant Design |
| 数据库 | PostgreSQL 16 |
| 队列 | Redis 7 + BullMQ (M3+) |
| WA 协议 | @whiskeysockets/baileys (M2+) |
| 接管浏览器 | Puppeteer + Chromium |
| 打包 | Inno Setup 6 |

## 仓库结构 (Monorepo · pnpm workspace)

```
WAhubX/
├── packages/
│   ├── backend/          NestJS API (localhost:3000)
│   ├── frontend/         React + Vite
│   └── shared/           共享 DTO / 类型 / 枚举
├── installer/            Inno Setup 打包 (M11)
├── scripts/              100 剧本包原始素材 (M4+)
├── START_M1.md           M1 启动说明
├── WAhubX_技术交接文档.md  技术规格
└── WAhubX_产品介绍书.html  产品全景
```

## 开发

> ⚠️ 尚未初始化 packages/，M1 Week 1 任务进行中。

```bash
# 安装依赖 (M1 完成后可用)
pnpm install

# 后端开发
pnpm --filter backend dev

# 前端开发
pnpm --filter frontend dev
```

## 里程碑

| 阶段 | 周数 | 进度 |
|---|---|---|
| M1 · 基础骨架 | 4 | 🟡 进行中 |
| M2 · Baileys 集成 | 3 | ⚪ |
| M3 · 任务调度 | 3 | ⚪ |
| M4 · 剧本引擎 | 3 | ⚪ |
| M5 · 养号日历 | 2 | ⚪ |
| M6 · AI 层 | 2 | ⚪ |
| M7 · 素材生成 | 2 | ⚪ |
| M8 · 健康分 | 2 | ⚪ |
| M9 · 接管 UI | 2 | ⚪ |
| M10 · 备份/更新 | 2 | ⚪ |
| M11 · Admin/打包 | 2 | ⚪ |

完整规格见 [WAhubX_技术交接文档.md](./WAhubX_技术交接文档.md)。

## License

Proprietary. Commercial SaaS. 详见 [LICENSE](./LICENSE)。

联系: bryangeh79@gmail.com
