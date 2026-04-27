# 04 Risks Issues

## 当前主要风险 (D10 进行时)

1. **WA Web DOM 自动化未打通发送/接收主链路** · D10 任务 · 风险点:
   - selector 漂移 (WA Web 会改 DOM)
   - 聊天列表/消息列表虚拟化 · DOM 不总在页面里
   - 发送成功确认不稳定 (单勾/双勾/已读 状态机)
   - 上传文件流程不稳定 (input[type=file] 兼容性)
2. **bind 主链路在 runtime 层已工作** · 但还没在 production frontend 端流量验过
3. **frontend 还可能临时依赖 admin/runtime cache 接口** · D14 必须收敛
4. **Windows native 运行形态未替代 Docker 开发壳** · D12 任务
5. **Baileys 仍在项目里** · 过渡期"双路径并存"认知混乱风险:
   - 业务模块仍直接调 `BaileysService.sendText/sendMedia/etc`
   - 仅 bind 三方法走 ISlotRuntime
   - 文档要清晰标识哪些路径是过渡哪些是新主线

## 已识别但暂缓处理

- WebGL 指纹随机化 (放 D8+ · Codex 拍板不做)
- 自动 respawn / quarantine (Codex 锁 · 不在 D8-D10 引入)
- 24h soak (用户决定延后到系统完成后集中测试 · D15)

## 关键约束 (Codex 反复强调)

- ✅ 先交付功能 · 再集中测试
- ❌ 未测试前不得把"可交付"表述成"已稳定"
- ❌ 不能在已有抽象上发散 (新功能不该改 ISlotRuntime 接口)
- ❌ 不能在 D 边界外偷跑 (如 D9 不做 W2 · D10 不做 Windows native)

## 历史已知问题 (session 1-3 · 不影响当前主线)

- WA 440 死循环 (老 SIM · 1.5h 死) · 元凶疑似 Baileys 协议指纹本身
- UK 号 5h 死号 (新绑无代理直连本机马来 IP) · 同元凶
- 这些问题在 Chromium 路线下理论上更稳 · 但 D15 集中验收前不下结论

## 2026-04-25/26 · session 4 集中补洞期间新发现

### 已修
- **chrome target crash** (T2.5 image 触发): 多 send 并发同 page → renderer crash · 已修 (P0.6 per-slot mutex + P0.5 硬超时 + waitForAnySelector per-call 2s cap)
- **send-text-no-tick 误判 fail**: WA Web tick selector 不稳 · 已 relax 为 unconfirmed=true 仍 ok
- **inbound 链路断**: runtime emit message-upsert · backend 没监听器 · 已补 @OnEvent · role gate 正确

### 未修 (明天起)

- **P0.7** WA Web Document/file attach chain 未实装 (T2.5 file 唯一阻塞点 · 详见 01_project_status.md)
- **R1** inbound watcher displayName 抓错 (B 路线已让链路通 · displayName 提取仍取到消息预览 · 非 contact 名 · synthetic JID 污染 wa_contact)
- **R2** sendText tick 选择器对 send-to-self 不灵 (已 ship "tick relax" · 后续可补真 ack)
- **R3** admin/runtime-cache 边缘接口仍走老 baileys 语义 (主路径 SlotsService.toResponse 已 fix)
- **R4** mutex inner settle wait 上限 90s · 真长 hang 时下一 cmd 阻塞 (跟 P0.7 一起评估是否改 page reload 硬 abort)
