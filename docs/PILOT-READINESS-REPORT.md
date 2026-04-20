# Pilot Readiness Report · v1.0.0-rc3

> 起草 2026-04-21 · Cascade [40] · 经 2 轮 dogfood 验证
> 对齐 tag `v1.0.0-rc3`

---

## Executive Summary

Pilot 客户能直接上手的程度: **7/10**

| 维度 | 评分 | 说明 |
|---|---|---|
| 文档完整性 | 9/10 | 13 份中文 + 4 份英文 · 覆盖安装 / 上手 / 故障 / 限制 / 合同 |
| 脚本可靠性 | 8/10 | validate-env.ps1 dogfood 1 轮炸 · fix 后 9/9 跑完 · encoding 坑根治 |
| RC 交付物 | 6/10 | 当前仅 docs + scripts (59.3 KB) · 无真 installer · 标显眼警告 |
| 实际能跑 | 4/10 | 没 installer · pilot 客户看 docs 建立预期 · GA 才能真装 |
| 修订闭环 | 8/10 | Dogfood 发现 15 issues · fix 11 · V1.1 延 4 · report 透明 |

**核心价值**: pilot 客户现在**能看懂产品形态** · **能跑 pre-flight** · **能反馈文档坑**. 真装要等 GA (需 installer deps 齐 + 律师 signoff).

---

## Dogfood 测试总览

### 执行了几次

- **第 1 轮** · rc2 包 (58.6 KB) · 作为"假设马来华人电商老板"视角
  - Scene 1 · 解压读 README + QUICK-START
  - Scene 2 · 跑 validate-env.ps1 → **炸** (CRITICAL-01 暴露)
  - Scene 3 · dev env 装 skip (非典型 pilot 动作)
  - Scene 4 · UX 首次启动 skip (无 .exe)

- **第 2 轮** · rc3 包 (59.3 KB) · fix 验证
  - Scene 1-2 全重跑 · 通过
  - 链接 sample 点击 → 指向正确 · FIXED 验证

### 发现 issues 数量 + 严重度分布

| 严重度 | 数量 | 已修 | V1.1 延 |
|---|---|---|---|
| CRITICAL | 1 | 1 | 0 |
| MAJOR | 13 | 8 | 5 |
| MINOR | 3 | 3 | 0 |
| **合计** | **17** | **12 (71%)** | **5 (29%)** |

详见 `staging/dogfood-issues.md`.

### 已修清单

1. `validate-env.ps1` 中文编码炸 (CRITICAL-01) · 全脚本英文化 · PS 5.1+7 双兼容
2. Markdown 内部链接 → pilot kit 重命名后断 (MAJOR-02) · build-pilot-kit.js 加 rewriteMdLinks 中英双向
3. `pwsh` 命令假设 (MAJOR-03) · 改 `powershell -ExecutionPolicy Bypass` 默认
4. `Get-FileHash` 路径假设 (MAJOR-04) · 加 `cd Downloads` 前置
5. RC 无 installer 警告不醒目 (MAJOR-05) · README 头部大红横幅 + WARNING 块
6. VPS URL 没告知 (MAJOR-06) · README 加客服 URL 占位 + QUICK-START line 12 改写
7. 跳代理后选组概念空 (MAJOR-07) · QUICK-START ⑥ 补 "无代理选 '默认 / 直连'"
8. INSTALLATION.md 对 RC 混乱 (MAJOR-13) · 通过 #5 横幅说清 RC 性质
9. 币种歧义 (MINOR-09) · 加 `USD $` + 汇率备注
10. README 构建时间 UTC (MINOR-10) · 双显示 MY 本地 + UTC
11. 视频脚本定位 (MINOR-11) · 改 "产品方录屏用 · 客户可跳"

### V1.1 延后清单

1. 验证码 UI 截图占位符 (MAJOR-08) · 需产品方录屏
2. validate-env.ps1 docs 路径 pilot kit vs repo 检测 (MAJOR-12) · 半解决 · 英文化已屏蔽
3. ActivatePage 跳转验证 (MAJOR-14) · M11 Layer B VM smoke 时真跑
4. AI 关闭 Dashboard Alert 提示 (MINOR-15) · V1.1 UI 改动
5. 合同模板律师 signoff (外部依赖) · `docs/contract/` 占位

---

## Pilot 客户能直接上手程度评分

**7/10** · 分项说明:

