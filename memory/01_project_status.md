# 01 Project Status

- 项目: WAhubX
- 当前日期: 2026-04-25
- 当前版本: v1.0
- 当前阶段: Phase 1 (90% · 测试冻结期 · T1 全过 · 等 SIM 进 T2 真机验证)
- 当前主线: Chromium WA Web 统一架构 · 抽象层成立 · 进 W2 DOM 自动化
- 当前部署目标: 租户本地 Windows + Inno Setup + 本地 Postgres/Redis
- VPS 角色: license / 激活 / 升级分发 (轻活)
- 当前主开发分支: `claude/goofy-mendel-3f5881` (worktree)

## 已锁定架构决策 (Codex + 主理人)

- ❌ Baileys 不是长期产品主架构 · 进退役过渡态 (只修 bug · 不加功能)
- ✅ Chromium WA Web 唯一目标架构
- ✅ 部署仍是 Inno Setup 桌面 + VPS license · **不变 SaaS 月费产品**
- ✅ 角色架构: 1 客服号 (always-on) + N-1 广告号 (批跑 · 死了换 SIM)
- ✅ ISlotRuntime 接口为业务层唯一抽象 · backend 不再直接 if chromium / if baileys

## 隔离层真实状态表 (Codex 锁定权威口径 · 不夸大)

| 项 | 当前状态 | 结论口径 |
|---|---|---|
| 每 slot 独立 Chromium 进程 | ✅ 已实现 | slot 级浏览器进程隔离 |
| 每 slot 独立 runtime 子进程 | ✅ 已实现 | slot 级运行态隔离 |
| 每 slot 独立 user-data-dir | ✅ 已实现 | slot 级会话目录隔离 |
| 每 slot 独立 cookie / localStorage / IndexedDB / session | ✅ 已实现 | slot 级浏览器会话隔离 |
| 每 slot 独立 bind 状态 / page 状态 / WS runtime 连接 | ✅ 已实现 | slot 级运行状态隔离 |
| 每 slot 独立 pid 生命周期 | ✅ 已实现 | slot 级进程生命周期隔离 |
| 每 slot 独立 proxy 参数 | ✅ 已实现 (架构层) | 支持 slot 级代理绑定 |
| 每 slot 独立公网出口 IP | ✅ T1.1 实测验证 (2026-04-25) | slot 级出口 IP 隔离 · 各走自己 proxy |
| 每 slot 独立容器 | ❌ 未实现 | 不是容器级隔离 |
| 每 slot 独立 OS / network namespace | ❌ 未实现 | 不是系统级网络命名空间隔离 |
| 每 slot 独立数据库实例 | ❌ 未实现 | 全系统共享本地 Postgres |
| 每 slot 独立 Redis 实例 | ❌ 未实现 | 全系统共享本地 Redis |
| 每 slot 独立 VPN runtime | ❌ 未实现 | 不是 VPN 级完全隔离 |
| 每 slot 独立宿主机网络栈 | ❌ 未实现 | 全 slot 共享 Windows 宿主网络栈 |
| 系统级 DNS 硬隔离 | ❌ 未实现 | Windows 仅 Chromium 级软约束 |
| Linux iptables 53 封禁 | 仅 dev 壳实现 | 不是最终 Windows 产品隔离能力 |
| 一个 slot 崩溃不拖垮其他 slot | ✅ T1.2 实测验证 (2026-04-25) | slot 级故障域隔离 · 实测 kill 1 · 另 1 + backend 不受影响 |
| backend 重启后按规则恢复 slot | ✅ 已实现基础版 | auto-spawn 生命周期闭环 |
| customer_service / broadcast 角色隔离 | ✅ 已实现 | role gate · 不同角色走不同业务门禁 |

### 统一对外口径 (Codex 锁)
1. 当前已实现"slot 级浏览器进程与会话隔离"
2. 当前未实现"容器级 / OS 级 / DB 级 / VPN 级完全隔离"
3. 当前"每 slot 独立公网出口"属于已支持但待测试验真的能力 · 不能先宣称完成

## 当前 D 进度

| D | 状态 | 内容 |
|---|---|---|
| D6 | ✅ | 真扫码 + session 落盘 + 重启免扫 |
| D7-3 | ✅ | UA-IP 国家一致性 |
| D7-2 | ✅ | 深度 stealth (navigator/Intl/permissions/chrome.runtime) |
| D7-1 | ✅ | 行为模拟 + idle 调度器 (双护栏) |
| D8-1 | ✅ | Runtime↔Backend WS 桥骨架 + 心跳 |
| D8-2 | ✅ | bind 主链路 (start-bind/qr/bind-state · BindStateMachine 严格 fsm) |
| D8-3 | ✅ | SlotsService facade + connection-close 4 类 + 语义边界 |
| D9 | ✅ | ISlotRuntime + Registry + packages/shared 协议单一来源 |
| D10 | ✅ | W2 WA Web DOM 自动化 (sendText/receiveMessage/sendMedia) |
| D11-1 | ✅ | slot.role migration + entity + DB 唯一客服号硬约束 |
| D11-2 | ✅ | UI role badge + 切换 + 后端错误语义 (3 codes) |
| D11-3 | ✅ | Dispatcher 白名单 + Inbound 业务订阅 role gate |
| D12-1 | ✅ | OS detect + 路径抽象 + Chromium 探测 + RuntimeLaunchConfig |
| D12-2 | ✅ | RuntimeProcessManager + child_process.spawn (Windows native 跑通) |
| D12-3 | ✅ | active slot auto-spawn (onModuleInit/Destroy 闭环) |
| D13 | ⏸️ | Inno Setup 打包 · 等 Codex 锁 3 决策点 (Chromium 来源 / Node 内置 / 数据目录) |

