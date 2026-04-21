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

# WAhubX Pilot 合作协议 · Pilot Agreement

> 发给 pilot 试用客户 · 签订后生效
> 最后更新 · 2026-04-21 · 对齐 v1.0.0-rc3.1

---

## 中文版

### 1. 双方

- **甲方 (作者 · Licensor)**: Bryan Geh · WAhubX 作者
- **乙方 (Pilot 客户 · Pilot Customer)**: _______________________ (填公司名或姓名)
  - 联系人: _______________________
  - 邮箱: _______________________
  - WhatsApp / Telegram: _______________________

### 2. Pilot 性质与期限

2.1 **Pilot 目的**: 乙方作为 WAhubX v1.0 发布前的早期测试客户 · 协助甲方验证产品在真实马华电商 / 私域运营场景下的可用性 · 收集反馈用于 GA 版本迭代.

2.2 **Pilot 期限**: 建议 **4 至 8 周** · 具体起止日期:
- 起始: _______________________
- 结束: _______________________
- 如需延期 · 任一方邮件请求 · 双方确认延期时长

2.3 **Pilot 阶段划分** (甲方内部分波次):
- **Wave 1 · RC 预览** · 看文档 + 跑 validate-env · 不真装 · 纯提反馈
- **Wave 2 · GA Soft Launch** · 真 installer · 跑 1 号养号 · 周 check-in
- **Wave 3 · Scaled Pilot** · 多号 (3-10) · 完整部署

乙方所属 Wave: _______ (由甲方填定)

### 3. Pilot 特别权益 · 费用

3.1 **License 费用**: **Pilot 期内免费**. 甲方向乙方提供 License Key · 绑定乙方 1 台指定机器.

3.2 **运营成本自理** (均为可选 · 不配置也能跑):
- 代理费 (~USD $40-100/月 · 若选配)
- AI API 费 (~USD $5-50/月 · 若选配)
- ComfyUI 本地部署硬件 (若选 Mode B1)

具体配置见 [DEPLOYMENT-MODES.md](../user-guide/DEPLOYMENT-MODES.md).

3.3 **转正优惠** (Pilot 期满 · 乙方转正式客户):
- **价格锁定** · 乙方可以 Pilot 期商务报价 · 锁定 **首 2 年** 续费价格 · 不随市场调价
- **免费升级** · 乙方享有所有 v1.x 版本免费升级权
- **优先功能投票** · 乙方在 V1.1 功能路线图投票中有加权投票权
- v2.0 major upgrade 时 · **50% 迁移折扣**

3.4 **Pilot 结束后不转正**: 乙方有权自由选择不转正 · 无违约责任. License 立即吊销 · 乙方删除本机软件.

### 4. 乙方反馈义务

4.1 **每周 Check-in**:
- **频次**: 每周 1 次 · 时长 30 分钟
- **方式**: 视频会议 (Zoom / Google Meet) 或电话
- **内容**: 使用频次 / 功能命中 / 遇到问题 / 建议改进
- **甲方记录**: 经乙方同意后 · 会议 summary 归档

4.2 **每周问卷** (若跳过 check-in):
- 按 [docs/pilot/FEEDBACK-COLLECTION.md](../pilot/FEEDBACK-COLLECTION.md) §3 的 5 问问卷填写
- 10 分钟完成 · 发回客服邮箱

4.3 **连续 2 周未反馈** · 甲方发书面提醒 · 再 1 周仍无响应 · 视为放弃 Pilot 资格 · 协议自动终止.

### 5. Bug Report 协作

5.1 **报告格式**: 乙方发现 bug · 按 [docs/pilot/FEEDBACK-COLLECTION.md](../pilot/FEEDBACK-COLLECTION.md) §2 格式提交 · 含:
- 严重度 (崩溃 / 阻塞 / 不便 / 轻微)
- 复现步骤
- 环境 (Windows 版本 / 内存 / 代理 / AI 配置)
- 日志打包 (scripts/validate-env.ps1 输出 + data/logs/ 最近 50 行)
- 截图 (可选)

5.2 **响应 SLA**:
- **崩溃** (🔴) · 2 小时内响应 · 24 小时 hotfix 或回滚
- **阻塞** (🟠) · 24 小时内响应 · 1 周内 patch
- **不便** (🟡) · 3 天内响应 · 下一 M 版本修
- **轻微** (🟢) · 1 周内响应 · backlog

5.3 **Bug 修复致谢**: 乙方报告被采纳修复 · 甲方在 CHANGELOG 致谢 (乙方可选匿名或署名).

### 6. 数据收集同意

6.1 **甲方收集** (乙方 opt-in):
- 脱敏日志 (无 PII · 无消息内容)
- 使用频次统计 (功能命中率 · 按天聚合)
- 错误发生数据 (异常 stack · 无具体消息)
- 每周反馈问卷内容

