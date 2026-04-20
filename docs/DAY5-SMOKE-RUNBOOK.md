# M11 Day 5 · 端到端升级 Smoke Runbook

> **状态**: 代码 / UT / CLI / docs 全就位 · Day 5 smoke 分两层:
>
> **Layer A · Dev 机 backend 层 smoke** (本 runbook · 一键可跑):
> - pack + sign + backend verify + apply prepare (无 process.exit · 安全)
> - 需要: dev key (已备 `keys/`) + test.wupd (已备 `staging/day5-smoke/`) + dev-snapshot.sh
> - **2026-04-20 已部分完成** · 见第 8 节 live 证据
>
> **Layer B · Installer.exe 端到端 smoke** (需 clean Windows VM):
> 阻塞外部资源:
> - `installer/deps/node-lts-embedded/` · Node 20 LTS portable (~60MB)
> - `installer/deps/pgsql-portable/` · PostgreSQL 16 portable (~200MB)
> - `installer/deps/redis-windows/` · Redis for Windows (~8MB)
> - `installer/assets/wahubx.ico` · 产品图标
> - Clean Win10/11 VM 或物理测试机

---

## 前置检查

### 1. 代码就绪性

```bash
cd /c/AI_WORKSPACE/Whatsapp\ Auto\ Bot/packages/backend
pnpm test          # 203/203 all green
pnpm run build     # 编译过
```

### 2. 当前 commit chain

```
M11 commits (M10 之后 · 13 commits):
  d7ed01f refactor(m11-preamble): fp 文件命名统一
  9832b74 build(m11-day1.5): Installer 基座
  cc0fc3e feat(m11-day2): Ed25519 签名模块
  b143832 feat(m11-day2.5): Admin UI 升级 Tab
  317b54f feat(m11-day3): UpdateService + /version routes
  e619b52 feat(m11-day4-prepare): apply 准备阶段 + signal file
  c6ec82a build(m11-day4-scripts): 6 installer 运行时脚本
  4e532ad build(m11-day5-prep): sign-wupd CLI
  1202d3c docs(m11): UPGRADE.md
  de3abe1 build(m11-day5-prep-pack): pack-wupd CLI
  74eddbe feat(m11-补强1): /version/bootstrap
  8565524 build(m11-day5): installer/build.bat 完整版
  bfd9689 docs(m11): DEVELOPMENT.md M11 章节
```

### 3. 资源清单核对 (Day 5 smoke 开跑前)

- [ ] `installer/deps/node-lts-embedded/node.exe` 存在
- [ ] `installer/deps/pgsql-portable/bin/postgres.exe` 存在
- [ ] `installer/deps/redis-windows/redis-server.exe` 存在
- [ ] `installer/assets/wahubx.ico` 存在 (256x256+)
- [ ] `~/wahubx-signing-keys/privkey.pem` 存在 (权限 0600)
- [ ] `packages/backend/src/modules/signing/public-key.ts` 的 `WAHUBX_UPDATE_PUBLIC_KEY_HEX` **非全 0**
- [ ] 干净 Windows VM 或 sandbox (测 installer · 不污染主机)

任一缺 · 回 [UPGRADE.md](./UPGRADE.md) 或 [DEVELOPMENT.md](./DEVELOPMENT.md) 对应章节补齐.

---

## Smoke 1 · 首次安装 (fresh install · 补强 1)

### 1.1 构建 installer

```bash
cd installer
build.bat
# 期望:
#   [OK] iscc.exe
#   [OK] pnpm found
#   [OK] backend dist/ built
#   [OK] frontend dist/ built
#   [OK] node staged · [OK] pgsql staged · [OK] redis staged
#   Build complete. Output: WAhubX-Setup-v<ver>.exe
```

**失败情形**:
- `assets/wahubx.ico missing` WARN → 用任意 .ico 或注释 `SetupIconFile=` 行, 只为测 .iss 语法
- `deps/* missing` WARN → 可继续但 installer 无 runtime · 只测 .iss

### 1.2 在干净 Windows VM 跑 installer

```
双击 output/WAhubX-Setup-v<ver>.exe
→ 默认装到 C:\WAhubX
→ 向导: 中文/English · 端口配置 (3000/5433/6380 默认) · 确认
→ 安装期自动跑 init-db.bat
  [1/5] Initializing PostgreSQL data directory
  [2/5] Starting PostgreSQL
  [3/5] Creating database wahubx
  [4/5] Running database migrations (TypeORM)
  [5/5] Stopping PostgreSQL
```