## 后续路线 (D11-D15)

- D11: slot.role 架构 (broadcast / customer_service) ✅
- D12: Windows native (去 Docker · Chromium 直接 spawn) ✅
- D13: Inno Setup 打包 (测试通过后)
- D13.5: 多语言 (中/英)
- D14: License/upgrade 复用现 license-server
- D15: 集中验收 (24h soak + Windows 真交付)

## 测试冻结期规则 (Codex 锁 · 自 2026-04-25 末)

不做:
- ❌ 新功能分支 / 模块
- ❌ D13.5 多语言
- ❌ D13 安装包
- ❌ D14 license 收口

只做:
- ✅ T2 验证 (扫码 / 发消息 / 收消息 / 媒体 / soak)
- ✅ 缺陷修复 (T2 暴露的)
- ✅ 测试证据归档
- ✅ memory 同步

T2 优先级 (Codex 锁):
1. T2.1 真扫码 → chat-list (Windows native 第一次)
2. T2.2 重启免扫 (C5/C6 Windows 验)
3. T2.3 sendText 真发 + 单勾确认
4. T2.4 receiveMessage + role gate (cs vs broadcast 分流验)
5. T2.5 sendMedia image/file 真发
6. T2.6 24h soak

## T2 实测进展快照 (2026-04-25 末 + 2026-04-26 凌晨)

| Test | 结果 | 实证 |
|------|------|------|
| T2.1 真扫码 → chat-list | ✅ PASS | bind-state=connected · session 落 %APPDATA% |
| T2.2 重启免扫 | ✅ PASS | backend 多次 respawn · 每次都 rehydrate complete · 无需新扫 |
| T2.3 sendText | ✅ PASS | chat_message id=1 · waMessageId=local-... · 单勾确认 |
| T2.4 receive + role gate | ✅ PASS (5/5 验收点) | chat_message id=5,6,7,21,22,23 · CS 入库 · source=displayName |
| T2.5 image | ✅ PASS | chat_message id=24 · msg_type=image · 22s 完成 |
| **T2.5 file** | **❌ FAIL** | 独立 P0.7 · WA Web Document menu click chain 未实装 |
| T2.6 soak | 🔵 待 (今晚已起持久 monitor) | 验收范围: login 持久 + text + inbound + image (file 不前置) |

## P0 集中补洞清单 (2026-04-25 session)

| # | 项 | 范围 | 状态 |
|---|----|------|------|
| P0.1 | sendText/sendMedia 改走 SlotsService → Registry → ChromiumSlotRuntime | controller 不再直调 BaileysService | ✅ |
| P0.2 | @OnEvent('runtime.bridge.message-upsert') · role gate · 写 chat_message | inbound 链路通 | ✅ |
| P0.3 | cancel-bind 三层语义统一 · 不再 500 | runtime/bridge/controller 一致返 | ✅ |
| P0.4 | bindAbortController 生命周期 · 每轮清理 | start-bind 入口 + then/catch 三处 | ✅ |
| P0.5 | sendText/sendMedia 全链路硬超时 (25s) + waitForAnySelector per-call 2s cap | Promise.race · page.$ 不再吞超时 | ✅ |
| P0.6 | per-slot send-* mutex (排队 · 等 inner settle 再放) | 防 send 并发互殴致 page crash | ✅ |
| **P0.7** | **WA Web Document attach chain 实装** | **明天第一优先级 · T2.5 file 解锁前置** | **❌ 待修** |
| P1.5 | 普通模式 chat-list watchdog (解 SOAK_MODE 门槛) | 普通测试也能感知 WA 踢号 | ✅ |
| P1.6 | UI 假数据止血 · runtime 字段下发 + 前端 hide/placeholder | waNickname/warmup/stats 在 chromium 路径正确 hide | ✅ |
| B 路线 | inbound watcher 多策略身份提取 + dedupe 放宽 | T2.4 解锁 (CS 角色入库 OK) | ✅ |

## 2026-04-26 凌晨 · P0.7 / P0.9 / P0.10 全 ship · P0.11 战前拆解完毕

### 当晚交付 (按用户执行令顺序)

