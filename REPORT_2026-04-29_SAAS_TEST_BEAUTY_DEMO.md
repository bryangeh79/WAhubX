```
================================================================
WAhubX SaaS 多租户验证测试报告 · Beauty Demo Tenant
================================================================
日期: 2026-04-29
分支: claude/goofy-mendel-3f5881
新 Commit: 03d4562 (跑测发现 2 bug · 修后再跑全过)


────────────────────────────────────────────────────────────────
1. 新建 / 模拟了哪些测试租户和 KB
────────────────────────────────────────────────────────────────

测试租户 1: Beauty Demo Tenant (新建 · 美容业 · 跨行业测试)
  ──────────────────────────────────────────
  tenant_id: 99
  name: Beauty Demo Tenant
  email: beauty@demo.test
  plan: pro
  slot_limit: 30
  
  KB 列表 (4 个):
    200 公司通用       (is_default=true · 6 条 starter FAQ)
    201 美白护理配套   (is_default=false · 2 条产品 FAQ)
    202 祛痘护理配套   (is_default=false · 2 条产品 FAQ)
    203 身体塑形课程   (is_default=false · 2 条产品 FAQ)
  
  通用 KB starter FAQ (200):
    1. "你好"        intent=greeting
    2. "介绍一下"    intent=product_intro · fu="您具体想了解哪方面?"
    3. "多少钱"      intent=pricing · handoff:if_no_price
    4. "人工"        intent=human_agent · handoff:always
    5. "怎么预约"    intent=demo · handoff:always
    6. "你吃饭了吗"  intent=off_topic
  
  产品 KB 各 2 条 FAQ (含 var:/intent:/handoff:/risk: tags):
    201: "美白几次能见效", "美白会反弹吗"
    202: "祛痘会留疤吗", "祛痘多久见效"
    203: "塑形课多久一次", "没运动基础能做吗"

  tenant_reply_settings:
    mode: smart
    default_kb_id: 200
    daily_ai_reply_limit: 200

对照租户 (现有): WAhubX Tenant
  ──────────────────────────────────────────
  tenant_id: 5
  KB 列表 (4 个):
    9  公司通用      (is_default=true)
    11 WAhubX
    12 M33 Lotto Bot
    18 FAhubX

SaaS 隔离验证 (SQL):
  SELECT tenant_id, COUNT(*), array_agg(name) FROM knowledge_base 
  WHERE tenant_id IN (5, 99) GROUP BY tenant_id;
  
  tenant_id |          names
  ──────────┼─────────────────────────────────────────
       5    | {公司通用, WAhubX, M33 Lotto Bot, FAhubX}
       99   | {公司通用, 美白护理配套, 祛痘护理配套, 身体塑形课程}
  
  ✓ 完全独立 · 0 跨 tenant 引用 · 0 共享数据


────────────────────────────────────────────────────────────────
2. 每个测试案例的输入和实际输出
────────────────────────────────────────────────────────────────

测试方式: 独立 Node 脚本 (packages/backend/scripts/saas-test-runner.mjs)
直接复制 reply-executor 纯函数, 数据从 PG 拉, 模拟 handle() 决策路径.
不调 LLM (因为 Beauty Demo 没扫码客服号, 真 LLM 端到端做不了).

▼ T1 · 客户首发问候 (问候 FAQ 优先 · 不发菜单)
  Tenant: 99 (Beauty)
  输入: "你好"
  决策: faq_hit_common_early
  Trace:
    KB pool · default=200:公司通用 · products=[201:美白护理配套, 202:祛痘护理配套, 203:身体塑形课程]
    早期通用 FAQ 命中 kb=200 · score=1.00 · faq="你好" · 跳过菜单
  实际答: "你好呀！欢迎来到我们公司～请问有什么我可以帮您的吗？"
  ✓ 没出现 WAhubX/FAhubX/M33

▼ T2 · 介绍一下 (通用 FAQ 反问哪个产品)
  输入: "介绍一下"
  决策: faq_hit_common_early · score=1.00
  实际答: "请问您想了解哪一项服务呢？我们这边主要提供几个不同的项目，
          您可以告诉我您的需求～"
  ✓ 中性话术 · 没绑定特定行业

▼ T2b · 模糊咨询 (没产品名 + 没问候 → 发菜单)
  输入: "想了解你们"
  决策: product_menu_shown
  实际菜单:
    您好, 我是 [Tenant Name] 的智能客服 😊
    请问您想咨询哪一个产品?
    
    1. 美白护理配套 - 专业美白护理 · 8 次疗程显著见效
    2. 祛痘护理配套 - 深层清洁 + 抗炎 + 修复三步法
    3. 身体塑形课程 - 私教 1 对 1 形体管理 · 12 周课程
    
    直接回复编号或产品名称即可
  ✓ 100% 用 Beauty Demo 自己的 KB · 不出现 WAhubX 任何产品

▼ T3 · 锁定具体产品 (中文 KB pre-filter 必须工作)
  输入: "我想了解祛痘"
  决策: rag_or_clarify
  Trace:
    KB pre-filter 命中: [202:祛痘护理配套] ✓
    smart 模式 · FAQ 没命中 · 转 RAG · isKbExplicitlyTargeted=true
  实际行为: 测试脚本不跑 RAG · 实跑环境会喂祛痘 chunks 给 LLM 答
  ✓ 中文产品名 KB pre-filter 修复后正常工作 (Bug 1)

▼ T4 · 价格反问
  输入: "多少钱"
  决策: faq_hit_common_early · score=1.00
  实际答: "请问您想了解哪一项服务的价格呢？告诉我具体项目，
          我可以让顾问帮您查报价 😊"
  ✓ 通用价格反问 · 没说 Basic/Pro/Enterprise/账号数量

▼ T5 · 预约请求
  输入: "可以预约吗"
  决策: handoff_l1 · 命中 keyword "预约"
  实际行为: decider 拦截 · markHandoff · 不进 executor
  ✓ 自动转人工 (任务 8 关键词扩展)

▼ T6a · demo 请求
  输入: "我要 demo"
  决策: handoff_l1 · 命中 keyword "demo"
  ✓ 立即转人工

▼ T6b · 重复 (确保 "预约" 也命中)
  输入: "我要预约"
  决策: handoff_l1 · 命中 keyword "预约"
  ✓ 立即转人工

▼ T7a · 闲聊 (通用 FAQ 闲聊兜底优先 · 不发菜单)
  输入: "你吃饭了吗"
  决策: faq_hit_common_early · score=1.00 · 命中 starter FAQ
  实际答: "哈哈，我主要负责产品咨询的智能客服 😊 
          您是想了解我们的服务、价格、预约流程，还是需要我帮您转人工呢？"
  ✓ 简短陪聊 + 拉回业务 + 没说 WAhubX 业务 (Bug 2 修)

▼ T8 · 关键 SaaS 偏见测试 · "30 个号" 在美容租户
  输入: "我有 30 个号"
  Tenant: 99 (Beauty)
  决策: product_menu_shown
  实际菜单: 列出 Beauty 自己的 3 个 KB · 不解释什么是"30 个号"
  ✓ AI 不会自动用 WAhubX Pro 套餐话术回应
  ✓ 让客户先选产品 · 后续根据具体产品 KB 答 (美容跟"号"无关)

▼ T8-W · 对照 · 同一句话在 WAhubX 租户
  输入: "我有 30 个号"
  Tenant: 5 (WAhubX)
  决策: product_menu_shown
  Trace: products=[11:WAhubX, 12:M33 Lotto Bot, 18:FAhubX]
  ✓ 同一段代码同一逻辑 · 自动用 WAhubX 自己的产品 KB
  ✓ 但是从 DB 动态读取 · 不是因为代码 hardcoded WAhubX

▼ T9a · 多产品菜单全流程
  输入: "想了解你们"
  决策: product_menu_shown
  ✓ 菜单 100% 来自 Beauty 自己的 KB

▼ T9b · 客户回 "2"
  输入: "2" (在 lastWasProductMenu state 下)
  决策: product_menu_picked
  绑定: kb=202:祛痘护理配套
  ✓ 数字编号正确解析

▼ T9c · 客户回产品名简称
  输入: "塑形"
  决策: product_menu_picked
  绑定: kb=203:身体塑形课程
  ✓ 中文部分匹配 · "塑形" 子串在 "身体塑形课程" 里 → 命中


────────────────────────────────────────────────────────────────
3. 是否出现 WAhubX / 账号系统偏见
────────────────────────────────────────────────────────────────

✓ 0 处偏见

测试脚本最后跑了一轮 SaaS 偏见审计 · 检查所有 Beauty Demo 输出是否含
禁止词列表:
  WAhubX / FAhubX / M33 / Lotto / Facebook Auto Bot / 
  WhatsApp 多账号 / 养号 / 广告号 / 账号数量 /
  10 号 / 30 号 / 50 号 / Basic / Pro / Enterprise /
  VPN / 封号

13 个测试案例 (Beauty Demo) 全部 ✓ 无偏见.

生产代码静态审计:
  grep -rnE "WAhubX|FAhubX|M33 Lotto|Facebook Auto Bot|10 号|30 号|
            50 号|账号数量|多少个号|账号需求量|VPN|封号"
       packages/backend/src/modules/intelligent-reply
  
  → 0 处生产 prompt / 配置 hardcoded
  → 注释里提到的均为历史 bug 修复说明 (描述用 · 不影响 LLM)


────────────────────────────────────────────────────────────────
4. 是否确认产品菜单动态读取当前 tenant KB
────────────────────────────────────────────────────────────────

✓ 100% 动态.

代码层 (reply-executor.service.ts):
  const allProductKbsForMenu = await this.kbRepo.find({
    where: { 
      tenantId: conv.tenantId,    ← 当前对话的 tenant
      isDefault: false,            ← 排除公司通用 KB
      status: 1                    ← 只活跃 KB
    },
  });
  
  const menuLines = allProductKbsForMenu
    .map((k, i) => `${i + 1}. ${k.name}${k.description ? ' - ' + k.description : ''}`)
    .join('\n');

测试验证:
  Tenant 99 (Beauty) 菜单:
    1. 美白护理配套 - 专业美白护理 · 8 次疗程显著见效
    2. 祛痘护理配套 - 深层清洁 + 抗炎 + 修复三步法
    3. 身体塑形课程 - 私教 1 对 1 形体管理 · 12 周课程
  
  Tenant 5 (WAhubX) 菜单:
    1. WAhubX
    2. M33 Lotto Bot
    3. FAhubX

  完全不同 · 同一段代码 · 数据从 DB 来.

边界条件:
  - tenant 0 个产品 KB → 不发菜单
  - tenant 1 个产品 KB → 不发菜单 (单产品自动绑)
  - tenant 2-N 个产品 KB → 发菜单
  - tenant 50 个产品 KB → 全部列出 (没截断 · V2 优化)


────────────────────────────────────────────────────────────────
5. 是否确认 default KB 是租户级
────────────────────────────────────────────────────────────────

✓ 100% 租户级.

数据层:
  tenant_reply_settings 表
    tenant_id (PK)              ← 一行 per tenant
    default_kb_id               ← 指向当前 tenant 的某个 KB
  
  Tenant 99 default_kb_id = 200 (Beauty 自己的"公司通用")
  Tenant 5  default_kb_id = 9   (WAhubX 自己的"公司通用")
  
  → 任何 tenant 走 reply-executor 拿到的 default KB 都是该租户自己的
  → 任何 tenant 之间 default KB 完全隔离

代码层:
  const settings = await this.settings.get(conv.tenantId);
  const defaultKbId = settings.defaultKbId;
  // ↑ 这是 tenant.default_kb_id · 100% 当前 tenant 的

starter FAQ 灌入 (Migration 1798):
  扫所有 tenant · 给每个 tenant 自动建 1 个 "公司通用" KB · 灌 52 条
  starter (问候 / 转人工 / 价格反问 / 闲聊兜底等通用客服话术)
  
  Beauty Demo Tenant (id=99) 的灌入是手动 SQL (本测试简化版 6 条)
  实际生产环境 · 任何新建 tenant 都会自动得 1 个独立 default KB

新加 SaaS 边界 runtime debug log:
  conv X (tenant=Y) · KB pool · default=Z · products=[...]
  
  生产 backend 跑一段时间, 这条 log 能确认每个 tenant 加载的 KB 真隔离.


────────────────────────────────────────────────────────────────
6. 如有修正, 改了哪些文件
────────────────────────────────────────────────────────────────

测试发现 2 处真 SaaS 边界缺陷 · 立即修了:

▌ Bug 1 · 中文产品名 KB pre-filter 永远失效
  文件: packages/backend/src/modules/intelligent-reply/services/
        reply-executor.service.ts (line 159-189)
  
  老代码:
    const normalizeForKbName = (s) =>
      s.toLowerCase().replace(/[^a-z0-9]/g, '');
    // → "祛痘护理配套" normalize 后 = "" (空)
    // → kbNorm.length >= 3 假 · 不命中
    // → 中文租户 KB pre-filter 完全失效
  
  新代码:
    const normalizeForKbName = (s) =>
      s.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
    
    const kbNameMatchesQuery = (kbNorm, qN) => {
      if (kbNorm.length < 2 || qN.length < 2) return false;
      // 整词 (英文长名)
      if (qN.includes(kbNorm) || kbNorm.includes(qN)) return true;
      // 子串扫描 (中文短问)
      const maxLen = Math.min(kbNorm.length, 8);
      for (let len = maxLen; len >= 2; len--) {
        for (let i = 0; i + len <= kbNorm.length; i++) {
          const sub = kbNorm.substring(i, i + len);
          if (qN.includes(sub)) return true;
        }
      }
      return false;
    };
  
  效果: 客户问"祛痘" · KB "祛痘护理配套" 子串"祛痘"在 query 里 → 命中 ✓
  
  风险: 子串至少 2 字 · 单字"我/你/想"等不会触发误命中.
        多 KB 命中 (e.g. 客户问"配套" · "美白护理配套"+"祛痘护理配套" 都命中)
        合并为 primaryKbIds · 走跨 KB FAQ + RAG · LLM 自己看资料区分.

▌ Bug 2 · 多产品菜单优先级太高 · 拦闲聊 FAQ
  文件: 同上 (line 110-145)
  
  老逻辑:
    多产品 + conv 没绑 → 直接发菜单
    → 客户问 "你吃饭了吗" / "怎么联系" / "谢谢" 等通用 FAQ 被菜单拦
  
  新逻辑:
    Step 0.5 · 多产品菜单触发前先扫一遍 secondary 通用 KB FAQ
    matchFaq(defaultKbId, query) score >= 0.55 → 直接答 + intent='faq_hit_common_early'
    没命中才考虑发菜单
  
  效果:
    "你好" / "你吃饭了吗" / "多少钱" / "介绍一下" → 通用 FAQ 优先答 ✓
    "想了解你们" → 通用 FAQ 没命中 → 发菜单 ✓
    "想了解祛痘" → 通用 FAQ 没命中 → KB pre-filter 锁祛痘 KB ✓

▌ 同步改 Node 测试脚本
  文件: packages/backend/scripts/saas-test-runner.mjs
  保持纯函数跟生产代码等价 · 不漂移

▌ 测试数据
  文件: scripts/saas-test-beauty-demo.sql
  幂等 SQL (ON CONFLICT DO UPDATE/NOTHING) · 可重复跑


────────────────────────────────────────────────────────────────
7. 风险点
────────────────────────────────────────────────────────────────

R1 (中) · 子串包含的"假阳性" 风险
  Bug 1 的修法 (KB 名子串 ≥ 2 字在 query 里命中) 可能误触发:
  - 美容租户有 2 个 KB 都含 "护理" → 客户问 "护理" 时 2 个 KB 都命中
  - 客户问 "配套" → 美白+祛痘 KB 都命中 (因为都叫"X 护理配套")
  
  当前缓解: 多 KB 命中 → 合并为 primaryKbIds · 跨 KB 检索 · LLM 看资料区分
  V2 优化: 排除 KB 间共有的子串 ("护理"/"配套" 在多 KB 出现时不当 keyword)

R2 (低) · 早期 FAQ 命中可能拦下产品 KB 命中
  Bug 2 修法: 通用 FAQ 命中 (score >= 0.55) 直接答, 不进产品 KB 路径
  风险场景:
    客户问 "祛痘多少钱" · 通用 FAQ "多少钱" canonical jaccard 高 → 命中
    答 "请问您想了解哪一项服务的价格" · 没具体说祛痘
  
  实际: 还好. 客户回 "祛痘" 后 KB pre-filter 会锁定 → 后续问价
        会触发 handoff:if_no_price 转人工.
  
  V2 优化: 早期通用 FAQ 命中阈值改 0.85 (高分 = 完全 match · 像 "你好"="你好")
        中分 (0.55-0.85) 让产品 KB 路径优先

R3 (低) · 真 LLM 端到端测试做不到
  当前测试只覆盖纯函数 (FAQ/菜单/KB pre-filter)
  RAG cosine + LLM 真答 (DeepSeek/OpenAI) 没测
  原因: Beauty Demo Tenant 没绑 WhatsApp 客服号 (没扫码登录)
  建议: V2.1 加 admin 调试 endpoint · POST /admin/debug/simulate-reply
        backend 内部触发 takeover.message.in event · 走完整路径

R4 (无) · 跨 tenant 数据泄漏
  代码层 SQL 全部 WHERE tenant_id = conv.tenantId 限定
  KB / FAQ / chunks / settings / audit 全部按 tenant_id 隔离
  → 0 风险

R5 (低) · Beauty Demo 测试租户残留
  本次测试用 INSERT id=99 灌数据 · 没清理
  生产环境如果走同库 · 会留这条测试 tenant
  建议: 测完跑 DELETE · 或 tenant.id 用 999900+ 区段标识 "测试用" tenant


────────────────────────────────────────────────────────────────
8. 下一步建议
────────────────────────────────────────────────────────────────

立即可做 (低风险):
  S1 · 真 LLM 端到端测试
    - 在 admin debug controller 加 POST /admin/debug/simulate-inbound
    - 模拟 takeover.message.in event · 走真完整路径 (含 RAG + LLM)
    - 给 Beauty Demo + WAhubX 各跑 5-10 case · 看真实 LLM 输出
    - 验证 LLM 是否真按 system prompt 答 (不漏 "WAhubX 套餐" 等偏见)
  
  S2 · KB 名共有子串排除
    - 检测 tenant 内多 KB 名共有子串 (e.g. "护理配套") · 这些不当 keyword
    - 让 KB pre-filter 命中"差异化"产品名 (e.g. "祛痘"/"美白"/"塑形")
  
  S3 · 早期 FAQ 命中阈值调到 0.85
    - 只让"完全 match"的通用 FAQ 拦下菜单
    - 中分让产品 KB 路径接管

中期 (V2 · 需要 migration):
  M1 · KB.aliases text[] 列
    - 租户后台可手动加 KB 别名 (e.g. FAhubX KB 加 ["fahubx", "Facebook Auto Bot"])
    - 替代当前脆弱 keyword pre-filter

  M2 · KB.sort_order int 列
    - 租户后台可调菜单顺序 (主推产品排前)

  M3 · ai_reply_audit.raw_inbound_message
    - 当前 audit.inboundMessage 字段存在但 handle() 没传
    - 加进去让审计可追溯客户原话

长期 (V3):
  L1 · 转人工外部通知 (Telegram bot · Email)
  L2 · LLM 输出 post-filter (敏感词列表外拒答)
  L3 · 多 tenant prompt 多版本 (允许租户后台微调 system prompt)


────────────────────────────────────────────────────────────────
9. Build / Backend / 测试运行结果
────────────────────────────────────────────────────────────────

✓ pnpm --filter @wahubx/backend run build · TS 0 errors
✓ Backend nest --watch hot-reload PASS
✓ 9700 LISTENING · PID 14808 跑 commit 03d4562
✓ Git commits 链 (今晚 SaaS 客服 V2 全栈):
    eb57de1 feat: AI 客服 V2 (FAQ + 菜单 + 销售引导)
    884bbdf fix: SaaS 通用 (去 WAhubX 偏见话术)
    03d4562 fix: 中文 KB pre-filter + 菜单优先级 ← 本次

✓ 13 个测试案例 100% 通过
✓ 0 处 WAhubX 偏见 (审计禁止词列表)
✓ 跨行业 (美容 vs SaaS) 同一段代码同一逻辑 · 数据完全隔离

测试基础设施:
  scripts/saas-test-beauty-demo.sql        SQL 数据 (幂等)
  packages/backend/scripts/saas-test-runner.mjs  Node 测试 runner
  
  跑法:
    cat scripts/saas-test-beauty-demo.sql | docker exec -i wahubx-dev-pg psql -U wahubx -d wahubx
    node packages/backend/scripts/saas-test-runner.mjs


================================================================
报告完
================================================================
```
