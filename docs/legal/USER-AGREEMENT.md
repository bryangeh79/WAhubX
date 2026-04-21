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

# WAhubX 用户使用协议 · User Agreement

> 激活 License 时 · 用户须点击同意 · 方可完成激活
> 最后更新 · 2026-04-21 · 对齐 v1.0.0-rc3.1

---

## 中文版

### 1. 协议双方 · Parties

- **甲方 (Licensor / 许可方)**: Bryan Geh · WAhubX 作者
- **乙方 (Licensee / 被许可方)**: 购买 License Key 的自然人或法人

本协议自乙方激活 License 之日起生效 · 至 License 到期 · 被吊销 · 或乙方主动终止使用之日结束.

### 2. License 发放与激活

2.1 **套餐与槽位上限**: 乙方通过商务渠道向甲方购买下列 License 之一:
- **Basic** · 10 槽位
- **Pro** · 30 槽位
- **Enterprise** · 50 槽位

2.2 **激活机制**: 乙方在其 Windows 机器上输入 License Key 执行激活. 激活将:
- 向甲方 VPS 服务端验证 Key 合法性
- 记录乙方**机器指纹** (CPU ID · 硬盘 Serial · 网卡 MAC 等组合哈希)
- 在乙方本机建立首个 Admin 账号
- 将 License 状态设为 "bound-to-<machine-fingerprint>"

2.3 **单机绑定**: 1 个 License 仅可绑定 1 台机器. 同一 License 在第 2 台机器尝试激活会被拒绝.

2.4 **机器变更 Recovery**: 乙方更换硬件 / 重装 Windows 导致指纹变化时 · 可通过下述 3 路径恢复:
- 使用备份的 `APP_ENCRYPTION_KEY` · 跑 `restore-env-key.bat`
- 导入此前导出的 `.wab` 全量备份
- 联系甲方客服 · 吊销旧绑定 · 重新激活 (历史 WhatsApp session 丢失)

详见 [docs/UPGRADE.md](../UPGRADE.md) §E2.

### 3. 费用 · 退款

3.1 **License 费用**: 按商务合同约定 · 在签约时一次性或分期支付. 收款币种 · 具体金额 · 由商务合同约定.

3.2 **退款政策**:
- 激活 **7 天内** · 乙方可无条件申请全额退款 · 退款后 License 吊销
- 激活 **30 天内** · 乙方可申请按未使用时间比例退款 · 扣除 20% 服务费
- 激活**超 30 天** · 除甲方明显违约外 · 不予退款

3.3 **续费**: 若 License 为订阅制 (年付 / 月付) · 乙方可在到期前 30 天申请续费. 续费价格以续费当日商务报价为准.

### 4. 使用范围与限制

4.1 **准许用途**:
- 乙方自有业务的 WhatsApp 客户运营
- 合法的私域营销 · 客服 · 群发通知
- 乙方雇佣的员工在乙方授权下操作

4.2 **禁止用途** (触及**即刻吊销 License · 不退款**):
- 转售 · 分发 · 出借 License 给非乙方的第三方
- 反编译 · 破解 · 绕过 License 验证或 Ed25519 签名验证
- 用于 [DISCLAIMER.md](./DISCLAIMER.md) §6 所列的 7 类红线行为
- 将本产品的核心功能用于开发竞品

4.3 **违规吊销流程**:
- 甲方发现违规 · 邮件通知乙方 48 小时内整改
- 整改不到位 · 甲方 revoke License Key · 客户端 24h 内掉线
- 乙方不服 · 可在吊销后 30 天内申诉 · 甲方复核并回复

### 5. PDPA 2010 合规声明 (马来西亚个人数据保护法)

甲方作为 Data User (数据使用者) 在 PDPA 2010 下承担以下义务:

5.1 **数据收集告知** (Notice and Choice Principle):
- **甲方 VPS 收集**: 乙方邮箱 · 机器指纹 · 激活 IP · 激活时间戳 · License Key 关联记录
- **不收集**: 乙方的 WhatsApp 消息内容 · 联系人 · 业务数据 (本地部署 · 数据不离机)

5.2 **使用目的** (General Principle):
- License 合法性验证
- 防止滥用 / 盗版
- 客服技术支持
- 产品改进 (聚合脱敏数据)

