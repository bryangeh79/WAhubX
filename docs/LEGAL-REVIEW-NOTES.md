# WAhubX Legal Review Notes

> 受众: 马来西亚本地律师 + 产品方商务决策人
> 起草 2026-04-21 · Cascade [42] · 非法律专业起草 · 提供审阅重点
> 触发: RELEASE-V1.0.md §14 · `docs/pilot/RECRUITMENT-PACK.md` §5

---

## ⚠ 本文档定位

本文档**不是法律意见**. 也**不是合同文本**.

目的: 给律师审阅时一份"**工程方视角的关注点清单**" · 帮律师快速定位哪些条款对产品架构最关键. 最终合同的法律语言 · 条款具体数字 · 权责分配 · 仍由律师起草 + 双方商务定.

---

## 必审条款 (6 大类)

### 1. 封号免责

**背景**: WAhubX 调用 WhatsApp 协议 (Baileys) · 自动化发消息. 此属 **WhatsApp ToS 灰色地带** · WhatsApp 可能封号客户号.

**关键问题**:
- 号被封 · 谁负责?
- 用户按我们指引操作 · 仍被封 · 我们赔吗?
- 如果用户违规 (e.g. 24h 发 500 条) · 我们免责吗?
- 赔付上限? (全额 / 订阅费 / 零?)

**工程方建议**:
- 声明: **WAhubX 是工具 · 不保证 WhatsApp 账号可用性**
- 区分: 按文档正常操作 vs 明显违规操作 (5 天养号未到自动发量)
- 产品做了 6 路防护 (dispatcher skip · health scorer · phase gate · dry_run · night window · takeover lock) · 已尽合理注意义务

### 2. License 吊销条款

**背景**: 超管可 revoke License · 违规使用时.

**关键问题**:
- "违规" 怎么定义? 需列黑名单行为:
  - 用于赌博 / 色情 / 诈骗 / 传销
  - 明知第三方代购 (非实际使用人)
  - 破解 / 反编译 / 绕过 License 验证
  - 传播 WAhubX 安装包给非客户
- 吊销是否退款? 何种条件下退?
- 吊销通知方式? (邮件 / 产品内 / 立即)
- 申诉机制? (误吊销 · 客户怎么反向提供证据)

**工程方建议**:
- 吊销 = License.revoked=true · 客户端 24h 内掉线
- 产品内 不主动告知吊销原因 (防钻空子) · 客户需邮件申诉
- 条款要明确"单方吊销权" + "退款政策"

### 3. 隐私数据 · PDPA 2010 合规

**背景**: 马来西亚 Personal Data Protection Act 2010 · 客户的 WhatsApp 消息 · 联系人 · 手机号都算 personal data.

**关键问题**:
- WAhubX 本地部署 · 数据在客户机器 · 但仍有:
  - 客户 WhatsApp 消息日志 (本地 `data/logs/`)
  - 客户 WhatsApp 联系人 (local DB)
  - 客户手机号 (License 激活时收集)
  - Machine fingerprint (License 绑定)
- License 服务端 (我们 VPS) 收集:
  - 客户邮箱
  - 客户所在 IP (激活时)
  - License Key 发放记录
  - 机器码 (bind)

**PDPA 7 原则必对齐**:
1. **General Principle** (数据处理需合法目的) ✓ 我们有 License 激活 + 服务提供
2. **Notice and Choice** (告知客户收集什么 · 怎么用) · **待写隐私政策文档**
3. **Disclosure** (不向第三方披露) ✓ 本地部署 · 无第三方共享 · 但 AI API 例外 (见 §4)
4. **Security** ✓ AES-256-GCM 加密 · bcrypt 密码 · HTTPS License API
5. **Retention** (不超期保留) · 待定 · 吊销后多久删客户数据?
6. **Data Integrity** (保持准确) · 客户自维护
7. **Access** (客户可查 + 修正) · 待实现 · 目前无 "导出我的数据" 按钮

**关键问题**:
- 数据本地化 · 是否需在马来境内 (PDPA 7 条: 不得传境外除非同等保护)?
- 客户数据访问权 / 删除权 · 如何响应客户要求?
- 第三方共享 (OpenAI / Anthropic / Google · Replicate · ElevenLabs): 客户发消息 → 我们的 system prompt → **是否构成数据跨境传输**?

