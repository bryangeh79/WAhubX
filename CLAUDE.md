# CLAUDE.md — WAhubX 工作守则

> 这份是给 Claude Code 看的项目契约。新 session 第一件事先读它。
> 所有规矩都是用户以前说过一次后立的条, 违反过要返工的不写第二遍.

---

## 工作汇报铁律（用户 2026-04-19 立）

1. **任何后台任务 `exit code != 0` 必须在回复里明写。**
2. **必须标明: 启动 OK / 启动失败 / cleanup 杀的, 不允许省略。**
3. **即使判定良性, 也写一行 "X 退出码来自 taskkill, 日志显示已正常 serve"。**

触发条件: 每次 `run_in_background: true` 的 Bash 在结束时返 `status: failed` 或 `exit code != 0`.
动作顺序:
- 先 `Read` 该任务的 `output-file` 尾部 (最后 10-30 行足够) 判断是启动失败还是被 kill 的.
- 再在下一条回复里**明写**结论, 格式:
  > 后台任务 `<task_id>` exit=X: <启动 OK, 被 taskkill 杀 | 启动即失败 (原因 Y)>.

绝不省略. 绝不因"最终冒烟 PASS 了"就忽略.

---

## 杀进程政策

**禁用**: `taskkill //F //IM node.exe` (会杀机器上所有 Node 进程, 包括用户其他项目的 FAhubX dev / MCP servers).

**优先顺序**:
1. **TaskStop 工具**: 后台任务由 Bash `run_in_background:true` 启动时拿到 `task_id`. 收尾用 `TaskStop({ task_id })`, 精准不误伤.
2. **按端口**: 明确知道端口时 (比如后端 3000 / vite 5173) 用:
   ```bash
   netstat -ano | findstr ":3000" | awk '{print $5}' | sort -u | xargs -I{} taskkill //F //PID {}
   ```
3. **按 PID**: 知道 PID 直接 `taskkill //F //PID <pid>`.

绝不 `-IM node.exe` / `-IM chrome.exe` 这种按进程名的大范围匹配.

---

## 项目身份快照

- **名称**: WAhubX — WhatsApp 多账号自动化运营 SaaS
- **仓库**: https://github.com/bryangeh79/WAhubX.git
- **路径**: `C:\AI_WORKSPACE\Whatsapp Auto Bot\`
- **启动日期**: 2026-04-19
- **当前里程碑**: M1 (基础骨架, 4 周) — Week 1 ✅ / Week 2 ✅ / Week 3 进行中

### FAhubX 只读参考

- 路径: `C:\AI_WORKSPACE\Facebook Auto Bot\`
- 仓库: `https://github.com/bryangeh79/FAhubX.git`
- **铁律**: 只读参考复用, **绝不 commit / push FAhubX 仓库**.
- 复用方式: 拷贝代码到 WAhubX, 去掉 facebook/FB 关键字改 whatsapp/WA, 去 Swagger 装饰器, 去 FB 业务字段 (maxAccounts/plan on user).

---

## 核心决策速查 (不要再讨论)

| # | 决策 |
|---|---|
| 部署 | 本地桌面应用 (Inno Setup 打包), VPS 只做 License 发放 + 升级分发 |
| 仓库 | Monorepo pnpm workspace (`packages/backend` + `packages/frontend` + `packages/shared` 预留) |
| DB | **PostgreSQL 16** 强制, Docker 起本地在主机 `:5433` (避开 FAhubX 的 5432), SQLite 留到 M10 |
| 后端 | NestJS 10 + TypeORM + pino, TS strict |
| 前端 | React 18 + Vite 5 + antd 5, 品牌绿 `#25d366`, **中文单语言** (V1) |
| 认证 | JWT 双 token (access 15m / refresh 7d) + **bcryptjs round=12** + 登录 5 次失败锁 15 分钟 |
| Users:Tenant | **1:N**, role 枚举 `admin/operator/viewer`, 平台超管 `tenant_id=null` |
| 套餐 | Basic 10 / Pro 30 / Enterprise 50 (`PLAN_SLOT_LIMIT` 常量硬映射 → `tenant.slot_limit`) |
| 多国 | V1 只做马来西亚, 但 `country/timezone/language` 字段预埋在 tenant+user 两级 |
| 槽位 | `slot_id 1..slot_limit` per tenant (本地部署 = 单 tenant 机器), **只显示 slot_limit 张卡**, 不是 50 张锁 40 |
| License 激活 | 原子事务: 校验 key → 创建 admin user → 绑定 machine_fingerprint → 返 tokens | 激活时**自动创建首个 admin user** |
| 并发 | 全局 6 槽位 (M3 实装), 同账号/同 IP 组互斥, 养号阶段软锁 |
| WA 协议 | @whiskeysockets/baileys (M2 才上) |
| AI | DeepSeek/Gemini/OpenAI/Claude 全选配 + Piper 本地语音 + Flux 本地图片, 租户自填 API Key |

完整版见 `START_M1.md`.

---

## 工作风格 (用户 2026-04-19 立)

1. **简洁直接** — 别给"本方案完美地..."这种废话.
2. **决策透明** — 遇岔路先问用户, 给选项 + 推荐 + 理由.
3. **坦白代价** — 选型说清代价 (成本/复杂度/风险), 不只说好处.
4. **复用优先** — FAhubX 能直接抄的绝不重写, 抄前先看懂.
5. **小步提交** — 分模块/分文件, 不要一次 1000 行.
6. **中文交流** — 对话用中文, 代码/技术名词保持英文.
7. **先拆清单再写代码** — 大任务先拆 todo, 用户确认后动手.

---

## 当前 dev 数据 (本地 PG 里已有)

| 记录 | 用途 |
|---|---|
| `platform@wahubx.local / Test1234!` (tenant_id=NULL, role=admin) | 平台超管, 用来生成/吊销 license |
| `admin@wahubx.local / Test1234!` (tenant_id=1, role=admin) | dev 租户 admin, Basic 套餐 10 槽 |
| `acme-admin@acme.com / AcmeAdmin1234!` (tenant_id=2) | 真实激活流程跑出来的 Pro 套餐 admin, License 已 revoke |

需要清空: `docker compose -f docker-compose.dev.yml down -v` 删卷.

---

## 技术栈快速链接

- `docs/DEVELOPMENT.md` — 零到一本地搭建 + 常用命令 + troubleshooting
- `WAhubX_技术交接文档.md` — DB schema + API 路径 + 调度状态机 (权威)
- `WAhubX_产品介绍书.html` — 业务全景
- `START_M1.md` — M1 启动说明 + 已拍板决策清单
- `scripts/` — 100 剧本原始素材 (M4 才用)