5.3 **第三方共享** (Disclosure Principle):
- 甲方**不**主动向第三方披露乙方数据
- **例外**: 乙方自主配置的 AI Provider (OpenAI / Anthropic / Google / DeepSeek / Replicate 等) · 在乙方启用后 · 其消息片段将发送至所选 AI 服务商 · 受该服务商隐私条款管辖
- 乙方在启用任何 AI Provider 时 · UI 会明示数据传输目的地

5.4 **安全保护** (Security Principle):
- License 数据采用 HTTPS 传输
- 机器指纹以 SHA-256 单向哈希存储
- 乙方本机敏感数据 (AI Keys · WhatsApp session) 使用 AES-256-GCM 加密 · 密钥机器绑定

5.5 **保留期** (Retention Principle):
- License revoke 后 · 甲方在 30 天内删除乙方绑定记录
- 甲方服务端日志保留 90 天后自动清理

5.6 **乙方权利** (Access · Correction · Erasure):
- 乙方可随时邮件申请查看甲方持有的其数据摘要
- 乙方可申请更正错误信息
- 乙方可申请删除数据 (意味着 License 同时终止)
- 乙方可撤回同意并投诉至马来西亚个人资料保护局 (JPDP)

### 6. 知识产权

6.1 **软件归属**: WAhubX 软件 · 源代码 · UI 设计 · 文档 · 品牌 · 商标 · 均归甲方所有. 乙方仅获得使用许可 · 无所有权.

6.2 **乙方素材**: 乙方上传或生成的素材 (persona · avatar · voice · image) · 归乙方所有. 甲方仅在提供产品服务所必需的范围内 · 不可撤销地 · 非独占地 · 免费使用.

6.3 **反馈建议**: 乙方提供的产品改进反馈 · 如被甲方采纳 · 纳入后续版本 · 甲方拥有相关 IP · 无需向乙方支付对价.

### 7. 责任限制

7.1 **甲方责任上限**: 任何情况下 · 甲方因本协议承担的总责任上限 **≤ 乙方已向甲方支付的 12 个月内的 License 费用总额**.

7.2 **不担保项** (照 [DISCLAIMER.md](./DISCLAIMER.md) §5):
- WhatsApp 账号可用性
- AI 生成内容准确性 / 合法性
- 第三方服务稳定性
- 产品无 bug · 无中断

7.3 **间接损失**: 甲方不对任何 · 乙方业务损失 · 利润损失 · 机会损失 · 名誉损失 · 等间接或后果性损害承担责任.

### 8. 服务终止

8.1 **乙方主动终止**:
- 乙方可随时停止使用 · 卸载软件
- 主动终止不影响已支付费用的退款政策 (§3.2)

8.2 **甲方终止**:
- 乙方违反 §4.2 禁止用途
- 乙方欠费超过 30 天
- 甲方业务终止 · 需提前 60 天邮件通知所有乙方

8.3 **数据处置**:
- 终止后 · 乙方应在 30 天内删除本机 WAhubX 全部文件
- 乙方的 WhatsApp session 数据 · 乙方自行决定保留或删除
- 甲方 VPS 上的乙方激活记录 · 30 天后删除

### 9. 争议解决 (马来西亚管辖)

9.1 本协议适用 **马来西亚法律** 解释 · 履行 · 争议解决.

9.2 发生争议 · 按以下顺序处理:
- **第 1 步 · 协商** · 任一方发现争议 · 应首先邮件通知对方 · 30 天内协商解决
- **第 2 步 · 仲裁** · 协商不成 · 提交 **亚洲国际仲裁中心** (Asian International Arbitration Centre · AIAC) · 按其 2018 年仲裁规则 · 在 **吉隆坡** 进行仲裁 · 仲裁语言为中文或英文 (双方约定)
- **第 3 步 · 诉讼** · 仲裁执行问题 · 提交 **吉隆坡高等法院** 管辖

### 10. 协议变更

10.1 甲方有权单方修订本协议. 重大变更 · 甲方需至少提前 30 天邮件通知乙方.

10.2 乙方不接受变更的 · 可按 §3.2 申请退款 · 退款后协议终止.

10.3 继续使用产品 (激活 / 升级后) · 视为接受新版本协议.

### 11. 其他条款

11.1 **完整协议**: 本协议与 [DISCLAIMER.md](./DISCLAIMER.md) 共同构成双方完整合意 · 取代之前所有口头或书面约定.

11.2 **可分割性**: 本协议某条款被判无效 · 其他条款仍具约束力.

11.3 **通知**: 双方联系邮箱以商务合同约定为准 · 邮件送达即视为有效通知.

