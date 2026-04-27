# 03 Next Phase Plan

## 当前阶段 · Phase 1 (94%)

主线任务: Chromium WA Web 统一架构交付到 Windows 桌面 + Inno Setup ship.

D7-D12 全完 · 等 Codex 锁 D13 交付链决策.

## 明天 (2026-04-26) 优先级 · 锁

1. **P0.7** · WA Web Document/file attach chain 实装 (估 1-2h)
   - attach button → menu → "Document" item click → active input → preview → tick
   - 修完直接回归 T2.5 file
2. T2.5 file 通过 → 全 T2.x 闭环 (sole exception 解锁)
3. T2.6 24h soak 启动 (今晚已起 monitor · 明天确认数据)
4. 最终验收补齐 → D13 才能进打包

## 紧接 · 测试阶段 (D13 暂停 · Codex 拍板顺序改)

Codex 拍板顺序更正:
1. 先测 Chromium 主链路 (bind/qr/sendText/receiveMessage/sendMedia/重启免扫)
2. 再测 slot 隔离真实性 (2 slot 真不同 user-data-dir + pid + proxy + 崩了不影响)
3. 测试通过后才开 D13 + 多语言 + license 收口

## 测试阶段拆解

### Phase T1 · 不需要真 SIM 也能测
- T1.1 multi-slot spawn: 拉 2 个 fake slot · 验 user-data-dir 物理分开 · pid 不同
- T1.2 进程独立性: kill 一个 runtime · 另一个仍 running
- T1.3 proxy 隔离: 2 slot 配不同 proxy · 看 ipinfo 各自走自己 IP
- T1.4 backend 重启 · auto-spawn 顺序日志可观察

### Phase T2 · 需要真 SIM (主理人提供)
- T2.1 bind 主链路: 真扫码 → chat-list (D6 在 Docker 跑过 · Windows native 第一次)
- T2.2 重启免扫 (C5/C6 等同 Windows 验证)
- T2.3 sendText 真发到测试号 + 单勾确认 (D10 第一次真测)
- T2.4 receiveMessage 真收 inbound + DOM observer 触发 + role gate (cs vs broadcast 分流验)
- T2.5 sendMedia image/file 真发 (D10 实测)
- T2.6 24h soak (Codex D15 范围 · 提到 T2 末尾)

## D13-D15 (测试通过后)

- D13: Inno Setup 打包 (CfT 内置 + Node + 全 dist · 决策已答 · 等真测后再开)
- D13.5: 多语言 (英文 / 中文 · 用户提到的 i18n)
- D14: License/upgrade · admin endpoint 收敛 · 走正式 /slots/* API
- D15: Windows 真交付验收

## 历史范围 (D10 · 已完)

1. **sendText** · `ChromiumSlotRuntime.sendText()` 真打通
   - 路径: deep link `web.whatsapp.com/send?phone=...` → 输入框定位 → human typing → Enter → 单勾确认
   - 不做: 群 / status / newsletter / 复杂编辑
2. **receiveMessage** · 最小 inbound 主链路
   - 路径: DOM observer + 最小去重 (messageId 缓存)
   - 不做: takeover / intelligent-reply 联动 (留 D11+)
3. **sendMedia** · 只做最稳路径
   - 路径: `input[type=file]` 上传 (image / file)
   - 不做: video / voice / paste (留后续)

## D10 不做的事 (Codex 锁)

- ❌ Windows native port
- ❌ 24h soak
- ❌ 自动恢复 / quarantine
- ❌ 高级 selector 自愈
- ❌ status / react / group / channel
- ❌ 全仓老业务点一次性迁移

## D11-D15 路线

| D | 内容 | 估时 |
|---|---|---|
| D11 | slot.role 架构 (broadcast / customer_service · DB 字段 + dispatcher 调度区分) | 1-2 天 |
| D12 | Windows native (去 Docker · child_process.spawn Chromium) | 2-3 天 |
| D13 | Inno Setup 打包 (含 Chromium binary) | 3-5 天 |
| D14 | License/upgrade 复用现 license-server (admin endpoint 删 · 收敛到 /slots/* 正式 API) | 5 天 |
| D15 | 集中验收 (24h soak + Windows 真交付) | 1 周 |

## 阶段升级条件

升 Phase 2 = 把 Phase 1 收尾全做完:
- ✅ Chromium runtime bind/status/event/send/inbound 主链路全部跑通
- ✅ Baileys 只剩过渡兜底 (没业务模块直接调 BaileysService 三 facade 之外的方法)
- ✅ Windows native + Inno Setup 打包出 .exe
- ✅ License 端到端激活流程
- ✅ 24h soak 真过

## Phase 2 候选 (远期)

- 接 Meta Verified 引导 UI (高价值客户加值服务)
- 多客服号联动 (1 个 CS 号 + 1 个 backup CS 号)
- Status / 频道 / 群 自动化扩展
- 高级反检测 (Canvas / WebGL / 字体指纹随机化)
- selector 自愈 (LLM 兜底 fallback)
