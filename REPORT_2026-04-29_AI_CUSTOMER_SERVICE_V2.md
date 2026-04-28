```
================================================================
WAhubX AI 智能客服 V2 优化报告
================================================================
分支: claude/goofy-mendel-3f5881
Commit: eb57de1
日期: 2026-04-29
范围: 仅 AI 智能客服板块 (零 DB migration · 零禁止区域改动)


────────────────────────────────────────────────────────────────
1. 改了哪些文件
────────────────────────────────────────────────────────────────

1.1  packages/backend/src/modules/intelligent-reply/services/
       knowledge-base.service.ts                  (+90/-25)
       — generateFaqs() prompt 升级 + 输出结构化 JSON

1.2  packages/backend/src/modules/intelligent-reply/services/
       reply-executor.service.ts                  (+360/-30)
       — 多产品菜单 / FAQ-only 兜底 / AI prompt 升级 / matchFaq 跨 variants
         / send() metadata / 辅助函数

1.3  packages/backend/src/modules/intelligent-reply/services/
       auto-reply-decider.service.ts              (+25/-5)
       — HANDOFF_KEYWORDS_LEVEL1 扩展


────────────────────────────────────────────────────────────────
2. 每个文件改了什么
────────────────────────────────────────────────────────────────

2.1  knowledge-base.service.ts · generateFaqs(tenantId, kbId)

     - 检测 kb.isDefault → 切换 prompt scope
       isDefault=true  → 公司通用 KB · 出"客服通用话术 FAQ" (问候/营业时间/
                         转人工/价格反问/闲聊兜底)
       isDefault=false → 产品 KB · 出"产品专属 FAQ" (功能/套餐/风险/开通)

     - System prompt 角色改为 "资深 WhatsApp 客服话术设计师"
       要求口语化 + 销售导向 + 末尾追问 + 适度 emoji + 不报价 + 不承诺

     - User prompt 强制输出结构化 JSON, 每条:
       {
         canonical_question, variants[], answer, intent,
         handoff_action, follow_up_question, risk_level, tags[]
       }

     - 解析阶段把 variants/intent/handoff_action/follow_up_question/
       risk_level 全部塞进 KbFaqEntity.tags 数组, 用前缀区分:
         intent:pricing
         handoff:if_no_price
         risk:medium
         fu:请问您想管理多少个号
         var:多少钱
         var:这个价位怎么样
         lead_collection (普通 tag · 不带前缀)

     - 兼容老格式 (q/a) · 兼容 AI 偶尔不输出某字段


2.2  reply-executor.service.ts · handle()

     入口顺序 (改动后):
     ┌─────────────────────────────────────────────────────────┐
     │ 1. ConversationStage 检查 (HumanTakeover/HandoffRequired/│
     │    DoNotReply/Closed → return)                          │
     │ 2. settings.mode === 'off' → return                     │
     │ 3. 多产品菜单逻辑 (新):                                  │
     │    a) 5min 内有 product_menu_shown audit                │
     │       → parseProductMenuReply() 解析数字/产品名         │
     │       → 命中: 绑 conv.kbId + 发确认问候 + return        │
     │    b) tenant 多产品 KB + conv 没绑 + 不像问候/产品名    │
     │       → 发菜单 + return                                  │
     │ 4. 老逻辑: KB pre-filter / FAQ Jaccard / RAG 不动        │
     │    + matchFaq 改跨 variants                             │
     │    + send() 写 metadata                                 │
     │ 5. FAQ-only 没命中 (新): 发默认 4 项菜单 (产品介绍/价格 │
     │    /开通流程/转人工) · 不 markHandoff                   │
     │ 6. AI 模式 system prompt 全面升级                       │
     └─────────────────────────────────────────────────────────┘

     新加的辅助函数 (private):
       isGreetingOrSimple(s)        — 问候/转人工/谢谢检测
       parseProductMenuReply(s, kbs) — 数字 + 产品名两种解析
       getTenantDisplayName(tenantId) — 菜单开场白用 tenant.name

     新加的 static 工具:
       extractVariantsFromTags(tags) — 抽 var:* 前缀
       extractFaqMeta(tags)          — 抽 intent:/handoff:/risk:/fu:/var:

     matchFaq() 改动:
       - 同时跑 canonical question + 所有 variants Jaccard
       - 取每个 FAQ 内最高分 + 全 KB 取最高 FAQ
       - 返回 matchedVariant (命中的是哪个 variant 文本)

     send() 改动:
       - 加 metadata?: Record<string, unknown> 参数
       - 写入 ai_reply_audit.guardrail_edits jsonb 字段 (复用)
       - intent='system_notice_*' 或 'product_menu_shown' 不计入
         ai_reply_count_24h (不消耗 conv 配额)


2.3  auto-reply-decider.service.ts

     HANDOFF_KEYWORDS_LEVEL1 扩展项:
     - 客户主动要求人工: 人工/真人/转人工/找人工/老板/sales/agent/human
     - demo / 购买: demo/演示/试一下/试用/购买/下单/我要买/buy/purchase
     - 商务: 报价/合同/见面/预约
     - 付款: 付款/付不了/不能付款/payment failed
     - 技术: 账号异常/不能登录/登不上/账号被封/banned

     Level 2 缩小到只有价格 + 套餐 (LLM 提示用 · 不直接 markHandoff)


────────────────────────────────────────────────────────────────
3. 数据库 migration · 新增字段
────────────────────────────────────────────────────────────────

✗ 没有 migration
✗ 没有新字段

✓ 全部复用现有字段:
  - KbFaqEntity.tags (text[])              → 塞 var:/intent:/handoff:/risk:/fu:
  - AiReplyAuditEntity.guardrail_edits (jsonb) → 塞 metadata
  - CustomerConversationEntity.kb_id        → 产品菜单绑定
  - AiReplyAuditEntity.intent              → 'product_menu_shown' 当 state 标记

风险点: tags 用前缀偷渡 variants/intent 等 · 单元素长度无 hard limit ·
       但生成端限制 var: ≤ 100 字 / fu: ≤ 200 字 / 整体 tags ≤ 30 项.


────────────────────────────────────────────────────────────────
4. FAQ 生成 prompt 如何优化
────────────────────────────────────────────────────────────────

A. 角色定位:
   "产品运营专家"  →  "资深 WhatsApp 客服话术设计师"

B. 输出风格硬要求:
   - 中文口语化 · 像真人客服微信聊天
   - 答完带追问 (推动客户继续说)
   - 适度 emoji
   - 不官方腔 / 不机械
   - 资料没价格 → 引导留联系方式 + 转人工

C. 公司通用 vs 产品 KB 完全不同的 scope:
   - 通用: 只生成"客服通用话术 FAQ" · 问候/转人工/闲聊兜底/价格反问
   - 产品: 只生成"该产品专属 FAQ" · 功能/套餐/风险/开通流程
   - 明确告诉 LLM "不要互相重复"

D. 输出结构化 JSON · 每条 8 个字段:
   canonical_question / variants (≥3) / answer / intent (16 选 1) /
   handoff_action (4 选 1) / follow_up_question / risk_level / tags

E. handoff_action 规则提示:
   - 价格相关 → if_no_price
   - demo/购买/投诉/退款/付款/账号异常 → always
   - 风险话题 → risk_level: high

F. temperature 0.5 → 0.6 (略放点创意 · 让 variants 更多样)
G. maxTokens 4096 → 8192 (容纳 30 条 ×8 字段 ×3+ variants)


────────────────────────────────────────────────────────────────
5. 多产品选择如何实现
────────────────────────────────────────────────────────────────

设计原则:
  - 文字菜单 · 不用 WhatsApp 真 interactive button (不动 WA Web 底层)
  - 复用 customer_conversation.kb_id (现有字段) 当绑定状态
  - 复用 ai_reply_audit.intent='product_menu_shown' 当 "上一次发过菜单" state

流程:
  ┌──────────────────────────────────────────────────────────┐
  │ A. 客户发首条消息                                         │
  │    ↓                                                     │
  │ B. 检查: tenant 产品 KB ≥ 2 ?                           │
  │    ↓ 是                                                  │
  │ C. 检查: conv.kbId 已绑产品 KB ?                        │
  │    ↓ 否                                                  │
  │ D. 5min 内 audit 有 'product_menu_shown' ?              │
  │    ↓                                                     │
  │   ┌─是 → 试 parseProductMenuReply() 解析"1"/"2"/"产品名"│
  │   │      ↓ 命中: 绑 conv.kbId + 发确认问候              │
  │   │      ↓ 没命中: 继续走主流程 (FAQ/RAG 兜底)         │
  │   │                                                       │
  │   └─否 → 检查客户消息:                                  │
  │          ↓ 含产品名? 是 → 老 KB pre-filter 路径        │
  │          ↓ 像问候? 是 → 通用 FAQ 路径                  │
  │          ↓ 都不是: 发产品菜单 +                         │
  │            audit.intent='product_menu_shown'           │
  └──────────────────────────────────────────────────────────┘

菜单文本 (每个 tenant 自动用 tenant.name 个性化):
  您好, 我是 {{tenantName}} 的智能客服 😊
  请问您想咨询哪一个产品?

  1. WAhubX - WhatsApp 多账号运营系统
  2. FAhubX - Facebook 自动养号系统
  3. M33 Lotto Bot - 彩票机器人系统

  直接回复编号或产品名称即可


parseProductMenuReply 容忍:
  - "1" / "2" / "3"
  - "FAhubX" (大小写无关)
  - "fahubx" / "fa hubx" (normalize 后包含)
  - "我要 fahubx"
  - "wahubx 那个" (双向 includes 容错)

边界:
  - tenant 只有 1 个产品 → 不发菜单 (跳过)
  - tenant 有产品 KB + conv 已绑 → 不发 (老逻辑)
  - 客户消息含产品名 → 不发 (KB pre-filter 直接锁)
  - 客户问候/转人工/谢谢 → 不发 (通用 FAQ 答更自然)
  - 5min 内已发菜单但客户没选 → 不再发第二次 (避免循环)


────────────────────────────────────────────────────────────────
6. FAQ-only 模式 vs AI 模式 未命中处理
────────────────────────────────────────────────────────────────

FAQ-only 模式:
  ┌─────────────────────────────────────────────────────┐
  │ 1A. 跨 primary KB FAQ Jaccard ≥ 0.55 → 命中 + 答    │
  │ 1B. 通用 KB FAQ Jaccard ≥ 0.55 → 命中 + 答          │
  │ → 都没命中:                                          │
  │   老逻辑: markHandoff('FAQ 模式 · 未命中')          │
  │           conv 永久锁 · 客户后续消息全 silent       │
  │   新逻辑: 发兜底菜单 (不 markHandoff)               │
  │           客户回复编号能继续走 · 4=转人工 自动触发  │
  └─────────────────────────────────────────────────────┘

  兜底菜单文本:
    不好意思, 这个问题我暂时没找到对应资料 😅 我主要可以协助您了解:
    1. 产品介绍
    2. 价格 / 套餐
    3. 开通流程
    4. 转人工客服
    请直接回复编号或您的需求, 我帮您处理~

  audit 写: intent='faq_only_fallback_menu', metadata.faq_only_fallback=true


AI 智能 + FAQ 模式:
  ┌─────────────────────────────────────────────────────┐
  │ 1A/1B. FAQ 命中 → 答 (不变)                          │
  │ 2A. RAG primary cosine top-3                         │
  │ 2B. score < 0.75 → 试 secondary 通用 KB              │
  │ 2C. score < 0.45 + KB pre-filter 没命中 → AI clarify│
  │     (不 markHandoff · 客户能继续问)                  │
  │ 2D. score ≥ 0.45 → 喂 chunks 给 LLM                  │
  │     LLM 用新 system prompt (任务 6+7):               │
  │     - 销售流程编排                                   │
  │     - 闲聊检测 + 简短陪聊 + 拉回业务                 │
  │     - 转人工触发清单 (返 handoff=true)               │
  └─────────────────────────────────────────────────────┘


────────────────────────────────────────────────────────────────
7. 转人工规则如何实现
────────────────────────────────────────────────────────────────

三层触发:

层 1 · auto-reply-decider HANDOFF_KEYWORDS_LEVEL1 (硬关键词 · 立即 handoff)
  - 投诉 / 律师 / 报警 / 骂人 / 骂街
  - 退款 / 退货 / payment failed
  - demo / 演示 / 试用
  - 购买 / 下单 / 我要买 / buy / purchase / order
  - 报价 / 合同 / 见面 / 预约
  - 付款 / 付不了 / 不能付款
  - 账号异常 / 不能登录 / 登不上 / banned
  - 老板 / sales / agent / human
  - 人工 / 真人 / 转人工

  命中 → conv.stage = HandoffRequired · return (不进 8s 聚合)


层 2 · FAQ tags handoff_action='always'
  - FAQ 命中后看 tag 'handoff:always'
  - true → 答完调 markHandoff()


层 3 · AI 模式 LLM 自判 intent + handoff
  - system prompt 教 LLM 何时 handoff=true
  - 输出 {handoff: true} → markHandoff


转人工话术示例 (FAQ 端 / AI 端):
  这个部分需要顾问根据您的情况确认, 我先帮您转接真人客服处理 😊


转人工后:
  - conv.stage = 'handoff_required'
  - reply-executor.handle() 入口检查 stage · 直接 return (AI 不再答)
  - decider 入口也检查 stage · 客户再发消息 30min 内补一次 ack 通知 (任务前已实装)
  - 5min 没人工跟 → 系统 auto follow-up (任务前已实装)


通知渠道 (没动):
  - 后台 takeover 页面通过 WS 实时推
  - 没接 Telegram / Email / SMS (这是 V2 范围 · 本轮不做)


────────────────────────────────────────────────────────────────
8. 测试案例与预期结果
────────────────────────────────────────────────────────────────

[A] 多产品选择菜单
  A.1 客户首发 "你好"
      预期: 通用 FAQ "你好" 命中 (jaccard 1.0)
      → 答 "你好呀！欢迎来了解我们的产品~您想先看看 WAhubX、
         FAhubX、M33 Lotto Bot 呢?" (通用 FAQ 已 starter 灌过)
      不发产品菜单 (isGreetingOrSimple=true)

  A.2 客户首发 "我想问一下"
      预期: 不像问候 + 没产品名 + 多产品 → 发产品菜单
      audit.intent='product_menu_shown'

  A.3 客户在 A.2 后回 "1"
      预期: parseProductMenuReply 命中 productKbs[0] (WAhubX)
      conv.kb_id 绑 KB id · 答 "好的, 您选了 WAhubX 😊..."
      audit.intent='product_menu_picked', metadata.kb_bound_now=true

  A.4 客户首发 "fahubx"
      预期: KB pre-filter 直接命中 [10:FAhubX] · 不走菜单

  A.5 客户首发 "自动养号怎么做"
      预期: 没产品名 + 没产品 KB pre-filter · 发菜单
      (注: 这是已知限制 · 任务 4 没要求 LLM 做 intent → KB 路由)

  A.6 客户首发 "我有 30 个号"
      预期: 没产品名 + 没像问候 → 发菜单
      或: 走 FAQ → 通用 KB 没"30 个号"FAQ → 走 RAG → 跨多产品 KB
          各 KB 都有"账号数量" chunks · 余弦看哪个高 · 命中后 LLM 答


[B] FAQ-only 模式 (settings.mode='faq')
  B.1 客户 "你吃饭了吗"
      预期: 通用 FAQ 不命中 (没"吃饭"FAQ) · 跨产品 FAQ 不命中
      → 发兜底菜单 "不好意思, 这个问题我暂时没找到对应资料 😅..."
      audit.intent='faq_only_fallback_menu'
      不 markHandoff · 客户回复 "1" 仍能继续

  B.2 客户 "多少钱"
      预期: 通用 FAQ "多少钱" 命中 (starter 已灌)
      → 答 "请问您想了解 FAhubX、M33 Lotto Bot 还是 WAhubX 的价格呢?
           告诉我具体产品..."

  B.3 客户 "fahubx 多少钱"
      预期: KB pre-filter 命中 FAhubX
      → 跨该 KB FAQ Jaccard · 命中 "fahubx 多少钱" / "价格" 类
      → 若 FAQ tag 'handoff:if_no_price' · 答 + 不立即 handoff (留给客户问完再说)
      → 若 FAQ tag 'handoff:always' (e.g. demo) · 答完即 markHandoff


[C] AI 智能 + FAQ 模式 (settings.mode='smart')
  C.1 客户 "你吃饭了吗"
      预期: 通用 FAQ 不命中 · RAG 在产品 KB 找不到 (cosine < 0.45)
      → 走 clarify_low_confidence
      LLM 看 system prompt "闲聊处理" 段 · 简短陪聊 + 拉回业务
      预期答: "哈哈, 我主要是负责产品咨询的 AI 智能客服 😊
              您是想了解产品功能、价格、开通流程, 还是需要我帮您转人工呢?"

  C.2 客户 "我想了解 WAhubX"
      预期: KB pre-filter 锁 [11:WAhubX]
      → FAQ Jaccard / RAG · 命中 → LLM 用 WAhubX chunks 答介绍
      LLM 看 system prompt "销售流程" → 末尾追问账号数量
      预期答: "WAhubX 是一套 WhatsApp 多账号运营系统, 主要包含..." +
              "请问您目前大概是想管理 10 个、30 个, 还是 50 个 WhatsApp 号呢?"

  C.3 客户 "我有 30 个号"
      预期: 不进菜单 (像产品需求描述) · 走 RAG · cosine 高
      LLM 答 "Pro 30 号方案适合您..." + 引导留联系方式

  C.4 客户 "我要 demo"
      预期: HANDOFF_KEYWORDS_LEVEL1 命中 'demo'
      → decider 直接 markHandoff · conv.stage='handoff_required'
      audit.mode='handoff', intent='handoff', handoff_triggered=true

  C.5 客户 "我要退款"
      预期: HANDOFF_KEYWORDS_LEVEL1 命中 '退款' · 同 C.4

  C.6 客户 "账号登不上"
      预期: HANDOFF_KEYWORDS_LEVEL1 命中 '登不上' · 同 C.4


[D] FAQ 自动生成质量 (上传产品介绍后)
  D.1 调 POST /knowledge-base/:id/faqs/generate
  D.2 跑 DeepSeek · 输出新格式 JSON
  D.3 解析后 KbFaqEntity 实例:
        question:   "怎么收费？"
        answer:     "价格会根据账号数量、方案和服务范围不同而调整...
                     请问您目前大概是想管理 10 个、30 个, 还是 50 个账号? 😊"
        tags:       ['intent:pricing', 'handoff:if_no_price', 'risk:medium',
                     'fu:请问您目前大概需要管理多少个账号？',
                     'var:多少钱', 'var:这个价位怎么样', 'var:报价']
        status:     'draft'
        source:     'ai_generated'

  D.4 客户问 "多少钱"
      → matchFaq 跨 canonical "怎么收费？" + 3 个 variants
      → "多少钱" Jaccard 跟 "var:多少钱" = 1.0 命中 ✓
      → 答 + audit.metadata.matched_variant='多少钱'

  D.5 后续测: tag 'handoff:if_no_price' · 答完不直接 handoff
      (V2 加: 看资料里有没有具体价格 · 没有就 mark)


────────────────────────────────────────────────────────────────
9. 风险点
────────────────────────────────────────────────────────────────

R1 (低) · tags 字段语义偷渡
  现在 tags 既存普通分类 (greeting/zh/en) 也存元数据前缀 (var:/intent:/...)
  老查询 (e.g. SELECT * WHERE 'greeting' = ANY(tags)) 不受影响
  但前端 KB FAQ 编辑 UI 如果直接显示 tags 会看到 "var:多少钱" 这种丑数据
  缓解: 前端展示时跳掉前缀型 tags · 显示 plainTags + 单独区域显示 variants

R2 (低) · 多产品菜单 5min 状态窗口
  audit.intent='product_menu_shown' 5min 内反查
  极端场景: 客户 5 分钟没回 + 后续突然回"1" · 解析失败重发菜单
  缓解: 这是合理 UX (太久没回当新会话起步)

R3 (中) · LLM 输出格式不稳
  新 prompt 要求 8 字段 JSON · DeepSeek 偶尔会漏 variants 或 intent
  现状解析做了兜底 (用 q/a 老字段名) · 但生成质量取决于 LLM 配合
  缓解: 测试时跑几次 generate · 看 30 条 FAQ 里有多少完整字段

R4 (低) · 转人工关键词扩展可能误伤
  e.g. 客户说 "我没买过这个产品想了解" → '想买' 没命中 · '买' 单字没列
  我列的是 "购买/下单/我要买/想买/要买/怎么买" · "想了解" 不在
  缓解: 真测发现误伤再加白名单逻辑 (e.g. 前面有"不"否定)

R5 (中) · system prompt 长度
  AI 模式 system prompt 从 ~400 字变到 ~1200 字
  每次 LLM 调用多消耗 ~300 token · 累计 30 条 conv/day = ~9k token/day
  成本影响: DeepSeek $0.14 / 1M token · 日均额外 ~$0.001 · 可忽略
  延迟影响: 大 prompt 多 50-100ms 处理 · 用户感知不明显

R6 (低) · matchFaq 跨 variants 性能
  原: 每 FAQ 1 次 Jaccard
  新: 每 FAQ × (1 + variants 数) 次 Jaccard
  30 条 FAQ × 4 variants = 120 次 Jaccard / 调用
  Jaccard 是 O(token) · token 数十 · 总耗时 < 5ms · 不构成瓶颈


────────────────────────────────────────────────────────────────
10. 建议下一步
────────────────────────────────────────────────────────────────

V2.1 (产品)
  1. 前端 FAQ 编辑 UI 拆 tags 显示
     - plainTags 区域 (普通分类)
     - variants 区域 (列表 + 增删)
     - intent 单选下拉
     - handoff_action 单选下拉
     - risk_level 单选下拉
     - follow_up_question 单行输入

  2. AI Wizard 二段式生成
     - 第 1 步: 列大纲 (15 个主题) · 让租户确认
     - 第 2 步: 每个主题生成 1-2 条 FAQ · 总 ~25 条
     比一次性生成 30 条更精准

  3. 首条客户消息识别 (LLM 路由)
     - "自动养号怎么做" → 应自动锁 FAhubX
     - 当前需 LLM 调一次轻量 classifier
     - 建议加 KB.aliases text[] · 让 keyword pre-filter 命中更稳

V2.2 (运维)
  4. 转人工通知接 Telegram bot
     - 操作员手机收推送 · 不必盯 dashboard

  5. AI 回复审计前端 dashboard
     - 列 audit 表 · 含 mode/intent/confidence/matched_variant/metadata
     - 调试 + 客服质量审查

V2.3 (技术债)
  6. ai_reply_audit 加列 raw_inbound_message + cleaned_question
     现在 inboundMessage 字段虽存在但 handle() 没传值 · audit 看不到客户原话
     这要小 migration · 建议跟其他 audit 字段一起做

  7. 系统 prompt 全文存 audit
     当前不存 · 调试时无法回放当时 LLM 看到了什么
     建议存到 guardrail_edits.system_prompt_hash 或新加 prompt_log 表


────────────────────────────────────────────────────────────────
11. 需要先讨论 (没直接改)
────────────────────────────────────────────────────────────────

D1 · "购买" 关键词命中导致 markHandoff 太激进
  我把 '购买/下单/我要买/想买/要买' 都加进 Level 1 立即 handoff.
  但客户说 "请问购买流程是怎样的" 也会被命中 · 答都没答就转人工.
  
  方案 A: 我现在做的 · 一律转人工 (用户硬要求)
  方案 B: '购买' 不立即 handoff · 让 AI 答完流程后再判 intent='buying' 才 handoff
  方案 C: 加白名单 (e.g. "购买流程" 不算 / "怎么购买" 不算)
  
  当前实施: A. 如要改 B/C 请告诉我.

D2 · 多产品菜单的 isGreetingOrSimple 边界
  问候 / 谢谢 / 转人工 都不发菜单. 但客户首条发 "你们有什么产品?"
  这是要求展示产品 · 应该发菜单. 当前 'isGreetingOrSimple' 不命中
  → 走 FAQ · 通用 KB 应该有"有什么产品" FAQ → 答用产品列表
  
  但如果通用 KB 没生成这条 starter (52 条 starter 没"有什么产品 → 列产品") ·
  会走 RAG → 失败 → clarify
  
  建议: 在 starter-common-faq 加一条 "有什么产品 / 你们卖什么 / what
  products" · answer 提示 LLM 列产品名. 但当前 starter 是写死的.
  
  V2.1 建议加.

D3 · isCompanyCommonKb prompt 给老 KB 重新生成
  我改了 generateFaqs prompt, 但用户已生成的老 FAQ 不会自动重写.
  租户必须手动调 POST /knowledge-base/:id/faqs/generate 重生成.
  
  建议: 加按钮 "AI 重新生成 (V2 prompt)" · 或自动检测老格式 FAQ
       (没 var:* tags 的) · 提示用户升级.

D4 · 接管 vs AI 互殴 (上次拍板"先不修")
  本轮没动. 用户拍板.

D5 · DeepSeek 输出非 JSON 的兜底
  jsonMode: true 让 DeepSeek 严格输出 JSON · 但偶尔仍会失败.
  当前: 解析失败抛 BadRequestException · 用户重点 generate 即可.
  建议 V2.1: 失败时用 regex 提 {} 段 · 容错率更高.


────────────────────────────────────────────────────────────────
12. Build / 测试 / Backend 状态
────────────────────────────────────────────────────────────────

✓ pnpm --filter @wahubx/backend run build · TypeScript 0 errors
✓ Backend nest --watch hot-reload PASS (12:13:34 AM Found 0 errors)
✓ 重启 backend 后跑新代码 · 9700 LISTENING · PID 32628
✓ Git commit eb57de1 · 3 files +487/-68
✓ 没动 WhatsApp Web selector / Chromium / session / sendText / 8s 窗口 /
  养号 / 广告 / takeoverLock


================================================================
报告完
================================================================
```
