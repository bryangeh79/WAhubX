# V1.0 已知限制

> 透明告知 pilot 客户 · 避免上线后 surprise
> 每条含: 限制 · 影响 · 规避 · 修复时间

---

## 1. _builtin 素材池未预装真内容

### 限制
V1 installer 打包 `_builtin` 素材池时 · 可能只包含 placeholder 文件 (real-mode seed 生成未跑 / 未 LFS 授权).

### 影响范围
StatusPostExecutor Layer 2 降级路径 (`_builtin_images_life` 等池) 空 · 新号 Phase 2+ 发 status post 时直接跳到 Layer 3 纯文本.

### 规避
- **方案 A** · 接 Replicate API (~$5/月) · Layer 1 persona 专属图自动生成
- **方案 B** · 手动上传图到 `C:\WAhubX\data\assets\_builtin\image\_builtin_images_life\` (通用池 · 所有号共用)
- **方案 C** · Layer 3 纯文本发 status 也能跑 · 只是多样性低

### 预计修复
V1.1 · GitHub Releases 分发 ~50MB 真素材包 · installer 首次启动下载.

参 `docs/M7-BUILTIN-SEED.md`.

---

## 2. 未经真 VM installer E2E smoke

### 限制
M11 升级系统代码已完成 (Layer A + Layer B-lite PASS) · 但没在**干净 Windows VM** 上跑过完整 installer.exe → 真升级 → 真回滚 E2E 流程.

### 影响范围
- 首次装机可能踩未发现的 installer 坑 (PG portable 路径 / Redis 权限 / 防火墙)
- 升级包 `.wupd` 实际 apply 时 backend 自杀 + installer 接管 app/ rename 的时序未在物理机验证

### 规避
- 第一批 pilot 装机**现场陪 60 min** · 有问题立即修
- `.wupd` 升级 pilot 期内**暂不推送** · 有需要人工替换 app/ 并重启
- 详细 runbook: `docs/DAY5-SMOKE-RUNBOOK.md`

### 预计修复
发布前 V1.0 GA · 必须跑完 Layer B 真 E2E (见 `INVESTIGATION_NOTE.md` + `staging/v1.0-release-checklist.draft.md` §2).

---

## 3. Persona voice 是大陆腔 · >8s 长语音不推荐

### 限制
Piper zh_CN-huayan-medium 是北京普通话模型. 3-5s 短语音差别不明显 · 但 >10s 长语音马华本地用户能听出来.

### 影响范围
- Voice rewrite / 自动生成的语音 status post
- 如果接 WhatsApp 语音消息 · 对方听音辨认

### 规避
- V1 硬编码 8s 上限 · 超长 throws (PiperService.generate)
- 文本池偏向 "笑声 / 语气词 / 短问候 / 确认" · 天然短
- 真 · 大段语音交互仍用**文字** · 不用 TTS

### 预计修复
V1.1 · 3 条路径评估:
- 路径 A · 爬公开马华声音样本 + fine-tune Piper 模型 (开源 · 免费)
- 路径 B · 引入 ElevenLabs voice clone (付费 · 质量好)
- 路径 C · 放弃 TTS · 只用真 mp3 素材库

---

## 4. 跨版本降级永不支持 · 只做失败回滚

### 限制
`.wupd` 升级包 from_version 必须 == 当前版本. 没有 "先装 v1.2 再回到 v1.0" 路径.

### 影响范围
- 客户装了新版本 · 遇到 bug · 只能等 hotfix · 不能 "先降级再说"
- 客户要回之前的状态 · 只能用**升级前自动备份** (M10 backup 模块自动做 · 升级失败自动回滚)

### 规避
- 升级前手动做一次 `.wab` 全量备份 (Backup 页 · 5s)
- 升级失败自动回滚已验证 (M11 Layer A · 回滚到备份点)
- 升级成功但行为异常 · 联系客服拿旧版 `.wupd` → from_version 匹配后降级

### 预计修复
不修复. 这是产品设计决策 · 防止 schema 混乱. V2 考虑 branch-based migration (复杂度大幅上升).

---

## 5. 硬件变更触发 E2 recovery · 准备旧 env key 或 .wab

### 限制
License Key 绑定机器码. 换硬盘 / 换主板 / 重装 Windows (换硬件指纹) · backend 启动会报 E2 "machine fingerprint mismatch" · 拒绝启动.

### 影响范围
- 客户硬件大修 / 换新机
- 硬盘坏需恢复

### 规避
Recovery 3 条路径 (详 `docs/UPGRADE.md`):
- **Path 1 · env key recovery**: 客户曾备份过 `APP_ENCRYPTION_KEY` · 粘回 `.env` · backend 用旧 key 解密历史数据
- **Path 2 · .wab import**: 客户做过 `.wab` 全量备份 · Backup 页导入 · 系统自动解密 + 重新绑定新机器码
- **Path 3 · 客服重置**: 联系客服 · revoke 旧 License 绑定 + 重新激活 · 历史 WhatsApp session 丢失 (需重新扫 QR 注册)

### 规避建议 (pilot 客户须做)
- 安装后**第 1 天**就做一次 `.wab` 备份 · 云端保存
- 记录 `.env` 文件的 `APP_ENCRYPTION_KEY` 值 · 保密保存

### 预计修复
不修复. 本地部署产品天然要求客户管好密钥. V1.1 考虑自动上云备份 (opt-in).

---

## 6. Installer V1 仅中文界面

### 限制
Inno Setup 安装向导 + WAhubX UI 目前仅中文.

### 影响范围
- 非中文用户 (少见 · 我们 target 马华) 看不懂
- 英语流利的技术员助手看不懂

### 规避
- UI 操作流程配图 · 非中文用户可靠截图操作
- 客服可远程协助装机

### 预计修复
V1.1 · i18n 全量 · 加英文 + 马来文. 技术上 antd 支持 · 工作量 ~1 周.

---

## 7. VPS 自动下载 `.wupd` 推 V1.1 · V1 手动导入

### 限制
V1 升级流程: 客户收到邮件通知 → 从链接下载 `.wupd` → UI Upgrade 页手动上传.

### 影响范围
- 客户可能错过升级
- 关键 hotfix 推送慢

### 规避
- 邮件 + WhatsApp + Telegram 3 渠道通知
- 升级包 ~5MB · 下载快 · 上传快
- Pilot 期内 · 客服主动推送 · 不依赖客户主动

### 预计修复
V1.1 · `/version/auto-check` endpoint 定时 ping VPS · 新版本弹通知 + 一键下载. 不自动装 (避免意外).

---

## 8. 免费部署模式的质量妥协

### 限制 (Mode A · 全免费 · 详 `DEPLOYMENT-MODES.md`)

客户不配 AI / 不买代理时:
- **Status 发图**: 只能用 `_builtin` 预置或手动上传 · 无 AI 生成多样性
- **账号个性化降低**: 所有号共享 `_builtin` 素材 · 被 WhatsApp 关联标记风险理论存在
- **文本同质**: 用 script content_pool 原文 · 多号内容重复率高
- **IP 关联**: 家庭网络直连 · 2+ 号同 IP · 被关联封风险大幅升高

### 这是明确的成本 vs 质量 trade-off

产品**可以跑** · 但账号质量/寿命降低. V1 明确告知客户 · 不隐瞒.

### 规避
- 预算紧: 只跑 1-2 号 · 减少关联风险
- 想跑 3+ 号: 至少配住宅代理 (~$40-60/月)
- 想提升文本: 至少配 DeepSeek (~$3-5/月)

### 预计修复
不修复. 这是免费模式的固有 trade-off. V1.1 考虑:
- 内置更多样的 script content_pool (AI 预处理 · 装机时生成 · 非运行时调用)
- _builtin 素材每次升级扩充 ~50 张图

---

## 9. 其他小限制

| 限制 | 影响 | 规避 | V1.1 |
|---|---|---|---|
| Voice 生成最大 8s | 长语音受限 | 用 status image 替代长语音 | 马华 fine-tune |
| Flux 本地需 NVIDIA GPU (AMD 不支持) | AMD 用户只能用 Replicate | 配 Replicate ($5/月) | ROCm 支持 |
| Settings UI 不支持导入 / 导出配置 | 换机器需手填 | .wab 备份包含部分配置 | 独立 export/import |
| 无 audit log UI · 只有 log 文件 | 操作追溯难 | grep log 文件 | Admin 新增 audit tab |
| 不支持 WhatsApp Business API | 只做 personal WA | 客户自担 ToS 风险 | 不做 · 超 scope |
| 单机部署 · 无集群 / 负载均衡 | 单机故障全停 | 做 .wab 备份 · 故障时换机 | 不做 · 本地部署的设计 |

---

## 10. 非 bug 的正常降级 · 客户常误解

以下是**产品按设计行为**, 不是故障. Pilot 客户必读:

### 10.1 AI 关掉发的文本没变化
→ 正常. §B.4 三维降级 · 无 AI 就用 script 原文. 想变化 · 开任一 AI provider.

### 10.2 Phase 0 新号不主动发消息
→ 正常. 孵化期只接收 · 防封号. 第 3 天后自动开始发.

### 10.3 dispatcher 看 skip-xxx 不执行
→ 正常. 6 路拒绝机制 · 并发/夜间窗口/同 IP 等. 看 log 具体哪条 skip.

### 10.4 Status post 只发了文本没图
→ 正常. §B.20 4 层降级 · Layer 3 fallback. Layer 1/2 素材池空时会到这里. 填 `_builtin` 或 persona 池能解.

### 10.5 签名验证 PREVIEW_REJECTED
→ 正常. `.wupd` from_version 与当前版本不匹配 · downgrade 不允许. 换匹配版本的包.

### 10.6 养号日历关机期间没执行
→ 正常但需补. 开机后 dispatcher 补跑 pending 任务. 大量积压会延后几小时.

---

## 总体定位

**V1.0 是 pilot-grade** · 不是 GA-grade.

预期:
- 10 bug / 100 小时使用 · 修复周期 ≤ 1 周
- 2-4 周 pilot 期有 2-3 个**阻塞级**问题需客服协助
- 非核心功能 (backup 自动清理 / Settings 高级项) 可能有小坑

接受这些 · 是 pilot 客户的心理准备.

GA (V1.0 正式版) 预计 · V1 pilot 反馈迭代 2 轮后 · ~8 周.

---

_最后更新 2026-04-20 · 对齐 v0.12.0-m7_
