# WAhubX · 技术交接文档 v1.0

> 开发团队启动参考。包含：架构分层、模块映射、数据库 Schema、核心 API、调度状态机、执行流程、部署拓扑。
> 产品介绍书（HTML）另见 `WAhubX_产品介绍书.html`。

---

## 1. 架构总览

### 双平面分层

```
┌──────────────────────────────────────────────────────────┐
│ VPS 控制平面（轻）                                         │
│  ├─ license-server       License 发放/校验/吊销            │
│  ├─ version-cdn          .wupd 升级包分发                   │
│  ├─ pack-registry        .wspack 剧本包分发                 │
│  ├─ admin-portal         创建租户/发 Key/停用               │
│  └─ support-intake       故障日志接收（可选）                │
└──────────────────────────────────────────────────────────┘
            ↓ License 校验 / 升级检查 / 剧本包下载 ↓
┌──────────────────────────────────────────────────────────┐
│ 本地桌面执行平面（重 · 租户自备机 · Windows）                 │
│  ├─ frontend-ui          React + TS (webview)             │
│  ├─ backend-api          NestJS                           │
│  ├─ local-db             PostgreSQL / SQLite              │
│  ├─ redis-bullmq         任务队列 + 6 并发仲裁             │
│  ├─ baileys-engine       注册 + 登录 + 消息                │
│  ├─ chromium-takeover    接管模式有头浏览器                │
│  ├─ ai-providers         OpenAI/DeepSeek/Gemini/Claude     │
│  ├─ asset-studio         Flux(本地/Replicate) + Piper/EL   │
│  ├─ script-engine        剧本解析 + 变体 + 改写调度          │
│  ├─ warmup-calendar      5 天养号日历引擎                   │
│  ├─ health-scorer        封号危险指数引擎                   │
│  └─ watchdog             崩溃/掉线/QR 告警                  │
└──────────────────────────────────────────────────────────┘
```

### 通信协议

- 本地 → VPS：**HTTPS REST**（License/Update/Pack 拉取）
- VPS → 本地：**无主动推送**（本地定时轮询）
- 本地内部：**HTTP (localhost) + BullMQ (Redis)**

---

## 2. 模块映射（从 FAhubX 迁移）

| 模块 | 状态 | 说明 |
|---|---|---|
| auth | ★ 复用 | JWT 双 token |
| users | ★ 复用 | 用户/角色 |
| license | ★ 复用 | License Key 机制 |
| admin-licenses | ★ 复用 | Admin 后台 |
| batch-operations | ★ 复用 | 批量操作 |
| account-batch | ★ 复用 | 账号批处理 |
| facebook-accounts | ◐ 改造 → `wa-accounts` | + SIM/persona/health |
| chat-scripts | ◐ 改造 | + session/pool/ai_rewrite/fallback |
| task-executor | ◐ 改造 | Puppeteer → Baileys |
| task-scheduler | ◐ 改造 | + 6并发/IP互斥/阶段过滤 |
| task-queue | ◐ 改造 | 简单 cron → BullMQ |
| task-monitor | ◐ 沿用 | 日志/告警 |
| account-health | ◐ 扩展 | + 封号危险指数/养号阶段 |
| vpn / vpn-client | ◐ 沿用 | 每槽位独立 |
| slots | ● 新建 | 50 物理槽位锁定 |
| execution-groups | ● 新建 | 4–8 号执行组 |
| warmup-calendar | ● 新建 | 5 天养号日历 |
| ai-providers | ● 新建 | 多模型抽象层 |
| asset-studio | ● 新建 | Flux/Piper 生成调度 |
| script-packs | ● 新建 | .wspack 加载/签名 |
| baileys-engine | ● 新建 | WA 协议层 |
| takeover-ui | ● 新建 | 自建接管聊天 UI |

---

## 3. 数据库 Schema（PostgreSQL）

### 3.1 租户 & 授权
```sql
CREATE TABLE tenant (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  plan TEXT CHECK (plan IN ('basic','pro','enterprise')),
  slot_limit INT NOT NULL,  -- 10/30/50
  status TEXT DEFAULT 'active',  -- active/suspended
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE license (
  id SERIAL PRIMARY KEY,
  license_key TEXT UNIQUE NOT NULL,
  tenant_id INT REFERENCES tenant(id),
  machine_fingerprint TEXT,
  issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  revoked BOOLEAN DEFAULT false
);
```

### 3.2 槽位 & 账号
```sql
CREATE TABLE account_slot (
  slot_id INT PRIMARY KEY,       -- 1..50 物理锁定
  tenant_id INT REFERENCES tenant(id),
  account_id INT UNIQUE REFERENCES wa_account(id),
  status TEXT DEFAULT 'empty',   -- empty/active/suspended/warmup
  proxy_id INT REFERENCES proxy(id),
  persona JSONB,
  profile_path TEXT,             -- /data/slots/01/
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE wa_account (
  id SERIAL PRIMARY KEY,
  slot_id INT REFERENCES account_slot(slot_id),
  phone_number TEXT UNIQUE,
  country_code TEXT DEFAULT 'MY',
  timezone TEXT DEFAULT 'Asia/Kuala_Lumpur',
  primary_language TEXT DEFAULT 'zh',
  wa_nickname TEXT,
  wa_avatar_path TEXT,
  wa_signature TEXT,
  registered_at TIMESTAMPTZ,
  warmup_stage INT DEFAULT 0,    -- 0/1/2/3
  warmup_day INT DEFAULT 0,
  last_online_at TIMESTAMPTZ,
  session_path TEXT,             -- Baileys creds 路径
  device_fingerprint JSONB
);

CREATE TABLE sim_info (
  account_id INT PRIMARY KEY REFERENCES wa_account(id),
  carrier TEXT,
  sim_type TEXT,                 -- prepaid/postpaid
  registered_name TEXT,
  activated_date DATE,
  monthly_cost DECIMAL,
  notes TEXT
);

CREATE TABLE account_health (
  account_id INT PRIMARY KEY REFERENCES wa_account(id),
  health_score INT DEFAULT 100,
  risk_level TEXT DEFAULT 'low', -- low/medium/high
  risk_flags JSONB,              -- [{code, severity, at}] (最近 20 条 snapshot)
  total_sent INT DEFAULT 0,
  total_received INT DEFAULT 0,
  send_fail_rate DECIMAL,
  last_incident JSONB,
  updated_at TIMESTAMPTZ
);

-- M8 新增 · 风险事件原始流水 (§5.4 所有"次数"源头)
-- 去重: UNIQUE(account_id, code, source_ref) + ON CONFLICT DO NOTHING
--   source_ref 上游唯一 id (task_run_id / baileys_msg_id / proxy_log_hash)
--   兜底 'auto:md5(code||minute)' 按分钟去重
-- 滚动窗口: scorer 只读 at > now - health.scoring_window_days (default 30)
-- 为何独立表而非扩 risk_flags JSONB: 事件量大 (每号每天数十条), JSONB 累加到百条 + 趋势 GROUP BY 会慢;
-- 独立表+索引 (idx_risk_event_account_at, idx_risk_event_at) 给 HealthTab 7 天趋势折线 10ms 级查询.
CREATE TABLE risk_event (
  id BIGSERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES wa_account(id) ON DELETE CASCADE,
  code TEXT NOT NULL,            -- captcha_triggered / reported / send_failed / friend_rejected /
                                 --  same_ip_banned / qr_expired / connection_lost / proxy_down /
                                 --  banned_by_wa / phase_gate_blocked
  severity TEXT NOT NULL,        -- info / warn / critical
  source TEXT NOT NULL,          -- task_runner / baileys / dispatcher / executor
  source_ref TEXT NOT NULL,      -- 上游唯一 id 或 auto:md5(code|minute) 兜底
  meta JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT UQ_risk_event_dedupe UNIQUE (account_id, code, source_ref)
);
CREATE INDEX idx_risk_event_account_at ON risk_event (account_id, at DESC);
CREATE INDEX idx_risk_event_code ON risk_event (code);
CREATE INDEX idx_risk_event_at ON risk_event (at DESC);

-- M6 新增 / M8 改名 · 全局 k-v 设置 (命名空间 key 前缀)
--   ai.text_enabled · health.dry_run · health.scoring_window_days
CREATE TABLE app_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.3 代理
```sql
CREATE TABLE proxy (
  id SERIAL PRIMARY KEY,
  tenant_id INT REFERENCES tenant(id),
  proxy_type TEXT,               -- residential_static/residential_rotating/datacenter
  host TEXT, port INT, username TEXT, password TEXT,
  country TEXT, city TEXT,
  status TEXT DEFAULT 'unknown', -- ok/down/unknown
  last_check_at TIMESTAMPTZ,
  avg_latency_ms INT,
  bound_slot_ids INT[]           -- 共享此 IP 的槽位
);
```

### 3.4 执行组
```sql
CREATE TABLE execution_group (
  id SERIAL PRIMARY KEY,
  tenant_id INT REFERENCES tenant(id),
  name TEXT,
  description TEXT,
  has_ip_conflict BOOLEAN DEFAULT false,  -- 组内有同 IP 警告
  created_at TIMESTAMPTZ
);