11.4 **语言**: 中文版与英文版同等效力. 歧义以中文版为准.

---

## English Version

### 1. Parties

- **Licensor**: Bryan Geh · Author of WAhubX
- **Licensee**: Natural person or legal entity who purchases a License Key

Effective from activation date · terminates upon License expiry, revocation, or voluntary cessation.

### 2. License Issuance and Activation

2.1 **Plans and Slot Limits**: Basic (10) / Pro (30) / Enterprise (50) slots.

2.2 **Activation**: Enter License Key on Windows machine. Activation:
- Verifies Key with Licensor's VPS
- Records **machine fingerprint** (hash of CPU ID, disk serial, MAC etc.)
- Creates first Admin account locally
- Sets License state "bound-to-<fingerprint>"

2.3 **Single-machine binding**: 1 License = 1 machine. Second-machine activation rejected.

2.4 **Hardware change recovery**: 3 paths (see UPGRADE.md §E2).

### 3. Fees · Refund

3.1 License fee per business contract.

3.2 **Refund policy**:
- Within **7 days** of activation · unconditional full refund · License revoked
- Within **30 days** · pro-rata refund minus 20% service fee
- After **30 days** · no refund except for Licensor's material breach

3.3 **Renewal**: subscription plans allow renewal within 30 days of expiry at current market rate.

### 4. Usage Scope and Restrictions

4.1 **Permitted**: Own-business WhatsApp customer operations · legal private-domain marketing · authorized employees.

4.2 **Prohibited** (triggers **immediate revocation · no refund**):
- Resell / distribute / lend License to third parties
- Decompile / crack / bypass License or Ed25519 signature verification
- Any of 7 red-line behaviors in DISCLAIMER.md §6
- Using core features to develop competing products

4.3 **Violation revocation**: 48h email warning → revoke → 30-day appeal window.

### 5. PDPA 2010 Compliance

Licensor acts as Data User under Malaysia's Personal Data Protection Act 2010:

5.1 **Notice**: VPS collects email, fingerprint, activation IP, timestamp, License Key. Does NOT collect WhatsApp messages, contacts, business data.

5.2 **Purpose**: License verification, abuse prevention, support, product improvement (aggregated anonymized).

5.3 **Third-party disclosure**: No active disclosure. Exception: Licensee-configured AI Providers receive message fragments after explicit opt-in.

5.4 **Security**: HTTPS, SHA-256 hashed fingerprints, AES-256-GCM encrypted local sensitive data.

5.5 **Retention**: License records deleted 30 days post-revocation; server logs auto-purge after 90 days.

5.6 **Rights**: Access summary, request correction, request deletion (terminates License), withdraw consent, file complaint with JPDP Malaysia.

### 6. Intellectual Property

6.1 Software / source / UI / docs / brand → Licensor.
6.2 Licensee-generated assets → Licensee. Licensor receives non-exclusive royalty-free license for service provision.
6.3 Feedback adopted by Licensor → IP belongs to Licensor · no compensation to Licensee.

### 7. Limitation of Liability

7.1 **Liability cap**: Licensor's total liability ≤ **12 months of License fees paid by Licensee**.

7.2 **No warranty on**: WhatsApp account availability · AI content · third-party services · bug-free operation.

7.3 **No indirect damages**: lost profits, business interruption, opportunity cost, reputation damage.

### 8. Termination

8.1 **Licensee voluntary**: anytime uninstall; refund per §3.2.

8.2 **Licensor terminates**: §4.2 violation · 30+ days overdue · Licensor ceases business (60-day notice).

8.3 **Data disposition**: 30 days post-termination · Licensee deletes WAhubX files · Licensor deletes activation records.

### 9. Dispute Resolution (Malaysia Jurisdiction)

9.1 Governing law: **Malaysian law**.

9.2 Procedure:
- **Step 1 · Negotiation**: email notice, 30 days
- **Step 2 · Arbitration**: **AIAC Kuala Lumpur** under 2018 Rules · Chinese or English
- **Step 3 · Enforcement**: **Kuala Lumpur High Court**

### 10. Agreement Changes

30-day email notice for material changes. Non-acceptance → refund per §3.2. Continued use = acceptance.

### 11. Miscellaneous

11.1 Integrated with DISCLAIMER.md · supersedes prior agreements.
11.2 Severability preserved.
11.3 Notice by contracted email = valid.
11.4 Chinese prevails on ambiguity.

---

_Last updated 2026-04-21 · Aligned with v1.0.0-rc3.1_