**期望结果**:
- `C:\WAhubX\app\` 含 backend/frontend/node/pgsql/redis 子目录
- `C:\WAhubX\data\config\fp-installer.txt` 已生成
- `C:\WAhubX\.env` 有随机生成的 JWT/DB/APP_ENCRYPTION_KEY
- 桌面图标 `WAhubX`

### 1.3 首次启动 · 验 Fresh Install 流

```
双击桌面 WAhubX 图标
→ start.bat 起 PG + Redis + Backend
→ 浏览器自动打开 http://localhost:3000
→ Frontend 调 GET /version/bootstrap (Public)
   返 {fresh_install: true, license_activated: false, ...}
→ 跳 License Key 激活页 (走 M1 激活流程)
→ 输入 License Key + 设置平台超管账号
→ 成功 · 进 dashboard
```

验证:
- [ ] `data/config/fp-license.txt` 已生成 (32 hex)
- [ ] `data/config/fp-master-key.txt` 已生成 (64 hex)
- [ ] `data/config/fp-installer.txt` 已生成 (JSON)
- [ ] DB 里有 1 条 user (platform admin) + 1 条激活 license

---

## Smoke 2 · 打包 + 签名 test .wupd

### 2.1 开发机上构造 test .wupd

假装从 0.11.0-m11 升级到 0.11.1-test:

```bash
cd /c/AI_WORKSPACE/Whatsapp\ Auto\ Bot

# bump 版本 (手动 或 package.json 改)
# 为了 smoke · 改 packages/backend/package.json 里 "version": "0.11.1-test"
# 或直接 git checkout -b test-upgrade · 改完不 merge

# 1. Build
cd packages/backend && pnpm run build
cd ../frontend && pnpm run build
cd ../../

# 2. 组 app.tar (简化: 只包 backend dist 测试 · 完整版包 frontend + node_modules)
tar -cf /tmp/test-app.tar -C packages/backend dist/

# 3. 假装有 1 条新 migration (或用 placeholder · 实际测试不需跑真 migration)
echo "-- test migration 1779999999999" > /tmp/1779999999999-TestFeature.sql

# 4. pack-wupd
node scripts/pack-wupd.js \
  --from 0.11.0-m11 \
  --to 0.11.1-test \
  --app-tar /tmp/test-app.tar \
  --migrations "/tmp/1779*-*.sql" \
  --out /tmp/WAhubX-0.11.1-test.wupd

# 5. sign
node scripts/sign-wupd.js sign \
  --wupd /tmp/WAhubX-0.11.1-test.wupd \
  --privkey ~/wahubx-signing-keys/privkey.pem

# 6. verify (sanity)
PUB=$(cat ~/wahubx-signing-keys/pubkey.hex)
node scripts/sign-wupd.js verify --wupd /tmp/WAhubX-0.11.1-test.wupd --pubkey-hex $PUB
# ✓ signature_valid
```

---

## Smoke 3 · 应用升级 (happy path)

### 3.1 Backend preview

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login ...)

curl -X POST http://localhost:3000/api/v1/version/verify-upd \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/WAhubX-0.11.1-test.wupd"
```

**期望 PreviewResult**:
- `signature_valid: true` (因 public-key.ts 已填真公钥)
- `version_compat: 'ok'` (PATCH bump)
- `app_content_valid: true`
- `migrations_valid: true`
- `can_apply: true`

### 3.2 Admin UI 升级

1. 登录 Admin · 进 "升级" tab
2. 上传 `.wupd`
3. 点 "预览 manifest" · 确认字段
4. 点 "应用升级"
5. Progress modal · 8 阶段 (verifying → pre-backup → stopping → replacing → migrating → starting → health-check → done)
6. **Day 5 完整 smoke 需要 installer 外壳配合**: 当 backend apply() 写 signal file + process.exit(0) 后, installer 外壳监测 signal · 执行 rename dance · 起新 backend
7. Frontend 显 "backend 断线 · 请刷新" · 用户刷新登录 · 新版就位

### 3.3 验证升级成功

- [ ] `app/` 是新版 · `app-old-<ts>/` 已删 (或保留作 fallback)
- [ ] `backups/pre-update/<ts>.wab` 存在 (pre-update backup)
- [ ] `data/` + 用户数据无损 (登录后号还在, DB 状态正确)
- [ ] `migrations` 表含新 migration 记录
- [ ] `/version/current` 返 `0.11.1-test`
- [ ] `updates/staging/apply.signal.json` 已被 installer 清掉

---

## Smoke 4 · 回滚路径 (故意 broken .wupd)

### 4.1 造一个 broken .wupd

```bash
# 复制 happy path 的 .wupd
cp /tmp/WAhubX-0.11.1-test.wupd /tmp/WAhubX-0.11.1-broken.wupd

# 破坏 app_sha256 或 migrations_sha256 · 让 preview can_apply=false
# 方法 A: 直接改 app.tar 一个字节 (manifest sha 不匹配)
# 方法 B: 加一条 manifest 里没有的 migration 文件到 zip (额外文件没影响但 missing 字段报)
# 方法 C: 造一条 migration SQL 里故意 `SELECT * FROM non_existent_table;` 让升级中 migration fails
```

