# Pilot 反馈收集模板

> 用于 pilot 期间结构化收集反馈
> 格式: Google Form / Typeform / 纯邮件都行

---

## 1. 安装反馈表 (10 问 · Day 1 装机后填)

### Google Form 可直接复制字段

**1. 你的姓名 / 公司名**
- 短答

**2. 装机耗时**
- 单选: < 15 min / 15-30 min / 30-60 min / > 60 min

**3. 安装过程顺不顺?**
- 评分 1-5 (1=极卡 / 5=丝滑)

**4. SmartScreen 警告你是否顺利绕过?**
- 单选: 是 · 一次成功 / 绕了 2-3 次 / 完全没绕过需客服 / 其他 _______

**5. License 激活成功了吗?**
- 单选: 一次成功 / 重试 1-2 次成功 / 失败多次后成功 / 至今没成功

**6. 如果激活有问题 · 什么错误?**
- 长答

**7. 代理配置完成了吗?**
- 单选: 已配 · 测试通 / 已配 · 测试不通 / 跳过 (用家庭网络) / 还没配

**8. AI Provider 你选的是?**
- 多选: 不配 · 全免费 / DeepSeek / OpenAI / Claude / Gemini / Replicate / ElevenLabs / 其他 _______

**9. 第一个 WhatsApp 注册成功了吗?**
- 单选: 一次成功 / 重试成功 / 失败需客服 / 还没试

**10. 如果能改 1 件事让装机体验更好 · 是什么?**
- 长答 (关键字段 · 决定下版本优化方向)

---

## 2. Bug Report 格式

客户发 bug 时 · 请他们填:

```markdown
## Bug Report

### 基本信息
- 客户: _______ (公司/姓名)
- 日期: _______
- 严重度: 崩溃 / 阻塞 / 不便 / 轻微
  (崩溃 · 软件挂了 不能用)
  (阻塞 · 某功能完全不能用 但软件还跑)
  (不便 · 功能可用但体验差)
  (轻微 · 小瑕疵)

### 症状
[描述 1-3 句 · 你看到了什么]

### 复现步骤
1. [点哪里]
2. [填什么]
3. [按什么]
4. [结果: 看到什么错]

### 环境
- Windows 版本: (运行 `winver` 看)
- 内存 / 硬盘: (任务管理器看)
- WAhubX 版本: (About 页)
- 代理: 有 / 无
- AI Provider: (已配哪些)

### 已尝试
[你自己试过什么 · 都没效]

### 日志 · 截图
- 日志: [附件 zip · 或从 TROUBLESHOOTING.md §日志打包步骤]
- 截图: [可选]

### 期望
[你希望的正确行为]
```

### 严重度分级 · 客服优先级

| 级别 | 响应 | 修复目标 |
|---|---|---|
| 🔴 崩溃 | 2h 内响应 | 24h 内 hotfix 或回滚 |
| 🟠 阻塞 | 24h 内响应 | 1 周内 patch |
| 🟡 不便 | 3 天内响应 | 下一 M 版本 |
| 🟢 轻微 | 1 周内响应 | 排入 backlog |

---

## 3. 每周 Check-in 问卷 (5 问 · 10 min)

### 每周一发 (邮件或 Telegram / WhatsApp)

```
[客户名] · Week [N] Check-in

Hi [名字] · 又到每周反馈时间. 5 个问题 10 分钟:

1. 本周实际用了吗? (完全没用 / 偶尔 / 每天)

2. 用到了哪些功能? (可多选)
   [ ] 注册新号
   [ ] 养号自动跑
   [ ] 手动发消息 (接管)
   [ ] 看 Health / Dashboard
   [ ] 配 Script
   [ ] 其他 _______

3. 本周遇到最烦的问题是? (短答 1-2 句)

4. 养号效果如何? (跑了 [X] 个号 · 封了 [Y] 个?)

5. 1-10 推荐指数 · 你会推荐给同行吗?
   (1=绝不 / 10=立刻)

Bonus · 有什么希望我们优先加的功能?

谢谢 · [你名字]
```

