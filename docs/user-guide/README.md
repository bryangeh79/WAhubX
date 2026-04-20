# WAhubX 用户文档索引

> 最后更新 2026-04-20 · 对齐 v0.12.0-m7
> 所有文档中文 · 面向马来华人市场 pilot 客户 + 潜在客户

---

## 按角色分组

### 📦 终端用户 (日常运维)

首次上手 · 按这个顺序读:

1. **[INSTALLATION.md](./INSTALLATION.md)** · 完整安装部署手册
   - 系统要求 · 下载 · SmartScreen 处理
   - License 激活 · Admin 账号创建
   - 代理 / AI Provider 配置 (**全部可选**)
   - 注册第一个 WhatsApp · 启动 5 天养号
   - UI 8 个页面导览

2. **[QUICK-START.md](./QUICK-START.md)** · 30 分钟上手精简版
   - 有基础用户 · 最短路径
   - 从下载到跑通第 1 号

3. **[DEPLOYMENT-MODES.md](./DEPLOYMENT-MODES.md)** · 3 档部署模式选择
   - **Mode A · 全免费** ($0/月 · 技术验证)
   - **Mode B · 标准** (~$50-100/月 · pilot 推荐)
   - **Mode C · 高端** (~$150-300/月 · 规模化)
   - 每档组件选择 · 代理 / AI / TTS 搭配

4. **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** · 故障排查 checklist
   - 10 大常见问题 · 症状 · 诊断 · 修复
   - 日志位置指引
   - log 打包给客服的操作步骤

### 🛠 管理员 / 部署负责人

- **[../DEVELOPMENT.md](../DEVELOPMENT.md)** · 本地开发环境搭建 (开发者文档)
- **[../UPGRADE.md](../UPGRADE.md)** · 升级流程 + E1/E2 recovery 路径
- **[../DAY5-SMOKE-RUNBOOK.md](../DAY5-SMOKE-RUNBOOK.md)** · 升级包 smoke 测试手册
- **[../RELEASE-V1.0.md](../RELEASE-V1.0.md)** · V1.0 GA 发布 checklist (17 节 · 170+ 项)
- **[../../installer/deps/FETCH-DEPS.md](../../installer/deps/FETCH-DEPS.md)** · 依赖二进制下载手册
- **[../M7-BUILTIN-SEED.md](../M7-BUILTIN-SEED.md)** · `_builtin` 素材生成流程
- **[../M7-COMPLETE.md](../M7-COMPLETE.md)** · M7 架构说明 + V1.1 债

**装机前脚本**:
- `scripts/validate-env.ps1` · 客户机 pre-flight 9 项检查
- `scripts/demo-fixtures.sql` · demo tenant + persona seed (dev UI 展示用)
- `installer/scripts/verify-deps.ps1` · release build 前 deps 齐全检查

### 🤝 Pilot 联系人 / 销售

- **[../pilot/RECRUITMENT-PACK.md](../pilot/RECRUITMENT-PACK.md)** · Pilot 客户招募包
  - 理想客户画像 · 招募渠道
  - 邀约邮件模板 (中 + 英)
  - 合同模板 (**需法律审阅**)
  - 报价梯度 (Free / Standard / Premium pilot)
- **[../pilot/FEEDBACK-COLLECTION.md](../pilot/FEEDBACK-COLLECTION.md)** · 反馈收集模板
  - 安装反馈表 (10 问 · Google Form)
  - Bug Report 格式
  - 每周 Check-in 问卷 (5 问)
  - 日志收集指引
- **[ONBOARDING-VIDEO-SCRIPT.md](./ONBOARDING-VIDEO-SCRIPT.md)** · 3-5 分钟视频分镜
  - 5 scenes · 每 scene 画面 + 旁白 + 截图需求
  - 拍摄技术建议 (录屏 / 剪辑工具)

### ⚠ 所有角色必读

- **[../KNOWN-LIMITATIONS-V1.md](../KNOWN-LIMITATIONS-V1.md)** · V1 已知限制
  - 9 条核心限制 + 6 条被误解为 bug 的正常降级
  - 影响 · 规避 · V1.1 修复计划

---

## 核心原则 (产品设计哲学)

### 1. 你只需买 License

产品能跑的**必需清单**只有:
- License Key (向我们购买)
- Windows 机器 · SIM · 网络 (你自备)

**其他全部可选**. 每处付费 / API Key / 服务 · 我们都明确标 "可选" + 给免费替代方案.

### 2. 三维降级 · 永不崩

- AI 关 → 用 script 原文 (不崩)
- 图片池空 → 纯文本 status (不崩)
- 代理断 → 本机直连 (不崩 · 只是账号风险升)

这是**产品按设计行为** · 不是故障.

### 3. 本地部署 · 数据不离机

- WhatsApp session + 消息 + 素材 · 全在你本地 `C:\WAhubX\data\`
- 我们只保留 VPS 上的 License 状态
- 遵守马来西亚 PDPA

### 4. 硬件绑定 · 换机器需走 recovery

License 绑机器码. 换硬件有 3 条 recovery 路径 (见 TROUBLESHOOTING §3). Pilot 客户务必**装机第 1 天就做一次 `.wab` 备份**.

---

## 文档地图

```
docs/
├── user-guide/              ← 本目录 · 终端用户文档
│   ├── README.md              ← 你在这里
│   ├── INSTALLATION.md        ← 完整安装手册
│   ├── QUICK-START.md         ← 30 min 上手
│   ├── DEPLOYMENT-MODES.md    ← 3 档部署模式
│   ├── TROUBLESHOOTING.md     ← 故障排查
│   └── ONBOARDING-VIDEO-SCRIPT.md ← 视频分镜
│
├── pilot/                   ← Pilot 客户管理
│   ├── RECRUITMENT-PACK.md    ← 招募包
│   └── FEEDBACK-COLLECTION.md ← 反馈收集
│
├── KNOWN-LIMITATIONS-V1.md  ← V1 已知限制 (所有人读)
│
├── DEVELOPMENT.md           ← 开发者本地搭建
├── UPGRADE.md               ← 升级流程
├── DAY5-SMOKE-RUNBOOK.md    ← M11 升级 smoke
├── M7-BUILTIN-SEED.md       ← 素材 seed
├── M7-COMPLETE.md           ← M7 架构说明
├── HANDOFF_2026-04-20.md    ← M8 交接 (历史)
└── M1_ACCEPTANCE.md         ← M1 验收 (历史)
```

---

## 版本信息

| 项 | 值 |
|---|---|
| 最新代码 tag | `v0.12.0-m7` |
| 产品版本 | v1.0 (pilot-ready · 非 GA) |
| 文档起草日 | 2026-04-20 |
| 下一计划 | V1.1 · 基于 pilot 反馈迭代 ~8 周后 GA |

---

## 反馈渠道

文档有错 · 说不清 · 或你希望新增一节:

- 直接邮件 / WhatsApp 客服
- Pilot 客户用 FEEDBACK-COLLECTION.md 的 Bug Report 格式
- 非紧急建议 · 每周 check-in 时提

我们收集反馈 · 每 2 周统一更新文档.

---

_"让每个马华生意人都能用上 · 不靠预算多少决定" —— WAhubX 团队_