**工程方建议**:
- 产品 + 合同**都**告知客户: 启用 AI 后 · 其 WhatsApp 消息片段会发给所选 AI provider
- 客户 opt-in 明示 · Settings 配 Key 时弹窗确认
- 隐私政策文档标注: AI provider 的 location (US / EU / Singapore 等)

### 4. 服务中断免责

**背景**: WAhubX 依赖第三方:
- **License 服务端 · 我们自运营** · 下线 = 所有客户 24h 后掉线
- **AI Provider · OpenAI/DeepSeek 等** · 如果他们挂了 · 文本 AI 不 work
- **Replicate** · AI 图片挂
- **代理商 · 客户自选** · 代理挂

**关键问题**:
- VPS License 宕机 · 我们赔多少? (时长 / 订阅月费抵扣 / 无赔?)
- 第三方 API 挂 · 我们是否负责? (明确"仅提供集成 · 不担保第三方稳定性")
- 我们主动关服务 (倒闭 / 转型) · 客户怎么办? (**关键** · 需有 escrow / 源码 releas 条款?)

**工程方建议**:
- 产品已有 24h offline grace (License 离线容忍)
- 第三方 API · 明确"客户自备 Key · 客户与 provider 合约自理"
- 合同加 escrow 条款争取客户信心

### 5. 升级拒绝权 · 版本锁定

**背景**: `.wupd` 升级 · 客户 UI 上传. 没自动推送. 但未来 V1.1 会自动.

**关键问题**:
- 客户可拒绝升级吗? (支持 "旧版本" 多久?)
- 我们能 "强制升级" 吗? (安全漏洞场景 · 必须让客户升?)
- 旧版本停止支持后 · 仍能激活吗?

**工程方建议**:
- V1 默认:客户**有权**拒绝升级 · 旧版持续可用 (只要 License 有效)
- 除非: critical 安全漏洞 (我们主观判断) · 可强制 · 或吊销旧版 License
- 合同明写"升级政策" + "旧版支持期"

### 6. Pilot 特别条款

**背景**: Pilot 期是早期客户 · 责权利与正式客户不同.

**关键条款**:
- **反馈义务** · Pilot 客户每周反馈 1 次 · 否则取消 Pilot 资格
- **数据收集同意** · Pilot 客户 opt-in 允许我们看 log (脱敏) · 供产品改进
- **Bug 不担责** · Pilot 期 bug 导致业务损失 · 我们零赔付
- **早期客户权益** · 终身 license / 前 N 年 discount / 免费升级到 v2?

**工程方建议**:
- Pilot 合同独立 · 别跟正式客户合同混
- "终身 license" 等承诺谨慎 · 产品 5 年后可能调价 · 留"重大变更重新协商"出口

---

## PDPA 深度合规清单

### 优先写入隐私政策文档 (docs/PRIVACY-POLICY.md · 待产出)

- [ ] 我们收集什么数据 (License 激活 · Machine FP · 服务端日志)
- [ ] 不收集什么 (WhatsApp 消息内容 · 联系人 · 手机号细节 · all local)
- [ ] 第三方共享 (AI provider 列表 · 其 privacy policy 链接)
- [ ] 数据保留期 (客户离开后 N 天删)
- [ ] 客户权利 · 查阅 · 修正 · 删除 · 撤回同意 · 投诉
- [ ] 跨境传输声明 (VPS 在哪? AI API 在哪?)
- [ ] 儿童数据 (我们不对 18 以下客户)
- [ ] 数据泄露响应 (24h / 72h 通知 客户 + PDP Commissioner)

### 产品技术需配合 (工程方 TODO V1.1)

- [ ] "导出我的数据" 按钮 (PDPA Access right)
- [ ] "删除我的数据" 按钮 (PDPA Erasure right)
- [ ] AI Provider 使用前 opt-in 确认弹窗 (明示数据传 US)
- [ ] 日志 · 30 天 auto-purge (Retention 原则)
- [ ] License 服务端 · 客户 deactivate 后 30 天删绑定记录

---

