# FETCH-DEPS · 逐项下载手册 + 校验

> 对齐 v0.12.0-m7 · 替补 `installer/deps/README.md`
> 目的: 新开发机 / 新 CI runner 从 0 准备 installer build 所需的全部二进制

---

## 总览

| 组件 | 必需性 | 大小 | 用途 |
|---|---|---|---|
| Node 20 LTS (Windows portable) | 必需 | ~60 MB | backend 运行 |
| PostgreSQL 16 (portable) | 必需 | ~200 MB | 业务数据库 |
| Redis for Windows | 必需 | ~8 MB | 队列 + 接管锁 |
| `wahubx.ico` (产品方图标) | 必需 | <200 KB | installer + .exe 图标 |
| Inno Setup 6 | 必需 | ~5 MB | 打包工具 (开发机装) |
| Piper + 模型 | 可选 | ~50 MB | TTS (V1 可跳 · 运行时降级) |
| ComfyUI + flux-dev | 可选 | ~23 GB | 本地 AI 图片 (客户装 · installer 不打包) |

---

## 1. Node 20 LTS (Windows x64 Portable)

### 下载

**最新 20.x LTS**:
```
https://nodejs.org/dist/v20.19.4/node-v20.19.4-win-x64.zip
```

### 校验 SHA-256

从 `https://nodejs.org/dist/v20.19.4/SHASUMS256.txt` 取

### 解压

```powershell
Expand-Archive -Path node-v20.19.4-win-x64.zip -DestinationPath .\extract\
Move-Item .\extract\node-v20.19.4-win-x64\* installer\deps\node-lts-embedded\
```

确保 `installer/deps/node-lts-embedded/node.exe` 存在.

### backend 依赖注入

```powershell
# 在 installer/deps/node-lts-embedded/ 下
$env:Path = "$PWD;$env:Path"
cd ..\..\..\packages\backend
pnpm install --prod  # 只装 production 依赖 · 避免 dev 依赖污染
Copy-Item -Recurse node_modules ..\..\installer\deps\node-lts-embedded\
```

---

## 2. PostgreSQL 16 (Windows Portable)

### 下载

**官方 binary zip**:
```
https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip
```

### 校验 SHA-256

EDB 不提供 checksum 文件. 本项目自己 pin:
```
[下载后 Get-FileHash · 填入 installer/deps-checksums.txt]
```

### 解压

```powershell
Expand-Archive -Path postgresql-16.4-1-windows-x64-binaries.zip -DestinationPath .\extract\
Move-Item .\extract\pgsql\* installer\deps\pgsql-portable\
```

结构: `installer/deps/pgsql-portable/bin/postgres.exe` + `share/` + `lib/`.

### 初始化脚本 (installer 首次启动时跑)

`installer/scripts/init-db.bat` 已写 (M11 Day 3). 首次启动调:
1. `pgsql-portable/bin/initdb.exe -D data/pg` 建集群
2. `pg_ctl.exe -D data/pg start`
3. `createdb wahubx`
4. `psql -f schema.sql` (migrations 自动跑)

---

## 3. Redis for Windows

### 下载

**Microsoft Redis for Windows (已弃维护 · 但 3.2 稳定用)**:
```
https://github.com/microsoftarchive/redis/releases/download/win-3.2.100/Redis-x64-3.2.100.zip
```

**更新: 用 Memurai (Redis 兼容 · 持续维护)**:
```
https://www.memurai.com/get-memurai
```

V1 选 Memurai Developer Edition · 免费 · Redis 7 兼容.

### 校验

Memurai 有 signed .msi / .zip · SHA-256 在下载页

### 解压

```powershell
Expand-Archive -Path memurai-developer-4.1.x.zip -DestinationPath installer\deps\redis-windows\
```

配置文件 `redis.conf` 手动加:
```
bind 127.0.0.1
port 6379
maxmemory 256mb
maxmemory-policy allkeys-lru
```

---

## 4. wahubx.ico (产品方图标)

**Blocker** · 需产品方设计师提供.

规格:
- 多尺寸 ico: 256 / 128 / 64 / 48 / 32 / 16
- 透明背景
- WhatsApp 绿 `#25d366` 主色
- 辨识度高 (pilot 客户桌面一眼认出)

放置: `installer/assets/wahubx.ico`

### 临时 placeholder (dev 用)

无图标开发 ok · Inno Setup 用默认图标. **release build 前必须替换**.

---

## 5. Inno Setup 6

### 下载

```
https://jrsoftware.org/isinfo.php
```

直接装在开发机上 · 不是 `installer/deps/` 子目录.

### 验证装好

```powershell
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" /?
```

输出帮助信息即 OK.

---

## 6. Piper TTS (可选)

### 下载

**Piper runtime**:
```
https://github.com/rhasspy/piper/releases/latest/download/piper_windows_amd64.zip
```

### 模型

Piper 中文女声:
```
https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx
https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx.json
```

Piper 英文女声:
```
https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json
```

放置: `installer/deps/piper/piper.exe` + `installer/deps/piper/voices/*.onnx`

### 可选: installer 不打包 Piper

V1 策略 (降低 installer size):
- installer 不带 Piper · 默认语音功能 disabled
- 客户 opt-in 后 UI 提示下载 Piper (首次用到 TTS 时)
- WAhubX 内置下载脚本 · 自动放对位置

决策待 release gate.

---

## 7. ComfyUI (客户自行安装 · installer 不打包)

原因: 23 GB 太大 · 不是所有客户需要 · Replicate API 是替代

客户文档: `docs/user-guide/DEPLOYMENT-MODES.md` Mode B1 section

---

## 依赖快速校验

完成所有下载后 · 跑:

```powershell
cd installer
pwsh .\scripts\verify-deps.ps1  # 见 installer/scripts/
```

输出期望:
```
[OK] node-lts-embedded  · node.exe v20.19.4
[OK] pgsql-portable     · postgres.exe v16.4
[OK] redis-windows      · redis-server.exe v3.2 (or Memurai)
[WARN] wahubx.ico       · 缺 · release 前必补
[OK] Inno Setup 6       · ISCC.exe installed
[SKIP] piper            · 可选 · 未装
```

SHA-256 对比脚本 `installer/scripts/verify-checksums.ps1` · 跟 `installer/deps-checksums.txt` 对齐.

---

## installer/deps-checksums.txt 格式

```
# SHA-256 checksums · 防止供应链篡改
# 每行: <relative-path> <sha256>

node-lts-embedded/node.exe  <sha256-from-SHASUMS256.txt>
pgsql-portable/bin/postgres.exe  <sha256-自己算>
redis-windows/memurai.exe  <sha256-从-memurai-网站>
```

下载新版本时 · 更新此文件 + commit 变更记录.

---

## Release gate 硬要求

v1.0 GA 发布前:
- [ ] 上面 6 项核心必需 (1-5 + ico) 全部具备
- [ ] SHA-256 checksums 文件提交
- [ ] `build.bat` 9 步全通过 (生成 WAhubX-Setup-v1.0.0.exe)
- [ ] Setup.exe 在干净 Win10/11 VM 上跑通一次安装流程

详见 `staging/v1.0-release-checklist.draft.md` / `docs/RELEASE-V1.0.md`.

---

_最后更新 2026-04-21 · 对齐 v0.12.0-m7_
