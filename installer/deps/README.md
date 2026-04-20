# `installer/deps/` · 预编译二进制占位

本目录用于 Inno Setup 打包所需的**第三方二进制**. 这些文件**不进 Git** (体积大 + 非代码) ·
CI / build.bat 构建时动态下载或从缓存复制.

## 期望结构 (M11 Day 3-4 build.bat 会准备)

```
installer/deps/
├─ node-lts-embedded/        Node 20 LTS portable · ~60MB
│  ├─ node.exe
│  ├─ npm.cmd
│  └─ node_modules/          运行 backend 必需依赖
├─ pgsql-portable/           PostgreSQL 16 portable · ~200MB
│  └─ bin/ + share/ + ...
├─ redis-windows/             Redis for Windows · ~8MB
│  └─ redis-server.exe + ...
└─ piper/ (optional)          Piper TTS · ~50MB · M7 之前留空
   └─ piper.exe + voices/
```

## Node 20 LTS 下载

**官方 portable 版**:
- URL: https://nodejs.org/dist/v20.19.4/node-v20.19.4-win-x64.zip (以最新 20.x LTS 为准)
- 解压到 `installer/deps/node-lts-embedded/`
- 确保 `node.exe` 在子目录根

**为何 Node 20 不是 22**:
- WAhubX V1 backend 当前依赖稳定 (NestJS 10 / TypeORM 0.3 / sharp / baileys) 均在 Node 20 LTS 上验证
- Node 22 LTS 升级排 V1.1 · 需整栈回归

**V1.1 升级 Node 22**:
- Node 20 EOL 2026-04 已过 · 停止 CVE patch
- 升级工作预估 1 周 · 验证:
  - @nestjs/* v10 兼容性
  - sharp 原生模块重编
  - baileys ESM 行为
  - typeorm data-source 加载

## CI 自动下载

`installer/build.bat` 应在构建前检查目录存在性 · 缺失则下载. 见 `build.bat` 注释区.

## 不用 npm install 在 deps/

`node_modules/` 应**构建时**从 `packages/backend/` 复制进 `staging/backend/node_modules/`,
不是预置在 deps/ 下. 保 deps/ 只放纯二进制.
