---
⚠️ 重要声明 · Important Notice

本文档为 AI 辅助起草 · 未经法律专业人士审阅.
所列条款为行业常见做法, 但:

1. 在马来西亚法律体系下的最终效力由法庭判定
2. 作者 (Bryan Geh) 对文档内容准确性不作担保
3. 一旦发生法律纠纷, AI 起草条款可能被判定部分或全部无效
4. 使用本文档 = 用户自行承担上述风险

(English translation follows below — same disclaimer.)
---

# WAhubX 免责声明 · Disclaimer

> 产品内显示版本 · 首次启动 / 关于页面引用
> 最后更新 · 2026-04-21 · 对齐 v1.0.0-rc3.1

---

## 中文版

### 1. 产品性质

WAhubX 是一款 WhatsApp 多账号自动化运营工具 · 本地部署于用户 Windows 机器 · 由用户持有 License Key 驱动使用. 本产品提供自动化发送 / 接收消息 · 养号日历调度 · AI 内容辅助生成等功能.

### 2. WhatsApp 服务条款风险 · 封号责任自担

用户使用本产品向 WhatsApp Messenger / WhatsApp Business 平台发送自动化消息的行为 · 属于 WhatsApp 用户协议 (Terms of Service) 中的**灰色地带**. WhatsApp 有权以其单方判断为依据 · 封禁 / 限制用户的账号.

**用户明确知悉并同意**:
- 本产品的使用可能导致 WhatsApp 账号被封禁 · 限流 · 或功能受限
- 本产品已内置养号机制 · 健康分引擎 · 6 路调度拦截 · 旨在合理降低账号风险, 但**不保证**账号可用
- 任何由于 WhatsApp 平台行为导致的账号损失 · 业务中断 · 客户流失 · 数据丢失 · **本产品作者 (Bryan Geh) 及其关联方不承担任何责任**
- 用户如需跑大规模营销 · 应自行评估其合规性并承担法律与商业后果

### 3. AI 生成内容 · 用户审核义务

本产品集成多个可选的 AI 服务 (如 OpenAI / DeepSeek / Claude / Gemini · 文本改写; Flux · 图片生成; Piper / ElevenLabs · 语音生成). 产出的剧本内容 / 图片 / 语音 · 均为**算法生成**.

**用户应负责**:
- 在分发给终端联系人之前 · 审核 AI 生成内容的准确性 · 合法性 · 恰当性
- 确保生成内容不含任何虚假 · 诽谤 · 误导性陈述
- 确保不侵犯第三方 IP · 商标 · 肖像权
- 本产品作者对 AI 生成内容之正确性 · 合法性 · 第三方权利侵犯 · 均不负责

### 4. 第三方服务依赖 · 中断责任自理

本产品功能依赖若干第三方服务, 包括但不限于:

- **License 验证服务端** (作者 VPS 运营)
- **AI Provider** (OpenAI / Anthropic / Google / DeepSeek / Replicate / ElevenLabs · 用户自选)
- **代理服务商** (IPRoyal / Bright Data / Oxylabs · 用户自购)
- **WhatsApp 协议层** (@whiskeysockets/baileys 开源库)

**任何上述第三方服务的中断 · 限流 · 政策变更 · 倒闭** · 均可能导致本产品部分或全部功能失效. 本产品作者不对第三方服务稳定性作任何担保 · 不承担由此产生的损失.

### 5. "AS IS" 提供 · 无隐含担保

本产品按**"现状"** (As Is) 提供. 作者不就:
- 产品的适销性 (Merchantability)
- 特定用途的适用性 (Fitness for Particular Purpose)
- 不侵权 (Non-infringement)
- 无错误 / 无中断 (Bug-free / Uninterrupted)

作任何明示或暗示的担保.

### 6. 使用行为红线 · 严禁恶意营销

用户承诺**不得**使用本产品从事以下行为:
- 发送垃圾信息 · 诈骗信息 · 钓鱼链接
- 骚扰他人 · 持续干扰未同意接收消息的陌生人
- 传播虚假信息 · 政治煽动 · 恐怖主义内容
- 赌博 · 色情 · 非法药品相关营销
- 冒充他人身份进行欺诈
- 传销 · 金字塔计划 · 未经监管的金融产品销售

违反上述红线 · 作者有权**立即吊销 License** · 并保留向司法机关报告之权利.

### 7. 数据本地存储 · 隐私保护