---

## 4. 日志收集指引 (客户自助版)

### 客户要做的 3 步

**Step 1 · 打包 log**

在 WAhubX 装目录 (默认 `C:\WAhubX\`) 开 PowerShell:

```powershell
$zip = "$env:USERPROFILE\Desktop\wahubx-logs-$(Get-Date -Format yyyyMMdd-HHmm).zip"
Compress-Archive -Path "C:\WAhubX\data\logs\*","C:\WAhubX\logs\*" -DestinationPath $zip
Write-Host "Log 打包完成: $zip"
```

Desktop 会出现 `wahubx-logs-YYYYMMDD-HHmm.zip`.

**Step 2 · 检查脱敏**

打开 zip 里的最新 `backend-*.log` · 搜这几个关键字 · 有则手删:
- `WAHUBX-` (License Key 前缀 · 应脱敏但 double-check)
- `sk-` / `claude-` / `gemini-` (API Key 前缀)
- `+60` 真实手机号 (如果不希望给客服)

**Step 3 · 发给客服**

- WhatsApp / Telegram · 附件上传 .zip
- 或邮件: `support@[你域名]` · 主题 `[客户名] Bug Log YYYY-MM-DD`

### 客服端接收

- 收到 log 先本地解 · **绝不转发 · 绝不上传云**
- 处理完 (1 周) · 删除原始 log
- 提取的信息只留聚合数据 (如 "5 家客户遇到 X 错误")

---

## 5. 自动化收集 (V1.1 路线 · 暂不实装)

V1 手动反馈 · V1.1 考虑:
- 用户点击 "帮我们改进" 按钮 · 自动打包 log · upload 到 VPS
- 聚合 Sentry / LogRocket 类似遥测
- 明确告知用户 · 开关默认关

V1 阶段保持**纯手动** · 隐私优先.

---

## 6. Testimonial 收集表 (Pilot 结束时)

```
WAhubX Pilot 总结问卷 · [客户名]

1. 你运营多少 WhatsApp 号?
   Pilot 前: ___
   Pilot 后: ___

2. 平均每号月产出?
   Pilot 前: RM ___
   Pilot 后: RM ___

3. Pilot 期内被封号数?
   ___ 个

4. 最满意的 3 个点?
   a. _______
   b. _______
   c. _______

5. 最不满意的 3 个点?
   a. _______
   b. _______
   c. _______

6. 会付费吗 (Pilot 结束后)?
   [ ] 立刻续费 Pro/Enterprise
   [ ] 考虑中 · 等哪个功能补上
   [ ] 降级到 Basic 就够了
   [ ] 暂不付费

7. 会推荐给同行吗?
   [ ] 已推荐 (__人)
   [ ] 愿意推荐但暂未
   [ ] 还不确定
   [ ] 不推荐

8. 2-3 句使用感受 (可用于官网 testimonial · 可化名):
   _______

9. 同意我们用你 quote 做案例吗?
   [ ] 同意 · 用真名
   [ ] 同意 · 化名 (建议名: _______)
   [ ] 不同意公开使用
```

---

## 7. 反馈数据处理 workflow

### 数据流

```
客户反馈
    ↓
[收件箱: 邮件 / WhatsApp / Telegram]
    ↓
分拣 (每周 30 min · 创始人自己做)
    ↓ 根据严重度
┌───┬───┬───┐
🔴 bug  🟡 feature  🟢 praise
    ↓       ↓         ↓
 GitHub   backlog   testimonial
  Issues  doc       池
    ↓
优先级排序 · 下一 sprint
```

### 工具推荐 (pilot 期 · 别上复杂 PM 工具)

- GitHub Issues · Bug + Feature request
- Notion / Airtable · testimonial 池
- Google Sheet · 每周 check-in 回答聚合

不要用:
- Jira (太重)
- Slack 讨论组 (反馈沉淀不下来)

---

_最后更新 2026-04-20_