| # | 项 | 状态 | 实证 |
|---|----|------|------|
| **P0.7** file/document attach chain | ✅ | T2.5 file PASS · `media-1777139339252-ve0jdh` · DB id=49 · 用 `page.waitForFileChooser()` 模式 |
| **P0.9** 智能客服 UI 强制 CS · readonly 展示 | ✅ | ReplyPage 头加 Alert · 显当前 tenant CS slot (slotIndex/phone/online) · 后端 D11-3 早已锁 |
| **P0.10** 接管 = bringToFront chrome 窗口 | ✅ | TakeoverPage 加 "打开 WA Web 窗口" 主按钮 · 全链路 5 层 (shared/runtime/backend/SlotsService/frontend) · 实测 200 12ms |
| **P0.11** 高保真 inbound 重做 | 📋 战前拆解完毕 | 见 `memory/08_p011_inbound_rebuild_battleplan.md` · 5h 估 · 4 phase · 明天集中跑 |

### 多 slot 实战通过 (2026-04-26)

- 5 slot 同时绑 + rehydrate (101 CS / 102 broadcast +proxy / 103 broadcast 直连 / 104 broadcast / 105 broadcast)
- task #55 script_chat 12 turns 全过 (slot 102 ↔ slot 103 双向 · 6:01 完成)
- multi-slot QR live port 冲突 (P0.8) 已修 · per-slotIndex 偏移 + EADDRINUSE 防御
- script-runner.service.ts 改走 SlotsService.sendText (R9 修)
- frontend placeholder phone 5s 后自动 reload (R5 修)

### 残项 (明天 + 后续)

- **P0.11** 高保真 inbound 重做 · 明天第一项 · 见 `08_p011_inbound_rebuild_battleplan.md`
- **R7** "强制执行模式" 文案误导 · forceOverride 不绕 role gate (D11 锁) · 改文案
- **R8** task pending 卡死 · UI 不显 dispatcher skip 原因 · 加诊断
- **R10** (P0.11 万一不通) inbound watcher 永远低保真 · 接受现状 · D12+ 评估

## P0.7 定义 · 明天第一优先级 (FILE/Document attach chain)

**问题**: T2.5 file (Document/任意非媒体文件) 当前无法发送

**根因**: WA Web 现代 DOM 中 "Document" 不是开盒即用的 hidden `input[type=file]` · 是真 menu item · 必须:
1. 点 attach button → menu 弹出
2. 在 menu 中点 "Document" item → 这一步才触发 active file input 注入 DOM
3. 拿到 active input · 调 uploadFile → 进 preview pane
4. preview pane 输入 caption / Enter → 发送
5. 等 tick / unconfirmed

**当前实装缺口**:
- 直接找 file input · 找到的可能是 stale/inactive input · uploadFile 不触发 preview
- 没有 menu item click 链 (`span[data-icon="document"]` / aria-label="Document" 等还没接)
- 没有 preview pane wait 逻辑 (跟 image 不一样 · image 直接 fileinput → preview)

**估时**: 1-2h
- attach button selector 验证 / 强化
- 找 menu item "Document" selector (i18n: Document / 文档 / Documento / etc)
- click menu item · 等 active input 出现
- uploadFile · 等 preview pane (跟 image 不同的 selector)
- caption / Enter / tick 走原 image 路径

**不阻塞**: T2.6 soak (text + inbound + image 已通)

## 残项清单 (今晚收口 · 不阻塞 T2.6)

| # | 项 | 来源 | 何时修 |
|---|----|------|--------|
| R1 | inbound watcher displayName 抓到消息文本不是 contact 名 · synthetic JID 污染 wa_contact | T2.4 测出 | D11+ 进 chat 拿真消息时一并 |
| R2 | sendText tick 选择器对 send-to-self 不灵 (返 unconfirmed=true 已自适应) | T2.3 测出 | tick relax 已 ship · 后续可补真 ack |
| R3 | online-status 老接口仍走 baileys 语义 (主路径 toResponse 已修) | 用户 post-fix 复扫 | admin/runtime-cache 接口待清 |
| R4 | mutex inner settle 等 max 90s · 真长 hang 时下一 cmd 阻塞 | P0.6 设计 trade-off | 跟 P0.7 一起评估 · 必要时改 page reload 强 abort |

## 今晚 5173 UI 验收 (P1.6 止血 · 后端实证 2026-04-26 00:18)

后端 `/api/v1/slots/101` 返:
```
status=active  role=customer_service  online=True (chromium-aware ✓)
phoneNumber=60186888168  runtime=chromium ✓ (P1.6 新字段)
socketLastHeartbeatAt=2026-04-25T16:16:49.951Z (90s 内)
suspendedUntil=None
waNickname=None         → 前端 chromium 路径 hide
warmupStartedAt=None    → 前端进度条 hide
tasksExecuted=2 contactsCount=5 channelsCount=0 groupsCount=0
                        → 前端 chromium 路径全显 "—" (P1.6)
```
卡片视觉应当: 不再"正在同步连接..." · 不再 "未设置昵称" · 4 项 stats 显 `—` 而非 `0`