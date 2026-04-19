# WAhubX · M1 基础骨架启动说明

> 复制本文件全部内容粘贴到新聊天室的第一条消息即可。
> 本文件是自给自足的 context — 新 Claude 读完这份就能无缝接手。

---

## 🎯 给 Claude 的指令

**继续 WAhubX 项目，启动 M1 基础骨架开发。**

这不是新项目，设计阶段已完成。请**不要重新设计**任何已定案的部分。如果你觉得某个决策需要改，先问我，不要擅自改动。

请按本文件顺序：
1. 先**读完**本文件（就当项目交接书）
2. 然后**读**技术交接文档（路径见下）
3. 然后**快速看一眼** Facebook Auto Bot 的 `backend/src/modules/` 结构（要复用的模块）
4. 回来给我一份 **M1 任务拆解清单**，等我确认后才开工

---

## 📋 项目身份

- **项目名**: WAhubX (WhatsApp 自动化运营平台)
- **起源**: FAhubX 的 WhatsApp 版本（FAhubX 是 Facebook 版）
- **定位**: 多账号自动运营 SaaS，本地桌面应用，Inno Setup 打包
- **目标市场**: 马来西亚优先，架构预埋多国扩展
- **套餐**: Basic 10 号 / Pro 30 号 / Enterprise 50 号
- **当前日期基准**: 2026-04-19 启动
- **开发周期**: V1.0 约 6.5 个月（27 周，11 个里程碑）

---

## 📚 必读参考文件（绝对路径）

```
技术交接文档（最重要，含 DB schema + API + 状态机）:
  C:/AI_WORKSPACE/Whatsapp Auto Bot/WAhubX_技术交接文档.md

产品介绍书（了解业务全景用）:
  C:/AI_WORKSPACE/Whatsapp Auto Bot/WAhubX_产品介绍书.html

100 剧本包（M4 才会用，M1 暂不用管）:
  C:/AI_WORKSPACE/Whatsapp Auto Bot/scripts/

FAhubX 代码库（M1 要大量复用）:
  C:/AI_WORKSPACE/Facebook Auto Bot/
    - backend/src/modules/  ← 重点看这里
    - frontend/src/          ← 脚手架参考
    - installer/             ← 打包参考
```

---

## 🧱 M1 范围（4 周）

### 必须交付
1. **项目脚手架**
   - 后端: NestJS 10 + TypeScript
   - 前端: React 18 + TypeScript + Vite
   - 单一仓库结构（monorepo 或 backend/frontend 并列）
   - 代码混淆配置 (javascript-obfuscator)
   - 构建脚本 (build-backend.bat / build-frontend.bat)

2. **数据库基础**（PostgreSQL 主 / SQLite 可选）
   - 初始 migration 脚本
   - 核心表: `tenant`, `license`, `account_slot`, `wa_account`, `sim_info`, `account_health`, `proxy`
   - 其他表（script_pack, task 等）可留到对应里程碑

3. **从 FAhubX 复用 4 个模块**
   - `auth` — JWT 双 token（直接移植）
   - `users` — 用户/租户模型（直接移植 + 加 plan 字段）
   - `license` — License key 机制（直接移植）
   - `admin-licenses` — Admin 后台（直接移植 + 调整 UI 文案）

4. **新建 1 个模块**
   - `slots` — 50 物理槽位锁定（数据模型 + 基础 CRUD）

5. **前端**
   - 登录页
   - 设置页（空壳，有导航即可）
   - Admin 后台（沿用 FAhubX 页面）
   - **槽位列表页**（空壳，显示 50 个空槽位卡片）

### 本里程碑不做（别跑偏）
- ❌ Baileys 集成（M2）
- ❌ 任何 WA 协议相关
- ❌ 任务调度、BullMQ（M3）
- ❌ 剧本引擎（M4）
- ❌ AI / 素材生成（M6-M7）
- ❌ 接管 UI（M9）
- ❌ 打包成安装包（M11）

---

## ✅ 已拍板的决策（不要重新讨论）