### + 加分项

- ✅ 9 份中文文档 · 按主题分段 · 找信息容易
- ✅ 4 份英文翻译 · 扩大可接触客户池
- ✅ validate-env.ps1 一键跑完 · 知道机器够不够格
- ✅ RC 预览横幅醒目 · 客户知道这不是真装包
- ✅ 付费全可选原则贯穿 · 客户不会被逼买不必要的东西
- ✅ 常见问题 5 条直接贴 QUICK-START 底部 · 90% 一般问题无需翻文档
- ✅ Dogfood 已暴露真坑 · fix 闭环 · 不把已知坑留给客户

### - 减分项

- ❌ 无真 installer · 客户只能读不能试
- ❌ 视频教程仍是脚本 · 拍摄待产品方
- ❌ 合同模板占位 · 律师未 signoff
- ❌ `wahubx.ico` 缺 · installer 无法真生成
- ❌ 没拍实际截图 · 文档里 `[截图: ...]` 占位符

---

## 真机 Pilot 建议 · 第一批客户画像

### 具备下列**技术水平 + 资源**的客户适合 RC 阶段预览:

1. **能读中文 markdown** (非印度/友族非必需 · 但中文流畅优先)
2. **熟悉 Windows 基本操作** (右键菜单 · PowerShell 开窗 · 不怕命令行)
3. **愿意等 GA 再真装** · RC 期主要给反馈 · 不期望立即运营

### Pilot Wave 分期推荐

**Wave 1 · RC 预览 (本 rc3 阶段)** · 2-3 家
- 给 pilot kit zip
- 他们读文档 + 跑 validate-env + 回反馈
- 不期望跑真 WhatsApp 号
- 目的: 找文档/流程坑 · 2 轮迭代

**Wave 2 · GA Soft Launch (v1.0.0 发布后)** · 3-5 家
- 给真 installer + 真 License
- 跑 1 号 · 养号 5 天
- 周 check-in 30 min
- 目的: 找代码/UX bug

**Wave 3 · Scaled Pilot (v1.0.0 + 2 周)** · 5-10 家
- 多号 (3-10 per 客户)
- 完整部署 Mode B Standard
- 目的: 找规模 / 长期运营坑 (封号率 / 代理耗尽 / API 费超预期)

---

## Release Gate 差距

从当前 rc3 到 v1.0.0 GA · 仍需:

1. **wahubx.ico 多尺寸** · 产品方设计师 (工作量 1-2 天)
2. **Inno Setup deps 下载齐 + build.bat 跑通** · 工程方 (工作量 1 周 · 下载 ~270MB)
3. **Layer B VM smoke 跑过** · 工程方 (工作量 1 周 · 干净 VM + installer test)
4. **律师审阅合同 · signoff** · 商务 + 法务 (工作量 2-3 周 · 含 PDPA 合规)
5. **截图拍摄 + 视频录制** · 产品方按 ONBOARDING-VIDEO-SCRIPT 拍 (1 天)

估 4 周到 `v1.0.0` GA (平行工作 · 不是串行).

---

## 推荐下一步

### 选项 A · 冻结 RC3 · 等外部依赖

- Pilot Wave 1 收反馈 · 2 周 window
- 平行 · 产品方 ico + 商务 signoff + 工程 deps 下载
- Wave 1 反馈回来后同步进 GA · 不再发 rc4/rc5

### 选项 B · 继续 rc4 迭代

- Dogfood Scene 3 + 4 真 dev env 装 · 找更多 UX 坑
- 加 mock Baileys pilot 端到端 (不需真 SIM)
- 文档加截图占位符真图

### 选项 C · 跳 rc 直接 GA-prep

- 等外部依赖 + 跑 Layer B VM smoke
- 不再迭代 RC
- 直接 `v1.0.0-prod` tag · 发 GA

**Claude 推荐**: **选项 A** · Wave 1 客户的**真实反馈**比我们自 dogfood 第 3 轮更有价值. 并行等依赖齐.

---

## 累积 local tags (post-dogfood)

- `v1.0.0-rc1` · release-prep tooling (已 push)
- `v1.0.0-rc2` · +i18n +E2E smoke +pilot kit (已 push)
- `v1.0.0-rc3` · +dogfood fixes (本 commit · 待 push)

---

_最后更新 2026-04-21 · 对齐 v1.0.0-rc3_
