# WAhubX V1.0 Release Checklist (正式版)

> 起草于 `staging/v1.0-release-checklist.draft.md` · polish 后搬到此处
> 受众: 产品方 + 工程方 · V1.0 GA 发布前**逐条对照**
> 对齐 code state: `v0.12.0-m7`

---

## 0. 发布前决策门 (GO / NO-GO)

所有条目 GO · 才能进 `v1.0.0` tag.

| 项 | GO 条件 | 查法 | 状态 |
|---|---|---|---|
| M1-M11 收工 tag 都 push | `git tag --list 'v0.*-m*'` 含 m1-m11 | 远端 vs 本地 | ✅ 至 v0.12.0-m7 |
| M7 `_builtin/` 填充 ≥ 50MB | `du -sh data/assets/_builtin/` | CI build output | ⚠ stub-only 待真生成 |
| 所有 UT 绿 | `cd packages/backend && pnpm test` 250+ all green | local | ✅ 271/271 |
| M11 Layer B smoke 过 | Windows VM 真升级 + 真回滚 | 见 `docs/DAY5-SMOKE-RUNBOOK.md` | ⚠ blocked on deps |
| 产品方交付 `wahubx.ico` | `installer/assets/wahubx.ico` 存在 | file presence | ❌ 产品方 TODO |
| 合同模板律师审阅 | 有签字 legal signoff | PDF archive | ❌ 商务 TODO |

**当前状态**: 6 项中 3 项 GO · 3 项 blocker. 估剩余 ~4 周.

---

## 1. 密钥 + 签名 (Ed25519)

- [ ] **生产 Ed25519 密钥对已生成** · 一次性 · 离线保管 · 绝不入仓库
      `node scripts/sign-wupd.js genkey --out-dir ~/wahubx-prod-keys/`
- [ ] `packages/backend/src/modules/signing/public-key.ts` 的 `WAHUBX_UPDATE_PUBLIC_KEY_HEX` 已替换为生产公钥 hex
      (非 dev 全 0 · 非 `3dfd279...` dev pubkey)
- [ ] `keys/` 目录 dev 密钥**已删除** · `rm -rf keys/`
- [ ] `build.bat` 加自动检查 · hex 是已知 dev 值或全 0 · production build **拒编译**
- [ ] 私钥备份 · 3-2-1 原则 · 3 份 · 2 种介质 · 1 份异地 (USB + iCloud + 纸笔备份 hex)
- [ ] 私钥丢失 playbook 写入公司内部 wiki · 不入 git repo
- [ ] `sign-wupd.js verify` 路径跑通最新 .wupd · signature_valid=true

## 2. Installer 二进制依赖

详见 `installer/deps/FETCH-DEPS.md`.

- [ ] `installer/deps/node-lts-embedded/` · Node 20.x LTS · ~60MB
- [ ] `installer/deps/pgsql-portable/` · PostgreSQL 16 portable · ~200MB
- [ ] `installer/deps/redis-windows/` · Redis / Memurai · ~8MB
- [ ] `installer/deps/piper/` + voices (可选 V1) · ~50MB
- [ ] `installer/assets/wahubx.ico` · 多尺寸 256/128/64/32/16
- [ ] SHA-256 全部填入 `installer/deps-checksums.txt` · 无 PENDING
- [ ] 预置 `_builtin/` 素材 (M7 Day 7 real mode 跑过) · 实际 size < 100MB
- [ ] `installer/scripts/verify-deps.ps1` 跑全绿

## 3. .env 默认值审计

- [ ] `generate-env.js` 产出的默认 `.env` · 密码强度 ≥ 20 字符 · 随机 · 非确定性
- [ ] `APP_ENCRYPTION_KEY` 每次安装独立生成 (不跨机器共享)
- [ ] `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` 独立随机
- [ ] 生产安装绝无 dev/test 凭证残留 (如 `Test1234!` / `platform@wahubx.local`)
- [ ] `.env` 不跟 installer 二进制同包 · 首次启动生成

## 4. CVE + 依赖审计

- [ ] `pnpm audit` backend + frontend · 无 high/critical
- [ ] `@whiskeysockets/baileys` 版本锁 + 已知 CVE 确认 (6.7.21 当前)
- [ ] `sharp` 版本 · libvips 无已知高危 CVE
- [ ] Node 20 LTS · 最新补丁版 (build 前拉一次)
- [ ] `typeorm` + `pg` 版本锁

## 5. 日志 + 观测性

- [ ] `pino` 生产模式 LOG_LEVEL=info · 无 debug 冗余
- [ ] 敏感字段脱敏确认 (M6 已做) · apiKey / password / token 不进 log · 回归 check
- [ ] `data/logs/` 轮转 · 单文件 < 100MB · 保 30 天
- [ ] Log 包含 License Key 前缀全脱敏 (`WAHUBX-PRO-****`)

## 6. 数据库迁移

- [ ] 所有 M1-M11 + M7 migrations 能从空 DB 依序跑过 · `pnpm run migration:run` on fresh schema
- [ ] Migration 无 down 断链 · forward-only 项已文档化
- [ ] `TypeORM logging=false` 生产默认 · 防 SQL 泄漏
- [ ] Migration 1780 (asset persona_id + 'manual_upload' enum) 部署过

## 7. Health 系统 · dry-run 关闭

- [ ] `app_setting.health.dry_run = false` · 真自动降级生效 (已 cascade [2] 关过)
- [ ] 72h 全量 dry-run 观察过 · 无误告警 · 无 scorer crash
- [ ] `health.scoring_window_days` 默认 30 · 文档化
- [ ] HealthCoordinator debounce 30min 验证过

## 8. 接管 (M9)