| 类别 | 决策 |
|---|---|
| 部署模式 | 本地桌面应用（Inno Setup 打包），VPS 只做 License + 更新 + 剧本包分发 |
| 套餐档位 | Basic 10 / Pro 30 / Enterprise 50 |
| 数据库 | PostgreSQL 主，SQLite 作为轻量可选 |
| 任务队列 | BullMQ + Redis（M3 才实装，M1 留接口） |
| WA 协议 | Baileys（不是 WhatsApp Web Puppeteer） |
| 接管方案 | 自建聊天 UI，不搞双模式切换，永不二次扫 QR |
| 浏览器隔离 | 独立 `--user-data-dir`（同 FAhubX） |
| 并发策略 | 全局 6 槽位，同账号/同 IP 组互斥，养号阶段软锁 |
| 代理策略 | 1 住宅静态 IP : 3–5 号，同组 IP 冲突软提示 |
| 养号方案 | 5 天平衡版默认（3/5/7 可选），72h 冷却硬守 |
| AI 策略 | 全选配，租户自填 API Key，未启用静默降级 |
| 语音 | Piper 本地免费默认，ElevenLabs 付费升级 |
| 图片 | 本地 Flux（有 GPU）/ Replicate 备选 |
| 文本 AI | DeepSeek / Gemini / OpenAI / Claude / 自定义 |
| 告警 | 桌面弹窗 |
| 日志 | 永久存储本地数据库，不导出 |
| 备份 | 每日自动快照 + 手动 .wab 导出 + 原厂重置 |
| 更新 | 手动导入 .wupd 升级包，自动备份 + 失败回滚 |
| 国家 | V1 只做马来西亚，但架构预埋 country/timezone/language 字段 |
| 剧本包 | .wspack 格式，已有 100 剧本初版（批次文件） |
| **开源协议** | **Proprietary / All Rights Reserved**（商业专有，不开源）<br>`LICENSE` 文件已写好在项目根目录，**不要改**<br>`package.json` 必须: `"license": "UNLICENSED"` + `"private": true`<br>GitHub 仓库**必须设为 Private**（https://github.com/bryangeh79/WAhubX） |

---

## 🗣️ 工作风格要求

1. **简洁直接** — 别给我冗长的"本方案完美地..."类废话，直入主题
2. **决策透明** — 遇到岔路口，**先问我**，别自己选；岔路口要给选项 + 你的推荐 + 理由
3. **坦白代价** — 每个选型要说清楚代价（成本/复杂度/风险），不要只说好处
4. **复用优先** — 能从 FAhubX 直接复用的绝不重写，复用前先看懂 FAhubX 代码
5. **小步提交** — 不要一次性给我 1000 行代码，分模块/分文件逐步来
6. **中文交流** — 我们用中文沟通，代码/技术名词保持英文
7. **不要开始写代码直到我说"开始"** — 先拆解清单我审核

---

## 🚀 你的第一个任务

读完上述文件后，给我一份 **M1 任务拆解清单**，格式如下：

```
M1 任务清单（预计 4 周）

Week 1:
  □ 任务 1: ... (预计 X 天, 复用 FAhubX/xxx)
  □ 任务 2: ...
  ...

Week 2:
  ...

关键依赖:
  - xxx 必须在 yyy 之前完成
  - ...

风险点:
  - 可能遇到的坑
  - ...

需要我确认的决策:
  1. 单仓库还是双仓库？
  2. ... (你认为需要先定的事)
```

然后**等我确认**再开工。

---

## 🔗 上下文快速查询

如果你对某个具体问题需要背景，参考以下速查：

| 问题 | 查哪里 |
|---|---|
| 某个表的字段设计 | 技术交接文档 § 3 |
| 某个 API 的路径/参数 | 技术交接文档 § 4 |
| 某个流程（注册/升级/调度）怎么走 | 技术交接文档 § 7 |
| 封号危险指数怎么算 | 技术交接文档 § 5.4 |
| 某个模块是复用还是新建 | 技术交接文档 § 2 |
| 套餐差异 / 业务逻辑 | 产品介绍书 |
| FAhubX 某个模块长什么样 | 直接读 `C:/AI_WORKSPACE/Facebook Auto Bot/backend/src/modules/{name}/` |

---

**准备好了就开始读文档，然后给我任务清单。**
