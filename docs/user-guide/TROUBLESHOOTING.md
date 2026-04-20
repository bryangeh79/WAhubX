# WAhubX 故障排查 Checklist

> 常见问题 · 诊断 · 修复 · 日志位置

---

## 一般诊断步骤

装机后任何异常 · 先看这 4 条:

1. **Backend 活吗** · Powershell `curl http://localhost:3000/api/v1/health` · 200 = OK
2. **Docker PG 起了吗** (dev) / **PortablePG 起了吗** (prod): `netstat -ano | findstr 5432`
3. **Redis 在** · `netstat -ano | findstr 6379`
4. **日志在** · `C:\WAhubX\data\logs\backend-*.log` · 最后 50 行看关键词 `ERROR` / `WARN`

---

## 1. 安装失败 / SmartScreen 阻止

### 症状
双击 `.exe` 后 Windows 蓝屏 "已保护你的电脑" · 没有"仍要运行"选项.

### 原因
- 没有 Code Signing 证书 (V1 不做 · 省成本 $200-500/年)
- 某些企业版 Windows 策略彻底禁未签名

### 修复
- 点 **"更多信息"** → 出现 "仍要运行" → 点
- 若完全没 "更多信息": 右键 `.exe` → 属性 → 底部 "解除锁定" 打勾 → 确定 → 重新双击
- 企业/AD 管控机器: 联系 IT 加白名单 · 或在非管控机器装

### 日志
装失败不会留产品 log · 看 Windows 事件查看器 → 应用程序.

---

## 2. Backend 起不来

### 症状
点桌面图标 · 一闪就退 · 或 UI 转圈后 "无法连接后端".

### 诊断树

**2A. PostgreSQL 没起**

```powershell
netstat -ano | findstr ":5432"
```

空 = PG 没起. 见 `C:\WAhubX\logs\pg\postgresql-*.log`.