- [ ] Socket.io JWT handshake 强制 · 无 anonymous 接入路径
- [ ] `/auth/refresh` 自动续期 · 测试 > 20min 静置后可 send message (M9 patch v0.9.1 已修)
- [ ] Hard-kill 30s reveal + 30min idle 自动释放 · 真测过

## 9. 备份 (M10)

- [ ] 每日快照自动跑 · `backup.last_daily_at` 稳定更新
- [ ] `.wab` export → import 全流程 · E2 recovery 两路径真跑过
- [ ] Pre-update backup + 失败回滚 · 在 VM smoke 验过

## 10. 升级 (M11)

- [ ] Installer.exe 在干净 Win10/Win11 VM 装过 · fresh install 路径 OK ⚠
- [ ] `.wupd` 升级过 · happy path 成功 ⚠
- [ ] `.wupd` 升级过 · 故意 broken migration · 回滚到旧版 OK ⚠
- [ ] 硬件变更 E2 recovery 两路径 · env key + .wab import 都测过

> ⚠ 3 项**都 blocked on Layer B physical VM smoke** · 见 `INVESTIGATION_NOTE.md`.

## 11. UI + i18n

- [ ] 所有 page 中文字符无 unicode 错位
- [ ] Login 页显 app version (M11 补强 1 已做)
- [ ] Activate 页显 fresh install / 重激活 区分 banner (M11 补强 1 已做)
- [ ] 英文 i18n · V1 不做 (已文档化 KNOWN-LIMITATIONS §6)
- [ ] 4 核心 user-guide docs 有英文版 (cascade [30] 已做)

## 12. License + VPS

- [ ] License 服务端 (VPS) 部署过 · `/license/verify` 接口稳定
- [ ] 本机 `/license/verify` 离线模式 · 过去 24h 内 verified 可继续用
- [ ] Revoke 流程 · 超管吊销 · 客户端 24h 内掉线
- [ ] License Key 格式统一 · `WAHUBX-{BASIC|PRO|ENTERPRISE}-xxxxx-xxxxx-xxxxx`

## 13. 客户 onboarding 材料

- [ ] `docs/user-guide/INSTALLATION.md` · 中文 完整手册 (已做 cascade [15])
- [ ] `docs/user-guide/QUICK-START.md` · 30min 精简 (已做 cascade [16])
- [ ] `docs/user-guide/DEPLOYMENT-MODES.md` · 3 档梯度 (已做 cascade [17])
- [ ] `docs/user-guide/TROUBLESHOOTING.md` · 故障排查 (已做 cascade [18])
- [ ] `docs/user-guide/ONBOARDING-VIDEO-SCRIPT.md` · 视频脚本 (已做 cascade [19])
- [ ] 3-5 分钟录屏视频 · 产品方拍 (用 ONBOARDING 脚本)
- [ ] 初次登录 · 输 License Key · 创建 admin · 登入
- [ ] 首号 register + 5 天养号可视化

## 14. 法务 + 合规

- [ ] EULA 文本 · 产品方提供 · installer 显示
- [ ] 隐私政策 · 本地数据不离机声明
- [ ] WhatsApp ToS 风险告知 · 产品方决策 (已知边缘)
- [ ] Pilot 合同模板 (`docs/pilot/RECRUITMENT-PACK.md` §5) 经律师审阅 · signoff
- [ ] PDPA (马来西亚) 合规声明

## 15. Pilot 配套

- [ ] `docs/pilot/RECRUITMENT-PACK.md` · 招募包完整 (已做 cascade [20])
- [ ] `docs/pilot/FEEDBACK-COLLECTION.md` · 反馈模板 (已做 cascade [21])
- [ ] 3-5 家 pilot 客户候选名单 (商务方填)
- [ ] Pilot Kit zip 包可构建 (cascade [32] 已做)

## 16. 版本号最终确认

- [ ] `packages/backend/package.json` · `version: "1.0.0"` (非 -m* 后缀)
- [ ] `packages/frontend/package.json` · 同
- [ ] `installer/wahubx-setup.iss` · `#define MyAppVersion "1.0.0"`
- [ ] `CHANGELOG.md` · 写 `[v1.0.0] · <date> · GA` 段 · 整合所有 M1-M11 + M7

## 17. Tag + Push + Release

- [ ] `git tag -a v1.0.0 -m "GA release"`
- [ ] `git push origin main`
- [ ] `git push origin v1.0.0`
- [ ] GitHub Release · 附 `WAhubX-Setup-v1.0.0.exe` + SHA-256
- [ ] Pilot Kit zip 同 release 上传 (cascade [32] 产出)

---

## 发布后 48h 监控

- [ ] 收集首 5 客户反馈 (通过 FEEDBACK-COLLECTION.md 模板)
- [ ] 监控 `data/logs/` 远程上报 (如果 V1.0 加了 telemetry · V1.1 计划)
- [ ] Hotfix 路径测试 · 用 `.wupd` 真发一次 patch (v1.0.1)
- [ ] 若 hotfix 跑通 · 流程认可

---

## 阻塞项聚焦

v1.0.0 发布前 **3 个硬 blocker**:

1. **产品方提供 wahubx.ico** · 设计师工作量 1-2 天
2. **干净 Windows VM Layer B smoke** · 工程方工作量 1 周 (deps 下载 + 编译 + 真装)
3. **律师审阅 Pilot 合同** · 商务方工作量 1-2 周

估路径: **4 周** 到 v1.0.0 GA.

---

## 状态可见性

每周一 · 更新本文档 checkbox 状态. 未勾项责任方自填进度.

---

_最后更新 2026-04-21 · 对齐 v0.12.0-m7_
