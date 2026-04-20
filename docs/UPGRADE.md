# WAhubX 升级架构 (M11)

> 状态 · 2026-04-20 · M11 进度到 Day 5 prep · 代码/UT 全绿 · 等 Day 5 portable binaries + 真密钥填入后做端到端 smoke.

---

## 1. 整体设计

WAhubX **本地桌面 app** · 升级不依赖云分发 · 用户手动 import `.wupd` 文件走流程.

### 1.1 角色分工

| 角色 | 职责 |
|---|---|
| **backend (自己)** | 升级 *准备* (preview / pre-update backup / staging 落盘 / 写 signal file) |
| **installer 外壳** (Inno Setup + Pascal util) | 升级 *执行* (原子 rename app/ / 替换文件 / 起新 backend) |
| **backend (新版)** | 升级 *完成* (onModuleInit 跑 migrations / `/health` 200 / 成功) |
| **installer 监测** | 升级 *校验或回滚* (监 signal file + `/health` + error log file) |

**核心约束**: Node backend 无法替换自己在磁盘的 exe (Windows 文件锁) · 必须外壳接管. 所以 backend 只做"准备阶段" · 外壳做"原子 rename".

### 1.2 三条安全链

1. **Ed25519 签名** · 包内完整性 + 发行者身份 (内容完整性; 非 Authenticode)
2. **SHA-256** · app.tar + 每条 migration 逐文件校验 (防内部篡改 · 签的 manifest 只含 sha, tar 本身不签)
3. **Pre-update `.wab` 备份** (M10 复用) · 升级失败时回滚源

---

## 2. `.wupd` 文件格式 (M11 Day 3)

```
┌──────────────────────┬─────────────────────────────────────────────────┐
│ magic (4B)           │ "WUPD"                                          │
│ version (1B)         │ 0x01                                            │
│ reserved (3B)        │ 0x00 0x00 0x00                                  │
│ manifest length (4B) │ uint32 BE                                       │
│ manifest JSON        │ WupdManifest 含 signature                       │
│ inner zip            │ app.tar + migrations/*.sql · 不加密 (公开审计)  │
└──────────────────────┴─────────────────────────────────────────────────┘
```

### 2.1 Manifest 字段

```ts
interface WupdManifest {
  from_version: string;    // '0.10.0-m10' · 升级前版本
  to_version: string;      // '0.11.0-m11' · 升级后版本
  app_sha256: string;      // app.tar 的 SHA-256 hex
  migrations: {
    name: string;          // TypeORM migration 文件名 (不含扩展)
    sha256: string;        // 该 migration 文件 SHA-256 hex
  }[];
  health_check: {
    endpoint: string;      // '/api/v1/health'
    timeout_sec: number;   // 60
    expect_status: number; // 200
  };
  rollback: {
    strategy: 'restore_pre_update_snapshot';
  };
  created_at: string;      // ISO
  signature: string;       // 'ed25519:<base64url-64B>'
}
```

### 2.2 签名作用域

签的是 **manifest 去掉 signature 字段后的 canonical JSON**:
- Key 字母升序递归 sort
- 紧凑 JSON (无 indent)
- UTF-8 bytes
- Ed25519 sign → 64B signature → base64url → 填回 `manifest.signature`

### 2.3 不加密 inner zip 的原因

- 升级内容可审计 (开源 spirit)
- 签名保完整性 (manifest AAD 绑 app_sha256 · migrations sha256 · 任一被改都验不过)
- 加密反让用户无法手动检查 · 本产品模型不需要保密升级内容

---

## 3. 升级流程 (§7.3 九步 · M11 对应)