CREATE TABLE execution_group_member (
  group_id INT REFERENCES execution_group(id),
  account_id INT REFERENCES wa_account(id),
  role_preference TEXT,          -- A/B/any
  joined_at TIMESTAMPTZ,
  PRIMARY KEY (group_id, account_id)
);
```

### 3.5 剧本 & 素材
```sql
CREATE TABLE script_pack (
  id SERIAL PRIMARY KEY,
  pack_id TEXT UNIQUE,           -- official_my_zh_basic_v1
  name TEXT, version TEXT,
  language TEXT, country TEXT[],
  installed_at TIMESTAMPTZ,
  enabled BOOLEAN DEFAULT true,
  signature TEXT
);

CREATE TABLE script (
  id SERIAL PRIMARY KEY,
  pack_id INT REFERENCES script_pack(id),
  script_id TEXT,                -- s001_morning_simple
  name TEXT, category TEXT,
  total_turns INT,
  min_warmup_stage INT,
  content JSONB,                 -- 完整剧本 JSON
  UNIQUE(pack_id, script_id)
);

CREATE TABLE asset (
  id SERIAL PRIMARY KEY,
  pool_name TEXT,                -- voices_casual_laugh
  kind TEXT,                     -- voice/image/file
  file_path TEXT,
  meta JSONB,                    -- duration/dimensions/persona_match
  source TEXT,                   -- ai_generated/imported/pack
  generated_for_slot INT,        -- 专属某槽位则非空
  created_at TIMESTAMPTZ
);

