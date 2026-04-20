# 部署模式 · 3 档阶梯 (Free / Standard / Premium)

> 所有付费组件均**可选** · WAhubX 核心产品不依赖
> 选择是成本 vs 账号质量的 trade-off · 客户自决

---

## TL;DR · 选哪个

| 场景 | 推荐 |
|---|---|
| 技术宅试用 · 1-2 号测试 · 零预算 | **Mode A · 全免费** |
| Pilot 客户 · 3-10 号 · 求平衡 | **Mode B · 标准** (本产品主推) |
| 规模化 · 10+ 号 · 高客单价 | **Mode C · 高端** |

所有模式**开箱即跑** · 切换只需 Settings UI 勾选.

---

## Mode A · 全免费 (Free Tier)

### 组件

| 功能 | 方案 | 月费 |
|---|---|---|
| 代理 | 家庭宽带直连 / 免费代理 | $0 |
| AI 文本 rewrite | **关** · 用 script content_pool 原文 | $0 |
| AI 图片 (avatar / status) | **关** · 用 `_builtin` 预置 + 手动上传 | $0 |
| AI 语音 | **Piper 本地** (唯一免费 AI · 自动) | $0 |
| VPS (License 服务端) | 客户无关 · 我们承担 | — |

**总月费: $0**

### 能跑吗

能跑. 所有核心功能通.

### 质量妥协

- 🔴 **同 IP 多号** → WhatsApp 关联封风险很高 · 建议 1 号测试
- 🟡 **文本重复** → 所有号共用 script 原文 · 内容同质 · 被检测概率升
- 🟡 **头像/状态图重复** → 只能用 `_builtin` 预置 (~50 张) · 多号难个性化
- 🟢 **语音 OK** · Piper 本地生成 · 每号独立

### 适合

- 工程师/技术 users 验证产品
- 小规模非关键账号测试
- 预算零 · 可容忍账号寿命 2-4 周

### 不适合

- 客户生产环境 3+ 号
- 电商/私域真实业务

---

## Mode B · 标准 (Standard Pilot) · ⭐ 推荐

### 组件

| 功能 | 方案 | 月费 |
|---|---|---|
| 代理 | 住宅静态 · 1 IP : 3-5 号 | $40-100 |
| AI 文本 rewrite | **DeepSeek** (最便宜) · 或 OpenAI-compat | $3-5 |
| AI 图片 | **ComfyUI 本地** (需 GPU) **或** Replicate flux-dev | $0 (本地) / $5-10 (云) |
| AI 语音 | Piper 本地 (同 Mode A) | $0 |
| 其他 | — | — |

**总月费: ~$48-115** (按代理 + AI 组合)

### 子选项 · AI 图片

**B1 · ComfyUI 本地** (如果你有 NVIDIA GPU)

- 硬件要求: RTX 3060 12GB+ (VRAM 关键 · 非 CUDA 核数)
- 下载: https://github.com/comfyanonymous/ComfyUI
- 模型: flux-dev.safetensors (~23 GB) · https://huggingface.co/black-forest-labs/FLUX.1-dev
- 启动: `python main.py` · 默认 `http://127.0.0.1:8188`
- WAhubX Settings → AI 配置 → Flux backend = **flux-local**
- 优势: 零云费 · 无 API 限流
- 劣势: 要懂点命令行 · 前期 23GB 下载

**B2 · Replicate 云** (无 GPU / 懒配置)

- 注册: https://replicate.com
- 获取 API Key (账户 → API Tokens)
- WAhubX Settings → AI 配置 → Flux backend = **flux-replicate** · 填 Token
- Model 保持默认 `black-forest-labs/flux-dev`
- 成本: ~$0.003 / 图 · 每号首次 4 候选 ≈ $0.012 · 100 号 ≈ $1.20 一次性 + 持续 status 补图 ~$5/月

### 成本明细 (Mode B · 5 号运营)

| 项 | 估计 |
|---|---|
| 住宅静态代理 1 个 (覆盖 5 号) | $40-60/月 |
| DeepSeek API (10 万 tokens/月) | ~$3-5/月 |
| Replicate (status 补图 · ~500 张/月) | ~$5/月 |
| **合计** | **$48-70/月** |

### 账号质量

- 🟢 同代理 IP ≤ 5 号 · 关联封概率低
- 🟢 AI rewrite → 每号文本多样性高
- 🟢 Persona avatar 独立生成 · 外观差异大
- 🟡 语音仍是大陆腔 (Piper huayan · V1.1 fine-tune 马华 voice)

### 适合

- **本产品 pilot 客户首选**
- 马华电商/微商 · 3-10 号规模
- 愿意每月付 ~$50 保账号

---

## Mode C · 高端 (Premium)

### 组件

| 功能 | 方案 | 月费 |
|---|---|---|
| 代理 | 住宅静态 · 1 IP : 1-2 号 · 或移动 4G 池 | $100-200 |
| AI 文本 | **Claude 3.5 Haiku** (质量最好的便宜模型) | $10-30 |
| AI 图片 | Replicate **flux-pro** (比 flux-dev 细节强) | $20-50 |
| AI 语音 | **ElevenLabs** 云 (自然度 / 口音可调) | $22/月起 |

**总月费: ~$152-302**

### 额外能力

- ElevenLabs 可选马华口音 voice clone (上传样本 30 秒)
- Flux-pro 生成更自然的人像 · 被识别为 AI 几率下降
- Claude Haiku 文本更贴近真人表达 · 少"AI 味"

### 适合

- 高客单价业务 (美容 / 保险 / 房产 · 单号月产出 $500+)
- 规模 10-50 号
- 团队有预算 · 要卡质量

---

## 切换模式

全部在 **Settings / AI 配置** Tab 里做:

[截图: AI 配置 tab · 4 列 provider 开关]

- 每个 provider 独立 **启用 / 禁用** 开关
- 填入对应 API Key (AES-256-GCM 加密落盘)
- 点 **"测试"** 验证 Key 有效
- 关掉 = 自动降级 (详见 §B.4 三维降级)

**切换不需重启** · 下次任务调度立即生效.

---

## 代理选购指南 (通用 · Mode B/C 用)

### 推荐供应商 (马来西亚场景)

- **IPRoyal** · Residential Static · https://iproyal.com
- **Bright Data** (前 Luminati) · 最大最贵最稳
- **Oxylabs** · 企业级

### 避坑

- ❌ 数据中心代理 (被 WA 批量标记)
- ❌ 免费代理站 (IP 池脏 · 可能被黑产用过)
- ❌ VPN 服务 (Softether / NordVPN · 共享 IP · 非多号场景)

### 预算紧的替代

- 自家 4G 热点 · 手动重拨 IP · 1 号专用 · 但丢稳定性
- 家庭宽带直连 · 1 号可以 · 2 号起风险陡增

---

## FAQ

**Q: 我完全不想付 API 钱 · 能跑吗?**
A: Mode A 能. 接受账号寿命缩短 + 多号被关联风险.

**Q: 本地 ComfyUI 需要多少硬盘?**
A: 模型 23GB + 输出缓存 ~10GB · 算 50GB 够.

**Q: Replicate 会不会限流?**
A: 个人账户默认 ~10 req/s · 够用. 大规模可升级.

**Q: 代理能共用多少号?**
A: 住宅静态 3-5 号上限 · 超过 5 个关联风险陡增. 4G 移动代理可放宽到 10 号.

**Q: ElevenLabs 一定需要吗?**
A: 完全不需要. Piper 本地免费 · 只是腔调偏大陆 · 短语音 (<8s) 差异不明显.

---

_最后更新 2026-04-20_