**方法 C** (最有价值 · 测完整回滚链):

```sql
-- /tmp/1779999999999-BrokenMigration.sql
SELECT * FROM deliberately_nonexistent_table;
```

重新 pack + sign + 签名 verify 过 preview (sha 匹配 · can_apply=true) · 但**运行时会挂**.

### 4.2 尝试升级

通过 Admin UI 上传 + apply · 期望:
- [verifying] ✓ 签名通过
- [pre-backup] ✓ pre-update.wab 生成
- [stopping] ✓
- [replacing] ✓ installer rename
- [**migrating**] ✗ TypeORM throw "relation 'deliberately_nonexistent_table' does not exist"
- Backend 写 `/tmp/wahubx-upgrade-error.json` + `process.exit(1)`
- Installer 监测到 error log + backend exit · 触发回滚
- [rollback]:
  - `app/` → `app-new-failed-<ts>/`
  - `app-old-<ts>/` → `app/`
  - pre-update.wab restore (DB 状态恢复)
  - 起旧版 backend
- `data/logs/upgrade-<ts>.log` 含 broken migration 详情

### 4.3 验证回滚完整

- [ ] `/version/current` 返 `0.11.0-m11` (旧版)
- [ ] 登录后号还在 · DB 状态与升级前一致
- [ ] Admin UI 下次开启 · 弹 "上次升级失败" modal 显 `deliberately_nonexistent_table does not exist`
- [ ] `backups/pre-update/<ts>.wab` 仍在 (保作审计)

---

## Smoke 5 · 硬件变化 recovery (E2 · M10 复用)

### 5.1 模拟硬件变化

```bash
# 备份 fp-master-key.txt
cp C:/WAhubX/data/config/fp-master-key.txt /tmp/fp-master-key-backup.txt

# 删除 · 模拟换机器 / 丢文件
rm C:/WAhubX/data/config/fp-master-key.txt
```

### 5.2 重启 backend · 验 E2 触发

```bash
stop.bat
start.bat
```

**期望**:
- `MachineBoundMasterKeyProvider` 生成新 fingerprint (不同内容) · 写新文件
- `HardwareRecoveryService.onModuleInit` 探测到现有 AI providers 无法 decrypt · 置 LOCKED 状态
- Admin UI 顶部红 banner: "检测到硬件指纹变化 · AI 功能已锁定"

### 5.3 Recovery 路径 A (原 env key)

假设之前 E1 迁移时 APP_ENCRYPTION_KEY 被记下来:

1. UI 点 "恢复加密密钥" banner
2. 选方案 A · 输入原 env key (64 hex)
3. Submit
4. Backend `recoverWithEnvKey()` 验 + re-encrypt 成 machine-bound
5. Banner 消失 · AI 功能恢复

### 5.4 Recovery 路径 B (导入 .wab)

假设没记 env key · 但有历史 .wab:

1. 选方案 B · 上传 pre-migration/*.wab 或 manual-export/*.wab
2. 若 .wab 用 env key 加密 · 额外填 override env key
3. Submit · Backend 经 `recoverFromWab` · 数据恢复
4. Banner 消失

---

## Smoke 6 · Uninstall (补强 2)

### 6.1 保留数据 (默认)

```
控制面板 · 程序 · WAhubX · 卸载
  不勾 "同时清除所有数据和备份"
  确认
```

**期望**:
- `C:\WAhubX\app\` 删
- `C:\WAhubX\data\` **保留**
- `C:\WAhubX\backups\` **保留**
- `C:\WAhubX\logs\` 删 (临时日志)
- `C:\WAhubX\.env` 删

重装后: `data/` 中 fp-* 文件仍在 · 自动免密恢复.

### 6.2 清所有数据 (慎选)

```
  勾 "同时清除所有数据和备份"
  确认
```

**期望**: `C:\WAhubX\` 整个目录空.

---

## 签名收工

Smoke 1-6 全过 · M11 可正式 release:

```bash
git tag -a v0.11.0-m11 -m "M11 · Installer + .wupd 升级系统 (完整闭环)"
git push origin main
git push origin v0.11.0-m11
```

CHANGELOG 整合所有 unreleased section 到 `[v0.11.0-m11]` 正式段落.

---

## 问题排查速查

| 现象 | 排查 |
|---|---|
| `iscc.exe not found` | 装 Inno Setup 6 (jrsoftware.org) |
| `pnpm build` 失败 | 检查 backend/frontend 代码 · `pnpm test` 先过 |
| `initdb` 失败 | PG portable 路径对不对 · 权限 · 端口占用 |
| Browser 打不开 | `logs/backend.log` · `.env` 文件内容 · 端口 |
| `signature_valid=false` | public-key.ts 的 hex 与签的 privkey 配套? |
| `app_content_valid=false` | app.tar 被改 · 重新 build · 重 sha |
| `migrations_valid=false` | migration 文件名 / 路径匹配 pack-wupd 时的 glob? |
| Apply 过程 stuck | 查 `/tmp/wahubx-upgrade-error.json` |

完整架构 + 所有 fail code 见 [UPGRADE.md](./UPGRADE.md).

---

## 8. Layer A · Dev 机一键 smoke (已就位 · 可直接跑)

### 8.1 前置 · dev 环境 snapshot (防 brick)

```bash
cd /c/AI_WORKSPACE/Whatsapp\ Auto\ Bot
./scripts/dev-snapshot.sh snapshot --notes "before-day5-smoke"
# 输出: dev-snapshots/dev-snapshot-<ts>.tar.gz
# 含: packages/backend/data/ + backups/ + DB 全量 dump
```

出错时随时 `./scripts/dev-snapshot.sh restore dev-snapshot-<ts>` 还原.

### 8.2 一键验证 (已备物料)

物料清单 (已生成 · gitignored):
- `keys/privkey.pem` · dev Ed25519 私钥 (本地 · 0600)
- `keys/pubkey.hex` · `3dfd279320bee09e67a5dc6a2fd8268e4cd65edb2b7edb15632709c36260e78f`
- `staging/day5-smoke/app.tar` · dummy app.tar (10KB)
- `staging/day5-smoke/test.wupd` · pack+sign 完成 (816 bytes)
- `packages/backend/src/modules/signing/public-key.ts` · 已填 dev pubkey

```bash
# 1. 背景 backend 健在
curl -sI http://localhost:3000/api/v1/health | head -1
# HTTP/1.1 200 OK

# 2. 登录
PLAT=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"platform@wahubx.local","password":"Test1234!"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

# 3. Backend /version/verify-upd · 期望 signature_valid=true (dev key 匹配)
# ⚠ curl 路径必须 Windows 绝对 (/tmp 在 bash 和 node 解读不同)
curl -s -X POST http://localhost:3000/api/v1/version/verify-upd \
  -H "Authorization: Bearer $PLAT" \
  -F "file=@C:/AI_WORKSPACE/Whatsapp Auto Bot/staging/day5-smoke/test.wupd"

# 期望 JSON 字段:
#   signature_valid: true       ← 2026-04-20 验证通过
#   app_content_valid: true     ← SHA-256 跨实现一致
#   migrations_valid: true      ← 空 migration · OK
#   version_compat: downgrade   ← test.wupd from 0.11.0-m11 · current 0.1.0 不匹配 (预期 · 本机没升级过)
#   can_apply: false            ← version 不适配 · 正确拒
```

### 8.3 若要测 apply prepare 阶段 (不 process.exit)

需要改 test.wupd 的 from_version 匹配 current (或改 current app_version). 为 Layer A smoke 不破 current · 留给 Layer B 正式测.

### 8.4 dev key → production 切换 (发布前必做)

```bash
# 1. 生成生产密钥对 · 离线保管
mkdir ~/wahubx-prod-keys
node scripts/sign-wupd.js genkey --out-dir ~/wahubx-prod-keys/
# 记下 pubkey.hex 内容

# 2. 替换 public-key.ts 的 WAHUBX_UPDATE_PUBLIC_KEY_HEX
# (vim 或 sed · 绝对路径: packages/backend/src/modules/signing/public-key.ts)

# 3. rebuild + 重 UT
cd packages/backend && pnpm test && pnpm run build

# 4. 删 dev 密钥 (或移走)
rm -rf keys/

# 5. installer/build.bat 重构 · 生成 production .exe
cd ../../installer && build.bat
```

---

## 9. Layer A smoke 2026-04-20 live 证据

**已执行**:
```
[18:59:22] pack-wupd CLI → staging/day5-smoke/test.wupd · 816B
[18:59:22] sign-wupd CLI → signed with keys/privkey.pem
[18:59:22] verify-wupd CLI → ✓ signature_valid

[19:00:xx] backend rebuild + restart with public-key.ts=dev hex
[19:00:xx] POST /version/verify-upd → {
             "signature_valid": true,        ← 跨实现兼容 ✓
             "app_content_valid": true,
             "migrations_valid": true,
             "version_compat": "downgrade",  ← 预期 · 非适配
             "can_apply": false
           }
```

Layer A 核心路径 (pack / sign / verify / 跨实现兼容 / backend 解析) **全通**.

剩下的 apply 真执行需 Layer B (VM + real binaries) 或构造匹配 from_version 的 .wupd (改 backend package.json 版本再 smoke 一遍).

---

_Last updated: 2026-04-20 19:00 · Layer A smoke 已 live 验证 · Layer B 待外部资源齐 · 随时可跑._
