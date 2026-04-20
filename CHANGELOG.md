# Changelog

按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 约定，版本按 [SemVer](https://semver.org/lang/zh-CN/)。

---

## [v0.12.0-m7 · M7 code-complete] · 2026-04-20 · 素材库 + Persona + Avatar + Voice

> Day 1-8 cascade 8 commits · 31 new UT · 271/271 total
> Live E2E smoke 待 prereq (ComfyUI + piper + 真账号) · 同 M11 Layer B 模式

### M7 Scope 总览

**基础设施** (Day 1):
- PersonaV1 Zod schema · 18 字段 · EthnicityMY 枚举 (V1 仅 chinese-malaysian)
- canonicalSerializePersona + computePersonaHash (SHA-256 · 16 hex · created_at 排除)
- Migration 1780 · persona 表 + asset.persona_id FK + enum 'manual_upload'
- BaileysService.sendStatusMedia · status@broadcast image/voice/file
- storage.ts asset path helpers · forward-slash relative paths
- ScriptRunnerService.personaHashForRun · slot.persona 内容基 hash · fallback alias

**生成能力** (Day 2-4):
- Flux adapter · local (ComfyUI) + Replicate + auto backend selection
- Piper TTS · subprocess wrap · 8s cap (补强 4 · 避大陆腔)
- PersonaGeneratorService · AI → Zod → leakage filter → dedupe
- AvatarGeneratorService · Flux 4 候选 · 评分 · regenerate/fallback

**运行时** (Day 5):
- StatusPostExecutor Layer 1/2 真发图 (sendStatusMedia)
- PersonaPoolScheduler · 每小时 tick · MY 04:00 refill pool < 20

**管理 UI** (Day 6):
- AssetsController (6 endpoints) + AssetsTab frontend
- 配额显示 (100 img + 50 voice / persona)

**生产 seed** (Day 7):
- generate-builtin-assets.js · stub mode verified
- docs/M7-BUILTIN-SEED.md · 流程 + 大小约束 + installer 打包

**DI 收尾** (Day 8):
- FluxModule + PiperModule · 从 env/settings 构造
- AvatarGeneratorService 现可完整 DI
- docs/M7-COMPLETE.md · 架构图 + 受限 PASS 说明 + V1.1 债

### Tests · 271/271 全绿

| Module | UT |
|---|---|
| persona.types (Zod + hash + leakage) | 20 |
| storage (asset paths) | 5 |
| script-runner (hash + cache) | 3 (new) |
| flux (local + replicate + service) | 8 |
| piper (adapter + service + estimateSec) | 6 |
| asset.service | 3 |
| persona-generator.service | 3 |
| avatar-generator.service | 3 (+ 2 score helper) = 5 |
| persona-pool.scheduler | 4 |
| **M7 new total** | **57** |

### 锁定约束

- V1 ethnicity 仅 `chinese-malaysian` · `malay` 永不实装
- Piper voice = 大陆腔 huayan · < 8s 限制避露馅 · V1.1 fine-tune
- 无 face-api / CLIP score · AvatarGenerator 简化评分 (bytes + seed deterministic)
- 无 live E2E smoke (推 prereq 就绪后 · Day 8 schedule)

### 已知 blocker (v1.0 GA 前必补)

1. ComfyUI setup 文档 (docs/FLUX-LOCAL-SETUP.md 待写)
2. piper.exe + 模型分发 (installer bundle vs 首次下载 · 待决策)
3. _builtin/ 真素材 (real mode · git LFS 或 GH Releases)
4. Settings UI 补 assets.* (Day 6 基础版 · 配 flux_backend / replicate_token 交互)

### Tag `v0.12.0-m7` @ 33da66a + 后续 Day 7/8 commits

累计 M7 commits:
- Day 1 Batch A: `66833c8`
- Day 1 Batch B + cascade 3-4: `5a7be90`
- Day 2: (tag only · included in 5a7be90 stream)
- Day 3: `14fedfe`
- Day 4: (rolled into Day 5 stream)
- Day 5: `98b821f`
- Day 6: `33da66a`
- Day 7: (本次)
- Day 8: (本次)

---

## [unreleased · M7 Day 7] · 2026-04-20 · _builtin-seed CI script

### Added
- `scripts/generate-builtin-assets.js` · CLI · 5 persona variants × (10 images + 10 voice) across 3 image pools + 3 voice pools
  - `--mode stub` (default) · 生 tiny PNG/OGG placeholder · ~12MB · CI smoke 可跑
  - `--mode real` · 调 FluxService + PiperService · 未实装 (exit 20 · Day 8 batch smoke 接)
  - `--personas` / `--images` / `--voices` / `--out` 可配
  - **Exit 10** 若超 100MB · GitHub Releases 外挂 · HALT
- `docs/M7-BUILTIN-SEED.md` · 生成流程 + 大小约束 + installer 打包路径 + release 授权 flow

### Stub smoke 验证 (2 persona × 3 img × 3 voice)
- 12 files · 1.41 MB · 目录结构对齐 StatusPostExecutor Layer 2 期望

### 锁定
- real mode 待 Day 8 batch smoke 接 Flux + Piper service
- `data/assets/*` 已在 .gitignore · stub 产出不会意外入库
- 真 release 素材由 git LFS 或 GitHub Releases 分发

### Tests · 271/271 still green

---

## [unreleased · M7 Day 6] · 2026-04-20 · AssetsTab + backend controller

### Added
- `AssetsController` (backend) · Admin-only · 6 endpoints:
  - `GET /assets/personas` · 列 persona 库
  - `GET /assets/list?kind&personaId&poolName` · 列 asset
  - `POST /assets/upload` · multipart · source=manual_upload
  - `POST /assets/generate-persona` · 调 PersonaGeneratorService · 返 report · count 1-20
  - `DELETE /assets/:id` · DB + 磁盘
  - `GET /assets/quota/:personaId` · 100 图 + 50 语音配额
- `AssetsModule` · 注册 AssetService + PersonaGeneratorService + PersonaPoolScheduler
- `AssetsTab.tsx` (frontend) · persona 库表 · 单选 persona 后列 asset · kind filter · 生成 Modal · 上传 Modal · 删除确认 · 配额 Progress
- `AdminPage.tsx` · 新增 "素材库" tab

### 锁定
- 无 UT (per sketch · frontend-heavy)
- 无 @ant-design/icons 依赖 (未安装 · 用文字按钮)
- AvatarGeneratorService + FluxService + PiperService 的 DI wiring 推 Day 8 (FluxModule/PiperModule)

### Tests · 271/271 backend · frontend build 通

---

## [unreleased · M7 Day 5] · 2026-04-20 · StatusPost 真发图 + Persona pool scheduler

### Changed
- `StatusPostExecutor` Layer 1/2 接真发图 · `baileys.sendStatusMedia('image', base64)`
  - Layer 1 · persona_id 匹配 asset.personaId · AI 生成的 persona-owned 专属图
  - Layer 2 · `_builtin_images_life` 通用池 (Day 7 _builtin-seed CI 填)
  - 文件缺失 / 发送失败 · 降级 layer 3 纯文本 · 不抛
- Layer 3 (scripts/status_posts) + Layer 4 (skip) 原逻辑保留

### Added
- `PersonaPoolScheduler` · 每小时 tick · MY 04:00 触发 · 池 < 20 调 `PersonaGeneratorService.generate`
  - 去重: 同一 MY 日只触发 1 次
  - `refillNow()` 暴露给手动调用 + UT

### Tests · 271/271 全绿 (34 + 1 = 35 suites)
- PersonaPoolScheduler · 4 UT · 不 triggered when count≥20 · needed 计算 · 非 refill hour · 同日去重

---

## [unreleased · M7 Day 4] · 2026-04-20 · Asset + Persona + Avatar services

### Added
- `asset.service.ts` · CRUD + 池抽签 · forward-slash filePath · persona-owned 优先 · 通用池 fallback
- `persona-generator.service.ts` · AI 驱动 PersonaV1 批量生成 · Zod validate · leakage filter · hash dedupe · report shape
- `avatar-generator.service.ts` · Flux 4 候选 · 评分选 1 · 全低 regenerate 1 轮 · 再低 fallback arr[0]
  - V1 评分: base64 bytes >= 20KB + seed deterministic (V1.1 替换 CLIP score + face-api)
- 3 spec files · 11 UT 全绿 (create/delete/count + AI happy/leakage/fail + 3 avatar path + score helper)

### 锁定
- 无 face-api / CLIP score (V1.1)
- 无 live Flux smoke (推 Day 8)
- 无 AvatarGenerator 持久化 (Day 6 UI 从 winner.image.base64 接到 AssetService.create)

### Tests · 267/267 全绿 (31 + 3 = 34 suites)

---

## [unreleased · M7 Day 3] · 2026-04-20 · Piper adapter + voice service

### Added
- `packages/backend/src/modules/assets/piper/piper-adapter.ts` · subprocess spawn · piper.exe · stdin text · stdout wav · timeout 30s · execImpl 注入用于测试
- `packages/backend/src/modules/assets/piper/piper.service.ts` · 门面 · 按 persona.languages.primary 选 model (huayan zh / amy en) · pickText 从 VOICE_TEXT_POOLS 抽 · 8s 上限卡死 (补强 4)
- `estimateDurationSec` · 中 4 字/秒 · 英 3 词/秒 · 粗估保守
- **6 UT 全绿** (sketch 要求 ≥ 4) · selectModel · pickText · 超时抛 · 成功路径 · 短中文 · 长中文

### 锁定约束
- V1 仅 < 8s 语音 · 超长 throws (避大陆腔暴露)
- wav → opus 转换延后到 Day 4 AssetService (用 ffmpeg)
- 无 live smoke · 推 Day 8

### Tests · 256/256 全绿 (30 + 1 = 31 suites)

---

## [unreleased · M7 Day 2] · 2026-04-20 · Flux Adapter (local + replicate)

### Added
- `packages/backend/src/modules/assets/flux/flux-provider.interface.ts` · FluxProvider abstraction · params/result types
- `packages/backend/src/modules/assets/flux/flux-local.provider.ts` · ComfyUI HTTP wrapper (port 8188) · workflow hard-code flux-dev · poll + view
- `packages/backend/src/modules/assets/flux/flux-replicate.provider.ts` · Replicate API client · 2 retry 指数 backoff · ~$0.003/img cost tracking
- `packages/backend/src/modules/assets/flux/flux.service.ts` · 门面 · mode=auto/flux-local/flux-replicate · GPU detect via nvidia-smi
- **8 UT 全绿** · flux-local healthcheck 2 · flux-replicate healthcheck 2 · flux.service backend selection 4

### 设计决策 (锁定)
- Replicate 默认 model: flux-dev (非 schnell)
- GPU detect 仅 nvidia-smi (AMD V1.1)
- encryptSecret 复用 M6 (下 Day 6 Settings UI 接)
- 无 live smoke (推 Day 8)
- LoRA / ControlNet / spawn ComfyUI · V1.1

### Tests · 250/250 全绿 (27 + 3 = 30 suites)

---

## [unreleased · M7 Day 1 Batch B + Cascade [3] [4]] · 2026-04-20 · runner hash + migration 1780 + 机制 verify

**Scope**: M7 Day 1 Batch B (#6 + #7 + #11) + cascade [3] 真降级 verify + [4] Layer B-lite

### Added
- `packages/backend/src/database/migrations/1780000000000-AddAssetPersonaId.ts` (NEW · #7)
  - `asset_source_enum` ADD VALUE `'manual_upload'` (forward-only)
  - `persona` 表 · PK=persona_id · JSONB content · content_hash + ethnicity + used_by_slot_ids + source · 2 indexes
  - `asset.persona_id TEXT NULL` + FK ON DELETE SET NULL + idx
  - **Live applied to dev DB** · columns verified
- `packages/backend/src/modules/assets/persona.entity.ts` (NEW · #7)
  - TypeORM entity for persona 表 · content 强类型为 PersonaV1
- `ScriptRunnerService.personaHashForRun()` (NEW · #6)
  - 读 slot.persona · PersonaV1Schema.safeParse · 过则 computePersonaHash(p) + scriptDbId + turnIndex 混合
  - 不过则 fallback 旧 sha1(acc|script|turn) alias · M4 fixture + 历史无 persona 账号不炸
- `ScriptRunnerService` 新 3 UT · 共 19/19 绿
  - persona 变化 → 不同 personaHash
  - slot.persona 无效 → fallback 16-hex 不炸
  - 补强 1 · cache hit smoke (mock AI · 第 2 轮 AI 0 调 · used_count 递增)
- `AssetEntity.personaId` 列 (TS)
- `/admin/debug/inject-risk-event` endpoint (cascade [3]) · 支持 count + code + severity · 直 emit risk.raw
- `DispatcherService` skip-health-high 加观察性 warn log (cascade [3] 验证用)

### Changed
- `app_setting.health.dry_run = false` (live · cascade [2])
- `AssetSource` enum 已在 Batch A 加 `ManualUpload` · 本次 migration 把 PG enum 同步

### Verified (cascade [3] [4])
- **[3] 真降级 mechanism**: 20 risk_event 注入 → scorer 自动 rescore → DB risk_level=high, score=0 → dispatcher 连续 4 轮 skip-health-high log → AlertDispatcher → DesktopAlertChannel 路径 fired (生产 SnoreToast 由 installer 装)
- **[4] M11 Day 5 Layer B-lite**: `/api/v1/version/apply-update` dryRun live · signature_valid=true + app_content_valid=true + migrations_valid=true · 全 pipeline 通 · Fresh-VM + installer.exe E2E blocked on prereq · 见 INVESTIGATION_NOTE.md
- Tag: `v0.11.0-m11-codecomplete-smoke-pending` 本地 (push 待 [14])

### Tests
- **242/242 全绿** · 27 test suites · 之前 214 + 25 (Batch A) + 3 (#6) + 1 (#11) ≈ 243
- Full backend build 零 TS error

### Dev state
- backend 停 (migration 后 · cascade [7]+ 不强制 live backend)
- Account 1 risk_level 恢复 low · risk_event 清理
- task.id=15 delete

---

## [unreleased · M7 Day 1 #4-10 Batch A] · 2026-04-20 · PersonaV1 + sendStatusMedia + paths

**Scope**: M7 素材库基础设施 · isolated/additive · 零现 runtime 影响 (新 API 未被调).

### Added
- `packages/backend/src/modules/assets/persona.types.ts` (NEW · #4 + #5)
  - `PersonaV1Schema` Zod 18-字段 schema · `persona_id/display_name/wa_nickname/gender/age/ethnicity/country/city/occupation/languages/personality/speech_habits/interests/activity_schedule/avatar_prompt/signature_candidates/persona_lock`
  - `EthnicityMY` 枚举 · `chinese-malaysian` (V1) / `malay` (**永不实装**) / `indian-malaysian`/`mixed` (V1.1)
  - `EthnicityNotImplementedError` + `assertEthnicityImplementedInV1()` 守护
  - `canonicalSerializePersona()` · 排序 key · 排 `created_at` · UTF-8 Buffer
  - `computePersonaHash()` · SHA-256 · 截前 16 hex · 跨平台稳定
- `packages/backend/src/modules/assets/prompts/persona-zh-my.ts` (NEW · #4)
  - 马华人口统计 seed · `AGE_DISTRIBUTION` / `MY_CITIES` / `MY_OCCUPATIONS` / `MY_SENTENCE_ENDINGS` (18 词) / `MY_COMMON_PHRASES` (18 条) / `MY_EMOJI_PREFERENCE` (4 组) / `MY_INTERESTS_LOCAL` (16 条) / `ACTIVITY_PATTERNS` (3 型)
  - `buildPersonaGenPrompt()` · **14 硬约束** · 先调 `assertEthnicityImplementedInV1`
  - `MAINLAND_LEAKAGE_TERMS` + `detectMainlandLeakage()` · 大陆梗/app/城市
- `packages/backend/src/modules/assets/prompts/voice-prompts.ts` (NEW · Day 3 placeholder)
  - `SUPPORTED_PIPER_MODELS` · `VOICE_POOL_CATEGORIES` (5 类) · `VOICE_TEXT_POOLS` · `buildPiperRequest()`
  - 腔调说明 (补强 4): Piper zh-CN 大陆腔 · V1 只短语音 · V1.1 评估 fine-tune
- `packages/backend/src/modules/assets/persona.types.spec.ts` (NEW · 20 UT)
  - Schema validation · EthnicityMY V1 守护 · canonical serialize 稳定性 · computePersonaHash · prompt 生成 · mainland leakage
- `BaileysService.sendStatusMedia()` (#8) · `packages/backend/src/modules/baileys/baileys.service.ts`
  - image/voice/file → `status@broadcast` · 16MB 上限 · 不落盘 (status 24h 过期) · 写 `chat_message` 便于日历幂等
- `AssetSource.ManualUpload = 'manual_upload'` (#9) · `packages/backend/src/modules/scripts/asset.entity.ts`
  - Day 2 asset-studio UI 用户手动上传 · PG enum migration 在 Batch B #7
- `storage.ts` 素材路径 helper (#10) · `packages/backend/src/common/storage.ts`
  - `getAssetsDir()` / `getAssetPoolDir(kind, pool)` / `getBuiltinAssetPoolDir(...)` / `getAssetFilePath(...)` / `toAssetRelativePath(...)`
  - 磁盘布局: `data/assets/<kind>/<pool>/<filename>` · `_builtin` 为 installer 预置只读
  - `toAssetRelativePath` 强 forward slash · 跨平台导入一致
- `packages/backend/src/common/storage.spec.ts` (NEW · 5 UT)

### Deferred (Batch B · 明日 09:00)
- #6 · runner 改用新 `computePersonaHash`
- #7 · PG enum ADD VALUE `manual_upload` migration (forward-only)
- #11 · 补强 1 · `_builtin/` 最小资源 smoke

### Tests
- 25/25 绿 (persona.types 20 + storage 5)
- Full backend build 通过 · 零 TS error

### Dry-run (21:30)
continuing · 计划 22:45 关

---

## [unreleased · M11 Day 5 build.bat 完整版] · 2026-04-20 · CI build 编排 9 步

**Scope**: 纯 build script · 零 runtime 影响.

### Changed
- `installer/build.bat` · 从 Day 1.5 骨架升到完整 9 步编排
  1. 检查 Inno Setup 6 安装
  2. 清空 staging/
  3. `pnpm run build` backend · 复制 dist/ + node_modules/ + package.json → staging/backend/
  4. `pnpm run build` frontend · 复制 dist/ → staging/frontend/
  5. 同 4 (其他打包)
  6. Copy `deps/node-lts-embedded` → `staging/node/` (WARN 若缺)
  7. Copy `deps/pgsql-portable` → `staging/pgsql/` (WARN 若缺)
  7b. Copy `deps/redis-windows` → `staging/redis/` + redis.conf
  8. 检查 `assets/wahubx.ico`
  9. `iscc.exe wahubx-setup.iss` → `output/WAhubX-Setup-v*.exe`

### 所需外部资源 (build 前准备)
- **Inno Setup 6** · https://jrsoftware.org/isinfo.php
- **pnpm** · 在 PATH
- **Portable Node 20 LTS** · 下载到 `installer/deps/node-lts-embedded/`
- **PostgreSQL 16 portable** · `installer/deps/pgsql-portable/`
- **Redis for Windows** · `installer/deps/redis-windows/`
- **`assets/wahubx.ico`** · 产品方图标

### 降级模式 (deps 缺失)
- 各 `deps/*` 缺则 WARN + 跳过该 copy
- 生成的 .exe 能编译但**无 runtime** · 仅测 `.iss` 语法 / 流程正确性
- 正式发布前必须齐 4 项 (node + pgsql + redis + ico)

### Dry-run (18:37)
backend pid 新 (重启 2 次) · risk_event 仍 2 · 稳定

---

## [unreleased · M11 补强 1 · bootstrap] · 2026-04-20 · /version/bootstrap · fresh install 探测 (public endpoint)

**Scope**: backend 新端点 · 仅查询 (COUNT) · 不 import M8 · 观察期并行安全.

M11 必做 #11 补强 1 "Fresh install vs upgrade 分叉" backend 侧具体落地.

### Added
- `GET /api/v1/version/bootstrap` · Public · 未登录可调
  - 返 `{fresh_install, platform_admin_exists, license_activated, app_version}`
  - Frontend 首屏 / Installer 诊断用
- `VersionService.bootstrap()` · 3 SQL COUNT (users WHERE role=admin tenant_id=null ·
  license WHERE machine_fingerprint IS NOT NULL · users total)
- 权限: `@Public()` 绕 global JwtAuthGuard + `@Roles()` 空 override 类级 Admin

### 修复 live 暴露的权限问题
- 首次实装只加 `@Public()` · Day 5 smoke 发现 RolesGuard (类级 @Roles Admin) 仍拦 403
- 加 `@Roles()` (empty) 在方法级 · override 类级 · RolesGuard 见 `required.length===0` 放行

### Tests (+3 · 203/203 全绿)

`update.service.spec.ts` (19 ut · 16 → 19):
- bootstrap · 无 DS → 保守 fresh=true
- bootstrap · admin 有 + license 无 → platform_admin_exists=true · license_activated=false
- bootstrap · admin + license 都有 → 典型 existing install 状态

### Live smoke
```
$ curl http://localhost:3000/api/v1/version/bootstrap  (无 auth · public)
{
  "fresh_install": false,
  "platform_admin_exists": true,
  "license_activated": true,
  "app_version": "0.1.0"
}
```

### Frontend 接入 TODO (Day 2.5 UpgradeTab 可复用)
- 首屏未登录时先调 `/version/bootstrap`
- `fresh_install=true` → License Key 输入页
- `platform_admin_exists=false && !fresh_install` → 诊断 modal (数据损坏?)
- 已登录就绕过 · 照常走 dashboard

---

## [unreleased · M11 Day 5 prep pack] · 2026-04-20 · pack-wupd CLI + 跨实现兼容 smoke

**Scope**: 纯 Node 脚本 · 复用 backend archiver (自动 fallback require 路径) · 零 runtime 影响.

### Added

- `scripts/pack-wupd.js` · 独立 CLI
  - `--from X --to Y --app-tar P --migrations "glob" --out O` · 组装未签名 .wupd
  - Magic + version + reserved + manifest length + manifest JSON + inner zip (app.tar + migrations/*)
  - 自动计算 app_sha256 + 逐 migration sha256 填进 manifest
  - `--health-endpoint / --health-timeout / --health-status / --rollback / --notes` 可选
  - archiver 自动 fallback: `archiver` → `packages/backend/node_modules/archiver` → `node_modules/archiver`

### Smoke 端到端跨实现兼容 ✓

```
# 1. pack (CLI)
$ node scripts/pack-wupd.js --from 0.10.0-m10 --to 0.11.0-m11 \
    --app-tar /tmp/app.tar \
    --migrations "/tmp/mig/*.sql" \
    --out /tmp/test.wupd
  ✓ .wupd packed (unsigned) · 1093B (21B app.tar + 2 migrations + manifest)

# 2. sign (CLI)
$ node scripts/sign-wupd.js sign --wupd /tmp/test.wupd --privkey /tmp/keys/privkey.pem
  ✓ signed · 1202B (+109B 签名 JSON 扩展)

# 3. CLI verify
$ node scripts/sign-wupd.js verify --wupd /tmp/test.wupd --pubkey-hex <test pub>
  ✓ signature_valid

# 4. Backend verify (live /version/verify-upd · 跨实现兼容测试)
$ curl -X POST /api/v1/version/verify-upd -F "file=@/tmp/test.wupd"
  manifest: from=0.10.0-m10 to=0.11.0-m11
  signature_valid: False     ← 期望 (backend 公钥是 dev 全 0 · 用 test pub 签 · 验证拒绝正确)
  signature_fail_code: SIGNATURE_MISMATCH
  app_content_valid: True    ← ✓ 跨实现 sha256 一致
  migrations_valid: True     ← ✓ 跨实现 sha256 一致
  version_compat: downgrade  ← ✓ current=0.1.0 from=0.10.0-m10 不匹配 · 正确拒
```

**证明 3 条跨实现兼容**:
1. `.wupd` 二进制格式 (magic + manifest + zip) · CLI 写 · backend 解
2. Canonical JSON 序列化 · 签名签的 byte 一致
3. SHA-256 逐文件计算 · CLI 写入 manifest · backend 读取验证

### Backend 重启 live 验证 (18:29)

- 旧 backend (17:20 起, 无 Day 3-5 代码) 被 taskkill · pid=3492 退出
- 新 build 含 Day 3-5 所有代码 · 启动 OK
  - `fp-master-key.txt loaded` (M11 Preamble 迁移已就绪)
  - `VersionController mapped /api/version` (Day 3 新路由)
  - `BackupService ready` (M10 + Day 4 pre-update)
  - `master-key migration · already done · skip` (之前已跑过 · 幂等)
- `/version/current` 返 `{app_version: '0.1.0', installer_fp: {arch: 'x64', osMajor: 'win11', ramBucket: '64G+'}}`

### Dry-run observation 继续

- 重启后 dry_run=true 状态不变 · acc 1/2 分 100/low · risk_event 2 (历史)
- 无 regression from M11 additions · 200/200 UT 的信心被 live 验证背书

---

## [unreleased · M11 Day 5 prep] · 2026-04-20 · sign-wupd CLI · genkey/sign/verify 三命令

**Scope**: 纯 Node 脚本 · 零项目代码依赖 · CI / 发版用 · 零 runtime 影响.

### Added

- `scripts/sign-wupd.js` · 独立 CLI
  - `genkey --out-dir <dir>` · Ed25519 密钥对 → privkey.pem (0600) + pubkey.pem + pubkey.hex
  - `sign --wupd <path> --privkey <pem>` · 就地覆写 · 填 `manifest.signature = 'ed25519:<b64url>'`
  - `verify --wupd <path> --pubkey-hex <64hex>` · 校验 + 打印 manifest · exit 0/1
  - 与 backend `signing` module 独立实现 · 签出/验入兼容 (同 canonical JSON + 同 Ed25519)
  - `.wupd` 格式对齐 `packages/backend/src/modules/update/wupd-codec.ts`

### Live smoke 即时验证

```
$ node scripts/sign-wupd.js genkey --out-dir /tmp/wahubx-keys
  ✓ pubkey.hex: 1b1f3104d89a10a0d3c53a7d112d4c4b3e85713b2079d0911390fbdcf30e7d2e

$ <造 dummy .wupd · 353B>
$ node scripts/sign-wupd.js sign --wupd /tmp/test.wupd --privkey ...
  ✓ signed · signature: ed25519:04veWuBBYVK_EYrSK3hh9KY8iwPodFe82Bv2W016To… · 462B

$ node scripts/sign-wupd.js verify --wupd /tmp/test.wupd --pubkey-hex 1b1f...
  ✓ signature_valid · Manifest OK
```

Day 5 发版流程固化:
1. 一次性生成生产密钥对 → 离线保管
2. `pubkey.hex` 贴到 `WAHUBX_UPDATE_PUBLIC_KEY_HEX` (public-key.ts)
3. build + pack `.wupd` (build.bat Day 5 补)
4. `sign-wupd.js sign ...` → 分发

---

## [unreleased · M11 Day 4 scripts] · 2026-04-20 · Installer 运行时脚本 (start/stop/init-db/generate-env/redis.conf)

**Scope**: 纯脚本文件 · 不触 runtime · 观察期并行安全.

Day 1.5 留的 `installer/scripts/README.md` placeholder 填上真脚本. 补强 1 (fresh install 分叉) 初步落地.

### Added (`installer/scripts/`)

- `generate-env.js` · 从 Inno 向导端口配置生成 backend `.env`
  - 改编自 FAhubX generate-env.js · 砍 puppeteer 路径 · 加 WAhubX 字段
  - 自动生成强密钥: JWT_ACCESS_SECRET · JWT_REFRESH_SECRET · APP_ENCRYPTION_KEY (M10 过渡 · 会被
    MasterKeyMigrationService 自动迁移到 MachineBound 后可删此行)
  - DB_PASSWORD 随机 20 字符 · 去易混淆字符 · PG 用 `scram-sha-256` 认证
  - 保留已有 .env 密钥 (重装不破坏已加密数据)
  - `.env` 写到 `{install}/.env` · **不嵌 app/backend/** · 升级时 app/ 替换 · .env 保留
- `init-db.bat` · 首次安装 DB 初始化 (补强 1 · fresh install 路径)
  - 1/5 initdb + pg_hba.conf (local-only scram) + postgresql.conf 自定义
  - 2/5 pg_ctl start + pg_isready 轮询
  - 3/5 createdb wahubx
  - 4/5 `node dist/database/migrate.js migrate` (TypeORM)
  - 5/5 pg_ctl stop (initial 初始化不需要常驻)
- `start.bat` · 3-step 启动 (PG → Redis → Backend) · 幂等 (已跑跳过)
- `stop.bat` · 按端口 PID 停服 (CLAUDE.md 铁律: **不**用 `taskkill /IM node.exe`)
- `wahubx.bat` · 用户入口 · call start.bat + /health 15s 轮询 + 自动 open 浏览器
- `redis.conf` · 本地 cache 配置 · bind 127.0.0.1 · 禁持久化 · 64MB 上限

### 目录布局 (installer/wahubx-setup.iss 部署后)

```
C:\WAhubX\ (install dir)
├─ .env                         generate-env.js 生成 · 升级不动
├─ wahubx.bat                   用户入口
├─ start.bat · stop.bat
├─ scripts/
│  ├─ init-db.bat               首次安装跑 (post-install)
│  └─ generate-env.js           post-install 跑
├─ app/                         升级时被 .wupd 替换的目录
│  ├─ node/                     portable Node 20 LTS
│  ├─ pgsql/                    portable PostgreSQL 16
│  ├─ redis/                    Redis for Windows
│  ├─ backend/                  dist/ + node_modules/
│  └─ frontend/                 vite build dist/
├─ data/                        用户数据 · 升级保留 · uninstall 默认保留
│  ├─ config/                   fp-license / fp-master-key / fp-installer / .env.backup
│  ├─ pgsql/                    PG 数据目录
│  ├─ slots/                    wa-session / fingerprint / media
│  └─ tmp/
├─ backups/                     M10 快照 · uninstall 默认保留
│  ├─ daily/
│  ├─ manual/
│  ├─ pre-migration/
│  ├─ pre-import/
│  └─ pre-update/               M11 Day 4 新增
└─ logs/                        运行日志 · uninstall 清
```

### Day 5 smoke TODO (确认 dist/database/migrate.js 存在)

`init-db.bat` 跑 `node dist/database/migrate.js migrate` · 需 backend 的 `pnpm run build` 产出此
compile 脚本. 若不存在 · build-backend.bat 需加步骤把 typeorm migration 入口编译进 dist/.
**当前 dev 环境用 `pnpm run migration:run` (typeorm-ts-node-commonjs)** · 装机用 compiled 版.

### Dry-run observation 稳定 (18:08 checkpoint)

backend pid=3492 unchanged · dry_run=true · risk_event 2 (无新增) · 分数未降.

---

## [unreleased · M11 Day 4 prepare] · 2026-04-20 · UpdateService.apply 准备阶段 · 无 process.exit

**Scope**: 补 apply 前期 (preview + pre-update backup + staging + signal file) · **不含**
process.exit (Day 5 smoke 真装). 保证 backend 不会自己 kill 自己 · 观察期继续安全.

### Added / Changed

- `backup-export.service.ts` · `ExportSource` enum 加 `'pre-update'` · `backup-paths.ts` 加
  `getPreUpdateDir()` · `backups/pre-update/`
- `backup/wab-codec.ts` · `WabManifest.source` 类型加 `'pre-update'`
- `update/apply-signal.ts` (新) · Signal File 机制
  - `ApplySignal` interface · v1 格式 · staging_path / pre_update_wab_path / old_app_rename_to / manifest / written_at
  - `getSignalFilePath()` · 固定路径 `<base>/updates/staging/apply.signal.json`
  - `readSignal()` / `writeSignal()` / `clearSignal()` / `assertNoStaleSignal()`
- `update.service.ts` · apply 真实装
  - `apply(wupdBuf, {dryRun?})` · 返 `PREPARED` / `PREVIEW_REJECTED` / `EXPORT_SVC_UNAVAILABLE`
  - 流程: preview check → assertNoStaleSignal → exportSvc.export('pre-update') → extractPayload
    → 落 staging + 写 signal file → 返 `{staging_path, pre_update_wab_path, signal_path, manifest}`
  - **不 process.exit** · Day 5 smoke 时加 (需 installer 外壳配合)
  - Double-check: sha256 在 preview 后再验一次 · 任一 mismatch throw `APPLY_ABORT`
- `version.controller.ts` · `POST /version/apply-update` 接 `body.dryRun` 参数传给 service

### Day 5 smoke 剩余 TODO (已明注释)

- 真 `.wupd` 签名 · 用 M11 Day 2 SignerService.generateKeyPair · 真公钥填入 `public-key.ts`
- installer 外壳 (Inno Setup 编译的 util 或独立 exe) · 监测 signal file · 执行 rename
- `process.exit(0)` · 补在 apply 末尾 · backend 自杀重启
- End-to-end 本机升级 · bump 0.11.0-m11 → 0.11.1 · 验 app/ 换了 + migration 跑了 + /health 200
- 故意 broken .wupd (篡改 app.tar) · 验 rollback 真触发

### Tests (+1 新 · 200/200 全绿 · 里程碑 200)

`update.service.spec.ts` (16 ut · Day 3 的 15 + Day 4 新增 2 · 替换 Day 3 NOT_IMPLEMENTED 路径):
- apply · 无 BackupExportService 注入 → `EXPORT_SVC_UNAVAILABLE`
- apply · preview rejected → `PREVIEW_REJECTED` · 不进 staging

### 安全边界确认

- apply **不** process.exit · live backend 不受影响
- 写 signal file 在独立路径 (`updates/staging/`) · 不干扰 data/ 或 backups/
- assertNoStaleSignal 防重复 apply · 上次残留必须手动清
- dry-run 观察期进行中 · backend pid 不变 · 无 regression

---

## [unreleased · M11 Day 3] · 2026-04-20 · UpdateService backend · .wupd preview + 路由

**Scope**: 新 backend module · `/version/*` 路由 · 不 import M8 health/dispatcher/risk. apply
真实装在 Day 4 (需 installer 外壳配合原子 rename).

### Added (`packages/backend/src/modules/update/`)

- `wupd-codec.ts` · `.wupd` 文件格式 codec
  - Magic `WUPD` + version 1 + reserved 3B + manifest length + manifest JSON + inner zip
  - `parseWupdHeader()` · 只读 header · preview 用
  - `extractWupdPayload()` · 解 inner zip · 返 `{appTar, migrations: Map}`
  - `verifyAppSha256()` · `verifyMigrations()` · SHA-256 比对
- `version.service.ts` · 当前版本 + fp-installer + SemVer 兼容判断
  - `getCurrent()` · cache · app_version (读 package.json / env) + fp-installer (`readOrCreateFpInstaller`)
  - `assessCompat(from, to)` · 返 `{ok | same | downgrade | major-bump}` + reason
  - `parseSemver / semverCompare` · export (给 UT 用)
- `update.service.ts` · 升级业务
  - `preview(wupdBuf)` · 完整: 签名 + 版本兼容 + app sha256 + migrations sha256 四项 check · 返 `PreviewResult`
  - `apply(wupdBuf)` · **Day 3 骨架** · 返 `{code: 'NOT_IMPLEMENTED'}` · Day 4 补真逻辑
- `version.controller.ts` · Admin-only
  - `GET  /api/v1/version/current`       返 CurrentVersionInfo
  - `POST /api/v1/version/verify-upd`    multipart · 返 PreviewResult (不写状态)
  - `POST /api/v1/version/apply-update`  multipart · Day 3 返 `{code: 'NOT_IMPLEMENTED'}`
- `update.module.ts` · 独立 · 仅 depends AuthModule · 自动拿 `@Global` Signing + Backup

### PreviewResult 字段 (给 Day 2.5 UI 消费)

```
{
  manifest: WupdManifest,
  file_bytes,
  signature_valid: boolean,
  signature_fail_code? : 'MISSING_SIGNATURE' | 'SIGNATURE_MISMATCH' | ...,
  signature_fail_message?,
  version_compat: 'ok' | 'same' | 'downgrade' | 'major-bump',
  version_compat_reason,
  app_content_valid: boolean,       // app.tar 的 sha256 vs manifest.app_sha256
  migrations_valid: boolean,        // 每条 migration 的 sha256 vs manifest.migrations[i].sha256
  migrations_issues?: { missing[], mismatch[] },
  can_apply: boolean                // 所有 check 通过才 true
}
```

### Tests (+15 · 199/199 全绿 · 超目标 20 的 75%)

- `update.service.spec.ts` (15 ut):
  - SemVer 2: parseSemver + semverCompare (PATCH/MINOR/MAJOR/pre-release)
  - preview 6: happy path · magic mismatch · 5 种 version_compat 场景
  - tamper 2: app.tar 改 → app_content_valid=false · migration 缺失 → missing
  - codec 3: verifyAppSha256 · verifyMigrations (ok/mismatch)
  - apply 1: Day 3 skeleton 返 NOT_IMPLEMENTED
  - module test 1: signer generateKeyPair 共享测试 key · 给 verify 用

### Day 4 TODO (apply 真实装)

- 注入 BackupExportService · pre-update 备份 (新 source 'pre-update')
- extractWupdPayload · 落盘 `staging/app.tar` + `staging/migrations/*.sql`
- 写 signal file `C:\WAhubX\updates\staging\apply.signal.json`
- `process.exit(0)` · installer 外壳 (Inno Setup 编译 util) 监测 exit + signal file
  - 接管: atomic rename `app/ → app-old/` + `staging/app-new/ → app/`
  - 启新 backend · TypeORM 跑新 migrations
  - health check 失败 → rename back + restore pre-update.wab

### Dry-run observation 持续稳定

Day 3 期间 backend pid 不变 · dry_run=true · acc 1/2 score=100 level=low · risk_event 仍 2.
下次 check 对齐原节奏 20:45.

---

## [unreleased · M11 Day 2.5] · 2026-04-20 · Admin UI 升级 Tab (纯 frontend 骨架)

**Scope**: 纯 frontend 新文件 + AdminPage 第 10 tab · 零 backend 改动 · Day 3 后端就绪时
直接无缝接入.

### Added
- `packages/frontend/src/pages/admin/UpgradeTab.tsx` · 完整 UI 骨架
  - 当前版本显示 (计划 `GET /version/current`)
  - `.wupd` 上传 + 预览 manifest (计划 `POST /version/verify-upd`)
  - Preview 卡片: from/to · app_sha256 · 签名校验状态 · 版本兼容标签 (OK / MAJOR-bump / downgrade) ·
    health_check · rollback strategy · migrations 列表
  - Apply 按钮 (当前 disabled 加 tooltip "Day 3 后端就绪") · Popconfirm "确认升级"
  - Progress modal · antd Steps 8 阶段 (verifying → pre-backup → stopping → replacing →
    migrating → starting → health-check → done/rollback) · 失败走 rollback 显 `Result status=error`
  - 成功显 "backend 断线 · 请刷新" Result + 刷新按钮
- AdminPage 第 10 tab `升级` · 紧接 `备份` tab 后

### Day 3-4 backend 对接点 (已在 UI 代码标 TODO)
- `GET /version/current` · 返 `{ app_version, installer_fp: {arch, osMajor, ramBucket} }`
- `POST /version/verify-upd` · multipart file · 返 `ManifestPreview + signature_valid + version_compat`
- `POST /version/apply-update` · multipart file · 真升级 · backend 中途会自杀重启

### Backend 不就绪时降级行为
- `GET /version/current` 404 / 超时 → UI 顶部 `WARN banner` "Day 3-4 后就绪"
- Apply 按钮 `disabled` + tooltip
- Preview 仍可调 · 报错 `preview 失败 · 后端未就绪`

### Tests
- Frontend 既有 4 ut (401 refresh) 保持通过 · UpgradeTab 不写 UT (纯 UI · Day 3 再补集成测)
- Backend 184/184 保持

### Dry-run observation 持续
Day 2.5 期间 backend live · 无改动 · dry-run 继续累积.

---

## [unreleased · M11 Day 2] · 2026-04-20 · Ed25519 签名/验证模块 (standalone crypto)

**Scope**: 纯 crypto 算法 · 不 import M8 health/dispatcher/risk · 不 import M10 backup · standalone.
观察期并行允许.

### Added (`packages/backend/src/modules/signing/`)

- `types.ts` · `WupdManifest` interface · 字段: `from_version / to_version / app_sha256 /
  migrations[] / health_check / rollback / created_at / signature`
- `public-key.ts` · `WAHUBX_UPDATE_PUBLIC_KEY_HEX` 硬编码 (当前 dev placeholder 全 0 ·
  production build 必须替换) · `getUpdatePublicKeyDer()` 拼 SPKI DER 给 crypto.verify
- `manifest-codec.ts`:
  - `canonicalSerialize()` · 递归 sort object keys + 紧凑 JSON + UTF-8 · 跨平台 bit-for-bit 一致
  - `parseSignatureField()` / `buildSignatureField()` · `ed25519:<base64url-64B>` 编解码
- `ed25519-signer.service.ts` · **dev/CI 用** · `sign(manifest, privateKeyPem)` 返带签名 manifest
  · `generateKeyPair()` 静态方法 (一次性发版用)
- `ed25519-verifier.service.ts` · **production backend 运行** · `verify(manifest, {publicKeyHex?,
  allowDevPlaceholder?})` 返 `{ok:true}` 或 `{ok:false, code, message}` ·
  `checkPublicKeyHealth()` 启动自检 · production 模式下全 0 key 直接拒
- `signing.module.ts` · `@Global` · providers = [Signer, Verifier] · exports 同

### Fail codes (`VerifyFailCode`)

- `MISSING_SIGNATURE` · 未签
- `SIGNATURE_FORMAT` · 非 `scheme:b64` 格式
- `UNSUPPORTED_SIG_SCHEME` · prefix 不是 `ed25519` (V2 换算法时换)
- `INVALID_SIGNATURE_LENGTH` · base64url 解码后非 64B
- `SIGNATURE_MISMATCH` · 签名有效 · 但 payload 被改 / 用错公钥验
- `DEV_PLACEHOLDER_KEY_IN_PROD` · production build 下公钥是全 0 · 拒

### Tests (+ 13 new UT · 184/184 全绿)

**`ed25519.spec.ts`** (13 ut):
- Signer 4: sign 返正确格式 · 同输入 deterministic · 非 Ed25519 key 拒 · generateKeyPair 返 PEM+hex
- Verifier 7: 正确签 ok · 篡改 payload → MISMATCH · 截断签名 → LENGTH/MISMATCH · 未签 → MISSING ·
  格式非法 → FORMAT · 不同密钥对 → MISMATCH · production+dev key → PLACEHOLDER_IN_PROD
- Codec 2: canonical 不同 key 顺序同输出 · signature 字段不参与序列化

### Constraints

- 当前 `WAHUBX_UPDATE_PUBLIC_KEY_HEX` 是 **dev placeholder** (全 0) · production build 前必须换真公钥
  - 生成: `openssl genpkey -algorithm ed25519 -out privkey.pem` + 提取 public hex 填入
  - 私钥离线保管 · 不入仓库
  - build.bat 应加检查 · 若 hex 全 0 且 `NODE_ENV=production` 拒编译
- **不**在本模块跑 smoke 级签名 · 真 `.wupd` 签名 + 真升级流程在 Day 3-4 UpdateService + Day 5 smoke
- Ed25519 选型依据 (§拍板 Z1): node built-in crypto 原生支持 · 32B 公钥小 · deterministic 签名
- 双校验职责 (D 决策):
  - Installer (Inno Setup Pascal) 校 `app_sha256` · Day 3-4 补 .iss 里 code
  - Backend (本模块 Verifier) 校 manifest signature · onModuleInit `checkPublicKeyHealth` 启动自检

### Dry-run observation 并行进行中

Day 2 期间 dry-run 保持 live · backend pid 稳定 · risk_event 无新增异常 · acc 1/2 未触发降级.
22:45 关 dry-run + 验真降级.

---

## [unreleased · M11 Day 1.5] · 2026-04-20 · Installer 基座 (Inno Setup .iss + Node 嵌入 placeholder)

**Scope**: 纯配置 + 占位文件 · 零 runtime / backend / frontend 改动 · dry-run 观察期并行允许
(模块对 M8 health 完全正交).

### Added
- `installer/wahubx-setup.iss` · Inno Setup 6.x 脚本 · 改编自 FAhubX main 分支 (commit ref `a6eb016` 前)
  - 品牌 FAhubX → WAhubX · 新 AppId UUID
  - 默认安装目录 `C:\WAhubX` · OutputBaseFilename `WAhubX-Setup-v{ver}`
  - 简化 FAhubX 的 Local/Cloud 模式选项 · **WAhubX V1 本地桌面 only**
  - Port Configuration 页保留 · 默认端口 3000 (backend) / 5433 (pg) / 6380 (redis)
  - **补强 2 · Uninstall 保 data/**: 默认仅删 `{app}\app\*` · Task checkbox `clean_data` 勾上才递归删 `{app}\data` + `{app}\backups`
  - 中文简体 + 英文双语
- `installer/deps/README.md` · Node 20 LTS 嵌入方式说明 + 占位目录
- `installer/assets/README.md` · 图标资源说明 (wahubx.ico 需用户提供)
- `installer/scripts/README.md` · 占位 (Day 3 真写 init-db / generate-env)
- `installer/build.bat` · 最简版 · 构建流程骨架 (Day 3-4 填 stage/backend/frontend 复制)
- `.gitignore` 追加 `installer/output/`, `installer/staging/`, `installer/deps/node-*/`
- `installer/.gitkeep` 保留空子目录结构

### Constraints
- **不**跑 staging/backend 与 staging/frontend 复制 · 那需 Day 3-4 UpdateService
- **不**拷 Node 20 LTS 二进制到 `deps/node-lts-embedded/` · 文件大 (~60MB) 不进 Git · CI build.bat 步骤下载
- **不** SignTool.exe · V1 不做 Code Signing (见 M11 Code Signing constraint)

### Windows Code Signing · **V1 不做** (决策调整 · 2026-04-20)

~~~~
原 M11 propose 计划 Code Signing 生产发布前必购 · **撤销** · 对齐 FAhubX 发布模式
~~~~

- 目标市场 (马来西亚私域运营者) SmartScreen 警告接受度高
- WA 自动化工具签名反而可能触发反病毒标记 (行为特征合规边缘)
- V1 客户 onboarding 视频 / README 教 "Run anyway" 即可 (产品层, 非代码 scope)
- `installer/build.bat` 不调 SignTool.exe · `.exe` 文件名含版本号方便识别
- **V1.1+ 若出现任一情况再评估**:
  - 客户数 > 100
  - 企业客户要求
  - 反病毒软件 false positive 频发

Ed25519 做 `.wupd` **内容完整性** (M11 Day 2 实装) · 不依赖 Authenticode 身份证明.

---

## [unreleased · M11 Preamble] · 2026-04-20 · fp 文件命名统一 (观察期内破例提交)

**破例背景**: dry-run 观察期 (2026-04-20 14:52 起 24-48h) 原则上不开 M11 代码. 用户明确破例:
> M11 Preamble (fp 统一) 属纯命名重构 · 不触 health/dispatcher/risk
> scope 严格限 fp 三文件 + migration + 文档 · 其他任何 M11 代码禁

**动机**: M10 smoke 暴露 M1 `machine-fingerprint.txt` (32 hex) 与 M10 `master-key-fingerprint.txt`
(64 hex) 用途正交但命名笼统 · 将来 M11 installer 再起第 3 份会继续爆命名冲突.
M11 Preamble 先统一, Day 1 开始一切新代码按新名写.

**不做** (严格锁定, 等观察期结束才开):
- ❌ Inno Setup .iss 任何行 · UpdateService · Ed25519 · .wupd 逻辑 · 升级 UI
- ❌ health / dispatcher / risk / scorer 任何行

### Changed · fp 命名统一

**文件重命名** (`data/config/`):
- `machine-fingerprint.txt` → `fp-license.txt` (M1 License 绑定用 · 32 hex)
- `master-key-fingerprint.txt` → `fp-master-key.txt` (M10 AES 密钥派生源 · 64 hex)

**向后兼容** (V1.1 可删 fallback 分支):
- `machine-id.util.getMachineId()` 启动时检测旧名 · 合法则 rename 到新名 + 删旧
- `MachineBoundMasterKeyProvider` 构造时调 `migrateLegacyMasterKeyFingerprint()` 同逻辑
- 旧名格式非法时**不动** · 让上层报错走 E2 recovery 路径 (不自动损坏)

### Added · fp-installer.txt (M11 Preamble 新文件)

- `packages/backend/src/modules/licenses/fp-installer.util.ts`
- 格式 JSON: `{ arch, osMajor, ramBucket, createdAt, installerVersion: '1.0' }`
- 粗粒度算法 (故意):
  - `arch` = `os.arch()` (x64 / arm64 / ia32)
  - `osMajor` = `deriveOsMajor()` · Windows 走 release build (22000+ = win11) · macOS 走 Darwin map · Linux 走 kernel major
  - `ramBucket` = 向下取 {4G, 8G, 16G, 32G, 64G+} 档
- `readOrCreateFpInstaller()` 返 `{current, stored, matches, wasFreshlyGenerated}` · M11 后续 installer 用此判兼容性
- **不参与任何加密** · 纯信息报告 · 不硬拒绝 · 让用户 / installer 策略层决策

### Tests (+ 16 new UT · 171/171 全绿)

- `fp-installer.util.spec.ts` · 7 ut (ramBucket 边界 · osMajor · compute · readOrCreate 首次/二次/硬件变/损坏 JSON)
- `machine-id.util.spec.ts` · 4 ut (首次新名 · legacy 迁移 · legacy 非法不迁 · 新旧并存不覆盖)
- `machine-bound-master-key.migration.spec.ts` · 5 ut (无 legacy · legacy 合法迁移 · legacy 非法保留 · 并存不覆盖 · 构造触发迁移)

### Docs

- 技术交接文档 §6 · `data/config/` 块更新 · 列 3 份 fp 文件 + 出处 M 号

### Constraints (M11 Preamble 破例范围)

- 仅 fp 三文件 + 迁移 fallback + UT + 文档 · **零**业务逻辑改动
- 后端启动时老数据 (M10 遗留 `master-key-fingerprint.txt`) 会一次性被重命名
- 观察期结束、真 M11 开工时, 这些命名已就位 · Day 1 加 Inno / Ed25519 等按新名直接用

---

## [v0.10.0-m10] · 2026-04-20 · M10 备份/升级基础设施 · §B.11 三层策略 + MasterKey 机器绑定

M10 里程碑: 每日本地快照 (whitelist + A+ missed 补跑 + 7 天 retention) · `.wab` 手动导出/导入
(AES-256-GCM + magic bytes + manifest AAD 防篡改) · 单槽 daily 恢复 (补强 1) · MasterKeyProvider
env → MachineBound 迁移 (E1 pre-migration.wab 预备份 + 事务 re-encrypt) · 硬件指纹变化 recovery
两选 (E2 原 env key / 导入 .wab) · `.wab` 导入 F+ pre-import 自动备份 + 失败回滚 · Admin UI 备份 tab.

**顺序链**: M7 (素材) 仍延后 → M8 保命 → M9 救济 → **M10 保底**. 砍 `.wupd` verify 到 M11
(与 apply 一起设计) · M10 配额 2 周 · 超出 0 周.

### 收工标准 (全绿)

| # | 项 | 证据 |
|---|---|---|
| 1 | 每日快照 setInterval + A+ missed 补跑 + whitelist + 7-day retention | `BackupService` · 6 ut (shouldRunMissed 3 + retention + snapshotSlot empty/hasData 3) |
| 2 | WabCodec · magic `WAHUB` + AES-256-GCM + manifest AAD 绑 | `wab-codec.ts` · 4 ut (roundtrip / wrong key / non-wab / tampered manifest) |
| 3 | `.wab` 手动导出 (pg_dump docker + slots whitelist + manifest) | live smoke manual export → 245KB · manifest 解析正确 |
| 4 | `.wab` 导入 F+ pre-import backup + 失败回滚 | `BackupImportService` · defense in depth catch + rollbackFromBuffer |
| 5 | 单槽 daily restore (补强 1) | `PerSlotRestoreService.restore` + `listAvailableSnapshots` · live smoke slot 11 真恢复 |
| 6 | MachineBoundMasterKeyProvider · HMAC-SHA256(salt, fingerprint) · 文件持久化 | `MachineBoundMasterKeyProvider` · 4 ut (首次生成/二次读/非法格式/raw fingerprint) |
| 7 | E1 MasterKey 透明自动迁移 · pre-migration.wab 预备份 + verify + 事务 re-encrypt | `MasterKeyMigrationService` · **live smoke 真跑**: 1 provider env → machine · `master-key.migration_done=true` |
| 8 | E2 HardwareRecovery · decrypt fail 探测 · 两选恢复 (env key / .wab) | `HardwareRecoveryService.detect/recoverWithEnvKey/recoverFromWab` · 每次 GET /recovery/status re-detect |
| 9 | BackupController · 11 endpoints · Admin-only | `/backup/daily{,run-now}` · `/backup/export` · `/backup/manual{,/:file/download}` · `/backup/import{,/preview}` · `/backup/slots/:id/{snapshots,restore}` · `/backup/recovery/{status,env-key,import}` |
| 10 | Frontend `BackupTab` · E2 red banner + 2 recovery 选项 + daily 状态 + manual list + per-slot restore modal | `packages/frontend/src/pages/admin/BackupTab.tsx` · AdminPage 第 9 tab |
| 11 | 155/155 unit test green (+17 M10) | wab-codec 4 + machine-key 4 + backup-svc 6 + backup-paths 3 |
| 12 | Live smoke 11 路径 · E1 真迁移 + daily 48 slots + export + preview + restore + recovery normal | 见下 Verified 段 |

### Added (M10)

**数据模型** — migration `SeedBackupSettings1778000000000` (无 schema 改动)
- app_setting seed: `master_key.migration_done=false` + `backup.last_daily_at=null`

**MasterKey 抽象升级** (`packages/backend/src/modules/ai/`)
- `MachineBoundMasterKeyProvider` — HMAC-SHA256(salt, SHA-256(host|platform|mac|cpu|ramGB)) → 32B
  - 文件持久化 `data/config/master-key-fingerprint.txt` (0600) · **独立于 M1 `machine-fingerprint.txt`** (后者是 license 用 32 hex)
  - 首次生成后**不再重算** · 硬件小变动不会漂移
  - `isFreshInstall()` · `source()` 供日志脱敏
- `EnvMasterKeyProvider` 宽容化 — APP_ENCRYPTION_KEY 缺失不抛, `isAvailable()` + `setKeyFromHex()` 给 E2 recovery 用
- `AiModule` 绑 `MASTER_KEY_PROVIDER → MachineBoundMasterKeyProvider` · 导出 Env / Machine / token 给 BackupModule

**BackupModule** (`packages/backend/src/modules/backup/`)
- `BackupService` — daily setInterval tick 60s 检查 hour:00 触发 · `runDailyNow()` · `retentionSweep()` · `getSnapshotStatus()` · A+ missed 补跑 onModuleInit
- `BackupExportService` — `pg_dump --clean --if-exists --no-owner --no-privileges` via docker exec → SQL text + slots whitelist → archiver zip → WabCodec
- `BackupImportService` — preview (parse header) · import (F+ pre-import backup → decrypt → psql restore → restore slots → rehydrate · 失败 rollback)
- `PerSlotRestoreService` — 单槽 zip 解压 · baileys `evictFromPool` · listAvailableSnapshots
- `MasterKeyMigrationService` — E1 onModuleInit detect env-加密 providers → pre-migration.wab + verify → 事务 re-encrypt → markDone
- `HardwareRecoveryService` — E2 onModuleInit + on-demand detect · recoverWithEnvKey (验 env key → 重加密) / recoverFromWab (委托 BackupImport)

**WabCodec** (`wab-codec.ts`)
- 格式: magic(5) + ver(1) + iv(12) + tag(16) + manifestLen(4) + manifest JSON(明文) + AES-256-GCM ciphertext
- Manifest 作 AAD 绑 · 改 manifest 触发 auth fail · 防中间人替换
- `parseWabHeader()` 仅读 header 不 decrypt · 用于 import preview
- `decodeWab()` 失败抛 `WAB_DECRYPT_FAILED` · 明确指引 E2 recovery 路径

**Controller** (`/backup/*` Admin only)
- daily: `GET /backup/daily` + `POST /backup/daily/run-now`
- manual: `POST /backup/export` + `GET /backup/manual` + `GET /backup/manual/:filename/download`
- import: `POST /backup/import/preview` + `POST /backup/import`
- per-slot: `GET /backup/slots/:slotId/snapshots` + `POST /backup/slots/:slotId/restore`
- recovery: `GET /backup/recovery/status` (每次 re-detect) + `POST /backup/recovery/env-key` + `POST /backup/recovery/import`

**Frontend BackupTab** (`packages/frontend/src/pages/admin/BackupTab.tsx`)
- 顶部 E2 recovery red banner (locked 时 · 含 fingerprint 前缀显示 + 恢复按钮)
- Daily 快照卡 · Statistic (最近时间 / 快照天数) + 日期表 + 立即运行按钮
- Manual 备份卡 · 导出按钮 + 列表 (含 `下载` 按钮) + 导入 modal (preview + confirm + `Popconfirm`)
- 单槽恢复卡 · 列已绑定账号 + `从快照恢复` modal (日期下拉)
- Recovery modal · Button.Group 切换方案 A (env key Input.Password) / B (.wab 上传 + override key)
- AdminPage 第 9 tab `备份`

**文档**
- 技术交接文档 §6 · 移除 `chrome-profile`, 加 `media` · 加 M10 `backups/` 目录块
- 技术交接文档 §B.11 · 更新 Layer 1 描述 · 加 A+ missed 补跑 + whitelist 策略
- 附 `master-key-fingerprint.txt` 与 `machine-fingerprint.txt` 用途区分

**依赖新增** (backend)
- `archiver@^7` + `@types/archiver` · zip 创建
- `yauzl@^3` + `@types/yauzl` · zip 读取

### Verified (live smoke · 11 路径)

- 启动日志:
  - `MachineBound master key derived · source=machine:20abfe62… · len=32B · fresh=true (第一次) / false (第二次)`
  - `BackupService ready · daily=03:00 · retention=7d · includeMedia=false`
  - `missed backup detected (lastDaily=never) · 立即补跑` → `daily snapshot 2026-04-20 · ok=60 skipped=4 fail=0`
  - `master-key migration · 检测 1 个 env-加密 provider · 开始迁移`
    → `export pre-migration · 240KB · 475ms`
    → `pre-migration backup verified`
    → `1 providers re-encrypted`
    → `DONE · APP_ENCRYPTION_KEY 现可从 .env 移除`
- HTTP smoke (延续 11 项):
  - `GET /backup/daily` → lastDailyAt 有值 · 1 date with 48 slots · 84 KB
  - `GET /backup/recovery/status` (首次 stale locked · 修复 controller 每次 re-detect 后) → **normal**
  - `POST /backup/export` → 245 KB · manifest.source=`manual-export` · schema_hash=42186f26c29045e5
  - `GET /backup/manual` → 1 file 列出
  - `GET /backup/slots/11/snapshots` → 1 snapshot 2026-04-20 · 44 KB
  - `POST /backup/slots/11/restore` → 成功 restoredFromDate=2026-04-20 · slot 01 真解压覆盖
  - `POST /backup/import/preview` on `pre-migration.wab` → manifest + schemaMatches=true · 不写任何东西
- 文件系统验证:
  - `data/backups/pre-migration/*.wab` 存在 · 245460 bytes
  - `data/backups/daily/2026-04-20/slot_*.zip` 48 个
  - `data/config/master-key-fingerprint.txt` 存在 64 hex · 不与 M1 `machine-fingerprint.txt` 冲突
- DB 验证:
  - `app_setting` `master_key.migration_done=true` · `backup.last_daily_at=2026-04-20T07:32:08.449Z`
  - `migrations` 表最新 `SeedBackupSettings1778000000000`

### Constraints (M10 范围边界)

- **`.wupd` verify 砍到 M11** · 升级 apply + rollback + 签名算法 (Ed25519) 一起设计 · M10 纯备份闭环 · M11 纯升级闭环
- **30 天回收站 (§B.18)** 延后 V1.1 · M10 per-slot restore 已能应急恢复 24h 内误删号
- **pg_dump via docker exec** · V1.1 评估脱 docker (installer 打包 pg_client 或 TypeORM JSON export)
- **云备份 (Layer 3)** · V2 付费增值
- **增量备份** · V1.1 · V1 全量 zip 每槽 ~10MB 够用
- **Redis 数据不进备份** · 现状 Redis 无关键数据 (BullMQ 装了未用) · 改动需 V1.1 再议
- **MasterKey 文件丢失 recovery** · E2 已提供两路径 · 但若用户两路径都走不通 (丢原 env + 丢历史 .wab), AI keys 永失 · 需重新 bind 所有 AI provider
- **Import 语义 = 覆盖** · 不支持"合并" · 覆盖前 F+ 自动 pre-import backup
- **跨 license 迁移不支持** · .wab 含 tenant_id 但不做跨 license 校验 · 设计上此能力不存在
- **硬件指纹算法固定** · HMAC-SHA256(salt, SHA-256(...)) · salt 硬编码 · 未来轮换算法需新 master-key v2 + 批量 re-encrypt 迁移
- **Service init order 依赖** · HardwareRecovery 在 E1 前跑 detect 会看到 locked (本次 smoke 暴露) · 修复: controller `GET /recovery/status` 每次 re-detect (1 次 O(providers) DB 查询, UI 轮询可接受)

### Rationale (存档关键决策)

- **A+ missed 补跑** (用户 2026-04-20) · 用户每晚关机 → setInterval 永不到 03:00 → 永无备份 = 灾难. 启动时检查 last_daily_at > 24h 立即补一次. 额外成本: 每次启动 1 次 DB 查询 + 可能 1 次 ~500ms 打 zip. 可接受.
- **E1 pre-migration.wab 强制 + verify** (用户 2026-04-20) · MasterKey re-encrypt 过程若中间失败, 数据部分 env/部分 machine, 全完. Verify 步骤额外 ~100ms, 值.
- **E2 两选 recovery** (用户 2026-04-20) · 硬件变更 = 高频真实场景 (用户换网卡 / 重装系统 / 数据迁移). 无 recovery = 产品灾难. 方案 A 输入原 env key · 方案 B 导入 .wab · 覆盖 99% 场景.
- **F+ import 前 pre-import backup** (用户 2026-04-20) · 导入失败是可能的 (文件损坏 / schema 不匹配). 失败时用户数据不应卡在中间态. pre-import backup 让回滚确定可行.
- **whitelist 而非 blacklist** (B 决策实测) · `data/slots/` 子目录可能意外出现新模块产物. whitelist `wa-session + fingerprint.json` 明确边界 · media 默认排除因为体积大且非必要 (V1.1 考虑 INCLUDE_MEDIA=true 选项)
- **machine-id / master-key fingerprint 两独立文件** (smoke 暴露) · M1 `machine-fingerprint.txt` 32 hex = License 绑定, M10 `master-key-fingerprint.txt` 64 hex = 加密密钥派生. 不同用途不同格式不同稳定性需求. 合用会造成 M1 升级 M10 时误判.
- **Ed25519 / .wupd 验证延 M11** (用户 2026-04-20) · verify 单飞没用. 与 apply/rollback 判定条件 (health 5xx? migration throw? 超时?) 共同设计连贯. 节 0.5 周回 2 周配额.
- **manifest 作 AAD 绑 GCM** · 若 manifest 明文放外层 attacker 可替换 (比如改 tenant_id). AAD 绑让 auth tag 覆盖 manifest · 改一字节就 fail.
- **Import = 覆盖不合并** · 合并语义复杂 (同一 phone 两条 wa_account? 剧本包冲突? chat_message 时序?). V1 粗暴覆盖 + F+ 回滚 · 清晰优先.

---

## [v0.9.1-m9] · 2026-04-20 · M9 patch · Frontend 401 auto-refresh 拦截器

**背景**: v0.9.0-m9 收工 handoff smoke 暴露漏洞. `JWT_ACCESS_TTL=15min`, 到期前端任一 HTTP
请求 → 401 → 原 `api.ts` 拦截器直接 `setSession(null, null) + on401` 强登出. 演示场景每 15
分钟踢回登录页 = 演示级 UX bug, 不接受为 V1.1 debt.

**修复** (`packages/frontend/src/lib/api.ts`)
- 401 首次命中 → 用 refresh token 调 `/auth/refresh` 换新 access → retry 原请求一次
- 失败 (refresh 本身 401 / 网络错误) → 走原登出路径
- 防无限循环: `original._retry` 标 · 同一 config 只 retry 1 次
- 并发控制: `inflightRefresh` Promise · 多个同时 401 的请求共享 1 次 refresh
- 豁免: `/auth/refresh` + `/auth/login` + `/auth/activate` 自身 401 不尝试 refresh (避免递归)
- 去重: refresh 失败 catch 块检查 `getAccessToken() !== null` 才再调 on401 (auth 端点分支已清时跳过)

**doRefresh 实现微调**: 原方案用裸 `axios.post` 避免递归. 改为走 `api` 实例 + `_retry=true` 标
+ 路径含 `/auth/refresh` 自动走 isAuthEndpoint 分支. 好处: 同一 MockAdapter 即可拦所有请求,
测试简单.

**测试** (`src/lib/api.test.ts`) · vitest + axios-mock-adapter + jsdom
- 4 ut 覆盖: refresh 成功 silently 200 / refresh 失败清 session 调 on401 / 防无限循环 retry
  后 401 不再 refresh / auth 端点 401 不触发 refresh
- localStorage polyfill (jsdom 25 某些 runtime 下 `.clear` 缺失)

**依赖新增** (frontend dev)
- `vitest@^2` · `axios-mock-adapter@^2` · `jsdom@^25`

**集成 smoke** (TTL=30s 加速模拟 20min idle)
```
[t=0s ] POST /auth/login                         → 200 · access + refresh
[t=1s ] POST /takeover/1/acquire                 → 200
[t=2s ] POST /chats/1/send-text #1 (fresh)       → 200 · waMessageId=3EB0349CC908E4B4F3846D
[t=3s ] idle 35s (token TTL 过期)
[t=38s] POST /chats/1/send-text #2 (expired)     → 401
[t=38s] ↳ interceptor: 401 + 非 auth 端点 + _retry=false → 调 refresh
[t=39s] ↳ POST /auth/refresh                     → 200 · new tokens
[t=40s] ↳ retry original with new token          → 200 · waMessageId=3EB0D2348CEBE11045F2F5
```
两条不同 waMessageId = 两条真实消息都成功发到 slot 12 · 用户视角 send #2 silently 200

**Constraint**: vitest 装在 frontend · 为 401 拦截器 + 未来更多 UI 测试准备. 后续建议所有新
frontend 模块配 vitest · M10 / M7 文件都走这个方式.

**Tag 策略**: v0.9.0-m9 已 push 远端 · 本补丁新增 `v0.9.1-m9` tag 指向补丁 commit · **不覆写
v0.9.0-m9** (保护其他 clone 者 + 历史语义纯粹). v0.9.0-m9 = M9 首交付 · v0.9.1-m9 = M9 handoff
发现的真 UX bug 立即补丁, 同一里程碑的修补版.

---

## [v0.9.0-m9] · 2026-04-20 · M9 接管 UI · Takeover Lock + socket.io + 手动发消息 + Hard-kill 逃生口

M9 里程碑: §B.8 接管锁状态机 · socket.io gateway (JWT handshake 强制 + 10s 断线 grace) · 手动 text/image/voice/file 发送 (95MB + MIME 白名单 + EXIF 剥离) · graceful pause (TaskPausedError) + 30s hard-kill 逃生口 (TaskInterruptedError, 不扣分) · 28/30min idle 双阶段桌面告警 · 前端 TakeoverTab (AdminPage 第 8 tab).

**顺序链**: M7 (素材) 延后 → M8 (健康) → **M9 (接管)**. 用户 2026-04-20 链决策: "保命 > 锦上添花, M9 > M7 同理 M8 > M7". 关键 rationale: M8 dry-run 72h 期间 **没有自动降级**, 必须有人工接管作救济渠道. M9 完成后才关 dry-run 进真自动降级, 时序对齐.

### 收工标准 (全绿)

| # | 项 | 证据 |
|---|---|---|
| 1 | TakeoverLockService · acquire/release/hard-kill/heartbeat + 内存 Map + DB flag 双写 | `takeover-lock.service.ts` · 17 ut · smoke 全 13 条路径 OK |
| 2 | F 决策权限: admin/platform-admin 可 · operator/viewer 403 · 跨租户非 platform-admin 403 | smoke 4 (tenant1 admin on slot-tenant4 → HTTP 403) · 3 ut |
| 3 | G 决策 socket 10s 断线 grace · 内存 timer · 非 idle timeout 路径 | `onSocketDisconnect` · 2 ut (fake timers) |
| 4 | D+ 上传卫生 3 条: 95MB + MIME 白名单 + sharp EXIF 剥离 | `takeover-upload.service.ts` · 8 ut 覆盖每白名单 + exe 拒 + path traversal |
| 5 | Z1+ Hard-kill 逃生口: 30s 未 graceful pause → reveal 按钮 · `task_run.status=interrupted` 不扣分 | migration 加 enum + `hardKill()` · 2 ut + chat-executor-pause 2 ut |
| 6 | X1+ 30min idle 硬释放 · 28min UI toast · sweep 30s 扫 | 2 ut (fake timers 29/31min) + smoke 配置 10min/9min 验证 sweep |
| 7 | socket.io JWT handshake 强制 · 匿名 disconnect · 复用 UserSessionService 校验 | `TakeoverGateway.handleConnection` · namespace `/takeover` · rooms `takeover:account:<id>` |
| 8 | 实时 fan-out: baileys `messages.upsert` → EventEmitter2 → gateway → rooms | smoke 20 (id=50 dir=in 落 acc 2, 发送方 slot 11 · 端到端) |
| 9 | Dispatcher 集成: `TaskPausedError` → task_run=paused / task=pending · `TaskInterruptedError` → interrupted · 不触发 risk `send_failed` | `dispatcher.service.ts` executeInBackground 双 catch · chat-executor demo `ctx.throwIfPaused?.()` |
| 10 | Frontend `TakeoverTab`: slot 列表 + 联系人 + 消息流 + send text/media + socket heartbeat + 28min toast + 30s hard-kill reveal | `TakeoverTab.tsx` · AdminPage tab key=takeover · vite proxy `/socket.io` |
| 11 | 28min idle warning / 30min timeout → `AlertDispatcher` 复用 M8 桌面 channel | `TakeoverAlertRelay` @OnEvent · fan-out 到 DesktopAlertChannel (§B.25) |
| 12 | 138/138 unit test green (+27 M9) | lock 17 + upload 8 + chat-pause 2 · 无 M8 前置 regression |

### Added (M9)

**数据模型** — migration `AddTakeoverRunStates1777000000000`
- `task_run_status_enum` 追加 `paused` (graceful 抢占) + `interrupted` (hard-kill 30s 兜底)
- `task_run.pause_snapshot jsonb` · 存抢占快照 `{accountId, reason, pausedAt, ...}` · resume 时 executor 读 (V1 字段立, 深度 resume 逻辑 V1.1 做)
- `task.paused_at timestamptz` · 接管时设, release 清; dispatcher 下一 tick 忽略 pausedAt 且 status=pending 的任务 (M9 V1 不用此字段过滤, 靠 takeover_active; 字段留给 V1.1)
- **enum 加值需独立提交** — PG 限制 `ALTER TYPE ADD VALUE` 同事务内不可引用. 本 migration 不建部分索引 (若需 `WHERE status='paused'`, 下一 forward-only migration 加)

**Takeover module** (`packages/backend/src/modules/takeover/`)
- `TakeoverLockService` · 内存 `Map<accountId, LockState>` + DB flag 双写 · `onModuleInit` 清进程重启残留
  - `acquire(accountId, user)` · 权限门 + 幂等同用户 + LOCK_HELD_BY_OTHER
  - `release(accountId, user, reason)` · 幂等 + 清 task.paused_at + emit event
  - `hardKill(accountId, user)` · running task_run → `interrupted` + emit · 不扣 risk 分
  - `heartbeat(accountId, user)` · 延长 idle timer
  - `onSocketConnect/Disconnect` · 10s disconnect grace timer (配置可调)
  - `isPaused(accountId)` · executor 查询探针
  - `sweepIdleLocks` (30s setInterval) · 28min emit warning once · 30min auto-release
- `TakeoverUploadService` · 3 条硬卫生 (D+ 决策)
  - Size ≤ 95MB (WA 100MB 留 5MB buffer)
  - MIME 白名单 · image(jpeg/png/gif/webp) · voice(ogg/mp3/opus/m4a) · file(pdf/docx/xlsx/zip/txt)
  - Sharp `.rotate().toFormat().toBuffer()` 剥 EXIF + 应用 orientation · jpeg/png/webp/gif 全走一遍
  - `safeName()` 去 path traversal · ASCII-safe · 保留 `.`-`_`
- `TakeoverGateway` (socket.io `/takeover`)
  - `handleConnection` · 手动校验 JWT (复用 JwtService + UserSessionService) · 无效 disconnect(true)
  - `@SubscribeMessage('subscribe')` · client 发 `{accountId}` 后 join room + markSocketConnect
  - `@SubscribeMessage('heartbeat')` · 10s 前端主动拉 idle
  - `@OnEvent` × 7 · 转 EventEmitter2 channels → socket.io rooms:
    - `takeover.message.in/out` → `message.in/out`
    - `takeover.acquired/released/hard_kill` → `lock.acquired/released/hard_kill`
    - `takeover.idle_warning/timeout` → `lock.idle_warning/timeout`
- `TakeoverAlertRelay` · `@OnEvent('takeover.idle_*')` → 复用 M8 `AlertDispatcherService` → 桌面 toast
- `TakeoverController` (`/takeover/*`) · Roles(Admin) · acquire / release / hard-kill / heartbeat / status / list
- `ChatsController` (`/chats/*`) · Roles(Admin) · conversations / messages / send-text / send-media (FileInterceptor · 95MB limit)

**Errors** (`takeover.errors.ts`)
- `TaskPausedError` · dispatcher catch → task_run=paused, task=pending (不计失败, 不扣分)
- `TaskInterruptedError` · dispatcher catch → task_run=interrupted (不计失败, 不扣分)
- `TakeoverLockError` with code enum → `ForbiddenException` (PERMISSION_DENIED) / `BadRequestException` (其他)

**Events** (`takeover.events.ts`)
- 7 channel 常量 · EventEmitter2 全局 bus 复用 M8 架构
- `takeover.message.in/out` payload 带 `manual: boolean` (in=false, 手动 out=true)

**Baileys 集成** (`baileys.service.ts`)
- 注入 `@Optional() EventEmitter2`
- `persistMessage` 返回 `{contactId, messageId}` (原返 void)
- inbound 消息触发 `takeover.message.in` event · outbound 由 ChatsController 自己 emit (避免 executor 发的 out 被误标手动)

**Dispatcher 集成** (`dispatcher.service.ts`)
- 注入 `@Optional() TakeoverLockService`
- `TaskExecutorContext` 加 `isPaused?()` + `throwIfPaused?()` hooks (dispatcher 绑定到 `takeoverLock.isPaused(accountId)`)
- `executeInBackground` catch:
  - `TaskPausedError` → task_run=paused · task=pending · task.paused_at=NOW · **不 emit risk**
  - `TaskInterruptedError` → task_run=interrupted · task=pending · **不 emit risk**
  - 其他 error → 原路径 task_run=failed + emit `send_failed`
- `chat.executor` demo 两处 `ctx.throwIfPaused?.()` breakpoint

**Frontend** (`packages/frontend/src/pages/admin/TakeoverTab.tsx`)
- AdminPage 第 8 tab `接管` · key=takeover
- 左列 bound slots 列表 · 右列 lock 控制条 + 联系人 + 消息流 + 发送区
- socket.io client (auth.token = access token · reconnection · 10s heartbeat)
- 事件监听: `message.in/out` 刷消息流 · `lock.idle_warning` toast · `lock.idle_timeout` 回归 unlocked 状态 · `lock.released` 清本地 · `lock.hard_kill` warning toast
- `HARD_KILL_REVEAL_MS = 30_000` · acquire 30s 后才显示 `🚨 强制接管` 按钮 (Z1+ 逃生口默认隐藏)
- 发送表单: 文本 Cmd+Enter · 媒体 Upload 选 type + 可选 caption · `multipart/form-data` POST /chats/:aid/send-media
- 消息气泡: 出站绿色 (#25d366) · 入站白 · `script_run_id IS NULL && direction=out` 标 "手动"
- `vite.config.ts` 加 `/socket.io` ws proxy

**依赖新增** (backend)
- `@nestjs/websockets@^10.4` · `@nestjs/platform-socket.io@^10.4` (peer v10 匹配项目 NestJS 版本)
- `socket.io@^4.8`
- `sharp@^0.34` (EXIF 剥离)
- `multer@^2.1` + `@types/multer`

(frontend) `socket.io-client` 最新

### Verified (smoke 20+ 路径)

- 启动日志: `TakeoverLock ready · idle_timeout=10min · warning=9min · disconnect_grace=10000ms` + `TakeoverGateway ready · namespace=/takeover`
- Smoke 2: delta-admin acquire slot 11 (acc 1) → DB `takeover_active=true`
- Smoke 4: tenant1 admin 尝试 acquire slot-tenant4 → **HTTP 403** 不可跨租户
- Smoke 5: platform-admin (tenantId=null) 可跨租户 acquire slot 12
- Smoke 6: `POST /chats/1/send-text {to: 60186888168, text: "M9 smoke 手动发送测试"}` → waMessageId 返回 · **真发到 slot 12**
- Smoke 14: send-text 无锁 → **HTTP 400 NO_ACTIVE_LOCK**
- Smoke 15: hard-kill 无锁 → **HTTP 400 NO_ACTIVE_LOCK**
- Smoke 16: acquire + hard-kill 无 running run → `{interruptedRunIds: []}` HTTP 200
- Smoke 20: acc 2 查 `contactId=3` (slot 11 phone 60168160836) 消息流 → id=50 **direction=in** 内容 `M9 smoke from slot 11 手动发送测试` · **端到端管道**: TakeoverController → baileys.sendText → WA → 对方 socket → messages.upsert listener → persistMessage → `takeover.message.in` event
- Smoke 21: `migrations` 表 id=10 `AddTakeoverRunStates1777000000000` · `enum_range` 含 `paused` + `interrupted`

### Constraints (M9 范围边界)

- **executor pause hook 只接了 chat.executor demo** — script_chat / warmup / status_post / status_browse 未接. 实际 run 被接管时会自然 run 完 (通常 <10s), 后续 task_run 保 success/failed. Hard-kill 逃生口兜底极端场景. V1.1 渐进接入其他 executor.
- **task.paused_at 字段留而不用** — V1 dispatcher skip-takeover-active #4 已经拦 pending. paused_at 字段给 V1.1 精细"只跳被接管时 pause 的任务"用, 不影响当前行为.
- **hard-kill 不真强停 in-flight 执行** — executor 内部 sendMessage 调用无 cancellation token · Hard-kill 只把 DB 状态改 interrupted, 实际 send 完成后 dispatcher 仍会尝试更新 task_run 到 success/failed. 因 task 状态已 Pending, 新 tick 会重评. 代价: 可能一条消息多发一次. V1.1 考虑在 executor 里加 AbortSignal.
- **socket.io JWT token 不续期** — access token 15min · 用户长时间接管会 disconnect + 前端重 login. 不自动刷. V1.1 做 refresh-token WS 续期
- **上传 FormData 单文件** — `FileInterceptor` · 发多图需多次 POST. 批量上传 V1.1
- **message.out 从 ChatsController emit · 不从 baileys.persistMessage emit** — 避免 executor 发的 out 被误广播到接管 UI. 代价: 若将来有 executor 也想被 takeover UI 看见, 要单独补路径
- **前端 TakeoverTab 无"抢占" UI** — V1 单用户, 同号二次 acquire 若被别人持有直接 400 LOCK_HELD_BY_OTHER. V2 multi-user steal 语义 + 通知

### Rationale (存档关键决策)

- **F 决策 权限 tenant-admin / platform-admin-only** — 用户 2026-04-20. V1 单用户但仍对 · 为 V2 multi-user 免重构. 核心原因: 接管 = 直接控号, 误操作影响大, operator / viewer 不应有.
- **G 决策 socket 10s grace** — 用户 2026-04-20. 前端刷新 / WiFi 切换 5s 断线常见. 立即释放 → task 瞬间恢复跑 → 用户回来看到 "我接管着时居然有自动消息发出". 10s buffer 覆盖 99% 场景.
- **Z1+ Hard-kill 30s reveal (默认隐藏)** — 用户 2026-04-20. Z1 纯 graceful 可能卡住 (executor 不回应). 30s 后给用户逃生口 · 默认隐藏防误操作. `interrupted` ≠ `failed` 语义严格: 不扣 risk 分, 明告 "这是用户主动中断".
- **enum 加值不内联 index** — PG `ALTER TYPE ADD VALUE` 新值同事务不可引用. forward-only 策略 · 索引如需后续追加 · 对齐 M8 `app_setting` rename 策略.
- **EXIF 剥离用 sharp 而非 exif-stripper** — sharp 已是 image 处理标准库 · 默认输出 strip metadata · 一次 API 同时拿 orientation-aware + rotate + strip. exif-stripper 只能剥, 重新编码还得 sharp, 重复依赖.
- **persistMessage 只 emit in · 不 emit out** — 区分 "谁触发的 send". Executor send 也走 persistMessage, 如果那里 emit out 会让接管 UI 看到 "我没发消息居然有 out 消息". 拆开: 手动 out 由 ChatsController emit (带 manual=true), executor out 不 emit.
- **chat.executor pause hook 2 处 breakpoint** — 演示而非一次性接全部 executor. `throwIfPaused` 是可选 hook, executor 自己决定在哪加. 降低 M9 scope 蔓延风险. 后续每 executor 收尾时接入.
- **MIME 白名单封闭不开放配置** — D+ 决策 · 防租户自己开 exe / bat 通道. 列表硬编码在 TakeoverUploadService. 要加新格式 = 改代码 + 重部署 · 审慎好过便利.

---

## [v0.8.0-m8] · 2026-04-20 · M8 健康分 + 风险感知 + 自动降级交付 (跳 M7, 保命先)

M8 里程碑: Event collector (EventEmitter2) + §5.4 公式 scorer + 30min debounce 自动 regress + dispatcher 6th 拒绝路径 (skip-health-high) + medium 降档 (priority -2 / send_delay ×1.5) + 桌面告警 + dry-run 模式 + 去重 UNIQUE 约束 + 滚动窗口 + HealthTab UI 带教育性 tooltip.

**顺序变更**: 原 roadmap M7 (素材生成) · M8 (健康分). 用户 2026-04-20 优先级翻转: M7 "锦上添花" 延后, M8 "保命" 先做. 理由: 当前 §B.16 预置素材池能工作 · 被风控的号跑 warmup 会拖累同 IP 组 · 产品介绍书"🟢🟡🔴 封号危险指数"是客户承诺.

### 收工标准 (全绿)

| # | 项 | 证据 |
|---|---|---|
| 1 | Event collector EventEmitter2 · dispatcher 任务失败 emit send_failed | `DispatcherService.emitRisk` · smoke: task 10 fail → risk_event 落 `send_failed task_run:10` |
| 2 | §5.4 公式 scorer: 验证码/举报/同IP被封/加好友拒 + sendFailRate + 自然会话加分 | `HealthScorerService.compute` 纯函数 · 12 ut cover 每 rule + 边界 0/29/30/59/60 |
| 3 | 去重 UNIQUE(account_id, code, source_ref) + ON CONFLICT DO NOTHING | migration + `RiskEventService.record` qb.orIgnore() · 4 ut + live smoke INSERT 0 when duplicate |
| 4 | 滚动窗口: 只累加 at > now - N 天 (default 30, settings 可配) | `HealthSettingsService` + `findWithinWindow` · 7 ut settings service + compute 纯函数验证 |
| 5 | 30min debounce · high 持续才 auto-regress · 进出 high 清时钟 | `HealthCoordinatorService.handleScoreTransition` · 6 ut (含 fake timers 31min 测试) |
| 6 | Dry-run 模式: 照常算分写 level, 不触发 regress/priority降档/send_delay 加倍 | 1 ut · live smoke: 13 captcha + 3 reported → score 0 level high, plan 仍 phase=2 · 关 dry-run 后新任务 skip-health-high 留 pending |
| 7 | dispatcher 6 条拒绝: `skip-health-high` · medium 降档 `healthDegrade` 标 payload | `dispatcher.service.ts` 新 branch · live smoke task 11/12 stays pending under high |
| 8 | 桌面告警 §B.25 · `node-notifier` 跨平台 + `AlertChannel` interface 留 email/Telegram 扩展 | `DesktopAlertChannel` + `AlertDispatcherService` · 日志 `AlertDispatcher ready · 1 channels: desktop` |
| 9 | Admin UI HealthTab · Table 健康分条 + 详情 Modal + 教育性 tooltip + dry-run 开关 + 窗口配置 | `HealthTab.tsx` · 每 breakdown 条带 explanation 教育文案 + `?` tooltip |
| 10 | 111/111 unit test green (+30 M8) | dispatcher 17 + pack-loader 9 + runner 16 + phase 13 + pair 7 + encryption 6 + adapter 6 + redaction 7 + scorer 12 + risk-event 4 + coord 6 + settings 7 |

### Added (M8)

**数据模型** — migration `CreateRiskEventAndAppSetting1776900000000`
- `risk_event`: BIGSERIAL · account_id FK · code · severity · source · source_ref · meta jsonb · at · created_at · UNIQUE (account_id, code, source_ref) · 3 idx
- `ai_setting` → rename to **`app_setting`** (通用 k-v, 命名空间 key 前缀): `ai.text_enabled` (M6 迁移保留) / `health.dry_run` / `health.scoring_window_days`
- `AppSettingEntity` 移 `common/`, 跨模块共享

**Event bus** (`@nestjs/event-emitter`)
- `EventEmitterModule.forRoot({ wildcard: true, maxListeners: 50 })` 全局注册
- channel `'risk.raw'` · payload `RiskRawEvent { accountId, code, severity, source, sourceRef?, meta?, at? }`
- `DispatcherService` 注入 `@Optional() EventEmitter2`, task 失败时 emit `send_failed` 带 `task_run:<id>` sourceRef (保 M3 spec 无 bus 兼容)

**Risk event service** (`risk-event.service.ts`)
- `record(event)`: qb.insert().orIgnore() · 返 `{inserted: boolean}` (false = 去重击中)
- 无 source_ref 兜底: `auto:md5(code|floor-to-minute).substring(0,16)`
- `findRecent(accountId, limit)` / `findWithinWindow(accountId, windowDays)` (滚动窗口查询) / `trendDaily(accountId, days)` (HealthTab 趋势)

**Scorer** (`health-scorer.service.ts`)
- `compute(events, prevHealth)` 纯函数 · 返 `ScoreBreakdown[]` (rule / delta / count / value / **explanation 教育性说明**)
- 扣分: captcha × 5 · reported × 15 · friend_rejected 5%/次 × 20 · same_ip_banned × 10 · sendFailRate × 100
- 加分: 通讯录 × 0.1 (max 10) · 自然会话 50/50 对称度 × 15
- `rescore(accountId)` 读 window events + prev_health → 写 `account_health.health_score/risk_level` + 追 20 条 riskFlags snapshot
- `toRiskLevel(score)`: 60+ low · 30-59 medium · 0-29 high (§5.4 边界严格)

**Coordinator · debounce 状态机** (`health-coordinator.service.ts`)
- `@OnEvent('risk.raw')` · record → rescore → handleScoreTransition
- 内存 `Map<accountId, firstHighAt>` · 进程重启清空 (故意, 降级要响应, 别过分记忆)
- high 进入: 记时刻 + warn 告警, 不 regress
- high 持续 >= 30min: 触发 `WarmupPhaseService.maybeRegress` + critical 告警
- 退出 high: 清 Map 条目 + log
- 5min setInterval 兜底 rescore (处理 missed events)
- **dry_run** 分支: 照常写 level, regress/告警加 `dry_run=true` 标, 日志 `[DRY-RUN]` 前缀

**Alert channel** (§B.25 对齐)
- `AlertChannel` interface + `ALERT_CHANNELS` Symbol DI token
- `DesktopAlertChannel` (`node-notifier`): 跨 Win/Mac/Linux 原生 toast · dry_run 加 `[DRY-RUN]` 前缀 · severity emoji (🔴 critical / 🟡 warn / ℹ️ info)
- `AlertDispatcherService`: fan-out 所有 channels · channel 失败不抛 (告警丢失 degraded 非 fatal)
- email / Telegram 留 interface 不实装 (V1.1)

**Dispatcher 集成** (`dispatcher.service.ts`)
- 新 rejection path `skip-health-high`: 读 `account_health.risk_level`, high 且 !dry_run → task 保 pending (不 run)
- Medium 降档: `{ action: 'run', healthDegrade: 'medium' }` · 标记 `task.payload._healthDegrade='medium'` 给 executor 读
- `@Optional() HealthSettingsService` 注入兼容 M3 spec

**WarmupPhaseService** 便捷方法
- `maybeRegressByAccountId(accountId)`: coordinator 直接用, 免查 plan

**API** (`account-health.controller.ts` — 避开 M1 `/health`)
- `GET /account-health/overview` · 租户视角 list 每号分数+level
- `GET /account-health/:accountId` · 详情含 breakdown + recent 30 events + 7 天趋势
- `POST /account-health/:accountId/rescore` · 手动重算
- `GET /account-health/settings` · dry_run + window_days
- `POST /account-health/settings/dry-run` · `{enabled}`
- `POST /account-health/settings/scoring-window-days` · `{days}` (1-365)

**Admin UI `HealthTab`** (`packages/frontend/src/pages/admin/HealthTab.tsx`)
- 顶部 Alert: dry-run Switch + 72h 首 rollout 提示 tooltip · 评分窗口 InputNumber
- Table: 槽/账号/进度条 (level 配色)/等级 Tag (🟢🟡🔴)/更新时间/详情+重算按钮
- 详情 Modal 折叠 3 块 (对齐 Y3 默认折叠):
  - 扣分/加分明细 · 每条带 **? tooltip 教育性说明** (为什么扣, 降低租户恐惧感)
  - 最近 30 事件流水 · severity 着色
  - 7 天趋势 · 按天 progress bar

**文档**
- 技术交接文档 §3.2 追加 `risk_event` 和 `app_setting` schema 块 · 详述去重/窗口/为何独立表设计决策 (用户 2026-04-20 要求: 不允许代码加表但文档没跟)

### Verified (smoke)

- `AlertDispatcher ready · 1 channels: desktop` + `health coordinator enabled · rescore every 120s · debounce 30min` 启动日志确认
- **去重**: 重复 INSERT 同 (account, code, source_ref) → `INSERT 0 0` · 总数 3 不变 (`ON CONFLICT DO NOTHING` 生效)
- **滚动窗口**: settings service 7 ut · 默认 30 · 非法值降级
- **Scoring §5.4**: 3 captcha → -15 → 85/low · 13 captcha + 3 reported = -110 clamped to 0 → 0/high · breakdown 每条带中文教育性 explanation 字段
- **Dry-run**: 开 dry-run 下 score=0 level=high · 但 `warmup_plan.currentPhase=2` 未回退 · 全局开关切到 false 后新任务触发 `skip-health-high` 保 pending
- **Dispatcher gate**: dry-run off 时 acc 1 (high) 新开 task #12 → **status=pending** (dispatcher skip-health-high 生效) · 同期 acc 2 (low) 任务能跑
- **App_setting rename**: 两行并存 · `ai.text_enabled=false` (M6 迁移保留) · `health.dry_run=false`
- **Log 脱敏传承 M6**: 227+ 日志行 grep key/master hex 0 次泄漏

### Constraints (M8 范围边界)

- **告警只实装桌面** — email / Telegram 留接口但不写实现. V1.1 加 SMTP / bot token config
- **debounce 状态存内存** — 进程重启清空. 再次 rescore 时重建. 故意不持久化: 降级是 "持续观察" 信号, 不是历史合计
- **send_failed 不直接扣分** — §5.4 公式用 `send_fail_rate` 比率, 不是事件次数. rate 字段由 baileys send 成功/失败路径维护 (M2 scope 已有, M8 不改)
- **M3 未知 task_type** `mystery_type` 仍 pending · 不受 health gate 影响 (gate 前已过 leave-pending-unknown-type 早退)
- **coordinator 兜底 5min setInterval** — 高频 event 仍主推 handleRaw, 定时仅处理 missed. HEALTH_RESCORE_INTERVAL_MS 可调
- **Priority 降档" 未做真实 priority 列动态修改** — dispatcher.decide 只在 payload 打 `_healthDegrade` 标, 给 executor 读. 真 priority 降档 (`task.priority -= 2`) 需改 task row, 会影响已有 pending 任务排序, V1.1 评估

### Rationale (存档关键决策)

- **Event 去重 UNIQUE (account, code, source_ref)** — 用户 2026-04-20 加固 #1. 重复事件虚降分是生产灾难 (同一次 captcha 被 task retry 多次触发导致同号被扣几次分). 数据库硬约束比应用层检查更可靠.
- **兜底 md5(code|minute) 而非 md5(code|id)** — 上游无稳定 id 时按分钟去重. 60s 内同 code 视为同事件 (WA 侧一次验证码弹窗实际上就是 1 事件, 但 baileys 可能触发多个 status change 信号).
- **滚动窗口 30 天默认** — 用户 2026-04-20 加固 #2. 账号分数永远回不来是产品痛点. 30 天平衡"记住短期异常" vs "允许恢复". settings 可调. 写 DB 行让运维可按租户/地区调整.
- **Dry-run 模式必做** — 用户 2026-04-20 加固 #3. 新公式首次 rollout 不验证就打开真降级 = 50 号全被误降 = 生产灾难. 72h dry-run 期可校准公式. 兜底: 任意 DB 坏数据 / coordinator bug 在 dry-run 下不会真伤害账号
- **§5.4 explanation 中文教育文案** — 用户 2026-04-20 Y3 UX 加 ?. 扣分项暴露给租户时, 干字段名 ("captcha_triggered × 5") 吓人. 加一行说明 "WA 侧对该号存疑, 需降频保号" 降低租户恐惧感 + 自然教育. 这些文案硬编码在 compute() 里, 与规则同源, 绝不漂移
- **账号独立 account-health 模块路径** — M1 已有 `health` (系统健康 uptime), 两者语义完全不同但同名. M8 走 `/account-health/*` 路径 + `AccountHealthModule` 类名避免冲突. 放一起会让人迷惑
- **AppSettingEntity 共享 + 命名空间 key** — 拒绝"每模块 settings 一张表". `ai.text_enabled` / `health.dry_run` 靠前缀分命名空间, 单表双索引就够快. M10 可能加 `backup.auto_daily` 等, 不会为此加表
- **coordinator Map<accountId, firstHighAt> 内存状态** — 降级要"响应此刻的持续性", 不是"历史总时长". 进程 restart 后重新观察 30min 是正确的, 已用户在 restart 时点刚好 high 也算公平

---

## [v0.6.0-m6] · 2026-04-20 · M6 AI 层 + Provider 抽象 + 改写缓存 + 三维降级交付

M6 里程碑: OpenAI-compat adapter (覆盖 openai / deepseek / custom 5+ endpoints) + AES-256-GCM key 加密 (MasterKeyProvider DI 抽象) + pino 递归日志脱敏 + ScriptRunner miss 接 AI + 全链路失败降级到 content_pool (§B.4).

### 收工标准 (全绿)

| # | 项 | 证据 |
|---|---|---|
| 1 | API key AES-256-GCM 加密落 DB, 密文格式 `gcm:v1:iv:ct:tag` | `AiEncryptionService` · 6 ut (roundtrip / 随 IV / 篡改失败 / 错密钥 / 格式校验 / maskKey) |
| 2 | MasterKeyProvider DI 抽象, M6 用 Env 版, M10 可换 MachineBound 不改 AiTextService | `master-key.provider.ts` · Symbol token + interface + `EnvMasterKeyProvider` |
| 3 | OpenAI-compat adapter 一把梭覆盖 openai / deepseek / custom_openai_compat (Ollama / SiliconFlow / Azure / OpenRouter) | `OpenAICompatAdapter` · 6 ut (200 ok / 401 / 429 / 5xx / empty / abort-timeout) |
| 4 | ScriptRunner miss 分支接 AI + 失败降级 pool · source 落 provider type | `resolveText` 重写 · 6 ut (enabled / disabled / 200 / 401 / timeout / throw / cache 命中不再调) |
| 5 | Gemini / Claude adapter skeleton 就位, 返 NOT_IMPLEMENTED, runner 自动降级 | `GeminiAdapter` + `ClaudeAdapter` · enum 值保留 · runner 统一 fallback |
| 6 | API key 任何深度任何字段名不进日志 | `formatters.log` + `redactSensitive` 递归函数 · 7 ut (深度嵌套 / 蛇形/驼峰命名 / ciphertext / master key / header) · live smoke 227 log lines 0 泄漏 |
| 7 | 81/81 unit test green (+25 M6) | dispatcher 17 + pack-loader 9 + runner 16 + phase 13 + pair 7 + encryption 6 + adapter 6 + redaction 7 |
| 8 | /ai-providers REST + /ai-settings + connectivity test + Admin UI AiTab | controllers + AiTab.tsx · key 脱敏 `sk-a***xyz` 显示 |

### Added (M6)

**数据模型** — migration `CreateAiProviders1776800000000`
- `ai_provider`: SERIAL pk · provider_type enum (openai/deepseek/custom_openai_compat/gemini/claude) · name · model · base_url · api_key_encrypted · enabled · last_tested_at · last_test_ok · last_test_error · default_params jsonb
- `ai_setting`: K-V 表 (text_enabled 唯一 key · V1.1 扩 persona_enabled 等)

**加密层**
- `MasterKeyProvider` interface + `MASTER_KEY_PROVIDER` Symbol DI token · `getKey() / source()`
- `EnvMasterKeyProvider`: 读 env `APP_ENCRYPTION_KEY` (必须 64 hex chars · openssl rand -hex 32). 启动时验格式, 错抛
- `AiEncryptionService`: AES-256-GCM · encrypt() 每次随机 12B IV · decrypt() 校验 16B authtag, 篡改抛错
- 格式: `gcm:v1:{iv_hex}:{ciphertext_hex}:{authtag_hex}` · 版本位 v1 保未来算法轮换
- `maskKey(plain)` 给 UI 用: `sk-ab***cde` 脱敏

**Provider adapter 层**
- `RewriteAdapter` 契约 · `rewrite({baseUrl, apiKey, model}, input) → RewriteResult` · `ping()` 最小请求
- `AdapterErrorCode` 6 类: Timeout / NetworkError / AuthFailure / QuotaExceeded / BadResponse / EmptyResult / NotImplemented
- `OpenAICompatAdapter`: `POST {base}/chat/completions` · fetch + AbortController timeout · status → code 映射
- `GeminiAdapter` / `ClaudeAdapter`: skeleton · 返 NOT_IMPLEMENTED (runner 自动降级, 不抛)

**AiTextService**
- `rewrite(input, enabled)`: 检查 enabled + 选 enabled=true 的 provider (id 最小胜出) + decryptKey + 调 adapter
- `test(providerId)`: ping + 落 last_tested_at / last_test_ok / last_test_error
- 日志只带 `type/model/ok/latency`, **永不打 key / response body**

**ScriptRunner miss 路径重写** (`resolveText`)
- cache miss → 先抽 pool 原文 `seed` (保底)
- AI 开 + provider 可用 → rewrite(seed, personaHint) → ok=true 用 AI 文本 · source=provider type
- AI 任何失败 / 未实装 / 抛 → `variantText = seed` · source='m4_pool_pick'
- cache 写入后下次同 persona 同 turn 命中免 AI 钱
- **运行不中断**: AI 异常包括 adapter throw 都被捕获, turn 记为 executed

**日志安全** (`config/logger.config.ts`)
- `formatters.log` hook 接 `redactSensitive` 递归 (max depth 8) · 剥除 `apiKey/api_key/apiKeyEncrypted/API_ENCRYPTION_KEY/password/license_key/authorization/cookie` 字段名任意深度
- pino `redact.paths` 作双保险
- 7 ut 覆盖 req.body / nested / ciphertext / master key / Authorization header

**API** (`ai.controller.ts`)
- `/ai-providers` CRUD (platform admin only, tenantId=null 检查)
- `POST /ai-providers/:id/test` — 连通性 ping 更新 last_tested_at
- `/ai-settings` GET + `/ai-settings/text-enable` POST body `{enabled}`
- DTO `ProviderDTO` 外暴 `apiKeyMasked` 不含密文 (通过 decrypt + maskKey)
- PATCH 时只提供 apiKey 字段才重加密, 不动其他字段

**Admin UI `AiTab`** (`packages/frontend/src/pages/admin/AiTab.tsx`)
- 顶部全局 "AI 文本改写" Switch
- Providers Table: 类型 tag / 脱敏 key / 最近测试结果 (绿勾/红叉带 tooltip) / 启用开关 / 测试 / 删除
- "新增" Modal: 5 种 provider type · 每种带 base_url 提示 (OpenAI/DeepSeek/Ollama hints)
- **备份/迁移 gotcha tooltip** (ℹ️ 图标 hover): 4 条安全提醒 · DB 备份含密文但主密钥须单独备份 / .wab 不含主密钥 / 轮换密钥须重录 provider

**env / config**
- 新增 env: `APP_ENCRYPTION_KEY` (必填 · 32B hex) · `AI_TEXT_ENABLED` (default 'false')
- `.env.example` 补两行, 指明 `openssl rand -hex 32` 生成

**文档**
- `packages/backend/src/modules/ai/README.md`: 架构图 / 安全模型 / 降级链 / 加 provider 指南
- 技术交接文档 §6: `ai-providers.json` → `ai-providers.json.backup` (人工导出 opt-in), 主线改走 DB
- CHANGELOG gotchas 段同步 Admin UI tooltip

### Verified (smoke)

启动时 `master key loaded · source=env:APP_ENCRYPTION_KEY · len=32B` 日志确认主密钥加载.

- Create provider (custom_openai_compat · dev-ollama · http://127.0.0.1:11434/v1): 返回 `apiKeyMasked='sk-n***red'`, 密文入 DB
- List: masked 同 create, 不泄漏
- Test (Ollama 离线): 返 `ok=false · error=NETWORK_ERROR · latencyMs=7` · DB `last_test_ok=false, last_test_error='fetch failed'` 持久化
- Enable AI text global switch → `/ai-settings` 返 `text_enabled='true'`
- script_chat 任务 (ai enabled, provider 不通): task status=success · 9 rewrite_cache 全 `source='m4_pool_pick'` → **降级链确认**
- PATCH apiKey 新值: DB 密文 prefix 变 (iv 不同) · 旧密文被覆盖
- live 227 log lines grep: 0 次 old key / 0 次 new key / 0 次 master key hex · **脱敏全覆盖**

### Constraints (M6 范围边界)

- **只做 AI 文本改写** — AI 对话接管 (偏离剧本时 hand-off) 留 M9 · AI 人设生成 / image / voice 留 M7 asset-studio
- **Gemini / Claude 未实装** — 用户建这两 provider 会直接 NOT_IMPLEMENTED, runner 自动降级. M7+ 按需补
- **没有自动批量重加密** — 主密钥轮换 = 所有 provider 密文失效, 需手工逐条 PATCH 更新 key. 设计理由: 避免半成品中间态, 宁可显式重录
- **全局一份配置, 不做租户级** — 对齐 tech doc §6 单租户安装假设, M1 多租户 dev 里 platform admin 统一配. V1.1+ 视需求拆租户级
- **没装 4 个 provider SDK** — 全 fetch, 减依赖. OpenAI SDK 版本锁相关风险绕过. 代价: error code 映射自己做
- **provider 选择策略简单** — `id ASC` 第一个 enabled=true 胜出. 未来扩 "按 persona 语言 / cost 策略" 至少 V1.1

### Rationale (存档关键决策)

- **AES-256-GCM v1 明确版本标记** — 格式 `gcm:v1:...` 为将来换算法/调参数保留扩展空间, 不会出现"旧密文解不动但版本号没办法升"的困境
- **MasterKeyProvider 抽象而非直接 env** — 用户 2026-04-20 的 M6 接受条款里明确提: M10 要接机器指纹派生密钥, 提前抽象避免后期硬拆 AiEncryptionService 的构造函数
- **formatters.log hook 胜过 pino redact paths** — fast-redact 的 `*.apiKey` 只一级, 为 ctx.provider.apiKey 这种深度嵌套 3 级字段得加 `*.*.apiKey` 多个 pattern, 不如直接 hook 递归清理一刀切
- **id ASC 选 provider** — 简单可预测, dev/prod 行为一致. 加"cost/latency-based routing" 属于分布式特性, 单机 installer 用不上
- **失败降级硬编码到 runner** — 不做"AI 失败标记上升"让上游处理. 养号剧本的可用性 > AI 增强质量, §B.4 降级矩阵的哲学就是"AI 是增强, 不是依赖"
- **custom_openai_compat 作为一级公民 provider type** — 用户 2026-04-20 洞察正确: OpenRouter / Ollama / Azure OpenAI / SiliconFlow / Together / Fireworks 都 OpenAI-compat, 一个 adapter 5+ provider 免费获得. 比 4 家各自写 SDK adapter 成本低 10 倍

---

## [v0.5.0-m5] · 2026-04-20 · M5 养号日历 + Phase 机 + 4 种 warmup executor 交付

M5 里程碑: 14 天 phase 机 (§5.3 严守) + 1h setInterval 日历引擎 + 4 层 Status 素材降级 + script_chat 运行时配对过滤链 + min_warmup_stage 真 gate (承接 M4 刻意延后的 gate) + §B.16 预置素材骨架.

### 收工标准 (全绿)

| # | 项 | 证据 |
|---|---|---|
| 1 | Phase 机: Day 1-3=0/4-7=1/8-14=2/15+=3 正确映射 + 阈值跨日升 phase | `computePhaseForDay` 3 ut + `tickDay` 5 ut |
| 2 | `risk_level=high` → 强制 Phase 0 + day=1 + regress_reason 记录 | 6 ut covers high/medium/low/null/bottom 边界 + smoke verified |
| 3 | `skip-to-next` 推到目标 phase 起始日, Mature 不能再升 | 2 ut + smoke API 0→1@day4 / 1→2@day8 |
| 4 | M4 挂起的 min_warmup_stage gate 真开启 (双边都必须 ≥ min) | `ScriptRunnerService.run` gate + 3 ut 覆盖 reject/pass/single-side + live smoke: acc=stage0, script=min1 → `warmup_stage 不足` |
| 5 | Pair 过滤链 5 条全生效 (exclude self + IP 组互斥 + takeover + !suspended + stage 门槛) | `WarmupPairService` + 7 ut covers base + 5 filters + null-proxy 保守 · smoke: 2 null-proxy slot → NO_PAIR_AVAILABLE ✓ |
| 6 | 4 层 Status 素材降级 (persona → builtin → pack text → skip); Phase 0-1 硬 block | `StatusPostExecutor` · smoke: Phase 2 → layer4-skip 成功空过; Phase 0 → PHASE_GATE 拒 |
| 7 | dev-only `/admin/debug/set-risk-level` 生产 build 自动 403 | `AdminDebugController.isProd` @ OnModuleInit + smoke |
| 8 | Calendar 1h setInterval · tick 幂等 (payload _warmupPlanId+_planDay+_windowAt 去重) | `WarmupCalendarService.onModuleInit` 日志 + `isDuplicate` JSONB 查询 |
| 9 | 56/56 unit test green | dispatcher 17 + pack-loader 9 + runner 10 + phase 13 + pair 7 |

### Added (M5)

**数据模型** — migration `CreateWarmupPlan1776700000000`
- `warmup_plan`: SERIAL pk · account_id FK wa_account CASCADE uniq · template text default 'v1_14day' · current_phase int · current_day int · started_at · last_advanced_at · regressed_at · regress_reason · paused bool · history jsonb[] · idx_phase_day

**Phase 机** (`warmup-phase.service.ts`)
- `tickDay(planId)`: current_day + 1, 跨阈值升 phase, 同步更新 `wa_account.warmup_stage`
- `maybeRegress(plan)`: 读 `account_health.risk_level`, high → 强制 Phase 0 · day=1 · 记 regress_reason
- `skipToNextPhase(planId, reason)`: 手动跳, day 推到目标 phase 起始日
- `pause` / `resume`: expert mode 暂停推进
- `computePhaseForDay(day, thresholds)`: 纯函数, 单测易测
- 所有变更落 `history` JSONB 流水 (上限 100 条)

**Plan 模板** (`warmup-plan.templates.ts`)
- `V1_14DAY_TEMPLATE`: 14 天完整日程, 每天 3-4 个窗口, windows 内嵌 `WarmupTaskSpec[]`
- Phase 阈值: 0→Day1, 1→Day4, 2→Day8, 3→Day15
- §B.2 Day 4 "破壳仪式" 的 status_post **去掉**, 改 `status_browse` reactive (对齐 §B.20 "Phase 0-1 禁 status_post")
- `MATURE_DAILY_WINDOWS`: Phase 3 常态模板 (每天 1 status_post 上限, §B.20)

**Pair 过滤链** (`warmup-pair.service.ts`, 技术决策 §B.15)
- 候选池 = 同租户其他槽位. 硬过滤 5 条:
  1. exclude self (accountId 相同跳过)
  2. `takeoverActive=false` (M3 rejection #4 对齐)
  3. `status != suspended/empty` (只要 active 或 warmup)
  4. `proxy_id != initiator.proxy_id` (**IP 组互斥 §B.15 #1 — dev 里两个 null proxy 保守视为同组**)
  5. `warmupStage >= requiredWarmupStage` (剧本门槛)
- 空集返 `null`, 绝不强配. ScriptChatExecutor 接 `NO_PAIR_AVAILABLE` error_code.

**Calendar 引擎** (`warmup-calendar.service.ts`)
- 1h setInterval (和 M3 dispatcher 风格一致, 不引 BullMQ repeatable — M3 也没用, 保持一致)
- 每 tick: regress check → 跨 24h 推 day → 读今日 schedule → 找 [now, now+1h) 窗口 → 创建 task 带 ±15-30min jitter
- 幂等: `_warmupPlanId + _planDay + _windowAt` JSONB 条件去重
- env 开关 `WARMUP_CALENDAR_ENABLED=false` + `WARMUP_CALENDAR_INTERVAL_MS=...` (smoke/test 调 600s)

**4 种 Executor**
- `WarmupExecutor` (从 M3 stub 升级): presence tick, 更新 `wa_account.last_online_at`
- `StatusPostExecutor` (新): Phase gate (<2 → PHASE_GATE) + 4 层素材降级硬编码 1→2→3→4
- `StatusBrowseExecutor` (新, stub): Day 4-5 reactive 动作占位. Baileys status feed API 在 M5 scope 内留 stub, M8 健康分接真 ws listener
- `ScriptChatExecutor` (M4 扩展): 新增 `_needPair=true` 模式, 运行时调 `WarmupPairService.pickPartner`. 兼容 M4 手动 `roleBaccountId` 模式

**Runner gate** (`script-runner.service.ts`)
- 承接 M4 刻意延后的 `min_warmup_stage` gate — 现 **真开启**
- 双边 (A + B) `warmupStage` 必须 ≥ `script.minWarmupStage`, 否则 throw `warmup_stage 不足: script=... 要求≥X, A=... B=...`
- 单测覆盖: reject-both-low / reject-single-side / pass-exactly-at-threshold

**API**
- `GET /warmup/plans` — 租户视角 list (join 手机号)
- `GET /warmup/plans/:accountId` — 单 plan 详情含 history
- `POST /warmup/plans/:accountId/init` — 建 Day 1 plan
- `POST /warmup/plans/:accountId/skip-phase` — 手动跳
- `POST /warmup/plans/:accountId/pause` / `resume`
- `POST /warmup/calendar/tick` — 手动触发 tick (仅 platform admin, dev 验证用)
- **DEV-ONLY** `POST /admin/debug/set-risk-level` — `NODE_ENV='production'` 自动 403, 否则接受 `{accountId, riskLevel}` 写 `account_health`. M5 期间 regress 链路唯一可测入口; M8 真健康分引擎上线后此端点保留作模拟工具

**Admin UI `WarmupTab`** (`packages/frontend/src/pages/admin/WarmupTab.tsx`)
- Table 列租户所有 plan · 列 Phase tag / Day 进度条 / 暂停/回退 badge / 回退原因
- 行内按钮: 详情 (Modal 显 history JSON) / 跳到下一 Phase / 暂停 / 恢复
- `AdminPage.tsx` Tabs 新增 "养号计划"

**§B.16 预置素材骨架** (`data/assets/_builtin/`)
- 10 空子目录 (personas / voices/zh / voices/en / images/{food,life,scenery,shopping,pets,selfies} / stickers) · 每个含 `.gitkeep`
- 总 README 说明命名约定 + 4 层消费顺序 + installer M11 打包 TODO
- 实物素材 (200MB) 留给 M7 `asset-studio` 生成并填充

### Verified (smoke)

- 5 executor 注册: `chat, warmup, script_chat, status_post, status_browse`
- Plan init API: account 1/2 各建 Day 1 Phase 0 计划
- Skip-phase chain: 0→1@day=4, 1→2@day=8 (threshold 对齐)
- dev debug endpoint: 设 `risk_level=high` → calendar tick 自动 regress account 1 到 Phase 0 day 1, `regressReason='risk_level=high · score=20'` ✓
- status_post PHASE_GATE: Phase 0 下创建 status_post → error_code=PHASE_GATE
- status_post 4 层降级: Phase 2 下, 所有池空 → layer4-skip success (不算失败, 空过)
- script_chat runner gate: account stage=0, script=s001 min=1 → error_code=RUNNER_THREW / `warmup_stage 不足`
- script_chat _needPair: 两 slot 都 null proxy_id → NO_PAIR_AVAILABLE (per §B.15 保守规则)

### Constraints (M5 范围边界)

- **dev 两 slot 同 null proxy_id 配对必失败** — 按 §B.15 设计正确. 真生产每个 slot 绑不同代理就解锁 pair 流
- **Baileys Status feed API 未接真** — `StatusBrowseExecutor` 当前是 stub · M8 健康分阶段接 ws `messages.upsert` / `presence.update` 监听
- **Phase 3 (Mature) 无 day-by-day 模板** — 用 `MATURE_DAILY_WINDOWS` 固定套餐 · 个性化日历 (按 persona peak_hours 动态生成) 留给 M6+
- **账号注册后 auto-init plan 未接入** — M2 W3.5 新号注册推迟到 V1.1, 所以 M5 只开 `/warmup/plans/:accountId/init` 手动端点. V1.1 注册流程收尾时 auto-init 加到 `slots.service.registerAccount`
- **calendar setInterval 不是 BullMQ repeatable** — 偏离最初 M5 plan A (BullMQ repeatable 1h). 原因: M3 dispatcher 也用 setInterval, BullMQ 装了没用, 保持一致不引额外复杂度

### Rationale (存档关键决策)

- **Phase 升级同步写 wa_account.warmup_stage** — 让 ScriptRunner gate 只读 `wa_account` 一张表, 不跨 `warmup_plan` 查. 保 hot path 快
- **history JSONB 上限 100 条 slice** — 防 JSONB 膨胀. Phase 事件一年才 ~20 条, 100 条覆盖账号整个生命周期 + 几次 regress
- **pair null-proxy 保守归同组** — §B.15 不允许"我猜它们真实出口 IP 可能不同". dev 必须用显式 proxy_id (哪怕同一代理分 2 row) 才能跑多槽互聊
- **status_post layer4-skip 视为 success** — executor 成功完成 "今天不发" 的判定, 不是失败. 失败视角只留给 SEND_FAILED / PHASE_GATE / NO_PLAN 这些需要 retry/alert 的情况
- **dev debug endpoint 单独 controller, 不藏在现有 admin** — `NODE_ENV=production` 检查只保护写方法, M8 或 staging 要插入健康事件有稳定端点. 合并到 admin-tenants 会让"dev 入口"被意外暴露

---

## [v0.4.0-m4] · 2026-04-19 · M4 剧本引擎 + 包导入交付

M4 里程碑: 剧本包结构化存储 (pack_id 主包 + pack_ref 增量 batch) + 内容池运行时随机抽 + AI 改写缓存 schema (M6 换真 AI) + 资源池 on_disabled 降级 + script_chat 执行器替代 M3 chat stub.

### 收工标准 (全绿)

| # | 项 | 证据 |
|---|---|---|
| 1 | 剧本 JSON 落 DB, schema 允许 100+ 剧本无膨胀 | `script_pack` + `script` 两表, content JSONB · 导入仓库自带 5 文件 → 100 scripts · migration `CreateScriptTables` |
| 2 | 增量包格式 (pack_ref) 不独立成包, 追加已有 pack | `PackBatchJson` + `importBatchJson` + 两遍扫 (主包先, batch 后) · batch2-5 追加 80 scripts 到 official_my_zh_basic_v1 |
| 3 | 内容池随机抽 + 同 persona cache 命中 | `ScriptRunnerService.resolveText` · `rewrite_cache` uniq(script_id,turn,persona_hash) · 二次跑命中复用 `used_count++` (7 ut covers) |
| 4 | 资源池空时按 on_disabled 降级 (skip / send_fallback_text) | `pickAsset` 返 null + `caption_fallback` 分支 · 2 ut 覆盖两条路径 |
| 5 | script_chat executor 接 runner, 单 turn 失败不中断 session | `ScriptChatExecutor` · runner `turnsExecuted/turnsSkipped/errors[]` · smoke: 28 chat_message 真发出, 9 cache 条目, task status=done |
| 6 | 33/33 unit test green | dispatcher 17 + pack-loader 9 + runner 7 |

### Added (M4)

**数据模型** — migration `CreateScriptTables1776614410555`
- `script_pack`: SERIAL pk · pack_id uniq text · name · version · language · country text[] · author · asset_pools_required text[] · signature text · enabled bool · installed_at
- `script`: SERIAL pk · pack_id FK CASCADE · script_id text · uniq(pack_id, script_id) · name · category · total_turns · min_warmup_stage · ai_rewrite · content jsonb (完整剧本, 含 sessions/turns/safety) · idx_category
- `rewrite_cache`: SERIAL pk · script_id · turn_index · persona_hash text · uniq 三联 · variant_text · used_count · source text default 'm4_pool_pick' · idx_used
- `asset`: SERIAL pk · pool_name text · kind enum(voice/image/file/sticker) · file_path text (相对 data/) · meta jsonb · source enum · generated_for_slot int · 2 索引

**PackLoaderService** (`packages/backend/src/modules/scripts/pack-loader.service.ts`)
- `importJson(PackJson)`: 主包 (pack_id 必需). 幂等 — 存在则更新 version + upsert scripts (按 pack_id + script_id 唯一)
- `importBatchJson(PackBatchJson)`: 增量 batch (pack_ref 必需). 找不到主包抛 404
- `importFromDirectory(dir)`: 两遍扫. 主包先, batch 后 — 保证主包先落盘 batch 才能 attach
- 校验: pack_id/version/language/country 必填, 包内 script_id 去重, total_turns 正整数, sessions 数组
- 测试: 9/9 (`pack-loader.service.spec.ts`) — minimal valid / missing field reject / dup script id / 幂等 version 升级 / 追加 script

**ScriptRunnerService** (`packages/backend/src/modules/scripts/script-runner.service.ts`)
- `run({scriptId, roleAaccountId, roleBaccountId, sessionIndex?, fastMode?})` — 跑 session 下所有 turns, 返 `{turnsExecuted, turnsSkipped, errors[]}`
- `resolveText`: cache 命中复用 + `used_count++`; miss 则 `content_pool` 随机抽 + 写 cache (source=`m4_pool_pick`, M6 换真 AI 只改 source + 抽法)
- `pickAsset`: `asset_pool` 查表随机抽; 空池按 `on_disabled` 降级 (skip / send_fallback_text 发 caption_fallback)
- `personaHash`: sha1(accountId|scriptDbId|turnIndex).substring(0,16) — 不同 A 账号走不同 cache 槽
- `typing_delay_ms` + `send_delay_sec`: fastMode=true (dev smoke) 跳过, 生产永开
- 单 turn 失败记入 `errors[]` 不中断整 session
- 测试: 7/7 (`script-runner.service.spec.ts`) — pool 抽 + cache miss 写 / 二次命中 + used_count++ / 空 pool skip / asset 空+skip / asset 空+fallback / turn 失败不中断 / 不同 persona 不同 cache 条目

**ScriptChatExecutor** (`packages/backend/src/modules/scripts/script-chat.executor.ts`)
- taskType=`script_chat` · allowedInNightWindow=false
- payload: `{scriptId, roleAaccountId, roleBaccountId, sessionIndex?, fastMode?}`
- 验 payload 缺字段 → `INVALID_PAYLOAD`; runner 抛 → `RUNNER_THREW`; 有 turn 错 → `TURN_ERRORS` (附明细)
- 注册进 `TASK_EXECUTORS` (tasks.module.ts) — 替代 M3 chat stub 真跑剧本

**API** (`packages/backend/src/modules/scripts/scripts.controller.ts`)
- `GET /script-packs` · `GET /script-packs/:id/scripts` · `PATCH /script-packs/:id/toggle` · `DELETE /script-packs/:id`
- `POST /script-packs/import-bundled` — 扫 `scripts/` 目录导入
- `POST /script-packs/import` body 传 PackJson / PackBatchJson
- Guard: 平台超管 (tenantId === null) 才能改, 普通 admin 只读

**Admin UI** (`packages/frontend/src/pages/admin/ScriptsTab.tsx`)
- Collapse 列所有包 · 行内 enable/disable Switch · 删除 Popconfirm
- "导入仓库自带包" 按钮一键灌数据
- 展开后按需加载包内剧本 Table · 每行 `预览 JSON` Modal 显示完整 content

### Verified (smoke)

导入仓库自带 5 文件 → `official_my_zh_basic_v1` v1.0.0 合计 **100 scripts** (主包 20 + batch2-5 各 20).

真 script_chat 任务: `scriptId=1` (s001_morning_simple) · slot #1 ↔ slot #2 (delta 租户, 真绑号) · fastMode=true.
- task.status = `done` · lastError = null
- `chat_message` +28 行 (out/in 双写, session 共 ~14 text turns 双向)
- `rewrite_cache` +9 行 (session turns, source=m4_pool_pick, persona_hash 对齐 A/B 各自)

### Constraints (M4 范围边界)

- **无真 AI 改写** — `source='m4_pool_pick'` 仅 content_pool 随机抽. M6 接入真 AI (OpenAI / DeepSeek / Gemini / Claude) 时只替换 resolveText 的 miss 分支 + cache source 改对应引擎名, schema 不改
- **无真资源文件** — asset 表 schema 就位, 实际文件生成留给 M7 asset-studio. 当前 voice/image/file turn 按 on_disabled 降级 (fallback 文本 / skip)
- **单 session 执行** — 目前只跑 `sessionIndex` 指定的一个 session, 多 session 自动衔接 + delay_from_start 留给 M5 养号日历接 (跨 task 串)
- **warmup_stage 未 gate** — min_warmup_stage 只存没强制. M5 养号推进器会按 warmup_day 自动放开剧本池

### Rationale (存档关键决策)

- **turns 不拆表** — 剧本是"原子包", 跨 turn 编辑极少. 拆表后加载 100 剧本 × 20 turns = 2000 行, JSONB 单列查询 < 100ms. 详 script.entity.ts 头注释
- **content_pool + cache 双写而非只 cache** — content_pool 是人工写的底稿, cache 是运行时产物. M6 换 AI 也只改 miss 路径, content_pool 仍是 ground truth, 用户可 UI 编辑
- **script_chat 分开 chat** — chat executor 是 M3 dev stub (TaskExecutor 契约验证), M4 不是"接 chat 逻辑", 是引入真剧本引擎新 type. 未来 chat 可能演化去掉 (任何真对话都应过剧本)
- **两遍扫主包 + batch** — batch 必须 attach 已存在 pack, 一遍扫容易排序依赖出错. 两遍保主包必先落

---

## [v0.3.0-m3] · 2026-04-19 · M3 任务调度 + 6 并发仲裁交付

M3 里程碑: BullMQ 基础设施 + 3s 轮询 dispatcher + 5 种拒绝路径 + 夜间窗口 + executor registry 抽象.

### 收工标准 (全绿)

| # | 项 | 证据 |
|---|---|---|
| 1 | Redis 7 加入 docker-compose.dev.yml, 不污染系统 | host :6380 (避 6379 占用) · wahubx-dev-redis-data 卷 · healthcheck PONG |
| 2 | Executor registry 模式, 未知 type 保 pending + warn | `ExecutorRegistry.get()` 返 null, dispatcher `leave-pending-unknown-type` |
| 3 | 5 rejection paths + 夜间窗口 + unknown type 全部单测覆盖 | 17/17 tests in `dispatcher.service.spec.ts` ✅ |
| 4 | Admin '任务队列' Tab: 6 并发槽 + 排队 + 最近失败 · 3s 轮询 | `QueueTab.tsx` · 无 WebSocket · 无 CRUD |

### Added (M3)

**基础设施**
- `redis:7-alpine` 加到 `docker-compose.dev.yml`, 主机 :6380 (避 6379 已占), 命名卷 `wahubx-dev-redis-data`, `redis-cli ping` healthcheck
- 依赖: `bullmq@5` + `ioredis@5`
- env: `REDIS_HOST/REDIS_PORT/REDIS_DB/REDIS_PASSWORD` + `SCHEDULER_MAX_CONCURRENCY=6` + `SCHEDULER_POLL_INTERVAL_MS=3000` + `SCHEDULER_NIGHT_WINDOW_START/END`

**数据模型** — migration `CreateTasksAndTakeover1776612590751`
- `task`: SERIAL pk · tenant_id · task_type (varchar, 非 enum 方便扩展) · priority · scheduled_at · repeat_rule · target_type enum · target_ids int[] · payload jsonb · status enum (pending/queued/running/done/failed/cancelled/skipped) · last_error · 2 索引 (status+scheduled, tenant+status)
- `task_run`: SERIAL pk · task_id FK CASCADE · account_id · started_at · finished_at · status enum · error_code/error_message · logs jsonb (结构化步骤: [{at, step, ok, meta}])
- `account_slot.takeover_active` boolean (rejection #4 用; M9 接管 UI 置 true)

**Executor 抽象**
- `executor.interface.ts`: `TaskExecutor` 接口 (taskType / allowedInNightWindow / execute) · `TaskExecutorContext` (task + accountId + log fn) · `TASK_EXECUTORS` Symbol DI token
- `ExecutorRegistry`: Map<taskType, TaskExecutor> · `get/has/isAllowedInNightWindow/listTypes` · 重复注册抛
- **约束**: 未注册 type → dispatcher 保 pending + warn log, 绝不 reject (用户 2A 约束)
- M3 内置 stubs: `ChatExecutor` (dev stub, M4 剧本引擎接真逻辑) · `WarmupExecutor` (dev stub, M5 养号日历接真逻辑)

**Dispatcher (技术交接文档 § 5.2)**
- 3s `setInterval` 轮询 · 防并发 `busy` 锁 · `tick(now?)` 纯函数风格便于测试
- `decide(task, ctx, now)` 返 union type, 8 种可能:
  - `run` · `skip-global-capacity` (#1) · `skip-account-busy` (#2) · `skip-ip-group-busy` (#3) · `skip-takeover-active` (#4) · `skip-night-window` · `leave-pending-unknown-type` · `soft-warn-warmup-stage` (#5)
- IP 组判定: `slot.proxy_id` 相同 = 同组 mutex; `proxy_id=null` 归到 "-1 null 组" (dev 直连多槽会互斥)
- `warmup_stage` 软锁: `MIN_WARMUP_STAGE_BY_TASK_TYPE` 表 (warmup=0, chat=Prewarm, status=Active), 不够只 warn 不拒
- 夜间窗口: `SCHEDULER_NIGHT_WINDOW_START/END` 默认 02:00-06:00 · 跨午夜支持 (22:00→04:00)
- `buildContext` 一次 tick 内快照所有 running state, 避免同轮决策交叉
- `executeInBackground` 真正执行 executor, 异步不阻塞 tick

**API**
- `POST /api/v1/tasks` 创建任务 (CreateTaskDto)
- `GET  /api/v1/tasks?status=xxx` 列表
- `GET  /api/v1/tasks/:id` 详情
- `POST /api/v1/tasks/:id/cancel` 取消
- `GET  /api/v1/tasks/queue/running` 运行中 (admin queue tab 用)
- `GET  /api/v1/tasks/queue/pending` 排队
- `GET  /api/v1/tasks/queue/failed-recent` 最近 20 条失败

**Admin UI · "任务队列" Tab** (`pages/admin/QueueTab.tsx`)
- **6 并发槽视图**: 6 格 Card, 每格显示 idle / running · task_id · account · 运行时长 mm:ss
- **排队列表**: id/type/target/priority/scheduled_at/created_at · 按优先级排序
- **最近失败 20 条**: id/type/target/updated_at/error
- **3s 轮询** (setInterval, 无 WebSocket 按 4A 约束)
- 不做: CRUD / search / filter / pagination (留 M11)

### 实测证据 (M3 smoke)

```
Registered 2 executors: chat, warmup
Dispatcher started, poll interval=3000ms, max concurrency=6

POST /tasks chat (account 2 = warmup_stage 0 < Prewarm)  → status=pending (soft warn)
POST /tasks warmup (account 1)                            → status=pending
POST /tasks mystery_type                                  → status=pending

[3s tick]
  task 1 (chat, account 2) → running → success (stub, 300ms)
  task 3 (mystery_type)    → WARN "Unknown task_type... left pending"
[6s tick — task 1 已完]
  task 2 (warmup, account 1) → running → success (stub, 500ms)
  # 关键: task 2 没在 tick-1 跑, 因 account 1 和 account 2 都 proxy_id=null = 同 null IP 组互斥 (rejection #3)

DB task_run.logs:
  task 1: [{step: "chat-prepared"}, {step: "chat-sent"}]
  task 2: [{step: "warmup-start"}, {step: "warmup-tick"}]
```

Unit tests: **17 passed, 17 total** (`pnpm test dispatcher`)
- 5 rejection paths (#1 global / #2 account / #3 proxy group incl. null / #4 takeover / #5 soft-warmup)
- 夜间窗口 (chat 拒 / warmup 放行 / 跨午夜)
- Unknown task_type 不 reject
- Ghost account (slot 找不到) 保 pending
- Group target (M4 才支持) 保 pending
- Registry 重复注册抛

### Known Issues (M3)

- 任务取消当前只改 status, 不中断已跑 executor (长任务无强制中止). 可接受: M3 stubs 都 <1s.
- 定时任务 (repeat_rule cron) 未实装; 字段已在, M5 养号日历会接.
- Dispatcher 单例, 多实例部署未做 Redis 分布式锁. V1 本地单进程可以, V2 拆 VPS 调度器时补.
- BullMQ 当前未实际用 (Redis 已起). 第一版 dispatcher 直接走 DB 查询 + 异步 executeInBackground 足够; M11 前若并发规模上去再接 BullMQ 真正的 Queue/Worker.

---

## [v0.2.0-m2] · 2026-04-19 · M2 Baileys 集成 + 槽位独立交付

M2 里程碑: 可绑真实 WA 号并收发消息 · 每槽位独立 (fingerprint + proxy + session) · 具备 M3 调度所需的隔离基础.

### 收工标准 (所有绿)

| # | 项 | 状态 | 证据 |
|---|---|---|---|
| 1 | Baileys 协议层 (消息/连接/重连/媒体) | ✅ | 真机扫码 2 号 · 收发文本 + 收图片 · restartRequired 自动重启处理 |
| 2 | 槽位创建生成 fingerprint.json 注入 Baileys browser | ✅ | `data/slots/<N>/fingerprint.json` · DEVICE_POOL 10 机型 · `baileysBrowser` 喂 makeWASocket |
| 3 | Baileys socket 按 slot.proxy_id 走代理 | ✅ | `resolveIsolation` + `HttpsProxyAgent` / `SocksProxyAgent` · `agent/fetchAgent` 传 Baileys |
| 4 | 2 个本地 dev-proxy 验证槽位走不同代理 | ✅ | `scripts/dev-proxy.ts` · P8080 / P8081 各自独立 CONNECT 日志 |
| 5 | Smoke: 两槽 Baileys 连接路径不相同 | ✅ | 独立进程 · 独立 TCP socket · 不同 client:port 不同 upstream:port · 见下方"技术细节" |

### Added (M2 W1-W3)

### Added (M2 W1-W3)

**W1 · 扫码绑定**
- `BaileysService` 扫码绑定现有号 (takeover 模式)
- `GET/POST /slots/:id/bind-existing{/status,/cancel}`
- 2 分钟绑定超时 + QR 轮询 + `fetchLatestBaileysVersion` 动态协议版本
- 前端 `BindExistingModal` · QR 渲染 · 5 态状态机

**W2 · 常驻 socket + 文本消息**
- 新表: `wa_contact` (UNIQUE account_id+remote_jid) · `chat_message` (BIGSERIAL · direction/msg_type enum)
- migration `CreateChatMessages1776600662633`
- Pool: `Map<slotId, WASocket>` 常驻 socket
- `onModuleInit` rehydrate: `status in (warmup, active)` + session 文件存在 → 自动续连
- `sendText` 发文本 · `messages.upsert` 入库 (去重 fromMe)
- `slots.clear` 完整清理: pool 踢出 + CASCADE 删 wa_account + rm -rf `data/slots/<N>/`
- 新端点: `POST /send` · `GET /contacts` · `GET /messages` · `GET /online-status`
- 前端 `ChatModal` 3 tab: 发消息 / 联系人 / 最近消息

**W3 · 自动重连 + 配对码 + 媒体消息**
- **自动重连**: 非 loggedOut 断线自动重连 · 指数退避 5s/10s/20s/40s/80s · 5 次达上限标 suspended · 重连成功清计数
- **Pairing Code (W3.2)**: `POST /slots/:id/bind-existing { phoneNumber }` 走 8 位配对码 (WA 原生替代 QR, 相机不便时用); 前端 `BindExistingModal` 加模式选择 Radio
- **媒体消息接收 (W3.3)**: `messages.upsert` 自动 `downloadMediaMessage` → 落 `data/slots/<N>/media/<msgId>.<ext>` → `chat_message.media_path` 存相对路径
- **媒体消息发送 (W3.4)**: `POST /slots/:id/send-media { to, type, contentBase64, mimeType?, filename?, caption? }` · 支持 image/voice/file · 16MB WA 限 · JSON body 上限调至 25MB (`app.useBodyParser`)
- 前端 `ChatModal` 新增"发图片" tab · antd Upload + base64 转换

**W3.5 · 槽位独立基础 (fingerprint + proxy wiring)**
- `common/fingerprint.ts`: DEVICE_POOL 10 机型 (Samsung/Xiaomi/Oppo/Vivo) · seed-based 稳定生成 · `baileysBrowser: [model · S{slotIndex}, Desktop, chromeMajor]`
- `common/proxy-config.ts`: `ProxyDescriptor` + `buildProxyAgent` (HttpsProxyAgent / SocksProxyAgent)
- `slots.service.seedForTenant`: 租户激活时为 N 个槽位各生成一份 `data/slots/<N>/fingerprint.json` (幂等)
- `PATCH /slots/:id/proxy { proxyId }`: 绑定/解绑代理 · 租户隔离 · 切换自动踢 pool
- `BaileysService.resolveIsolation`: bind + rehydrate 两路径统一读 fingerprint + proxy, 喂 `makeWASocket({ browser, agent, fetchAgent })`
- `onBindConnectionOpen` 同步把 fingerprint JSON 写 `wa_account.device_fingerprint` DB 列
- `POST /slots/backfill-fingerprints`: 升级回填 — 幂等补齐 fingerprint.json + DB 字段

**W3.6 · Admin 代理 CRUD**
- `POST /admin/proxies` · `GET /admin/proxies` · `DELETE /admin/proxies/:id` (RolesGuard=admin + 租户隔离)
- `CreateProxyDto` (proxyType / host / port / username? / password? / country? / city?)

**开发工具**
- `scripts/dev-proxy.ts`: 轻量 HTTP CONNECT 转发代理, 记录每条 CONNECT 的 client/upstream src-dst. 用法:
  ```
  LABEL=P8080 PORT=8080 npx ts-node scripts/dev-proxy.ts
  LABEL=P8081 PORT=8081 npx ts-node scripts/dev-proxy.ts
  ```

### 技术细节 · 槽位路由隔离实测

真实 smoke (commit `TBD`):
```
P8080 CONNECT web.whatsapp.com:443 · client=127.0.0.1:54021 · upstream=[IPv6]:54022 → WA
P8081 CONNECT web.whatsapp.com:443 · client=127.0.0.1:54026 · upstream=[IPv6]:54027 → WA

→ 2 个 slot 经 2 个独立代理进程 · 2 条独立 TCP 连接 · 不同 client port + 不同 upstream port
→ 从代码到网络栈完整隔离链通
```

**真实生产中"不同出口 IP 到 WA"的来源**:
- dev smoke 两代理都在 localhost → WA 看到同一个 NAT 出口. **不是 bug, 是 dev 限制**.
- 生产部署: 每个 proxy 行的 host/port 对应真实住宅代理供应商, 每个供应商给出独立 IP. WA 侧看到的 source IP 自然 distinct.
- 代码层面已保证: 不同 proxy_id → 不同 proxy row → 不同 HttpsProxyAgent 实例 → 不同 TCP 上游目标主机.

**M3 仲裁的 "IP 组" 判定**:
- 用 `proxy_id` / `proxy.bound_slot_ids` DB 字段决定组, 非实时 IP 比对
- 相同 proxy_id 的 slots = 同 IP 组 (M3 互斥)
- 不同 proxy_id 的 slots = 不同 IP 组 (可并发)
- dev 测试: 分配同一 proxy_id 给多槽即可构造"同组"场景, 无需真实 IP 相同

### Deferred (明确推迟)

- **W3.5 新号注册**: 推迟到 V1.1 单独里程碑. 每次失败永久烧 SIM 卡, 需实物 SIM 及谨慎测试流程.
- **多代理池健康检查 Cron**: M3 调度器阶段做
- **代理 IP 组错峰调度**: M3 仲裁器做
- **指纹轮换策略 / 深度反检测 stealth**: M5 养号日历阶段做
- **接管 UI**: M9

### Known Issues (M2)

- 媒体文件无 HTTP 服务入口 (前端暂无法直接看/下载) — M9 接管 UI 时加 `/slots/:id/media/<file>` 端点
- 没有消息去重 (接收方 `wa_message_id` 重复 upsert 会入多条) — M9 加唯一索引
- 没做发消息速率限制 / 养号节流 — M3 调度器 + M5 养号日历会统一管
- 视频消息当前归到 Image 枚举 — 待 MessageType 枚举扩展 Video
- Windows dev: `scripts/dev-proxy.ts` 的 BIND_ADDR 选项 EINVAL (Linux 可用)

### 真机验收 (带用户一起实测)

- 扫码绑定 2 个真号: 60168160836 + 60186888168 — 两个独立槽位, 独立 Oppo Reno11 / A78 指纹
- 接收文本消息 · 发送文本消息 (loopback slot1 → slot2) · 接收图片
- ChatModal UI 三 Tab 全部展示正确 (发文本 / 发图片 / 联系人 / 最近消息)
- 遇到并修复的坑:
  1. `restartRequired(515)` 误判失败 → 改为自动 respawn socket
  2. 同 DEVICE_POOL 条目碰撞 → browser label 加 `· S{slotIndex}` 后缀去重
  3. `requestPairingCode` 太早调返 "Connection Closed" → 改到首次 qr 事件触发
  4. getLocalStatus 返回已吊销 license → 加 `revoked ASC, issued_at DESC` 排序
  5. express 直接 import 崩溃 → 改用 `app.useBodyParser`
  6. Windows net.connect localAddress EINVAL → BIND_ADDR 文档注明 Linux only

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