```
用户行为                    backend 行为                            installer 外壳
─────────────────────────────────────────────────────────────────────────────────
[1] 选 .wupd 上传
    前端 UpgradeTab             POST /version/verify-upd
                                - parseWupdHeader
                                - Ed25519 signature 验
                                - SemVer compat 判
                                - app.tar sha256 验
                                - migrations sha256 验
                                返 PreviewResult · can_apply
    预览显示
    点 "确认升级"               POST /version/apply-update
                                - 再 preview (double check)
                                - assertNoStaleSignal
[2] Pre-update backup           - BackupExportService.export('pre-update')
                                  → backups/pre-update/<ts>.wab (M10 复用)
[3] Extract payload             - extractWupdPayload
                                - 落 staging/<ts>/app.tar
                                - 落 staging/<ts>/migrations/*.sql
[4] Write signal                - writeSignal {staging_path, pre_update_wab_path,
                                               old_app_rename_to, manifest}
[5] Backend exit                - process.exit(0)  ← M11 Day 5 补
                                                                    监测 signal file
                                                                    读到即接管
[6] Atomic rename                                                    - rename app/ → app-old-<ts>/
                                                                    - rename staging/<ts>/ → app/
                                                                    - 解 app.tar 到 app/
                                                                    - 把 migrations/*.sql 放 app/backend/dist/database/migrations/
[7] Start new backend                                                - 起 start.bat
                                  (新版 backend onModuleInit)
                                  - TypeORM migration:run
                                  - 成功 → /health 200
                                  - 失败 → 写 /tmp/wahubx-upgrade-error.json
                                           process.exit(1)
[8] Health check                                                     轮询 /health 60s
                                                                    200 → 成功 · 清 signal file
                                                                    5xx / 超时 / error log file 存在 → 回滚
[9] 回滚 (失败时)                                                     - stop new backend
                                                                    - rename app/ → app-new-failed-<ts>/
                                                                    - rename app-old-<ts>/ → app/
                                                                    - BackupImportService.import(pre-update.wab)
                                                                    - 起旧版 backend
                                                                    - 保留失败日志 data/logs/upgrade-<ts>.log
                                                                    - Admin UI 下次开启弹 modal
```

---

## 4. Error log file 机制 (Y2+ 决策)

**场景**: Backend 新版启动时跑 migration · 失败需精确诊断 · 不靠 /health timeout 猜.

**协议**:
```
/tmp/wahubx-upgrade-error.json
{
  phase: 'migration' | 'onModuleInit' | 'startup',
  migration_name?: string,          // 具体哪条 migration 挂
  error_message: string,
  failed_sql?: string,
  timestamp: 'ISO',
  backend_version: string
}
```

**Installer 监测**:
- `/health` 超时 60s → 超时回滚
- `/health` 返 5xx 3 次 → 异常回滚
- `/tmp/wahubx-upgrade-error.json` 存在 → 立即回滚 (快路径)
- 任一命中触发 [9] 回滚

---

## 5. Signal file 机制 (Day 4 prepare)

**文件**: `<install>/updates/staging/apply.signal.json`

**用途**: backend 退出前写 · installer 外壳监测 (poll 1s) · 读到即开始 rename dance.

**V1 字段**:
```json
{
  "version": 1,
  "written_at": "ISO",
  "staging_path": "C:\\WAhubX\\updates\\staging\\<ts>",
  "pre_update_wab_path": "C:\\WAhubX\\backups\\pre-update\\<ts>.wab",
  "old_app_rename_to": "C:\\WAhubX\\updates\\app-old-<ts>",
  "manifest": { ... }
}
```

**残留处理**: 下次 apply 前 `assertNoStaleSignal()` · 存在则**拒绝** · 指引手动清 (避免意外覆盖未完成的升级).

---

## 6. SemVer 兼容规则 (Z1 决策)

| from → to | compat | 行为 |
|---|---|---|
| 版本相同 | `same` | 不升级 |
| to < from | `downgrade` | **拒** · 永不降级 · 回旧版用 .wab |
| PATCH/MINOR bump | `ok` | 自动升级 |
| MAJOR bump | `major-bump` | 弹 modal "数据模型可能变更 · 建议先 .wab 备份" · 用户勾确认 |

from 必须等于 current · 否则视为 downgrade (不适用).

---

## 7. 发版操作手册 (Day 5 smoke 参照)

### 7.1 一次性生成密钥对

```bash
node scripts/sign-wupd.js genkey --out-dir ~/wahubx-signing-keys/
```

**产出**:
- `privkey.pem` · 0600 权限 · **离线保管 · 绝不入仓库**
- `pubkey.pem` · 明文公钥
- `pubkey.hex` · 64 hex 字符

**下一步**: 把 `pubkey.hex` 内容贴到 `packages/backend/src/modules/signing/public-key.ts`:
```ts
export const WAHUBX_UPDATE_PUBLIC_KEY_HEX = '<pubkey.hex 内容>';
```
提交代码 · 重新 build · 发布 installer.

### 7.2 打包 `.wupd`

