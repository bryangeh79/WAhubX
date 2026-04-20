# WAhubX 安装部署手册

> 面向: 终端用户 · 不懂编程也能照着做
> 语言: 中文 · 目标环境: Windows 10 / 11 · 马来西亚市场
> 版本: v1.0 (对齐 v0.12.0-m7 code-complete state)

---

## 你只需要准备这些

**必需** (产品运行最少需要):
- ✅ 一台 Windows 10 或 Windows 11 电脑
- ✅ 一张马来西亚 SIM 卡 (注册 WhatsApp 用)
- ✅ 可上网 (家庭宽带 / 4G 都行)
- ✅ WAhubX License Key (向我们购买)

**其他一切都是可选**. 本手册会在每个可选环节明确标注.

---

## 1. 系统要求

| 项 | 最低 | 推荐 |
|---|---|---|
| 操作系统 | Windows 10 64-bit | Windows 11 |
| 内存 | 8 GB | 16 GB |
| 硬盘 | SSD 20 GB 可用 | SSD 100 GB+ |
| 网络 | 稳定宽带 / 4G | 家庭宽带 + 4G 备用 |
| 电源 | 最好常开 (养号任务需持续运行) | 台式机 or 笔记本常插电 |
| CPU | 任意 Intel/AMD 双核以上 | i5 / Ryzen 5 或以上 |
| GPU | **不需要** (默认) | 可选: 若想本地 AI 绘图, NVIDIA RTX 3060 12GB+ |

> **不需要 GPU**. 所有 AI 相关功能都有免费兜底方案. 详见 [DEPLOYMENT-MODES.md](./DEPLOYMENT-MODES.md).

[截图: 系统信息面板 · Windows 版本 + 内存]

---

## 2. 下载 & 安装

### 2.1 预检

装之前 · 跑一次环境检查 (2 分钟):

```powershell
pwsh .\scripts\validate-env.ps1
```

9 项检查全绿 · 可装. 有 FAIL · 先修 (参 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) §2).

### 2.2 下载安装包

向客服索取最新 `WAhubX-Setup-v1.0.x.exe` 下载链接 + SHA-256 校验值.

[截图: 下载页面 · 含 SHA-256]

**验证文件完整性** (可选但推荐):

PowerShell 跑:
```powershell
Get-FileHash .\WAhubX-Setup-v1.0.0.exe -Algorithm SHA256
```

对比客服给的 SHA-256 值 · 不一致则**不要运行** · 重新下载.

### 2.2 运行安装包

双击 `WAhubX-Setup-v1.0.0.exe`.

**Windows SmartScreen 警告** (第一次装都会出现 · 正常现象):

[截图: SmartScreen "Windows 已保护你的电脑" 蓝屏]

1. 点击 **"更多信息"** (不是红色 X)
2. 出现 **"仍要运行"** 按钮 · 点它

[截图: "仍要运行" 按钮位置]

> **为什么有这个警告?**
> V1 版本没做 Code Signing 证书 (省 $200-500/年). 对安装过程本身无影响, 只是 Windows 的默认保护机制.

### 2.3 安装向导

[截图: 安装向导第 1 页 · 欢迎]

