# 05 Handoff For New Chat

## 新对话接手要点

- 语言: 中文
- 用户把你视为项目工程监督主任 / 高级工程师
- 汇报必须放代码框
- 收口格式偏好: `[Status: Completed | Next: ...]`
- 当前主目标:
  - Chromium WA Web 统一架构 (唯一)
  - 租户本地 Windows 部署 (Inno Setup + VPS license)
  - Baileys 仅过渡 · 不再做长期主线

## 当前真实进度

- W1 D6-D7 已完成 (Chromium 闭环 + 反检测三件套)
- D8-1/2/3 已完成 (WS 桥 + bind 主链路 + SlotsService facade)
- D9 已完成 (ISlotRuntime + Registry + packages/shared 协议单一来源)
- D10 已完成 (W2 sendText/receiveMessage/sendMedia · 走 WA Web DOM 自动化)
- D11 已完成 3 段 (slot.role 架构 · DB 硬约束 + UI badge + 调度门禁)
- D12 已完成 3 段 (路径抽象 + child_process.spawn + auto-spawn · Windows native 跑通)
- **测试冻结期** (2026-04-25 末) · Codex 锁定不开新 D · 只做 T2 + bugfix + evidence + memory
- T1 全过 (4 项 · 无 SIM 隔离实证)
- **T2 大部分通过** (2026-04-25/26 · 真号 60186888168):
  - T2.1 真扫码 ✅
  - T2.2 重启免扫 ✅
  - T2.3 sendText ✅
  - T2.4 receive + role gate ✅ (CS 入库 5 条)
  - T2.5 image ✅
  - **T2.5 file ❌** (独立 P0.7 · 明天第一优先级)
  - T2.6 soak 🔵 持久 monitor 已起 · 不被 file 阻塞
- P0 集中补洞 9 项已 ship (P0.1-P0.6 · P1.5/P1.6 · B 路线) · 详见 01_project_status.md
- D13 (打包) / D13.5 (i18n) / D14 (license) 全部 hold · 等 T2 + P0.7 通过
- 主分支: `claude/goofy-mendel-3f5881` (worktree)
- 进度: ~94% Phase 1

## 隔离真实状态 (诚实表述 · 不夸大)

✅ slot 级 (已实现): 浏览器进程 / user-data-dir / Runtime pid / bind 状态 / proxy 参数
❌ 系统级 (未实现): 容器 / DB / Redis / VPN runtime / 内核网络栈
⚠️ DNS: Windows 仅 Chromium 软封 · 非 Linux iptables 硬封

## 关键文件

- 共享协议: `packages/shared/src/runtime-protocol.ts` + `slot-runtime.ts`
- 业务抽象: `packages/backend/src/modules/slot-runtime/`
  - `slot-runtime.registry.ts` (按 RUNTIME_MODE 选实装)
  - `baileys-slot-runtime.ts` (老路径适配 · 不增强)
  - `chromium-slot-runtime.ts` (新路径 · sendText/sendMedia W2 D10 实装中)
- WS 桥: `packages/backend/src/modules/runtime-bridge/`
  - `runtime-bridge.service.ts` (port 9711 · 鉴权 · slot 路由 · cache)
  - `runtime-bridge.controller.ts` (admin 临时调试接口 · D14 删)
- Runtime: `packages/runtime-chromium/`
  - `src/index.ts` (主流程 · runBindFlow · onCommand handlers)
  - `src/runtime-ws-client.ts` (WS client + 重连)
  - `src/wa-web/wait-for-login.ts` (qr→chat-list 长 poll)
  - `src/bind-state-machine.ts` (严格单向 fsm)
  - `src/human-behavior.ts` (HumanBehaviorSimulator 全套 6 方法)
  - `src/idle-activity.ts` (客服号 idle 调度器)
  - `src/wa-web/stealth-inject.ts` (深度 stealth 注入)

## 当前明确的工程原则 (Codex 反复强调)

- ❌ 不抢跑恢复逻辑 (D11+)
- ❌ admin endpoint 不能成长期交付接口 (D14 收)
- ✅ bindState 与 pageState 必须分离 (语义边界)
- ✅ 先交付功能 · 再集中测试 (D15)
- ❌ 未测试前不得把"可交付"表述成"已稳定"
- ❌ 不在 D 边界外偷跑 (D9 不做 W2 · D10 不做 Windows native)

## 商业架构

- 每套餐 N 号: 1 客服 (always-on · 推荐 Meta Verified) + N-1 广告号 (批跑 · 死了换 SIM)
- 部署: VPS 跑 license · 租户 Windows 跑 backend + Chromium per slot
- 跟 FAhubX 同模式 · 不上 SaaS 月费

## 怎么继续

如果接手时 D10 未完:
1. `git checkout claude/goofy-mendel-3f5881`
2. 看最新 commit 跟当前进度对照 `01_project_status.md`
3. D10 三步: sendText → receiveMessage → sendMedia
4. 每步独立 commit · 每步实测可行 (用 admin endpoint 触发)

如果 D10 已完:
1. 进 D11 slot.role · 看 03_next_phase_plan.md
2. 不要回去改 D9 抽象层
