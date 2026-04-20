# `installer/scripts/` · 运行时脚本 · Day 3-4 补全

## 预期脚本 (M11 Day 3-4 交付)

### 顶层 (`{app}` 目录)
- `wahubx.bat` · 前台启动入口 · 用户点桌面图标触发
- `start.bat` · 后台启动 3 个服务 (pg / redis / backend)
- `stop.bat` · 按 PID 停服 · 不用 `-IM node.exe` (CLAUDE.md 铁律)

### 数据目录 (`{app}/scripts`)
- `init-db.bat` · 首次安装跑 `pg_ctl initdb` + 创建 db/user + 跑 TypeORM migrations
- `generate-env.js` · 从 Inno 向导端口配置生成 `.env` 文件 (backend 读)

### 服务配置
- `redis.conf` · 绑 localhost + 禁持久化 (cache 用 · 非主存储)

## Day 1.5 不写以上脚本的原因

- 这些脚本调用 **backend 内部 logic** (generate-env.js 算 encryption key · init-db.bat 跑 migrations)
- Day 1.5 严守 "installer 基座" scope · 不触 backend/frontend
- Day 3-4 UpdateService 实装时会一并产出

## 参照

- 改编源: `C:/AI_WORKSPACE/Facebook Auto Bot/installer/scripts/` · 逐脚本改 FAhubX → WAhubX
- 改动点: 端口默认值 · 服务名称 · pg schema init · TypeORM datasource 路径