```bash
# 1. 打 backend dist + frontend dist + migrations → app.tar
#    (Day 5 build.bat 补完整流程)
cd packages/backend && pnpm run build
cd ../frontend && pnpm run build
cd ../../
tar -cf staging/app.tar packages/backend/dist/ packages/frontend/dist/

# 2. 组装 .wupd (magic + manifest + inner zip)
#    (Day 5 build.bat 补)
node scripts/pack-wupd.js \
  --from 0.11.0-m11 --to 0.11.1-patch \
  --app-tar staging/app.tar \
  --migrations packages/backend/src/database/migrations/1779*.ts \
  --out output/WAhubX-0.11.1.wupd

# 3. 签名
node scripts/sign-wupd.js sign \
  --wupd output/WAhubX-0.11.1.wupd \
  --privkey ~/wahubx-signing-keys/privkey.pem

# 4. Verify (sanity)
node scripts/sign-wupd.js verify \
  --wupd output/WAhubX-0.11.1.wupd \
  --pubkey-hex <pubkey.hex>

# 5. 分发 .wupd 给客户 · 客户 Admin UI 升级 tab import
```

### 7.3 客户升级

1. 下载 `.wupd` (VPS / 邮件 / U 盘)
2. 登录 WAhubX Admin UI → 备份 tab 手动导出 .wab (defense-in-depth · 虽然 M11 Day 4 auto-backup)
3. 升级 tab → 上传 `.wupd` → 点 "预览 manifest"
4. 检查显示的 from/to/签名验证/版本兼容是否对 → 点 "应用升级"
5. 进度 modal 走 8 阶段 · 成功 → "backend 断线 · 请刷新"
6. 刷新登录 · 确认新版本

---

## 8. 故障排查 (Day 5 smoke 完成后逐项补真实场景)

### 8.1 "签名无效"

- **原因 A**: `.wupd` 在传输中被改 (中间人攻击 / 磁盘损坏)
  - 从源头重下
- **原因 B**: 用不同密钥对签 (换公钥未配套换私钥)
  - 检查 `packages/backend/src/modules/signing/public-key.ts` 是否是最新公钥
- **原因 C**: 本地 backend 是旧版 · 新公钥还没部署
  - 升级到中间版本先

### 8.2 "升级后 /health 超时"

- 查 `/tmp/wahubx-upgrade-error.json`
- 常见原因: migration 失败 / PG 未起 / 端口被占
- Installer 此时应已自动回滚到旧版 · 失败详情在 `data/logs/upgrade-<ts>.log`

### 8.3 "升级后 AI provider 解不出 key"

- 硬件指纹变过 (fp-master-key.txt 丢) · 走 M10 E2 recovery
- 或 master-key migration 出错 · 走 M10 E1 recovery (输入原 APP_ENCRYPTION_KEY)

### 8.4 "apply signal 残留"

- `C:\WAhubX\updates\staging\apply.signal.json` 存在 · 说明上次升级未完成
- **不要**直接删 · 先确认 backend 版本状态:
  - `app/` 存在 + backend 能起 · 正常
  - `app/` 缺失 · 从 `app-old-<ts>/` rename 回来
  - pre-update.wab 存在 · BackupImportService 恢复

---

## 9. V1.1+ roadmap

- **VPS 自动下载 `.wupd`** · 本地轮询 + user consent modal (V1 本地 manual)
- **差分升级** · 只传变更文件 · rsync-like
- **灰度 / A-B 版本** · 多租户云部署场景才有意义
- **Windows Code Signing (Authenticode)** · 客户 > 100 / 企业客户要求时购证书 (见 CHANGELOG M11 Code Signing constraint)
- **Node 22 LTS 升级** · 整栈回归 (见 CHANGELOG M11 Node 20 constraint)

---

## 10. 关键文件索引

| 职责 | 文件 |
|---|---|
| `.wupd` 格式 codec | `packages/backend/src/modules/update/wupd-codec.ts` |
| `.wupd` manifest 类型 | `packages/backend/src/modules/signing/types.ts` |
| Ed25519 sign/verify | `packages/backend/src/modules/signing/ed25519-*.service.ts` |
| 公钥常量 | `packages/backend/src/modules/signing/public-key.ts` ⚠ dev placeholder 全 0 · production 前替换 |
| UpdateService | `packages/backend/src/modules/update/update.service.ts` |
| Signal file | `packages/backend/src/modules/update/apply-signal.ts` |
| VersionController | `packages/backend/src/modules/update/version.controller.ts` |
| 前端升级 tab | `packages/frontend/src/pages/admin/UpgradeTab.tsx` |
| Inno Setup .iss | `installer/wahubx-setup.iss` |
| 运行时脚本 | `installer/scripts/*.bat` + `generate-env.js` |
| 发版 CLI | `scripts/sign-wupd.js` |

---

_Last updated: 2026-04-20 · M11 Day 5 prep · 此文档随 M11 收工更新到 v1.0_