修复:
- 检查 `C:\WAhubX\pgsql\` 目录完整 (installer 应装好)
- 手动起: `C:\WAhubX\scripts\start-pg.bat`
- 端口冲突 (已被其他 PG 占): 改 `.env` 里 `POSTGRES_PORT`

**2B. Redis 没起**

```powershell
netstat -ano | findstr ":6379"
```

同上思路. 启动: `C:\WAhubX\scripts\start-redis.bat`.

**2C. 端口 3000 被占**

```powershell
netstat -ano | findstr ":3000"
```

被其他程序占 (常见: Node.js dev 项目 / React 前端):
- 关占用程序 · 或改 WAhubX 的 `.env` PORT
- 不要 `taskkill /IM node.exe` (杀所有 Node)

**2D. `.env` 缺失 / 密码错**

装后首次启动应自动 `generate-env.js`. 如果 `C:\WAhubX\.env` 不存在:
- 重跑 `C:\WAhubX\scripts\init-env.bat`

### 日志位置
- Backend: `C:\WAhubX\data\logs\backend-YYYY-MM-DD.log`
- PG: `C:\WAhubX\logs\pg\postgresql-*.log`
- Redis: `C:\WAhubX\logs\redis\redis.log`

---

## 3. License 激活失败

### 症状
输入 Key 点激活 · 红色错误 / 超时.

### 诊断

**3A. 网络不通 VPS**

```powershell
curl https://license.wahubx.com/health
```

超时 → VPN / 防火墙 / 代理拦了 VPS 域名.

**3B. Key 被用过** (换机器)

错误文案: `License already bound to another machine`

修复: 联系客服 · 提供旧 + 新机器码 · revoke 旧绑定.

**3C. 机器码不匹配** (硬件大改)

错误: `Machine fingerprint mismatch`

修复 · 3 条路径 (详见 UPGRADE.md §E2):
- Path 1: 用旧 env key (若备份过) · 跑 `C:\WAhubX\scripts\restore-env-key.bat`
- Path 2: 导入 `.wab` 备份 · Backup 页 → 导入
- Path 3: 联系客服重置 License 绑定

**3D. Key 过期**

错误: `License expired`

修复: 续费或换 Key.

### 日志
`data/logs/backend-*.log` grep `LicenseModule`.

---

## 4. WhatsApp 注册失败

### 症状
发验证码失败 / 收到码输入后仍拒绝.

### 4A. SIM 未开国际漫游 / 号被 WA 黑

- 新买的 SIM · 先手机开 WhatsApp 试装一次 (别真用 · 只验证能收码)
- 若手机 WhatsApp 装不了 · 号码本身有历史 · 换 SIM

### 4B. 验证码收不到

- 等 60s 后换 voice call 接码
- 换运营商: Maxis / Celcom / Digi / U-Mobile 任选
- 注意 voice call 有的 VoIP 号码收不到 · 最好实体物理 SIM

### 4C. IP 历史脏

错误: `Banned IP` / 立即封号

- 代理换 IP (住宅代理商控制面板可 rotate)
- 家庭宽带直连: 重启光猫换 IP (ISP 动态分配)
- 移动 4G: 飞行模式切一下

### 4D. 频繁试错被限

输错 3 次验证码 → 号码 30 min 锁 · 别急.

### 日志
`data/logs/backend-*.log` grep `BaileysService` · `BindSessionService`.

---

## 5. 代理连不通

### 症状
添加代理 → 测试连接 → 红叉.

### 诊断

```powershell
curl --proxy socks5://user:pass@host:port https://ifconfig.me
```

- 返 IP 地址 = 代理通 · 问题在 WAhubX 侧 · 重试 or 看 `BaileysService` log
- 超时 = 代理商问题 · 联系代理商
- 401 = 用户名密码错
- 403 = 代理商封了你的账户 (欠费 / 违规)

### 常见延迟

- 住宅代理 · ping 100-300ms 正常
- \> 500ms · 考虑换地区节点 (选马来西亚本地 · 不是美国)

### 日志
grep `ProxyService` + `axios.*timeout`.

---

## 6. AI Provider 调用失败

### 症状
Dashboard → AI 配置 → 点 **"测试"** · 红叉.
或 script 跑起来 · 文本没 rewrite · log 显示 `AI rewrite fail, fallback pool`.

### **首先问自己** (非常重要)

> **你想用 AI 功能吗?**

如果不想: **保持 AI 关 · 产品正常跑** · 降级用 script 原文 (§B.4 三维降级). 这是**正常行为** · 不是 bug.

### 如果确实想开

**6A. OpenAI/DeepSeek/Claude/Gemini Key 错**

- API 控制台重新生成 Key · 粘过来
- 检查**有余额** (Anthropic / Google 新账户需充值)

**6B. endpoint URL 错** (自部署 / OpenAI-compat 场景)

- 正确格式: `https://api.deepseek.com/v1` (结尾 `/v1` · 不带 `/chat/completions`)
- SDK 会自动拼 `/chat/completions`

**6C. 模型名字错**

- DeepSeek: `deepseek-chat`
- OpenAI: `gpt-4o-mini` (便宜) / `gpt-4o` (贵)
- Claude: `claude-3-5-haiku-latest`
- Gemini: `gemini-1.5-flash`

**6D. 网络被墙**

- 用户 PC 在大陆内 → OpenAI / Anthropic / Google 域名大概率不通
- 解决: 配代理 (Key 独立 · 不走代理规则) · 或用 DeepSeek (国内可通)

### 日志
grep `ai-text.service` / `provider=`.

---

## 7. Baileys 掉线 / QR 频繁失效

### 症状
- 槽位在线几秒钟 → 离线
- QR 频繁刷新 · 扫不到

### 7A. 同 IP 多账号 · WA 关联检测

最常见原因. 修复: 加代理. 详见 [DEPLOYMENT-MODES.md](./DEPLOYMENT-MODES.md).

### 7B. 代理不稳定

延迟忽高忽低 · 代理商 IP 池轮换. 换静态住宅代理.

### 7C. Socket 过载

backend log `ECONNRESET` / `EPIPE` 多:
- 重启 backend · 清 in-memory socket pool
- V1 不做 redis rehydrate · 只靠 session 落盘 (`data/slots/<n>/wa-session/`)