本产品遵循本地部署原则:
- 用户 WhatsApp session · 消息记录 · 联系人 · 素材库 · 均存储于用户本机 (`C:\WAhubX\data\`)
- 本产品作者**不主动收集**用户的 WhatsApp 业务数据
- License 激活过程中 · 作者服务端仅记录: 邮箱 · 机器指纹 · 激活 IP · 激活时间
- 用户启用第三方 AI Provider 后 · 其消息片段可能发送至所选 AI 服务商 · 相关隐私条款由用户与该 AI 服务商自行约定

详见 [USER-AGREEMENT.md](./USER-AGREEMENT.md) §5 PDPA 合规段.

### 8. 升级与行为变更

本产品通过 `.wupd` 升级包分发新版本. 升级后产品行为可能发生以下变化:
- 新增或修改养号策略 · 影响既有账号运营节奏
- 调整健康分阈值 · 影响降级触发
- 变更默认 AI provider · 影响生成内容风格
- 修改 UI 流程

**用户接受以下风险**:
- 升级失败会自动回滚至升级前备份 (M10 备份机制), 但不保证 100% 成功
- 升级后 30 天内可能发现兼容性问题 · 用户自行监控
- 作者有权在 critical security 漏洞场景下**强制升级** · 拒绝则吊销 License

### 9. 本声明约束力

使用本产品 (安装 · 启动 · 激活 License) · 即视为用户**已完整阅读并接受**本免责声明全部条款. 如不接受 · 应立即停止使用并联系客服办理退款 (依 [USER-AGREEMENT.md](./USER-AGREEMENT.md) §3 退款条款).

本声明中文版与英文版同等效力. 如有歧义 · 以中文版为准.

---

## English Version

### 1. Product Nature

WAhubX is a WhatsApp multi-account automation tool deployed locally on users' Windows machines, driven by a License Key purchased from the author. It provides automated message sending/receiving, warmup calendar scheduling, and optional AI-assisted content generation.

### 2. WhatsApp ToS Risk · Ban Responsibility

Using WAhubX to send automated messages via WhatsApp Messenger / Business falls within the **gray zone** of WhatsApp's Terms of Service. WhatsApp reserves the right, at its sole discretion, to ban or restrict user accounts.

**Users explicitly acknowledge and agree**:
- Product usage may result in WhatsApp account bans, rate limits, or feature restrictions
- Despite built-in warmup, health scoring, and 6-path dispatch gating, **no account stability is guaranteed**
- Any account loss, business interruption, customer churn, or data loss caused by WhatsApp platform actions is **not the responsibility** of the author (Bryan Geh) or affiliates
- Users running large-scale marketing must assess compliance and bear legal/business consequences

### 3. AI-Generated Content · User Review Obligation

WAhubX integrates optional AI services (OpenAI / DeepSeek / Claude / Gemini for text; Flux for images; Piper / ElevenLabs for voice). All output is **algorithmically generated**.

**Users are responsible for**:
- Reviewing AI-generated content for accuracy, legality, and appropriateness before distribution
- Ensuring content contains no false, defamatory, or misleading statements
- Not infringing third-party IP, trademarks, or portrait rights
- The author is not liable for AI-generated content correctness, legality, or third-party infringement

### 4. Third-party Service Dependencies · Outage Risks Self-Borne

Product relies on third-party services including:
- License verification server (author-operated VPS)
- AI Providers (OpenAI / Anthropic / Google / DeepSeek / Replicate / ElevenLabs · user-selected)
- Proxy vendors (IPRoyal / Bright Data / Oxylabs · user-purchased)
- WhatsApp protocol layer (@whiskeysockets/baileys open-source)

**Any third-party outage, rate limit, policy change, or shutdown** may disable product features partially or fully. The author makes no warranty on third-party stability and assumes no liability.

### 5. Provided "AS IS" · No Implied Warranties

Product provided **"As Is"** without warranties of:
- Merchantability
- Fitness for a Particular Purpose
- Non-infringement
- Bug-free / Uninterrupted operation

### 6. Usage Red Lines · No Malicious Marketing

Users commit **not** to use the product for:
- Spam · scam · phishing
- Harassment · repeated messaging to non-consenting strangers
- False info · political agitation · terrorism content
- Gambling · pornography · illegal drug marketing
- Identity fraud / impersonation
- Pyramid schemes · unregulated financial product sales

Violation results in **immediate License revocation** and potential reporting to authorities.

### 7. Local Data Storage · Privacy

- User WhatsApp session, messages, contacts, and assets stay on local machine (`C:\WAhubX\data\`)
- Author does **not actively collect** user WhatsApp business data
- License activation records only: email, machine fingerprint, activation IP, timestamp
- If user enables third-party AI Provider, message fragments may be sent to the chosen provider under their privacy terms

See [USER-AGREEMENT.md](./USER-AGREEMENT.md) §5 for PDPA compliance.

### 8. Upgrade Behavior Changes

`.wupd` upgrades may change:
- Warmup strategies affecting account operation tempo
- Health score thresholds affecting degradation triggers
- Default AI provider affecting generated content style
- UI flows

**Users accept**:
- Upgrade failure auto-rollback to pre-upgrade backup (M10), but no 100% guarantee
- Compatibility issues may surface within 30 days post-upgrade, user-monitored
- Author may **force-upgrade** in critical security scenarios; refusal = License revocation

### 9. Binding Force

Using the product (installing · launching · activating License) = **full acceptance** of this disclaimer. If not accepted, stop use immediately and contact support for refund per [USER-AGREEMENT.md](./USER-AGREEMENT.md) §3.

Chinese and English versions are equally binding. In case of ambiguity, the Chinese version prevails.

---

_Last updated 2026-04-21 · Aligned with v1.0.0-rc3.1_