6.2 **甲方不收集**:
- WhatsApp 消息原文或摘要
- 乙方的联系人列表
- 乙方业务的客户 PII
- 乙方的 AI API Key 明文

6.3 **数据使用目的**: 仅用于产品改进 · 不分发 · 不出售 · 不与第三方共享 · Pilot 期结束后 30 天内删除原始反馈数据 (脱敏统计数据可保留).

6.4 **乙方 opt-out 权**: 随时邮件撤回数据收集同意 · 甲方 7 天内停止收集 · 已收数据 30 天内删除.

### 7. 知识产权 · 保密

7.1 **甲方 IP**: WAhubX 软件 · 源码 · 架构 · 产品设计理念 · 均属甲方.

7.2 **乙方 IP**: 乙方自身业务数据 · 客户列表 · 运营策略 · 属乙方.

7.3 **保密义务** (双向):
- 乙方不得向第三方披露 WAhubX 内部技术细节 · 未发布功能 · 甲方商务策略
- 甲方不得向第三方披露乙方业务信息 · 客户列表 · 运营数据
- 保密义务在协议终止后持续 **24 个月**

7.4 **反馈建议的 IP**: 乙方提供的产品改进建议 · 如被甲方采纳 · 纳入 V1.1+ · 甲方拥有相关 IP · 无需支付乙方对价 (本条与 [USER-AGREEMENT.md](./USER-AGREEMENT.md) §6.3 一致).

### 8. 责任与免责

8.1 **Bug 导致的业务损失** (Pilot 特殊条款):
- Pilot 期内 · 任何 bug / 崩溃 / 功能失效 · 甲方**零赔付** · 仅承诺 §5.2 响应 SLA
- 乙方明确承诺自担此风险 · 理解 Pilot = early access

8.2 **WhatsApp 账号封禁**:
- 甲方不保证乙方 WhatsApp 账号在 Pilot 期内不被封
- 封号损失由乙方自担 (与 [DISCLAIMER.md](./DISCLAIMER.md) §2 一致)
- 但若甲方有明显过失 (如 dispatcher 代码 bug 导致短时发量过大) · 甲方**为该次封号提供 1 次免费 License 重绑新机会**

8.3 **第三方服务中断**:
- AI API / 代理商 / License VPS · 参 [DISCLAIMER.md](./DISCLAIMER.md) §4
- 甲方 VPS 下线 · 若为计划内维护 · 提前 24h 通知乙方
- 若为非计划故障 · 乙方本机 License 有 24 小时离线 grace

### 9. 终止条款

9.1 **任一方提前 7 天通知终止**:
- 邮件或 WhatsApp / Telegram 书面通知
- 无违约责任

9.2 **甲方可立即终止** (无通知期):
- 乙方违反 §7.3 保密义务
- 乙方违反 [DISCLAIMER.md](./DISCLAIMER.md) §6 红线行为

9.3 **终止后处置**:
- 甲方吊销 License Key · 乙方客户端 24h 内掉线
- 乙方在终止后 7 天内卸载软件 · 删除本机 WAhubX 全部文件
- 双方继续履行 §7.3 保密义务 (持续 24 个月)
- 已收集反馈数据 · 甲方按 §6 处理

### 10. Pilot → V1.0 转正路径

10.1 **Pilot 期满前 2 周** · 甲方向乙方发 "Pilot 总结问卷" (见 [docs/pilot/FEEDBACK-COLLECTION.md](../pilot/FEEDBACK-COLLECTION.md) §6).

10.2 乙方填写问卷 · 勾选:
- [ ] 转正式客户 · 签 [USER-AGREEMENT.md](./USER-AGREEMENT.md) · 购买 License
- [ ] 暂不转正 · 感谢 Pilot 体验
- [ ] 考虑中 · 希望延期 Pilot 2-4 周再决定

10.3 **转正优惠执行**:
- 乙方签订正式 [USER-AGREEMENT.md](./USER-AGREEMENT.md) 时 · 甲方按 §3.3 约定锁定价格 + 赠送 v1.x 免费升级权
- 商务合同列明具体数字

10.4 **Testimonial 授权** (可选):
- 若 Pilot 体验良好 · 甲方可邀请乙方授权 2-3 句感言用于:
  - 官网 testimonial 区
  - 后续客户招募邮件引用
  - Case study 长文 (若乙方同意深度采访)
- 乙方可选实名或化名 · 或拒绝

### 11. 争议解决

11.1 适用 **马来西亚法律**.

11.2 争议处理顺序:
- 协商 30 天
- AIAC 吉隆坡仲裁
- 吉隆坡高等法院强制执行

