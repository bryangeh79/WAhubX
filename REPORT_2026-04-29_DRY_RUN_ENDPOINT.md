```
================================================================
WAhubX AI 客服 dry-run debug endpoint · 完整链路验证报告
================================================================
日期: 2026-04-29
分支: claude/goofy-mendel-3f5881
新 Commit: c7aa30c


────────────────────────────────────────────────────────────────
1. 新增 / 修改了哪些文件
────────────────────────────────────────────────────────────────

新建 (3 个):
  packages/backend/src/modules/intelligent-reply/services/
    reply-debug.service.ts                       (+218)
  packages/backend/src/modules/intelligent-reply/controllers/
    reply-debug.controller.ts                    (+74)
  packages/backend/scripts/
    dry-run-test.mjs                             (+138)

修改 (3 个):
  reply-executor.service.ts                      (+95/-15)
    - 新增 DryRunTrace / HandleOptions 接口 export
    - handle() / send() / markHandoff() 加 options 参数
    - fillTrace helper · 菜单/早期 FAQ 路径写 trace
    - send() 内 dryRun=true 跳 slots.sendText + audit draft=true
    - 修菜单触发条件中文 KB 名识别 bug (containsProductName 老 normalize)

  auto-reply-decider.service.ts                  (+8/-2)
    - HANDOFF_KEYWORDS_LEVEL1 / LEVEL2 加 export
    - 新增 export function checkHandoffKeyword(text)

  intelligent-reply.module.ts                    (+22/-2)
    - 加 ConfigModule + TenantEntity TypeORM 注册
    - debugControllers / debugProviders 按 env 条件注入
      const flag = process.env.ENABLE_AI_DEBUG_ENDPOINT
      flag === 'true' || '1'  →  注入 ReplyDebugController + Service
      其他                     →  完全不挂 endpoint

边界遵守 (本轮没动 · 0 lines changed):
  ✗ WhatsApp Web selector / Chromium / session
  ✗ sendText mutex / timeout / 8s 聚合窗口
  ✗ 养号 / 广告 / takeoverLock / slot worker


────────────────────────────────────────────────────────────────
2. Endpoint 路径和使用方式
────────────────────────────────────────────────────────────────

POST /api/v1/intelligent-reply/debug/dry-run
  Headers:
    Authorization: Bearer <admin_token>
    Content-Type: application/json; charset=utf-8

  Body:
    {
      "tenantId": 99,                  // 必填 · 哪个 tenant
      "message": "我想了解祛痘",        // 必填 · 模拟客户消息
      "phoneE164": "60123456789",       // 可选 · 默认临时 phone "0000000000"
      "mode": "smart" | "faq" | "off",  // 可选 · 不传走 tenant settings · 临时改完事还原
      "kbId": 202,                      // 可选 · 强制绑 conv.kb_id
      "forceStage": "new",              // 可选 · 强制 conv stage
      "reuseRealConversation": false,   // 默认 false (建临时 conv)
      "send": false                     // 默认 false · true 拒绝
    }

  Response:
    {
      "ok": true,
      "reply": "...",                   // AI 生成的回复文本
      "tenantId": 99,
      "conversationId": 6,              // 临时 conv id
      "conversationIsTemporary": true,  // 标记是 dry-run 创建
      "modeResolved": "common_kb_faq_early",
      "kbId": 200,
      "kbName": "default common KB",
      "matchedFaqId": 536,
      "matchedVariant": null,
      "intent": "greeting",
      "confidence": 1.0,
      "handoff": false,
      "handoffReason": null,
      "productMenuShown": false,
      "usedCommonKbEarly": true,
      "isKbExplicitlyTargeted": false,
      "primaryKbIds": [...],
      "secondaryKbId": 200,
      "ragChunks": [...],
      "llmProvider": "deepseek",
      "llmModel": "deepseek-chat",
      "auditId": 59,                    // 写入的 audit 记录 id
      "steps": [
        "create temp conv · id=6 · phone=dry_xxx",
        "handle start · convId=6 · dryRun=true",
        "early common FAQ probe · kb=200 · match=faqId=536 score=1.00"
      ],
      "handoffKeywordHit": null,
      "kbPool": {                       // 当前 tenant 真实 KB · SaaS 边界证据
        "defaultKbId": 200,
        "defaultKbName": "公司通用",
        "productKbs": [
          { "id": 201, "name": "美白护理配套" },
          { "id": 202, "name": "祛痘护理配套" },
          { "id": 203, "name": "身体塑形课程" }
        ]
      },
      "echo": { ... }
    }

启动:
  ENABLE_AI_DEBUG_ENDPOINT=true pnpm --filter @wahubx/backend run dev

跑测试:
  node packages/backend/scripts/dry-run-test.mjs


────────────────────────────────────────────────────────────────
3. 如何保证 send=false 不发送 WhatsApp
────────────────────────────────────────────────────────────────

四层防御:

层 1 · controller body 拒绝
  if (body.send === true) throw BadRequestException
  → 客户端就算明传 send:true 也被拒绝在入口

层 2 · service 入口拒绝
  if (input.send === true) throw BadRequestException
  → 即使 controller 被绕过 · service 也防

层 3 · executor.send() 内部 dryRun 守卫
  if (!dryRun && (mode === 'faq' || mode === 'smart')) {
    await this.slots.sendText(...);  // 真发
  } else if (dryRun) {
    this.logger.debug('dry-run · 跳过 slots.sendText');
  }
  → debug service 调 handle 时永远传 dryRun=true · 永不进真发分支

层 4 · 临时 conv 跟真客户隔离
  - 默认 reuseRealConversation=false · 创建新 conv (phone='dry_<ts>_<rand>')
  - conv.lastAiReplyAt / aiReplyCount24h 不更新 (在 send 内 dryRun=true 跳过)
  - 不污染真客户 24h 计数 / handoff 状态

实测验证:
  跑 15 测试后 backend log 0 处 sendText 调用
  audit 14 条全部 sentMessageId=null + draft=true


────────────────────────────────────────────────────────────────
4. 是否复用现有 reply-executor / decider
────────────────────────────────────────────────────────────────

✓ 100% 复用 · 0 复制粘贴

reply-executor.handle()  ← debug service 调用
  - handle 主流程 (FAQ matching / KB pre-filter / RAG / clarify) 一字未改
  - 唯一新增: options 参数 (默认 undefined · 老 caller 完全不变)
  - dryRun=true 时 send/markHandoff 内部分支条件改

decider.checkHandoffKeyword()  ← debug service 调用
  - 抽出函数 export · debug controller 直接调
  - 跟 decider.onInbound 调用同一个常量 HANDOFF_KEYWORDS_LEVEL1
  - 0 重复定义关键词列表

不复用:
  - 不复用 decider.onInbound (因为它进 8s 聚合窗 · dry-run 不能等 8s)
  - 但 decider 的关键词检查抽出来 · debug 直接前置跑
  - 后续 decider 修改关键词列表 · debug 自动同步


────────────────────────────────────────────────────────────────
5. 是否写 audit, 如何标记 debug/draft
────────────────────────────────────────────────────────────────

写 audit (没绕过) · 双重标记:

  1. ai_reply_audit.draft = true (boolean 列)
     SQL 查询: WHERE draft = true 直接过滤 dry-run 数据
     真客户 reply (draft=false) 跟 dry-run reply (draft=true) 严格分开

  2. ai_reply_audit.guardrail_edits.dryRun = true (jsonb 字段)
     SQL 查询: WHERE guardrail_edits->>'dryRun' = 'true'
     双标记冗余 · 一边丢失另一边还在

实测验证 (DB 查):
  SELECT id, draft, guardrail_edits->>'dryRun' as dr_flag,
         intent, mode_resolved
  FROM ai_reply_audit
  WHERE id IN (59..67, 80..84) ORDER BY id;
  
  → 14/14 draft=true + dr_flag='true' ✓

guardrail_edits 还存了:
  - matched_variant (FAQ 命中的具体 variant)
  - faq_intent / faq_handoff_action / faq_risk_level
  - mode_resolved (common_kb_faq_early / primary_kb_faq / ...)
  - product_menu_shown / available_kb_ids
  - faq_only_fallback / primary_kb_ids


────────────────────────────────────────────────────────────────
6. Beauty Demo 10 条测试 输入 / 输出
────────────────────────────────────────────────────────────────

Tenant: 99 (Beauty Demo · 美容业 · 跨行业测试)
KB pool: default=200:公司通用 · products=[201:美白护理配套, 202:祛痘护理配套, 203:身体塑形课程]

▼ B1 · 客户问候
  输入: "你好"  mode=smart
  期望: common_kb_faq_early greeting
  结果:
    modeResolved: common_kb_faq_early
    kb: 200 (公司通用) · matchedFaqId: 536
    intent: greeting · confidence: 1.0
    handoff: false
    reply: "你好呀！欢迎来到我们公司～请问有什么我可以帮您的吗？"
  ✓ 0 WAhubX 偏见

▼ B2a · 闲聊 AI 模式
  输入: "你吃饭了吗"  mode=smart
  期望: common_kb_faq_early off_topic (闲聊兜底拉回业务)
  结果:
    modeResolved: common_kb_faq_early
    kb: 200 · matchedFaqId: 541 · intent: off_topic
    reply: "哈哈，我主要负责产品咨询的智能客服 😊 您是想了解我们的服务、价格、
            预约流程，还是需要我帮您转人工呢？"
  ✓ 简短陪聊 + 拉回美容业务 · 0 WAhubX 偏见

▼ B2b · 闲聊 FAQ-only 模式
  输入: "你吃饭了吗"  mode=faq
  期望: 同样命中通用 FAQ
  结果: 完全相同 (mode 不影响 FAQ 命中) · ✓

▼ B3 · 锁定具体产品 (中文 KB pre-filter 必须工作)
  输入: "我想了解祛痘"  mode=smart
  期望: KB pre-filter 锁 [202:祛痘护理配套]
  结果:
    kb: 202 (祛痘护理配套) ← KB pre-filter 命中 ✓
    走 RAG (KB 202 chunks 没 embed · 但 isKbExplicitlyTargeted=true 绕过 clarify)
    LLM 用祛痘 KB 上下文答:
    reply: "您好呀！我是智能客服小美 😊 祛痘护理配套是我们挺受欢迎的项目呢～
            请问您是想要改善哪方面的痘痘问题呀？比如是偶尔冒痘、长期反复，
            还是想预防痘印？我帮您推荐合适..."
  ✓ 中文 KB pre-filter 修复后真正命中产品 KB · 0 WAhubX 偏见

▼ B4 · 价格反问
  输入: "多少钱"  mode=smart
  期望: common_kb_faq_early pricing (无具体产品 → 反问)
  结果:
    intent: pricing · matchedFaqId: 538
    reply: "请问您想了解哪一项服务的价格呢？告诉我具体项目，
            我可以让顾问帮您查报价 😊"
  ✓ 通用价格反问 · 不说账号数量 / Pro / Enterprise · 0 偏见

▼ B5 · 预约请求
  输入: "我要预约"  mode=smart
  期望: handoff_l1_decider (预约关键词)
  结果:
    modeResolved: handoff_l1_decider
    handoff: true · handoffKeywordHit: "预约"
    reply: (none, 直接 handoff)
  ✓ 直接转人工 · 不进 executor

▼ B6 · 模糊咨询 (没产品名 → 发菜单)
  输入: "想了解你们"  mode=smart
  期望: product_menu_shown
  结果:
    modeResolved: product_menu_shown
    productMenuShown: true
    reply: "您好, 我是 Beauty Demo Tenant 的智能客服 😊
            请问您想咨询哪一个产品?
            
            1. 祛痘护理配套 - 深层清洁 + 抗炎 + 修复三步法
            2. 美白护理配套 - 专业美白护理 · 8 次疗程显著见效
            3. 身体塑形课程 - 私教 1 对 1 形体管理 · 12 周课程
            
            直接回复编号或产品名称即可"
  ✓ 100% 美容产品 · 0 WAhubX 词

▼ B7 · 关键 SaaS 偏见测试
  输入: "我有 30 个号"  mode=smart
  期望: 美容租户里不解释 WAhubX 套餐 · 拉回菜单
  结果:
    modeResolved: product_menu_shown (没识别成 WAhubX 业务)
    reply: 美容产品菜单 (1.祛痘 / 2.美白 / 3.塑形)
  ✓ 跨行业完美 · 系统不会自动用 WAhubX 套餐话术回应

▼ B8 · FAQ-only 兜底
  输入: "随便问问"  mode=faq
  期望: faq_only_fallback_menu (FAQ 都没命中)
  结果:
    intent: faq_only_fallback_menu
    reply: "不好意思, 这个问题我暂时没找到对应资料 😅 我主要可以协助您了解:
            1. 产品介绍
            2. 价格 / 套餐
            3. 开通流程
            4. 转人工客服"
  ✓ 不直接 markHandoff · 让客户回编号继续

▼ B9 · 产品 KB FAQ 命中
  输入: "美白几次能见效"  mode=smart
  期望: KB pre-filter [201] + 产品 FAQ 命中
  结果:
    kb: 201 (美白护理配套) · matchedFaqId: 542
    reply: "通常 3-4 次能看到明显变化 · 完整 8 次后稳定 ✨ 建议先来做一次
            免费皮肤检测，顾问会根据您的情况给具体建议哦"
  ✓ 真用 美白 KB 的产品 FAQ 答 · 不是模糊话术

Beauty Demo 偏见审计: 10/10 ✓ · 0 处禁止词
  (检查列表: WAhubX/FAhubX/M33/账号数量/10 号/30 号/Basic/Pro/Enterprise/VPN/封号)


────────────────────────────────────────────────────────────────
7. WAhubX 5 条测试 输入 / 输出
────────────────────────────────────────────────────────────────

Tenant: 5 (WAAutoBot)
KB pool: default=9:公司通用 · products=[18:FAhubX, 12:M33 Lotto Bot, 11:WAhubX]

▼ W1 · 锁定 FAhubX
  输入: "fahubx 是什么"  mode=smart
  期望: KB pre-filter 锁 [18:FAhubX]
  结果:
    kb: 18 (FAhubX) · matchedFaqId: 506
    reply: "FAhubX 是自动养号系统，帮助 Facebook 账号暖化与长期维护，
            模拟真人行为，让账号更稳定。"
  ✓ FAhubX KB 命中 + 真答案

▼ W2 · 模糊 (没明说 wahubx)
  输入: "whatsapp 多账号可以几个号"  mode=smart
  期望: KB pre-filter 命中 WAhubX 或走菜单
  结果:
    modeResolved: product_menu_shown (没含产品名 "WAhubX")
    reply: WAhubX tenant 的菜单 (FAhubX/M33/WAhubX)
  ✓ 合理 · 没明说 wahubx 让客户选 (KB name "WAhubX" normalize="wahubx" 不在
    "whatsapp 多账号可以几个号" normalize="whatsapp..." 子串里)

▼ W3 · 介绍一下
  输入: "介绍一下"  mode=smart
  期望: 通用 FAQ 命中 反问哪个产品
  结果:
    modeResolved: common_kb_faq_early · matchedFaqId: 481
    reply: "你好呀～我们这边有FAhubX、M33 Lotto Bot和WAhubX几个产品，
            您是想先了解哪个呢？比如功能、价格、案例或使用流程，告诉我您的需求..."
  ✓ 通用 FAQ 命中 + 列出 WAhubX 自己的产品

▼ W4 · 问候
  输入: "你好"  mode=smart
  期望: 通用 FAQ greeting 命中
  结果:
    modeResolved: common_kb_faq_early · matchedFaqId: 455
    reply: "哈喽～我是你的智能小助手！想了解 FAhubX、M33 Lotto Bot 或 WAhubX 吗？
            随时告诉我，帮你安排体验哦～"
  ✓ greeting 命中 + 主动列产品

▼ W5 · 转人工
  输入: "我想买"  mode=smart
  期望: handoff_l1_decider (买关键词)
  结果:
    handoff: true · handoffKeywordHit: "想买"
    reply: (none, decider 直接拦截)
  ✓ 直接转人工

WAhubX tenant 测试: 5/5 ✓ · 行为符合预期


────────────────────────────────────────────────────────────────
8. 是否发现新的 SaaS 偏见
────────────────────────────────────────────────────────────────

✓ 0 处新偏见 · 但发现并修了 1 处残留 bug

残留 bug (来自 commit 03d4562 修中文 KB pre-filter 时漏的):
  位置: reply-executor.service.ts · 多产品菜单触发条件 (containsProductName)
  老代码: const n = k.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          (只保留英文数字 · 中文产品名 normalize 后 = 空)
  
  导致: 客户问 "我想了解祛痘" / "美白几次能见效" 时
        containsProductName=false (没识别中文 KB 名) → 触发菜单
        而不是命中产品 KB
  
  本次修: 复用主路径 kbNameMatchesQuery 同款 (保留中文 + 子串扫描)
  实测: B3 / B9 现在正确锁定产品 KB · 不再误发菜单

测试 audit (DB 验证):
  SELECT COUNT(*) FROM ai_reply_audit WHERE draft=true AND tenant_id=99;
  → 13 (Beauty Demo dry-run 全部 draft 标记)
  
  SELECT COUNT(*) FROM ai_reply_audit
  WHERE draft=true AND tenant_id=99 AND reply_text LIKE '%WAhubX%';
  → 0 (Beauty Demo dry-run 0 条含 WAhubX)


────────────────────────────────────────────────────────────────
9. 风险点
────────────────────────────────────────────────────────────────

R1 (低) · ENABLE_AI_DEBUG_ENDPOINT 没默认 false 检查
  当前: process.env.ENABLE_AI_DEBUG_ENDPOINT 未设 → undefined !== 'true'
        controller 不挂 · provider 不注入 · 0 风险
  生产 .env 不设 ENABLE_AI_DEBUG_ENDPOINT 自动安全

R2 (低) · 临时 conv 残留
  每次 dry-run 创建临时 conv (phone='dry_<ts>_<rand>')
  当前不删 · 长期跑会累积. SQL 清理:
    DELETE FROM customer_conversation
    WHERE phone_e164 LIKE 'dry_%';
    
    DELETE FROM ai_reply_audit
    WHERE draft = true;
  V2 建议: 加定时清理 task (e.g. 每天凌晨清 7 天前的 dry-run conv + audit)

R3 (低) · trace.modeResolved 部分路径未填
  RAG 路径 / clarify 路径 / FAQ-only fallback 路径 没调 fillTrace 写 modeResolved
  实测有些响应 modeResolved=null · reply/kbId 仍正确填了
  V2 建议: 统一所有分支调 fillTrace · 全路径 trace 完整

R4 (低) · mode override 临时改 settings 同步问题
  dryRun(input) 改 settings.mode 后跑 handle · 完事还原
  并发场景: A 跑 dry-run mode=faq, B 同时 dry-run mode=smart →
            后改的 mode 覆盖前一个 · 可能出现 A 实际跑了 smart
  
  缓解: 当前 dry-run 是 admin 单人调试 · 并发概率极低
  V2 建议: pass mode override 给 handle 而非改 settings

R5 (无) · 真发 WhatsApp 风险
  四层防御 (controller / service / executor / 临时 conv 隔离)
  实测 backend log 0 sendText 调用 · audit 0 真 sentMessageId


────────────────────────────────────────────────────────────────
10. 下一步建议
────────────────────────────────────────────────────────────────

S1 (立即) · 前端 admin debug 页面
  /admin/debug/ai-reply 页面 · 文本框输 message + 选 tenant + mode
  调 dry-run endpoint · 把 result 渲染成树状决策路径 + 高亮 KB
  让运维不用 curl · 鼠标点测试

S2 (立即) · 跑更多 edge case
  - 客户连发 4 条消息合并 (传 message="xxx\nxxx\nxxx\nxxx")
  - 各种 handoff 关键词 (退款 / 投诉 / 不能登录 等)
  - mode=off 时 dry-run 怎么表现
  - tenant 0 个产品 KB 时

S3 (V2) · 加完整 RAG trace
  - traceRef.ragChunks 在 RAG 路径填 (chunkId / kbId / score / preview)
  - traceRef.llmProvider / llmModel 从 tenant AI provider 读
  - 让运维看到 LLM 真用了哪些资料

S4 (V2) · 加 inboundMessage 字段写入
  当前 handle() 没把 mergedQuestion 写到 audit.inbound_message
  导致 audit 看不到客户原话
  建议: send() 加 inboundMessage 参数 · audit 写

S5 (V3) · 完整 prompt 存 audit
  加列 audit.system_prompt_text + user_prompt_text (或 jsonb)
  调试时能完整回放当时 LLM 看到了什么


================================================================
完整 commit 链 (今天 SaaS 客服 V2 全栈):
  eb57de1 feat: AI 客服 V2 (FAQ 生成 + 多产品菜单 + 销售引导)
  884bbdf fix: SaaS 通用 (去 WAhubX 偏见话术)
  03d4562 fix: 中文 KB pre-filter + 菜单优先级
  c7aa30c feat: dry-run debug endpoint + 修菜单触发条件中文识别 ← 本次

Backend 启动: ENABLE_AI_DEBUG_ENDPOINT=true · PID 在 9700 · 无 hardcoded 偏见
================================================================
```