一路 **下一步** · 默认选项即可:
- 默认安装路径: `C:\WAhubX\`
- 创建桌面快捷方式 ✅
- 启动时自动运行 ✅ (可取消)

安装约需 **2-5 分钟** (复制 Node/PostgreSQL/Redis portable 二进制).

[截图: 安装进度条]

完成后不要急着启动 · 先激活 License.

---

## 3. License Key 激活

### 3.1 第一次启动

双击桌面 "WAhubX" 图标.

首次启动会看到 **"激活"** 页面:

[截图: ActivatePage · Fresh Install banner]

- 横幅显示 **"全新安装"** (区分首次激活 vs 重激活)
- 显示本机 App Version

### 3.2 输入 License Key

粘贴购买时收到的 Key, 格式如:
```
WAHUBX-BASIC-XXXXX-XXXXX-XXXXX
WAHUBX-PRO-XXXXX-XXXXX-XXXXX
WAHUBX-ENTERPRISE-XXXXX-XXXXX-XXXXX
```

点 **"激活"**.

[截图: License Key 输入框]

### 3.3 发生了什么

后台执行:
1. 向 VPS License 服务器验证 Key 有效
2. 绑定本机**机器码** (一次性 · 换机器需客服重置)
3. 自动创建**首个 Admin 账号** (下一步你会设密码)
4. 根据套餐设置**槽位上限** (Basic 10 / Pro 30 / Enterprise 50)

**可能失败**:
- 网络不通 → 检查代理/VPN · 联系客服
- Key 已被用过 → 客服可 revoke 旧绑定
- 机器码不匹配 (换机器/硬件大改) → 见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

---

## 4. 首次启动向导

激活成功后自动跳到 **"创建管理员账号"**:

[截图: 设置 admin 账号 · email + password]

- **邮箱**: 随便填 (本地登录用 · 不发邮件)
- **密码**: 强密码 · 至少 8 位 · 含大小写 + 数字
- 再次输入密码确认

点 **"创建并登录"** → 进入 Dashboard.

[截图: Dashboard 首页]

---

## 5. 配置代理 (可选 · 强烈建议)

### 5.1 为什么要代理

WhatsApp 严查同 IP 多账号 · 尤其马来西亚. 不配代理:
- 跑 1 号没事
- 2-3 号容易同 IP 关联封
- 产品仍能跑 · 但账号风险大幅提高

### 5.2 代理类型选择

| 类型 | 月费 (估) | 风险 | 推荐场景 |
|---|---|---|---|
| 家庭宽带直连 | $0 (自有) | 🔴 高 (IP 固定易关联) | 技术验证 · 1 号测试 |
| 免费代理 | $0 | 🔴 高 (IP 池脏 / 不稳定) | 不推荐 |
| 数据中心代理 | $5-20/月 | 🟡 中 (被 WA 标记比例高) | 辅助用 |
| **住宅静态代理 · 1:3-5 号** | **$40-100/月** | 🟢 低 | **标准 pilot 推荐** |
| 移动 4G 代理 | $80-200/月 | 🟢 最低 | 高质量号 |

> 全免费模式也能跑 · 只是账号寿命短. 成本 vs 质量 trade-off · 客户自决.

### 5.3 添加代理

Admin 页 → **代理管理** tab → **添加代理**

[截图: 代理添加表单]

填:
- **协议**: SOCKS5 (推荐) 或 HTTP
- **主机**: 代理商给的 IP · 例 `proxy.residential-provider.com`
- **端口**: 代理商给的端口
- **用户名 / 密码**: 代理商给的凭证
- **所在地**: MY · Kuala Lumpur 等
- **分组名**: 自己起 · 便于分配槽位

点 **"测试连接"** · 绿勾 = 通 · 红叉 = 联系代理商.

### 5.4 代理分配

添加槽位时 (Accounts 页) · 下拉选这个代理.

**建议**: 1 个住宅代理绑 3-5 个槽位. 超过 5 个同 IP · 被关联封风险上升.

---

## 6. 配置 AI Provider (全部可选)

### 6.1 产品不依赖 AI 能跑

**重要**: 所有 AI 功能关了, 产品照样运转:
- 文本 rewrite 关 → 用 script 里的原文 (多样性低但能发)
- 图片生成关 → 用 `_builtin` 预置图或手动上传
- 语音生成关 → Piper 本地免费兜底

AI 只是**提升账号个性化 + 降低被检测率**的辅助.

### 6.2 三方案选择 (§B.5 对齐)

参 [DEPLOYMENT-MODES.md](./DEPLOYMENT-MODES.md) 详细梯度:

| 方案 | AI 文本 | AI 图 | AI 语音 | 月费估 |
|---|---|---|---|---|
| **Free (全免)** | 关 · 用 content_pool | 关 · 用 _builtin | Piper 本地 | **$0** |
| **Standard (推荐)** | DeepSeek | Replicate flux-dev 或本地 ComfyUI | Piper | **$5-15/月** |
| **Premium** | Claude Haiku | Flux-pro (Replicate) | ElevenLabs | **$50-200/月** |

### 6.3 配置方法 (如果选配)

Admin 页 → **AI 配置** tab.

[截图: AI 配置 tab · 4 列 provider]

每个 provider 独立开关 · 填入 API Key · 点 **"测试"** 验证.

Key 会被 AES-256-GCM 加密落盘 · 不明文存储.

---

## 7. 注册第一个 WhatsApp 账号

### 7.1 准备 SIM 卡

- 马来西亚本地 SIM (Maxis / Celcom / Digi / U-Mobile 任选)
- 号码**从未**注册过 WhatsApp · 或老号 cooldown 至少 30 天
- SIM 必须能收 SMS (或接电话 voice call)

### 7.2 插 SIM 到手机 · 收验证码

你本机电脑**不需要**插 SIM · 只需要能在手机上收到 SMS/call 就行.

### 7.3 WAhubX 内操作

Accounts 页 → **"添加槽位"** → 选代理分组 → **"启动注册"**

[截图: 注册向导 · 输入手机号]

- 输入手机号 · 格式 `60xxxxxxxxx` (马来西亚 国家码 + 号码 · 无 +)
- 选 SMS 或 voice call 接码
- 点**发送验证码**

### 7.4 输入验证码

手机收到 6 位码后 · 回 WAhubX UI 填入:

[截图: 验证码输入框 + 倒计时]

- 60s 倒计时 · 过期重发
- 输错 3 次 · 等 30min 再试 · 否则号码被锁

### 7.5 注册成功

[截图: 账号卡片 · 在线状态 · phase 0]

看到:
- 槽位卡片显示号码 + 绿色 **"在线"** 点
- Phase = 0 (孵化期 · 下一步养号)

---

## 8. 启动一键养号 (5 天默认方案)

### 8.1 为什么要养

新注册的 WhatsApp **不能立刻大量发消息** · 24 小时内发 50 条以上几乎必封.

WAhubX 内置 5 天养号计划 (§B.8):
- Day 1-2 · 孵化期 · 只接不发 · 偶尔读已读
- Day 3 · 预热期 · 少量发给老友
- Day 4-5 · 活跃期 · 进群 + 发 status + 双向对话

### 8.2 启动

Dashboard → 点刚注册号 → **"开始养号"** 按钮

[截图: 养号启动确认弹窗]

系统自动生成 5 天日历 · 每天任务 5-20 条不等 · 插入 `task` 队列.

### 8.3 观察进度

**Warmup 页** tab 看每日计划 + 完成度:

[截图: Warmup 页 · 5 天进度条]

**Tasks 页** 看分钟级任务:

[截图: Task 队列 · pending/running/done 分列]

### 8.4 通过 Phase Gate

第 5 天结束 · 自动进 Phase 2 (活跃) · 可手动 disable/override.

养号期间**不可接管发消息** · 由系统全自动 · 防人工误操作毁号.

---

## 9. UI 页面导览

### 9.1 Dashboard

[截图: Dashboard 全景]

- 槽位缩略卡 (在线/离线/接管中 状态灯)
- 今日任务进度
- Alert 列表 (高风险号提醒)

### 9.2 Accounts (槽位管理)

[截图: Accounts 页]

- 每槽位: 号码 · phase · health score · 绑定 persona · 最后活跃时间
- 操作: 启动养号 / 暂停 / 接管 / 解绑 / 删除

### 9.3 Scripts (剧本包)

[截图: Scripts 页]

- 已导入的剧本包 (100 剧本预置 · §C)
- 启用/禁用 · 查看内容
- 手动导入自定义包 (.wzip 格式)

### 9.4 Tasks (任务队列)

[截图: Tasks 页]

- 实时任务流 · pending / running / done / failed
- 6 路调度结果可视 (§B.7)
- 单任务详情 + 重试

### 9.5 Health (健康分)

[截图: Health 页]

- 每号 risk_level + score (§B.12)
- 最近 30 天 risk_event 流水
- high 级自动 Phase 0 回退 (debounce 30min)

### 9.6 Assets (素材库 · M7 新增)

[截图: Assets 页 · persona 库 + asset 列]

- Persona 库 (AI 生成的虚拟人设)
- 每 persona 的 image/voice 池 + 配额
- 上传 · 生成 · 删除

### 9.7 Backup (备份)

[截图: Backup 页]

- 每日自动快照列表
- 手动导出 `.wab` (加密包 · 可跨机恢复)
- 导入 `.wab` · 硬件变更 E2 recovery

### 9.8 Upgrade (升级)

[截图: Upgrade 页]

- 当前版本
- 手动上传 `.wupd` 升级包 (V1 不支持自动下载)
- 升级前自动备份 + 失败回滚

---

## 10. 下一步

- 首次装机成功 → 看 [QUICK-START.md](./QUICK-START.md) 的 30min 操作路径
- 踩坑 → [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- 想上第 2 个号 → 加代理 · 分组避同 IP · Accounts 页加槽位

---

## 关于付费 · 别被吓到

我们只卖你一件东西: **License Key**.

其他 (代理 · AI API · 语音云) 全是**可选增强**. 零额外开销也能跑 · 只是账号质量低.

阶梯参 [DEPLOYMENT-MODES.md](./DEPLOYMENT-MODES.md).

---

_最后更新 2026-04-20 · 对齐 v0.12.0-m7_