(与 [USER-AGREEMENT.md](./USER-AGREEMENT.md) §9 一致)

### 12. 签字页

签订本 Pilot 协议 · 乙方确认已阅读并同意:

- [ ] 本 Pilot 协议全部条款
- [ ] [DISCLAIMER.md](./DISCLAIMER.md) 免责声明
- [ ] [USER-AGREEMENT.md](./USER-AGREEMENT.md) 用户使用协议 (转正后生效)
- [ ] [docs/KNOWN-LIMITATIONS-V1.md](../KNOWN-LIMITATIONS-V1.md) V1 已知限制清单

---

**甲方签字**: _______________________
Bryan Geh · WAhubX 作者
日期: _______________________

**乙方签字**: _______________________
(公司名 / 法人代表 / 手写签字 + 盖章)
日期: _______________________

---

## English Version

### 1. Parties

- **Party A (Licensor)**: Bryan Geh · Author of WAhubX
- **Party B (Pilot Customer)**: _______________________

### 2. Pilot Nature and Term

- **Duration**: 4-8 weeks (adjustable by mutual email)
- **Wave**: 1 (RC preview) / 2 (GA Soft Launch) / 3 (Scaled Pilot)

### 3. Special Benefits · Fees

- **License fee**: **Free during Pilot**
- **Third-party costs self-borne** (all optional): proxy (~USD $40-100/mo), AI API (~USD $5-50/mo)
- **Post-Pilot benefits if converting to paid**:
  - Price locked for **first 2 years** renewal
  - Free upgrade to all v1.x versions
  - **Weighted vote** on V1.1 roadmap
  - **50% discount** on v2.0 major upgrade
- Party B may choose not to convert · no penalty · License revoked

### 4. Party B's Feedback Obligation

- **Weekly 30-min check-in** (video call / phone) · OR 5-question form in [FEEDBACK-COLLECTION.md](../pilot/FEEDBACK-COLLECTION.md) §3
- **2 weeks no feedback** · warning · 1 more week · Pilot terminated

### 5. Bug Report Collaboration

- Report per [FEEDBACK-COLLECTION.md](../pilot/FEEDBACK-COLLECTION.md) §2 format
- **SLA**: Crash 2h/24h · Blocker 24h/1wk · Inconvenient 3d/next M · Minor 1wk/backlog
- Acknowledged in CHANGELOG (anonymous or named · Party B's choice)

### 6. Data Collection Consent

- **Collect** (with opt-in): anonymized logs, usage stats, error stacks, weekly forms
- **NOT collect**: message content, contact lists, customer PII, AI API keys
- **Purpose**: product improvement only · no resale · no third-party sharing
- **Retention**: original feedback deleted 30 days post-Pilot
- **Opt-out**: anytime by email · 7-day stop · 30-day delete

### 7. IP · Confidentiality

- Licensor IP: WAhubX software / source / design
- Licensee IP: own business data / customer lists / strategies
- **NDA** (bilateral) persists **24 months** post-termination
- Feedback adopted by Licensor → Licensor's IP (no compensation to Licensee)

### 8. Liability

- **Pilot bug losses**: zero payout · only §5 SLA commitments
- **WhatsApp bans**: Licensee bears · UNLESS clear Licensor negligence (e.g. dispatcher bug) · then **1 free License rebind** offered
- **Third-party outages**: per [DISCLAIMER.md](./DISCLAIMER.md) §4

### 9. Termination

- Either party: 7-day notice
- Licensor immediate (on NDA breach or red-line use)
- Post-termination: License revoked · Party B uninstalls in 7 days · NDA continues 24 months

### 10. Pilot → V1.0 Conversion

- 2 weeks before Pilot end · Party A sends summary questionnaire
- Party B: convert / decline / request extension
- Conversion: sign [USER-AGREEMENT.md](./USER-AGREEMENT.md) · price locked per §3
- Optional: 2-3 sentence testimonial · named or anonymous

### 11. Dispute Resolution

Malaysian law · negotiate 30 days → AIAC KL arbitration → KL High Court enforcement.

### 12. Signatures

By signing below, Party B confirms reading and accepting:
- [ ] This Pilot Agreement
- [ ] [DISCLAIMER.md](./DISCLAIMER.md)
- [ ] [USER-AGREEMENT.md](./USER-AGREEMENT.md) (effective upon conversion)
- [ ] [KNOWN-LIMITATIONS-V1.md](../KNOWN-LIMITATIONS-V1.md)

**Party A**: _______________________ · Bryan Geh · Date: _______________________

**Party B**: _______________________ · Date: _______________________

---

_Last updated 2026-04-21 · Aligned with v1.0.0-rc3.1_
