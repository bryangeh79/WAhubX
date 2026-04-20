# INVESTIGATION NOTE · M11 Day 5 Layer B · 2026-04-20 Cascade [4]

## 结果 · 受限 PASS · tag v0.11.0-m11-codecomplete-smoke-pending

Layer A (CLI 跨实现验证) · 已 PASS (commits 6a8e654 / bc93fca / daf86dc)
Layer B-lite (backend apply pipeline) · 已 PASS (live /api/v1/version/apply-update)
Layer B (fresh VM + installer.exe E2E) · **BLOCKED on physical prereq**

## Layer B-lite · 本次证据

request: `POST /api/v1/version/apply-update` · dryRun=true · staging/day5-smoke/test.wupd
response: `{ code: "PREVIEW_REJECTED", ... }`

pipeline 全链 PASS:
- multipart upload (816 bytes)
- wupd header parse (magic "WUPD")
- **signature_valid: true** · Ed25519 · 用 dev pubkey `3dfd279...`
- **app_content_valid: true** · SHA-256 match `45e70f00...`
- **migrations_valid: true** · 0 migrations
- version_compat: `downgrade` (预期 · test.wupd from=0.11.0-m11 vs backend=0.1.0)
- can_apply: false (因 version 降级 · 并非签名/内容问题)

这证实 · backend 侧 wupd-codec + signing/verify + migration-validator + update-preview 全通.

## Layer B 真 E2E 仍 blocked on

| 前置 | 状态 | 备注 |
|---|---|---|
| `installer/deps/node-lts-embedded/` | 缺 · 仅 README | ~60MB 需从 nodejs.org 下 |
| `installer/deps/pgsql-portable/` | 缺 | PostgreSQL 16 portable ~200MB |
| `installer/deps/redis-windows/` | 缺 | Redis for Windows ~8MB |
| `installer/assets/wahubx.ico` | 缺 | 产品方图标 · 多尺寸 |
| `installer/output/WAhubX-Setup-v*.exe` | 缺 | 未跑 Inno Setup build |
| 干净 Windows VM | 未挂 | 需 Hyper-V/VirtualBox |

## Release 必要动作

见 `staging/v1.0-release-checklist.draft.md` §2 Installer 二进制依赖.
V1.0 GA 前补齐 6 项 + VM smoke run 完整 Layer B.

## 当前累积 tags (本地 · 待 [14] 授权 push)

- v0.10.0-m10 (已 push)
- v0.11.0-m11-codecomplete-smoke-pending (本次 @ 66833c8)

## 不影响后续 cascade

[5]+ Batch B · M7 Day 2-8 不依赖 installer 实物 · 继续推进.
