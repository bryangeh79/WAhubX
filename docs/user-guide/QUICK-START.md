# WAhubX · Quick Start (30 分钟上手)

> 给有基础的用户 · 最短路径 · 详版见 [INSTALLATION.md](./INSTALLATION.md)

---

## 前置 (装前准备齐)

- ✅ Windows 10/11 · 8GB+ 内存 · 20GB+ SSD
- ✅ 马来西亚 SIM (全新 / 30 天未用) + 能收 SMS 的手机
- ✅ WAhubX License Key
- ✅ 网络能通 github.com + VPS license 服务器 (URL 由客服提供 · 激活时粘到浏览器验证可达)
- 🟡 **可选**: 代理账号 · AI API Key (零额外付费也能跑)

---

## 整流程 (30 min)

### ① 预检 · 下载 · 验 · 装 (~10 min)

**先跑 pre-flight** (2 min):
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\validate-env.ps1
# PowerShell 7 用户可用: pwsh .\scripts\validate-env.ps1
```
全绿或仅 warning = 继续装.

**下载 + 校验** (切到下载目录):
```powershell
cd $env:USERPROFILE\Downloads
Get-FileHash .\WAhubX-Setup-v1.0.0.exe -Algorithm SHA256
# 对比客服给的 SHA-256 · 一致继续 · 不一致重新下
```

双击 `.exe` → SmartScreen 蓝屏 → **"更多信息"** → **"仍要运行"** → 一路下一步 → 装到 `C:\WAhubX\`.

### ② 激活 License (~2 min)

桌面图标启动 → 粘 License Key → **"激活"**.

自动做: VPS 验证 · 绑机器码 · 建首个 admin 账号. 下一页设密码.

### ③ 登录 · 建 Admin (~1 min)

邮箱随填 (本地用) + 强密码 → 进 Dashboard.

### ④ (可选) 配代理 (~3 min · 跳过也能跑)

Admin → **代理管理** → 添加:
- 协议 SOCKS5
- 主机 / 端口 / 账密 (代理商给)
- **测试连接** · 绿勾即可

> 不配 = 家庭 IP 直发 · 账号封得快. 1 号测试可跳.

### ⑤ (可选) 配 AI (~3 min · 跳过也能跑)

Admin → **AI 配置**.

**最省方案 (标准 pilot 推荐)**:
- 文本: DeepSeek (~USD $3-5/月) · 粘 Key
- 图片: 跳过 (用 `_builtin` 或手动上传)
- 语音: Piper 本地 · 默认开 · 无需配置

> 所有 `$` 符号均指 **USD**. 客户换算 RM 按当月汇率 (~RM 4.7 = USD 1).

> 不填 Key = AI 关 · 产品正常跑 · 用 script 原文 + 预置图.

### ⑥ 注册第 1 号 (~5 min)

Accounts 页 → **添加槽位** → 选代理分组 (无代理时选 **"默认 / 直连"** 组 · 自动家庭 IP) → **启动注册**.

输入手机号 `60xxxxxxxxx` → 选 SMS → **发送验证码**.

手机收 6 位码 → 输回 UI → 注册成功 → 槽位绿点.

### ⑦ 启动 5 天养号 (~1 min)

Dashboard → 点新号卡 → **开始养号**.

自动生成 5 天日历 · 每日 5-20 任务 · 进 `task` 队列. **关机也继续排** (开机后补跑).

### ⑧ 观察 (持续)

Tasks 页 / Warmup 页 / Health 页 随时看. Phase 0-2 的 5 天窗口内**不要接管发消息** · 等完全养好.

---

## 常见立即问题

| 症状 | 30 秒修 |
|---|---|
| SmartScreen 蓝屏 | 点"更多信息"再点"仍要运行" |
| License 激活超时 | 检查网络 / VPN · 重试 |
| 验证码收不到 | 换 voice call 接码 · 或换 SIM 运营商 |
| Phase 0 为什么不发消息 | 正常 · 孵化期只接不发 |
| AI 关了能跑吗 | 能跑 · 降级用 script 原文 + _builtin 图 |

详见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

---

## 然后呢

- 跑通 1 号 → 加代理 · 开第 2-5 号 (同代理组 ≤ 5 号)
- 想提升账号质量 → 看 [DEPLOYMENT-MODES.md](./DEPLOYMENT-MODES.md) 选 Standard/Premium
- V1 已知限制 → [KNOWN-LIMITATIONS-V1.md](../KNOWN-LIMITATIONS-V1.md)

---

_最后更新 2026-04-20 · 对齐 v0.12.0-m7_