CREATE TABLE rewrite_cache (
  id SERIAL PRIMARY KEY,
  script_id INT REFERENCES script(id),
  turn_index INT,
  persona_hash TEXT,
  variant_text TEXT,
  used_count INT DEFAULT 0,
  created_at TIMESTAMPTZ
);
```

### 3.6 任务 & 调度
```sql
CREATE TABLE task (
  id SERIAL PRIMARY KEY,
  tenant_id INT,
  task_type TEXT,                -- warmup/chat/auto_accept/status/etc
  priority INT DEFAULT 5,        -- 1高–9低
  scheduled_at TIMESTAMPTZ,
  repeat_rule TEXT,              -- cron-like 或 once
  target_type TEXT,              -- account/group
  target_ids INT[],
  payload JSONB,                 -- 任务参数
  status TEXT DEFAULT 'pending', -- pending/queued/running/done/failed/cancelled
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE task_run (
  id SERIAL PRIMARY KEY,
  task_id INT REFERENCES task(id),
  account_id INT REFERENCES wa_account(id),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  status TEXT,                   -- running/success/failed/skipped
  error_code TEXT, error_message TEXT,
  logs JSONB                     -- 步骤级日志
);

CREATE TABLE warmup_calendar (
  id SERIAL PRIMARY KEY,
  account_id INT REFERENCES wa_account(id),
  plan_variant TEXT,             -- 3day/5day/7day
  current_day INT,
  scheduled_tasks INT[],         -- 指向 task.id
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  paused BOOLEAN DEFAULT false
);
```

### 3.7 聊天 & 联系人
```sql
CREATE TABLE wa_contact (
  id SERIAL PRIMARY KEY,
  account_id INT REFERENCES wa_account(id),
  remote_jid TEXT,               -- 60123456789@s.whatsapp.net
  display_name TEXT,
  is_internal BOOLEAN DEFAULT false,  -- 内部互聊对象
  added_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  UNIQUE(account_id, remote_jid)
);

CREATE TABLE chat_message (
  id BIGSERIAL PRIMARY KEY,
  account_id INT REFERENCES wa_account(id),
  contact_id INT REFERENCES wa_contact(id),
  direction TEXT,                -- in/out
  msg_type TEXT,                 -- text/image/voice/file
  content TEXT,
  media_path TEXT,
  sent_at TIMESTAMPTZ,
  script_run_id INT,             -- 若由剧本发出
  ai_rewritten BOOLEAN DEFAULT false
);
```

---

## 4. 核心 API（REST，localhost:3000/api）

### 4.1 认证
```
POST   /auth/login          { email, password }  → tokens
POST   /auth/refresh        { refreshToken }
POST   /auth/logout
```

### 4.2 租户 & License（Admin）
```
POST   /admin/tenants       建租户
GET    /admin/tenants
PATCH  /admin/tenants/:id   调套餐/禁用
POST   /admin/licenses      生成 key
DELETE /admin/licenses/:id  吊销
POST   /license/verify      { key, fingerprint }  ← 本地启动调用
```

### 4.3 槽位
```
GET    /slots
POST   /slots/:id/register          { phone, sim_info, proxy_id }  ← Baileys 注册
POST   /slots/:id/bind-existing     扫码绑定现有号
POST   /slots/:id/clear             清空账号
POST   /slots/:id/factory-reset     原厂重置
POST   /slots/:id/backup
POST   /slots/:id/restore           { backup_id }
```

### 4.4 账号 & 健康
```
GET    /accounts
GET    /accounts/:id
PATCH  /accounts/:id/persona
PATCH  /accounts/:id/sim-info
GET    /accounts/:id/health
GET    /accounts/:id/warmup-calendar
POST   /accounts/:id/warmup/start   { plan: '3day'|'5day'|'7day' }
POST   /accounts/:id/warmup/pause
POST   /accounts/:id/warmup/cancel
POST   /accounts/:id/warmup/skip
```

### 4.5 执行组
```
POST   /groups          { name, member_ids }
GET    /groups
PATCH  /groups/:id      { add_member_id, remove_member_id }
DELETE /groups/:id
```

### 4.6 剧本 & 素材
```
GET    /script-packs
POST   /script-packs/import    { file }  ← .wspack 文件上传
POST   /script-packs/:id/toggle
DELETE /script-packs/:id

GET    /scripts?pack=&category=&stage=
GET    /scripts/:id
POST   /scripts/:id/preview    { persona_id }  ← 预览改写效果

GET    /assets?pool=
POST   /assets/generate        { pool, count, persona_id }  ← AI 批量
DELETE /assets/:id
```

### 4.7 任务 & 调度
```
POST   /tasks               创建任务（检测时段冲突）
GET    /tasks?status=&date=
PATCH  /tasks/:id/pause
PATCH  /tasks/:id/cancel
POST   /tasks/:id/run-now   立即执行

GET    /tasks/:id/runs      历史运行
GET    /tasks/:id/runs/:runId/logs
GET    /scheduler/slots     当前 6 并发槽位视图
```

### 4.8 接管 & 聊天
```
POST   /takeover/:accountId/acquire   获取接管锁
POST   /takeover/:accountId/release
GET    /chats/:accountId/conversations
GET    /chats/:accountId/messages?contact=&limit=&before=
POST   /chats/:accountId/send         { contact, type, content }
```

### 4.9 AI & 配置
```
GET    /ai-providers
POST   /ai-providers/:provider/config  { api_key, model, base_url }
POST   /ai-providers/:provider/test    ← 连通性测试
GET    /settings/system-health         ← 一键体检
```

### 4.10 更新 & 备份
```
GET    /version/current
POST   /version/check-update           → VPS
POST   /version/apply-update           { .wupd file }

POST   /backup/export                  生成 .wab 导出
POST   /backup/import                  { .wab file }
GET    /backup/snapshots               本地每日快照列表
POST   /backup/restore/:snapshotId
```

---

## 5. 调度器状态机

### 5.1 任务生命周期
```
 [pending] ──(scheduler picks)──> [queued]
     │                                │
     │ user cancel                    │ slot acquired
     │                                ↓
     │                           [running]
     │                          /    │    \
     │                 success / fail │ skip \ conflict
     │                        ↓      ↓      ↓
     │                    [done]  [failed]  [skipped]
     │                                ↑
     └────(user cancel)───> [cancelled]
```

### 5.2 并发槽位仲裁（核心）
```
每 3 秒扫描一次:
  1. 取 status=queued 的 tasks, 按 priority ASC, scheduled_at ASC
  2. 对每个候选:
     IF 当前运行 >= 6              → skip to next
     IF 该账号正在运行任务           → skip
     IF 该账号所属 IP 组已有账号运行 → skip (硬锁)
     IF 该账号正被手动接管           → skip
     IF 任务类型 < 账号 warmup_stage 允许 → 弹警告(软)，允许执行
     → 分配: status=running, 扣槽位 token
  3. 夜间 02:00-06:00 窗口: 只允许 warmup/maintenance 任务
```

### 5.3 养号阶段机
```
 [Phase 0 · 孵化] Day 1-3 (72h 硬)
       ↓  auto-advance
 [Phase 1 · 预热] Day 4-7
       ↓  auto-advance
 [Phase 2 · 激活] Day 8-14  (5-day plan 合并到此)
       ↓  auto-advance
 [Phase 3 · 成熟] Day 29+ (7-day plan) / Day 15+ (5-day compressed)

跳过条件:
  - 用户手动 skip-to-next（弹警告 + 记录）
  - 触发严重封号风险 → 强制退回 Phase 0 冷却

降级条件:
  - 健康分 < 40 持续 48h → 降回上一阶段
  - 被封/掉线 → 退回 Phase 0
```

### 5.4 健康分计算
```
baseline = 100
- 验证码触发次数 × 5
- 被举报次数 × 15
- 发送失败率 × 100
- 加好友被拒比例 × 20
- 同 IP 其他号被封 × 10
+ 连续在线天数 × 0.2 (max +20)
+ 通讯录规模 × 0.1 (max +10)
+ 自然消息接收占比 × 15

风险等级:
  low:    60-100  正常
  medium: 30-59   自动降速 50%
  high:   0-29    暂停主动任务 + 桌面告警
```

---

## 6. 文件系统布局

```
C:\WAhubX\
├─ app\                          程序目录（升级替换）
│  ├─ backend\                   NestJS 编译后
│  ├─ frontend\                  React 静态文件
│  ├─ bin\                       Baileys runtime / Piper / Flux (可选)
│  └─ version.json
│
├─ data\                         用户数据（升级时保留）
│  ├─ config\
│  │  ├─ license.json
│  │  ├─ machine-fingerprint.txt    (M1 · License 绑定 · 32 hex · SHA-256 前 16B)
│  │  ├─ master-key-fingerprint.txt (M10 · MachineBound 加密密钥派生源 · 64 hex)
│  │  ├─ ai-providers.json.backup   (可选, 人工导出; M6 起运行时 keys 存 DB ai_provider.api_key_encrypted)
│  │  └─ settings.json
│  ├─ db\                        PostgreSQL/SQLite
│  ├─ slots\
│  │  ├─ 01\
│  │  │  ├─ wa-session\          Baileys creds.json + keys (备份 whitelist)
│  │  │  ├─ fingerprint.json     槽指纹 UA/分辨率/时区 (备份 whitelist)
│  │  │  └─ media\               入站媒体下载缓存 (备份默认排除 · BACKUP_INCLUDE_MEDIA 可开)
│  │  └─ 02\ ...
│  ├─ backups\                   (M10)
│  │  ├─ daily\<YYYY-MM-DD>\slot_<NN>.zip   每日明文 zip · 7 天 retention
│  │  ├─ manual\<ts>_manual-export.wab      手动 .wab · AES-256-GCM
│  │  ├─ pre-migration\<ts>_pre-migration.wab   E1 迁移前自动备份
│  │  └─ pre-import\<ts>_pre-import.wab         F+ 导入前自动备份 (defense in depth)
│  ├─ assets\
│  │  ├─ voices\
│  │  ├─ images\
│  │  └─ files\
│  ├─ packs\
│  │  └─ official_my_zh_basic_v1\
│  └─ logs\
│
└─ backups\
   ├─ daily\
   │  ├─ 2026-04-19\
   │  │  ├─ slot_01.zip
   │  │  └─ ...
   └─ manual\
      └─ export_2026-04-19.wab
```

---

## 7. 关键执行流程

### 7.1 新号注册流程
```
1. 用户: POST /slots/01/register
     body: { phone, sim_info, proxy_id }

2. 后端: 前置体检
   - 检查槽位 empty
   - 检查代理连通
   - 检查 24h 内该 IP 注册次数 < 2
   - 检查 OpenAI Key 已配（若用户开 AI）

3. 后端 → baileys-engine
   - 生成全新 noise-protocol keys
   - 随机 device-fingerprint (UA/分辨率/时区/型号)
   - 调 register API 提交手机号
   - 返回 {request_id, sms_sent}

4. 前端: 弹出 6 位验证码输入框

5. 用户输入验证码 → POST /slots/01/register/verify
   - baileys 提交 code 完成注册
   - 保存 creds.json 到 data/slots/01/wa-session/

6. 后端: 并行启动
   a. asset-studio: 生成人设/头像/30 图 30 语音
   b. warmup-calendar: 排 5 天日历
   c. health-scorer: 初始化 100 分

7. 后端 → baileys
   - 上传 avatar/nickname/signature

8. 状态 → warmup_stage=0, 启动 5-day 养号
```

### 7.2 剧本执行流程
```
1. 调度器拉起 task (chat_script)
   payload: { script_id, role_A_account, role_B_account }

2. 并发仲裁通过 → 占两个槽位 token

3. script-engine
   for each turn:
     a. 选定发送账号 (A/B 切换)
     b. 检查 AI 开关:
        IF ai_rewrite ON:
          - 检查 rewrite_cache, 命中则用
          - 未命中 → 调 AI provider 生成 20 变体入库
        ELSE:
          - 从 content_pool 随机抽
     c. 媒体步骤:
        IF 语音功能 OFF:
          - on_disabled=skip → 跳过
          - on_disabled=send_fallback_text → 改发 caption_fallback
        ELSE:
          - 从 asset_pool 抽一个资源
     d. 执行: baileys.sendMessage + typing_delay + send_delay

4. 每条消息写 chat_message
5. 任务完成 → task_run.status=success
6. 更新 health_scorer 统计
```

### 7.3 升级流程
```
1. 用户导入 .wupd 文件 → POST /version/apply-update
2. 签名校验（公钥在程序里）
3. 版本链校验 (from_version 必须 match)
4. 全量备份 data/ 到 backups/pre_update_<version>_<ts>/
5. 停后台服务、杀 Chromium 实例
6. 替换 app/ 目录
7. 执行 migrations/ SQL
8. 启动服务
9. 健康检查 → 失败则回滚
```

---

## 8. 关键配置（settings.json 核心项）

```json
{
  "execution": {
    "max_concurrency": 6,
    "night_window": { "start": "02:00", "end": "06:00" },
    "scheduler_poll_interval_sec": 3
  },
  "warmup": {
    "default_plan": "5day",
    "strict_72h_cooldown": true
  },
  "ai": {
    "text_enabled": false,
    "image_enabled": true,
    "voice_enabled": true,
    "provider_text": "deepseek",
    "provider_image": "flux_local",
    "provider_voice": "piper"
  },
  "proxy": {
    "check_interval_sec": 300,
    "fail_pause_seconds": 600
  },
  "alerts": {
    "desktop_popup": true,
    "qr_timeout_min": 10,
    "health_low_threshold": 40
  }
}
```

---

## 9. Inno Setup 打包结构

```
installer/
├─ wahubx-setup.iss              主脚本
├─ deps/
│  ├─ node-lts-embedded/         portable Node
│  ├─ baileys-runtime/
│  ├─ piper/                     含中英文语音模型
│  └─ flux-local/ (optional)     用户选装
├─ staging/
│  ├─ app/                       构建产物
│  └─ data/                      初始空目录 + 默认 packs
└─ build.bat                     一键打包

输出: wahubx-installer-v1.0.exe (约 400MB 含 Piper，1.5GB 含 Flux)
```

---

## 10. 开发里程碑建议

| 阶段 | 周数 | 交付 |
|---|---|---|
| **M1 · 基础骨架** | 4 | auth/users/license/slots/settings UI + 空数据库 |
| **M2 · Baileys 集成** | 3 | 注册新号 + 扫码登录 + 发消息 + 接收消息 |
| **M3 · 任务调度** | 3 | BullMQ + 6 并发仲裁 + task/task_run + 基础日志 |
| **M4 · 剧本引擎** | 3 | .wspack 加载 + 剧本执行 + content_pool 抽签 |
| **M5 · 养号日历** | 2 | 5 天日历引擎 + Phase 自动推进 + UI 可视化 |
| **M6 · AI 层** | 2 | Provider 抽象 + 改写 + 缓存 + 降级 |
| **M7 · 素材生成** | 2 | Flux + Piper 集成 + 素材池管理 |
| **M8 · 健康分** | 2 | 规则引擎 + 告警 + 降级 |
| **M9 · 接管 UI** | 2 | 自建聊天 UI + 发文本/图片/语音/文件 |
| **M10 · 备份/更新** | 2 | 每日快照 + .wab 导出 + .wupd 升级 |
| **M11 · Admin/打包** | 2 | Admin 后台 + Inno Setup 打包 + 端到端测试 |
| **合计** | **27 周 ≈ 6.5 月** | **V1.0 发布** |

---

## 附录 · 技术选型一览

| 层 | 选型 |
|---|---|
| 后端框架 | NestJS 10+ |
| 前端框架 | React 18 + TypeScript + Vite |
| 数据库 | PostgreSQL 16（主）/ SQLite（轻量可选） |
| 缓存/队列 | Redis 7 + BullMQ |
| WA 协议 | @whiskeysockets/baileys |
| 接管浏览器 | Puppeteer + Chromium（独立 user-data-dir） |
| AI 文本 | OpenAI / DeepSeek / Gemini / Claude / 自定义 OpenAI 兼容 |
| AI 图片 | Flux-dev (本地 ComfyUI) / Replicate API |
| AI 语音 | Piper (本地) / ElevenLabs (付费) |
| 认证 | JWT AccessToken + RefreshToken |
| 代码混淆 | javascript-obfuscator |
| 打包 | Inno Setup 6 |
| 日志 | Pino + 本地文件 |
| 监控 | 自建 + 桌面弹窗（node-notifier） |

---

# 附录 B · 完整决策清单（补充）

> 设计阶段所有细节决策的集中留档。前面第 1–10 节是概览，本附录是细则。
> 开发时遇到"这个点我们讨论过吗？"先查这里。

---

## B.1 执行组详细规则

**什么是执行组**：4–8 号组合，任务创建时按组选号比按单号方便。

**硬规则**：
- 成员数量 **4–8 号**（推荐 4–6）
- **IP 冲突软提示**：组内成员来自同 IP 组时，创建时弹警告"建议独立 IP 以降低关联风险"，租户可强制添加
- 添加时显示警告的组在列表上贴黄色小标 `⚠️ 含同 IP 成员`，便于事后复盘
- **成员可跨组**：一个号可属于多个组（如 a05 在 Group 1 和 Group 3）
- 人设多样性建议（男女混合、职业不同），非强制

**建组 UI 规则**：
- 添加成员时实时显示该成员所属 IP 组，若与已有成员冲突 → 红色提示
- 组卡片顶部显示：成员数 / IP 分布 / 性别分布 / 人设多样性评分

---

## B.2 5 天养号日历具体时间表

> ⚠️ **权威性约定**：本节时刻表仅为**描述性示例**。所有主动行为（发消息、加好友、发 Status 等）必须通过其所属规则的 phase gate 检验：
> - 自动接受好友 → 遵循 §B.7 的阶段上限表
> - Status 发布 → 遵循 §B.20 的频率规则（Phase 0-1 禁止 / Phase 2 每 3 天 ≤1 / Phase 3+ 每天 ≤1）
> - 内部互聊 → 遵循 §B.15 IP 组规则 + §B.13 `min_warmup_stage`
>
> 若示例时刻表的某个动作被其所属规则拒绝，该时刻应**空过或降级为被动动作**（如浏览 Status、接收消息），不得强执行。

**Day 0（注册当天）** · 后台异步 3–5 分钟：
- 生成人设 JSON / 生成头像 4 张候选自动选 1 / 生成 30 张朋友圈图 / 生成 20 条语音 / 生成签名+昵称候选
- 15:00 挂载 20min · 写入昵称
- 19:00 挂载 30min · 写入签名
- 22:00 挂载 25min · 上传头像

**Day 1** · 冷却期 Day 1/3（72h 硬规则起始）：
- 10:00 挂载 30min
- 15:00 挂载 40min · 浏览 Status（不点赞）
- 21:00 挂载 30min

**Day 2** · 冷却期 Day 2/3：
- 09:30 挂载 35min
- 14:00 挂载 45min · 接收消息（不回）
- 20:00 挂载 30min

**Day 3** · 冷却期 Day 3/3 + 破壳起始：
- 10:00 挂载 30min · 72h 解除 is_new_account
- 14:30 挂载 40min · 自动接受好友 ≤ 3
- 20:00 挂载 30min · 被动回复启用（AI 兜底）

**Day 4** · 破壳冲刺（Phase 1，Status 仍被 §B.20 禁止，此日用**被动互动**作为破壳仪式）：
- 09:30 挂载 30min · 接受好友 ≤ 5
- 13:00 挂载 30min · 浏览其他人 Status feed（不点赞）
- 15:00 挂载 40min · 给其他人的 Status 点赞 1–2 个（reactive，非 broadcast）
- 20:00 挂载 30min · 被动回复启用（AI 兜底）

> Status 发布（broadcast）从 Day 8（Phase 2）才开始，频率按 §B.20 执行。

**Day 5** · 进入 Phase 1：
- 自动切换 → 可启用内部互聊
- 桌面弹窗通知租户

**时间抖动**：所有时间点实际执行时 ±15–30min 随机（防规律识别）
**夜间保护**：02:00–06:00 无任何任务（除非该号人设是"夜班型"）

---

## B.3 一键养号触发流程

**触发方式**（注册完成最后一步）：
```
✓ 槽位 01 注册成功
━━ 养号建议 ━━
  ● 立即启动一键养号 (推荐·默认选中)
  ○ 稍后手动启动
  ○ 我自己管理，不用自动养号 (专家模式)
```

**前置体检**（启动养号前必过）：
- 槽位状态 empty/ready
- 代理连通 OK
- SIM 信息已录入
- 若启用 AI：OpenAI Key / Flux / Piper 分别测试通过
- 全局调度器有空档（找 5 天内的 20+ 空档）

**自动排期算法**：
- 为日历的每个子任务找空档
- 冲突时弹"检测到冲突 · 自动顺延 XX 分钟 / 提前 YY 分钟 / 换时段"三选项
- 任一子任务失败 → 不中断总计划，跳过该点继续后面

**可选审核开关**（默认全关）：
- ☐ 头像生成后等我选一张
- ☐ 人设生成后等我审核
- ☐ 素材生成后等我删减
- ☐ 日历排期后等我确认

---

## B.4 AI 三维降级矩阵

```
┌─────────────┬─────────┬────────────┬──────────────┐
│ 组件        │ 默认   │ 启用时     │ 未启用时降级 │
├─────────────┼─────────┼────────────┼──────────────┤
│ AI 文本改写 │ 关     │ 每发送前改 │ 用 content_pool 原文随机抽 │
│ AI 对话接管 │ 关     │ 偏离剧本时  │ 不回复 / 弹窗提示手动接管  │
│ AI 人设生成 │ 关     │ 注册时生成  │ 用预置 50 人设模板库随机   │
│ AI 图片生成 │ 本地Flux│ 按需生成   │ 用预置 300 张马华图库      │
│ AI 语音生成 │ Piper  │ 按需生成   │ 剧本 voice 步骤跳过/转文本 │
└─────────────┴─────────┴────────────┴──────────────┘
```

**每组件独立开关**（settings.json）：
```json
"ai": {
  "text": { "enabled": false, "provider": "deepseek", "model": "deepseek-chat" },
  "persona": { "enabled": false, "provider": "openai" },
  "image": { "enabled": true, "provider": "flux_local" },
  "voice": { "enabled": true, "provider": "piper", "model": "zh_CN-huayan-medium" }
}
```

**未启用时 UI 表现**：
- 账号卡显示 `🎤 语音: ○ 已禁用（剧本中语音步骤跳过）`
- 执行日志显示 `⊘ 跳过语音 (语音功能未启用) 💡 启用 Flux 可生成专属图片` ← 顺手做付费升级入口

---

## B.5 快速开始向导（首次启动）

```
选择你的 AI 方案:
  ● 💰 省钱方案 (推荐)
    文本: DeepSeek · $3–5/月
    图片: Replicate Flux-schnell · $0.50/新号
    语音: Piper · 免费
  ○ ⚡ 均衡方案
    文本: Gemini Flash · 有免费额度
    图片: Replicate
    语音: Piper
  ○ 🎯 高质量方案
    文本: Claude Haiku
    图片: Flux-pro
    语音: ElevenLabs
  ○ 🔧 我自己选 (专家模式)
```

---

## B.6 Persona JSON 完整结构

```json
{
  "persona_id": "persona_a7f3e2",
  "display_name": "Jasmine Chen",
  "wa_nickname": "Jas 🌸",
  "gender": "female",
  "age": 28,
  "ethnicity": "Chinese Malaysian",
  "country": "MY",
  "city": "Petaling Jaya",
  "occupation": "电商客服",
  "languages": {
    "primary": "zh-CN",
    "secondary": ["en", "ms"],
    "code_switching": true
  },
  "personality": ["开朗", "碎碎念", "爱分享美食"],
  "speech_habits": {
    "sentence_endings": ["lah", "loh", "啦", "~"],
    "common_phrases": ["真的吗", "哇塞"],
    "emoji_preference": ["😊", "🙈", "😋"],
    "typing_style": "短句 + 偶尔错字",
    "avg_msg_length": 12
  },
  "interests": ["美食", "咖啡", "韩剧"],
  "activity_schedule": {
    "timezone": "Asia/Kuala_Lumpur",
    "wake_up": "08:30",
    "sleep": "23:30",
    "peak_hours": ["12:00-13:30", "19:00-22:00"],
    "work_hours": "09:30-18:30"
  },
  "avatar_prompt": "28-year-old Chinese Malaysian woman...",
  "signature_candidates": ["吃美食才是人生的意义 🍜"],
  "persona_lock": true,
  "created_at": "2026-04-19T10:30:00+08:00"
}
```

**人设生成器全局偏好**（租户设置）：
- 国家地区（默认马来西亚）
- 族群多选（华人/英语使用者/马来人/印度裔，按比例随机）
- 性别分布（60% 女 / 40% 男 可调）
- 年龄范围（22–45 可调）
- 语言混合（☑ 中文 ☑ 英语 ☑ 马来语夹杂）
- 活跃时段（朝九晚五/夜猫/全天）
- 职业池（默认马华常见职业，可自定义）

---

## B.7 自动接受好友详细规则

**默认值**：每日上限 30 个，间隔 60–300 秒随机

**单一/批量配置 UI**：
```
模式: ● 单一账号   ○ 批量配置

批量模式:
  应用到: ☑ 全选 (48/50) 或按分组选择
  每日上限: [30]    间隔: [60]~[300] 秒随机
  筛选条件:
    ☑ 对方有头像
    ☐ 必须在通讯录
    ☑ 对方不在黑名单
    ☐ 对方手机号国家 = [MY, SG, ...]
  接受后动作:
    ☑ 等待 N 秒后发欢迎语  [选择剧本▼]
    ☐ 打标签 [新好友]
```

**阶段上限强制裁剪**：
| Phase | 每日接受上限 |
|---|---|
| 0 · 孵化 Day 1-3 | 0（全锁） |
| 1 · 破壳 Day 4-7 | 5 |
| 2 · 激活 Day 8-14 | 15 |
| 3 · 成熟 Day 29+ | 30（可设更高） |

**风控要点**：一小时内接受 50 个 = 机器人特征，系统不允许 `间隔<60s` 或 `每日>100`。

---

## B.8 接管锁机制

**优先级体系**（最高抢占最低）：
```
手动接管    > 业务任务 > 养号任务 > 在线保活
priority=1   priority=3  priority=5  priority=7
```

**接管流程**：
1. 用户点"接管" → `POST /takeover/:accountId/acquire`
2. 检查该账号是否有任务在跑：
   - 有 → 发送"优雅暂停"信号，任务保存状态变 `paused`
   - 没有 → 直接进入接管
3. 账号状态 → `takeover_active`，其他任何任务尝试获取该号 → 被拒
4. UI 上显示 `🤖 AI 暂停中（接管中）`
5. 用户打完字 → `POST /takeover/:accountId/release`
6. 被暂停的任务从下一个时间点续跑，不需要重排日历

**接管超时**：闲置 30 分钟无操作 → 自动释放锁 + 弹窗确认

---

## B.9 仪表板首屏设计

按"异常优先 → 当日执行 → 健康趋势"三层金字塔：

```
┌─ 告警条（有事才显示）─────────────────────────┐
│ ⚠️ 2 个号掉线需重扫 · 1 个号健康分 <40        │
└──────────────────────────────────────────────┘

┌─ 四宫格 KPI ────────┐  ┌─ 6 并发槽实时视图 ──┐
│ 在线 48/50          │  │ [a03] 互聊 · 18min │
│ 发送 1,284 / 接收 956│  │ [a17] 剧本2 · 03min│
│ 失败 12             │  │ [a22] 空闲          │
└─────────────────────┘  │ [a31] 暖号 · 22min  │
                         │ [a45] 空闲          │
                         │ [a48] Status · 05min│
                         └────────────────────┘

┌─ 今日任务时间线 (24h 横轴) ──────────────────┐
│ 已完成 ████░░ 进行中 ▓ 排队 ░                │
│ 悬停看具体号+任务                             │
└──────────────────────────────────────────────┘

┌─ 健康分 Top/Bottom 10 ┐ ┌─ 7 天趋势 ──────────┐
│ ⚠️ a07  32 分  ↓      │ │ 发送量/失败率/封号 │
│ ⚠️ a19  45 分  ↓      │ │ 折线图              │
│ ✓ a31  98 分          │ │                    │
└──────────────────────┘ └────────────────────┘
```

**交互要求**：任何数字都可点进去看明细（点"在线 48" = 账号列表 + 哪 2 个掉了）。

---

## B.10 简单版报表

```
[报表] Tab 内三张卡片 + 一条折线图

今日 / 本周 / 本月 (切换)

┌──────────────────────────────────────────┐
│ 本月概览 (2026-04-01 ~ 今天)             │
│  发送消息   12,847   ↑ 8% vs 上月         │
│  接收消息    9,203   ↑ 12%                │
│  新增联系人   286                          │
│  活跃账号    48 / 50                       │
│  被封账号     1                            │
│  失败率     0.8%   ✓ 健康                 │
└──────────────────────────────────────────┘

每日发送量折线图（30 天）
▁▃▅▆▇█▇▆▅▄▃▅▇█▇▆▅▆▇▅▄▃▄▅▆▇
```

**不做**：CSV 导出、过滤器、自定义时段。

---

## B.11 备份三层策略

**Layer 1 · 本地自动快照**（默认开）：
- 每天 03:00 (本地时区 · `BACKUP_DAILY_CRON_HOUR` 可调) whitelist 打包 `data/slots/<id>/wa-session/** + fingerprint.json`
- **A+ 补跑** 启动时检查 `app_setting 'backup.last_daily_at'` · 若 > 24h / null 立即补跑一次 (防用户每晚关机永远没备份)
- 保存到 `/backups/daily/<date>/slot_<NN>.zip` · **明文 zip** (Layer 1 容量优先, 离线桌面场景)
- 保留最近 7 天, 超过自动 retention sweep
- M9 砍双模式后**不包含** chrome-profile (puppeteer 被砍 · 目录不复存在)

**Layer 2 · 手动导出 `.wab`**（迁移/换电脑用）：
- UI 一键 `[📦 备份全部]` → `wahubx_backup_<date>.wab`
- 包含：所有 profiles + sessions + 数据库（剧本/任务/日志）
- 不含：代理密钥、OpenAI Key（安全）
- 用 License Key 加密，恢复时要同一 license

**Layer 3 · 云备份**（V2，付费增值）：
- 租户填 Google Drive / OneDrive / S3 凭据
- 每日自动快照上传
- V1 不做

**换机迁移**：新机装软件 → 激活同 License → 导入 `.wab` → session 有效则不用重扫（前提同国家 IP）

---

## B.12 国家扩展 4 条硬规则

1. **IP 国家必须匹配号码国家**（马来号走新加坡 IP = 100% 触发验证）
2. **作息按本地时区自适应**（活跃时段按号所在国本地时间，别拿 UTC 调度）
3. **剧本按 `(country, language)` 双维度分组**，不是只按语言
4. **节假日/宗教日历进系统**：
   - 斋月期间白天活跃度 × 0.3（马来穆斯林号）
   - 斋月末礼物季活跃度 × 1.5
   - 农历新年前 2 周活跃度 × 1.3（华人号）
   - Deepavali / Christmas 各有相应系数

**V1 只实装 MY**，架构字段预埋全部国家维度。

---

## B.13 剧本 JSON 完整 Schema

```json
{
  "id": "s001_morning_simple",
  "name": "早安-简单问候",
  "category": "daily_greeting",
  "language": "zh",
  "country": ["MY"],
  "roles": ["A", "B"],
  "total_turns": 10,
  "min_warmup_stage": 1,
  "ai_rewrite": true,
  "persona_lock": true,
  "safety": {
    "max_daily_run_per_pair": 1,
    "min_hours_between_runs": 20,
    "skip_if_either_offline": true,
    "skip_if_ip_conflict": true
  },
  "sessions": [
    {
      "session_id": 1,
      "name": "morning",
      "delay_from_start": "0h",
      "turns": [
        {
          "turn": 1,
          "role": "A",
          "type": "text",                       // text / image / voice / file
          "content_pool": ["早", "morning", "早啊"],
          "typing_delay_ms": [400, 1500],
          "send_delay_sec": [0, 60],
          "ai_rewrite": true
        },
        {
          "turn": 2,
          "role": "B",
          "type": "voice",
          "asset_pool": "voices_casual_laugh",
          "duration_sec_range": [2, 5],
          "caption_fallback": "哈哈 🤭",
          "on_disabled": "send_fallback_text",  // skip / send_fallback_text
          "send_delay_sec": [60, 180]
        },
        {
          "turn": 3,
          "role": "A",
          "type": "image",
          "asset_pool": "images_food_malaysian",
          "caption_pool": ["看看这个 🤤", "刚 order"],
          "on_disabled": "send_fallback_text",
          "send_delay_sec": [30, 90]
        }
      ]
    }
  ],
  "asset_requirements": {
    "voices_casual_laugh": { "min_count": 10, "style": "casual_female_laugh" },
    "images_food_malaysian": { "min_count": 20, "style": "food_photography_realistic" }
  }
}
```

**字段说明**：
- `content_pool` — 文本变体池，随机抽一条
- `asset_pool` — 媒体池 ID，引用素材库
- `caption_fallback` — 媒体禁用时改发的文本
- `on_disabled` — `skip` 跳过 / `send_fallback_text` 降级文本
- `typing_delay_ms` — 模拟打字持续时长
- `send_delay_sec` — 上条结束后等多久再发
- `delay_from_start` — Session 级延迟（跨时段对话）
- `min_warmup_stage` — 号必须达到该阶段才能跑
- `ai_rewrite` — 是否过 GPT 改写（剧本级+轮次级双控）
- `safety.max_daily_run_per_pair` — 同一对号每天跑本剧本最多 N 次
- `safety.min_hours_between_runs` — 重复执行最小间隔

---

## B.14 SIM 档案卡字段

账号卡片 UI 展示的字段（对应 `sim_info` + `account_health` + `wa_account`）：

```
📱 +60 12-345 6789   [Celcom · Prepaid]
WhatsApp: ✓ 已登录  ·  昵称: Ahmad  ·  头像 ●
注册于: 2026-02-15   激活天数: 64 天

🏥 健康档案
  健康分: ████████░░ 82/100
  封号危险: 🟢 低
  养号阶段: Phase 3 · 成熟期 (Day 36)
  通讯录: 47 人 · 群组: 2 个
  本周发送: 312 条 · 失败率: 0.6%

📊 风险指标（近 30 天）
  验证码触发: 0
  被举报: 0
  加好友被拒: 2 (正常)
  高频触发冷却: 0

💳 SIM 卡信息
  运营商: Celcom   类型: Prepaid
  实名: Ahmad bin Ali
  激活日: 2026-01-10
  月费: RM 15   到期: 2026-05-10
  备注: ...

🌐 网络
  类型: 住宅静态   出口: 🇲🇾 Kuala Lumpur
  IP: 203.106.xx.xx   状态: ● 已连接
  共享槽位: 01, 05, 18 (共 3 号)

[🔄 同步状态] [💾 备份] [🔌 打开容器] [⚠️ 停用]
```

---

## B.15 IP 组 3 条硬规则

**1. 同 IP 的号绝不互加**
如果号 A、B、C 共用 IP₁，那 A-B、A-C、B-C 不能是好友。WA 一眼识别"同 IP 互聊 = 群控"。系统阻止创建这种内部互聊对。

**2. 同 IP 的号错峰活跃**
调度器选号时强制过滤：**同一 IP 组的号不能同时在跑**。
算法：每 IP 组一个 active-token，拿到 token 才能跑，释放后别的号才能拿。

**3. 同 IP 的号指纹差异化拉满**
- UA 不同（不同 Chrome 版本 + 不同机型）
- 分辨率不同（1920x1080 / 1366x768 / 1440x900 随机）
- 字体指纹随机化
- **但时区要一致**（同 IP 指向同城市，时区乱跳反而可疑）

**互聊圈 vs IP 组正交约束**：同 IP 组的号必须分散到不同互聊圈。

---

## B.16 预置素材库兜底

AI 关闭时的兜底资源，**随安装包一起打包分发**：

```
data/assets/_builtin/
├─ personas/            50 个预置人设 JSON（华人女青年/马来男中年/印裔混血…）
├─ voices/
│  ├─ zh/ (Piper 生成 100 条短语音)
│  └─ en/ (Piper 生成 60 条)
├─ images/
│  ├─ food/ (30 张马华食物)
│  ├─ life/ (30 张生活场景)
│  ├─ scenery/ (20 张马来风景)
│  ├─ shopping/ (20 张购物开箱)
│  ├─ pets/ (15 张宠物)
│  └─ selfies/ (20 张 AI 生成自拍)
└─ stickers/ (30 个表情包)
```

**总计约 200MB**，装机默认含，租户开启 AI 后可逐步替换为 AI 生成内容。

---

## B.17 `.wspack` 包结构

```
pack_my_zh_basic_v1.wspack  (加密签名 zip)
├─ manifest.json         元数据
├─ scripts/              剧本 JSON 列表
│  ├─ s001_morning_simple.json
│  └─ ...
├─ assets/               可选，包自带媒体
│  ├─ voices/
│  └─ images/
├─ personas/             可选，配套人设模板
└─ signature.sig         官方签名
```

**manifest.json**：
```json
{
  "pack_id": "official_my_zh_basic_v1",
  "name": "马来华语-基础互聊包",
  "version": "1.0.0",
  "language": "zh",
  "country": ["MY"],
  "category": "internal_chat",
  "script_count": 100,
  "min_warmup_stage": 1,
  "author": "WAhubX Official",
  "dependencies": {
    "min_app_version": "1.0.0",
    "required_asset_pools": ["voices_casual_laugh", ...]
  },
  "preview": ["s001.png", "s002.png"]
}
```

**导入流程**：签名校验 → 版本依赖校验 → 解压到 `data/packs/` → 注册到 `script_pack` 表 → 默认 `enabled=true`

---

## B.18 槽位清空 vs 原厂重置

**槽位物理锁定**：slot_id 1–50 永不改变，a01 永远是 a01。

**两档清空操作**：

| 操作 | 删除 | 保留 | 用途 |
|---|---|---|---|
| **清空账号** | WA Session、Chrome Profile、Device Identity | SIM 信息、代理配置、健康分历史 | 换号不换槽 |
| **原厂重置** | 上面全部 + SIM 信息 + 健康分历史 + 日志 | 代理配置（物理资源手动解绑） | 槽位要给别号用/彻底报废 |

**恢复到时间点**：从 `/backups/daily/` 选日期一键回滚该槽位。

**30 天回收站**：删除不是立即物理删除，保留 30 天可恢复。

---

## B.19 节假日活跃度系数

```json
{
  "holiday_calendar": {
    "MY": {
      "ramadan": { "date_range": "dynamic", "day_multiplier": 0.3, "night_boost": 1.5 },
      "raya": { "duration_days": 5, "multiplier": 1.2 },
      "cny_preparation": { "weeks_before": 2, "multiplier": 1.3, "ethnicity": "chinese" },
      "cny_main": { "duration_days": 7, "multiplier": 0.8, "ethnicity": "chinese" },
      "deepavali": { "duration_days": 2, "multiplier": 1.2, "ethnicity": "indian" },
      "christmas": { "duration_days": 3, "multiplier": 1.1 }
    }
  }
}
```

调度器生成养号日历时读取该配置，节日期间调整任务密度。

---

## B.20 Status 发布任务设计

**任务类型**：`status_post`

**内容来源**（4 层降级，从优先到最后）：
1. **persona 专属素材池**（M7 AI 生成后填充）
2. **预置素材库内置图**（§B.16，随安装包打包，M1 起即可用）
3. **剧本包 `status_posts` 类别**（纯文本 Status，风控较图文 Status 高）
4. **Skip**（素材完全空时不强发，避免异常行为）

**首选配图 Status**（2+3 纯文本是降级）。
**租户手动上传**：UI 提供上传入口，上传后进 persona 专属素材池，优先级最高。

**频率规则**：
- Phase 0-1: 禁止
- Phase 2: 每 3 天 ≤ 1 条
- Phase 3+: 每天 ≤ 1 条（过多反而像僵尸号）

**发布时间**：按人设的 peak_hours 内随机选（如午休 12-13 点、晚间 19-22 点）

---

## B.21 群聊 V2 预留设计

**V1 不做，但数据库字段预埋**：

```sql
ALTER TABLE wa_contact ADD COLUMN is_group BOOLEAN DEFAULT false;
ALTER TABLE chat_message ADD COLUMN group_jid TEXT;
```

**V2 规则**：
- 群规模 **≥ 6 人**，内部号 **≤ 3**
- 过渡期 Phase 2 末期才启用（Day 14+）
- 群内消息日均 10–30 条（真实群的频率）
- 同群内部号**错峰活跃**（调度器强制）
- 要有"潜水"人设（3 天才冒泡一次）
- 群话题剧本结构见 `剧本格式 B.13` 加 `type: "group_chat"`

---

## B.22 Meta 服务端 72h 硬约束（务必知晓）

**这不是我们能绕过的规则**，Meta 服务端对新号：

- 注册后前 72 小时账号被标记 `is_new_account = true`
- 主动行为触发的审查阈值是正常号的 5–10 倍
- 发给陌生号的消息**默认不投递**或延迟投递
- 触发验证码概率翻倍

**系统设计约束**：
- 72 小时冷却不可压缩（3day 方案也要保留）
- 冷却期内只允许：挂载在线、接收消息、资料完善、浏览 Status
- 冷却期内禁止：任何主动消息、加好友、发 Status

---

## B.23 Baileys 注册频率硬限制

**系统必须强制拦截**（避免批量注册秒封）：

- **同 IP 每日注册 ≤ 2 个**（UI 显示"该 IP 今日注册名额已满"）
- **两次注册间隔 ≥ 4 小时**
- **新号 72 小时内不发任何消息**（自动锁定所有主动任务）
- **SIM 激活 < 24 小时的号**提示"建议等一天再注册"

违反上述规则租户也**无法绕过**，UI 直接禁用按钮。

---

## B.24 测试连接 & 系统体检

**每 AI 配置项单点测试**：
```
[🧪 测试连接]
  ✓ API Key 格式正确
  ✓ 网络连通 (延迟 320ms)
  ✓ 调用成功 (返回 "hello")
  ✓ 余额检查: $12.40 可用（若 API 支持）
```

**失败具体提示**：
- `✗ Key 格式错误` 提示正确格式
- `✗ 403 Unauthorized` Key 无效
- `✗ 429 Rate Limited` 请求过频
- `✗ Network Timeout` 检查代理
- `✗ Insufficient Balance` 余额不足

**全局体检** `GET /settings/system-health`：
- 代理 × N 个：连通性 / 延迟 / 最近封禁
- AI Providers × N 个：连通 / 余额
- 素材服务：Flux / Piper 可用性
- 数据库连接
- Redis 连接
- 磁盘空间

---

## B.25 桌面告警类型表

所有需要桌面弹窗的事件（用 `node-notifier`）：

| 事件 | 紧急度 | 文案示例 |
|---|---|---|
| QR 扫码等待超时 | 🔴 高 | "槽位 01 QR 失效，请重扫" |
| 账号掉线 | 🔴 高 | "槽位 03 已掉线 10 分钟" |
| 代理断线 | 🔴 高 | "代理 203.106.x.x 断线影响 3 号" |
| 健康分 < 40 | 🟡 中 | "槽位 07 健康分 32，建议暂停任务" |
| 封号检测 | 🔴 高 | "槽位 12 疑似被封，已自动暂停" |
| OpenAI 余额不足 | 🟡 中 | "OpenAI 余额 < $1，AI 改写可能失败" |
| 养号完成 | 🟢 低 | "槽位 01 养号完成，已进入 Phase 1" |
| 任务失败累积 | 🟡 中 | "近 1 小时任务失败率 > 30%" |
| License 即将到期 | 🟡 中 | "License 30 天后到期，请续期" |
| 版本有更新 | 🟢 低 | "WAhubX v1.2 可用，点击查看" |
| 手动接管超时 | 🟢 低 | "槽位 05 接管已闲置 25 分钟" |

---

## B.26 FAhubX 代码复用清单（精确路径）

直接移植（M1 任务）：
```
FAhubX backend/src/modules/
  → auth/                  → WAhubX backend/src/modules/auth/
  → users/                 → WAhubX backend/src/modules/users/
  → license/               → WAhubX backend/src/modules/license/
  → admin-licenses/        → WAhubX backend/src/modules/admin-licenses/
  → batch-operations/      → WAhubX backend/src/modules/batch-operations/
  → account-batch/         → WAhubX backend/src/modules/account-batch/
```

改造（后续里程碑）：
```
facebook-accounts/browser-session.service.ts:298 ← user-data-dir 用法复用
chat-scripts/                                     ← 扩展 JSON schema
task-executor/                                    ← 换 Baileys
task-scheduler/                                   ← 加并发仲裁
task-queue/                                       ← 换 BullMQ
task-monitor/                                     ← 沿用
account-health/                                   ← 加健康分
vpn-client/                                       ← 按槽位独立
```

复用前端脚手架：
```
FAhubX frontend/
  → vite.config / tsconfig / package.json / obfuscate 配置
  → src/App.tsx / i18n / store / services 骨架
  → Admin 后台页面（改文案）
```

复用安装包：
```
FAhubX installer/
  → fahubx-setup.iss 改名 wahubx-setup.iss
  → build-backend.bat / build-frontend.bat / build.bat
  → obfuscate.js
```

**重要提示**：复用前先 diff FAhubX 的最新 commit，确认是你想要的版本。

---

# 📋 完整决策索引

| 主题 | 章节 |
|---|---|
| 架构总览 | § 1 |
| 模块映射 | § 2 |
| 数据库 Schema | § 3 |
| 核心 API | § 4 |
| 调度器状态机 | § 5 |
| 文件系统 | § 6 |
| 执行流程 | § 7 |
| 配置文件 | § 8 |
| 打包结构 | § 9 |
| 里程碑 | § 10 |
| 执行组规则 | § B.1 |
| 5 天养号日历 | § B.2 |
| 一键养号触发 | § B.3 |
| AI 降级矩阵 | § B.4 |
| 快速开始向导 | § B.5 |
| Persona 结构 | § B.6 |
| 自动接受好友 | § B.7 |
| 接管锁机制 | § B.8 |
| 仪表板设计 | § B.9 |
| 报表 | § B.10 |
| 备份策略 | § B.11 |
| 国家扩展规则 | § B.12 |
| 剧本 JSON Schema | § B.13 |
| SIM 档案卡 | § B.14 |
| IP 组规则 | § B.15 |
| 预置素材库 | § B.16 |
| .wspack 包结构 | § B.17 |
| 清空 vs 重置 | § B.18 |
| 节假日系数 | § B.19 |
| Status 任务 | § B.20 |
| 群聊 V2 预留 | § B.21 |
| Meta 72h 约束 | § B.22 |
| 注册频率限制 | § B.23 |
| 测试连接/体检 | § B.24 |
| 桌面告警类型 | § B.25 |
| FAhubX 复用清单 | § B.26 |