## Pilot 特别条款 draft (律师 refine)

```
Pilot 测试协议 · 特别条款

1. 反馈义务
   1.1 甲方 (客户) 每周至少提供一次使用反馈 · 格式按
       docs/pilot/FEEDBACK-COLLECTION.md 的模板
   1.2 连续 2 周未反馈 · 乙方 (我们) 有权书面通知终止 Pilot
   1.3 终止后 · 甲方 License 停用 · 已收集数据归档

2. 数据收集同意
   2.1 甲方同意乙方收集以下数据用于产品改进:
       - 脱敏日志 (无 PII)
       - 使用频次统计 (功能命中率)
       - 错误发生数据 (异常 stack trace · 无消息内容)
   2.2 乙方承诺不收集:
       - WhatsApp 消息原文
       - 客户联系人
       - 任何 PII
   2.3 甲方可随时 opt-out · 乙方 30 天内删除已收数据

3. Bug 不担责
   3.1 Pilot 期内软件 bug 导致的业务损失 · 乙方零赔付
   3.2 但乙方承诺 · 崩溃级 bug 24 小时内响应 · 1 周内 hotfix
   3.3 乙方发现 critical bug · 有权暂停 Pilot · 甲方同意

4. 早期客户权益
   4.1 Pilot 期满 · 甲方转正式客户 · 享受:
       - License 价格锁定 X 年 · 不随常规涨价
       - 免费升级到所有 v1.x 版本
       - v2.0 major upgrade 时 · 50% discount 迁移
   4.2 Pilot 期免费 License (不超 30 天)
```

---

## 合同草稿结构建议 (律师可直接用)

```
Pilot Agreement · WAhubX Pilot Testing

1.   甲乙方信息
2.   Pilot 期限 (建议 2-4 周)
3.   Pilot 交付物 (LicenseKey · docs · 客服 channel)
4.   使用许可 (地域 · 机器数 · 账号数)
5.   费用 (License 免 · 代理/AI 等第三方自费)
6.   Pilot 反馈义务 (见上)
7.   数据 / 隐私 (PDPA 对齐 · 见上)
8.   服务水平 / 免责
     - 非保证可用率
     - WhatsApp ToS 风险甲方自担
     - 第三方 API 稳定性甲方与 provider 自理
9.   知识产权
     - WAhubX 软件归乙方
     - 甲方反馈 · 若被采纳进产品 · 乙方拥有 · 无需支付甲方
10.  终止条款
     - 任何一方 7 天通知终止
     - 终止后 License revoke · 甲方卸载软件
11.  Pilot 后 · 转正式合同选项 (优惠价)
12.  争议解决
     - 适用马来西亚法
     - KL 仲裁 · AIAC 规则
13.  签字页
```

---

## 交付物清单 · 律师侧

完成后 · 需交给商务:

- [ ] **Pilot Agreement** (最终合同) · .docx + .pdf
- [ ] **Privacy Policy** · PDPA 对齐 · 中英双版
- [ ] **Terms of Service** (正式客户 · Pilot 后用)
- [ ] **EULA** (installer 内显示的 End User License Agreement · 精简版)
- [ ] **Data Processing Agreement** (若客户企业要求 · 加购)

---

## 预估工作量

- 律师审阅本文档 + 起草 5 份交付物: 2-3 周
- 来回 revise 1-2 轮: 1 周
- 总 · 3-4 周 · 与 installer 依赖下载工作平行

---

## 律师提问 checklist (节省时间)

建议律师首轮回复覆盖:

1. 马来西亚 PDPA 2010 · 本地部署软件商是否"Data User"?
2. WhatsApp ToS 条款 · 马来司法辖区对自动化工具有无专门立法?
3. AI API (OpenAI · Anthropic) 数据传输美国 · 是否需 PDPA 特别 disclosure?
4. Pilot 客户 "终身 license" 承诺的法律约束力 · 商业实践上如何退出?
5. "违规使用" 的穷尽列举 vs 开放定义 · 哪种在马国更有利?
6. License 吊销后的争议解决路径 · 客户小额纠纷怎么处理?

---

_最后更新 2026-04-21 · Cascade [42] · **非法律意见 · 仅供律师审阅参考**_