### 7D. QR 扫不到

- QR 2 分钟过期 · 扫完整后再刷
- 手机 WhatsApp 版本太老 · 升级到最新
- 手机网络不通 WhatsApp 服务器 · VPN 试

### 日志
grep `BindSessionService` / `baileys.service` / `disconnected`.

---

## 8. 养号任务不执行

### 症状
- 启动养号后 Tasks 页空 · 或 pending 不动
- Health 页 "最后活跃" 停滞

### 8A. Dispatcher 未 tick

log grep `DispatcherService started`:
- 应看到 `poll interval=3000ms`
- 没看到 → backend 没正常起 (回 §2)

### 8B. Phase Gate

任务 stuck pending · log 有 `skip-health-high` / `phase-gate-block`:
- 号处于高风险 · 已暂停 · 见 Health 页
- 或 Phase 不够 · status_post 需 ≥ Phase 2

### 8C. 6 路 skip 全命中

log grep `skip-`:
- `skip-global-capacity` · 任务太多 · 等
- `skip-account-busy` · 该号有任务在跑
- `skip-ip-group-busy` · 同代理 IP 另一号在跑
- `skip-night-window` · 02-06 夜间窗口
- `skip-takeover-active` · 你在接管中 · 放开接管

### 8D. Executor 未注册

log `Unknown task_type`:
- script 用了新 task_type · 但对应 executor 没实装
- V1 应有 chat / warmup / script_chat / status_post / status_browse

### 日志
grep `DispatcherService`.

---

## 9. Status Post 不发图 · 只发文本

### 症状
Status 任务成功 · 但看手机 WhatsApp 只有文本 status · 没有图.

### 原因
4 层降级 (§B.20) 命中 Layer 3 (纯文本) 而非 Layer 1/2 (图).

### 诊断

log grep `layer1-` `layer2-` `layer3-`:
- `layer1-persona-pool-hit` 过了 · 没到 `image-sent` → 文件缺
- `layer2-builtin-hit` 同理
- 直接 `layer3-text-sent` → persona + _builtin 都空

### 修复

- **persona 专属图空**: Assets 页 → 选 persona → 上传或生成
- **_builtin 空** (V1 installer 未 seed 真素材 · stub mode only): 跑 `scripts/generate-builtin-assets.js --mode real` (需 Flux) · 或手动拷贝一些 `.jpg` 到 `C:\WAhubX\data\assets\_builtin\image\_builtin_images_life\`

### 日志
grep `StatusPostExecutor`.

---

## 10. 升级 (.wupd) 失败

### 症状
Upgrade 页上传 `.wupd` → 错误.

### 10A. 签名无效

错误: `signature_valid: false`

- `.wupd` 不是我们签的 · 或文件损坏 · 重下
- 绝对不要改动 `.wupd` 内容 · 签名会失效

### 10B. 版本降级

错误: `version_compat: downgrade`

- 不支持从高版本 "降" 到低版本
- 升级 `.wupd` 的 from_version 必须匹配当前版本

### 10C. Migration 失败

错误: `migration execution failed`

- 自动回滚到升级前备份
- 看 log 具体哪个 migration 炸 · 联系客服带 log

### 日志
grep `UpdateService` / `migration`.

---

## 日志打包给客服

遇到解决不了的问题 · 给客服发 log 包:

PowerShell:
```powershell
$zip = "$env:USERPROFILE\Desktop\wahubx-logs-$(Get-Date -Format yyyyMMdd-HHmm).zip"
Compress-Archive -Path "C:\WAhubX\data\logs\*","C:\WAhubX\logs\*" -DestinationPath $zip
Write-Host "Logs: $zip"
```

**敏感信息自查** · 发前确认 log 里无:
- License Key 明文 (应脱敏)
- API Key 明文 (应脱敏)
- WhatsApp 消息真实内容 (一般不落 log · 但 confirm)
- 如果有 · 删除再发

---

_最后更新 2026-04-20_
