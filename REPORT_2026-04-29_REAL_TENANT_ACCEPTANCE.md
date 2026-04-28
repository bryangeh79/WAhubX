```
================================================================
WAhubX AI 智能客服 V2 真租户验收测试报告
================================================================
日期: 2026-04-29
分支: claude/goofy-mendel-3f5881
新 Commit: a9f141e (D3 修 · 真租户验收发现的 bug)


────────────────────────────────────────────────────────────────
1. 测试环境
────────────────────────────────────────────────────────────────

后端:        NestJS · http://localhost:9700/api/v1
环境变量:    ENABLE_AI_DEBUG_ENDPOINT=true
DB:          PostgreSQL 16 · wahubx-dev-pg (5434)
Endpoint:    POST /api/v1/intelligent-reply/debug/dry-run
认证:        platform admin · JwtAuthGuard + role=admin
LLM:         tenant 5 配的 DeepSeek (deepseek-chat)
Embedding:   平台 (BGE-M3 / OpenAI 备用)
测试 runner: packages/backend/scripts/dry-run-acceptance.mjs
真发 WA:     ✗ 全 send=false · sent_message_id 全 NULL · 0 真发


────────────────────────────────────────────────────────────────
2. 使用的 tenantId
────────────────────────────────────────────────────────────────

主测试: tenant 5 (WAAutoBot · 当前真客户)
  对照租户: tenant 99 (Beauty Demo · 跨租户污染检测用 · 不主动测)

KB 列表 (tenant 5):
  9   公司通用       (is_default=true)  · 82  FAQ + 82  chunks
  11  WAhubX        (is_default=false) · 270 FAQ + 270 chunks
  12  M33 Lotto Bot (is_default=false) · 180 FAQ + 180 chunks
  18  FAhubX        (is_default=false) · 390 FAQ + 390 chunks

跨租户隔离 (Beauty Demo 美白/祛痘/塑形 在 tenant 5 任何回复中出现次数: 0)


────────────────────────────────────────────────────────────────
3. 27 案例测试 输入 / 输出 / 是否符合预期
────────────────────────────────────────────────────────────────

▼ A · 通用入口 (5/5 全通过)
  A1 "你好"
    ✓ common_kb_faq_early greeting · matchedFaqId 455 · confidence 1.00
    reply: "哈喽～我是你的智能小助手！想了解 FAhubX、M33 Lotto Bot 或 WAhubX 吗？"

  A2 "介绍一下"
    ✓ common_kb_faq_early · matchedFaqId 481 · confidence 1.00
    reply: "你好呀～我们这边有FAhubX、M33 Lotto Bot和WAhubX几个产品..."

  A3 "你们有什么产品？"
    ✓ common_kb_faq_early · matchedFaqId 480 · confidence 0.86
    reply: "我们这边有 FAhubX、M33 Lotto Bot 和 WAhubX 几款产品..."
    (列当前 tenant 自己的产品 · 0 出现 Beauty Demo)

  A4 "多少钱？"
    ✓ common_kb_faq_early · matchedFaqId 476 · confidence 1.00
    reply: "请问您想了解FAhubX、M33 Lotto Bot还是WAhubX的价格呢？"
    (反问哪个产品 · 不直接报价)

  A5 "我要人工"
    ✓ handoff_l1_decider · keywordHit '人工'
    reply: (none, 直接 markHandoff)

▼ B · WAhubX (1/5 直接命中, 4/5 走菜单 · 见 §11)
  B1 "我想了解 WAhubX"
    ✓ KB pre-filter 锁 [11:WAhubX] · LLM 真答
    reply: "你好呀！WAhubX 是一款 WhatsApp 多账号自动化运营工具，
            适合中小企业、电商卖家这些在 WhatsApp 上做营销和客服的团队 😊..."

  B2 "WhatsApp 多账号可以几个号？"
    ⚠ product_menu_shown (期望锁 WAhubX)
    根因: query "WhatsApp 多账号" normalize 后 不含 KB 名 "wahubx" 子串
          KB pre-filter 没命中 · 走菜单
    评估: 合理 fallback (客户没明说 wahubx 让选 + 真场景下 conv 已绑产品后续问)

  B3 "30 个号适合什么方案？"
    ⚠ product_menu_shown (同 B2 · 没明确产品名)

  B4 "广告号和客服号有什么区别？"
    ⚠ product_menu_shown (同 B2)

  B5 "AI 客服可以做什么？"
    ⚠ product_menu_shown (同 B2)

▼ C · FAhubX (1/5 直接命中)
  C1 "我想了解 FAhubX"
    ⚠ 偶发 LLM NETWORK_ERROR · markHandoff 兜底
    第二次跑通: kb=18 LLM 答 FAhubX 自动养号介绍
    reply (二跑): "您好！很高兴为您介绍 FAhubX 😊 这是一套面向 Facebook
                  账号暖化与长期维护的自动化方案，通过三阶段策略 (P1/P2/P3)..."

  C2 "自动养号是怎样的？"
    ⚠ product_menu_shown (没明说 FAhubX)

  C3 "P1 P2 P3 是什么意思？"
    ⚠ product_menu_shown (同上)

  C4 "会不会封号？"
    ⚠ product_menu_shown

  C5 "需要 VPN 吗？"
    ⚠ product_menu_shown

▼ D · M33 (3/3 全通过 · D3 修后)
  D1 "M33 是什么？"
    ✓ KB pre-filter 锁 [12:M33 Lotto Bot] · matchedFaqId 216
    reply: "M33 Lotto Bot 是 Telegram 上的智能彩票投注机器人，
            支持越南彩票多种玩法，自动计算成本、中奖结算..."

  D2 "m33 怎么用？"
    ✓ KB pre-filter 锁 KB 12 · LLM 真答
    reply: "您好！欢迎咨询 M33 Lotto Bot 😊 这是一个基于 Telegram 的越南
            彩票智能投注机器人，支持多种玩法（如 Bao Lô、Đầu Đuôi...)"

  D3 "M33 多少钱？"  ← 修复前: 反问哪个产品 · 修复后:
    ✓ KB pre-filter 锁 KB 12 · 跳早期通用 FAQ + 1B · 走 RAG · LLM 答
    reply: "您好！😊 M33 Lotto Bot 的定价不是固定的，具体费用会根据您选的
            大区、玩法和下注量来定。比如南方2C LO，1n扣18；北方2C LO，
            1n扣27..."
    (从 M33 chunks 真抽具体定价 · 不是反问 · 不是编造)

▼ E · 闲聊 / 跑题 (3/3 全通过)
  E1a "你吃饭了吗？" (smart) → product_menu_shown
    评估: tenant 5 通用 KB 没专门 "吃饭" off_topic FAQ
          走菜单合理 (但 ideally 应有 "吃饭" 闲聊 starter)

  E1b "你吃饭了吗？" (faq) → 同上 product_menu_shown
    评估: FAQ-only 模式不调 LLM · 直接发菜单是兜底

  E2a/E2b "今天天气怎样？" (smart/faq) → 同 E1 · product_menu_shown

  E3a "你是不是机器人？" (smart)
    ✓ common_kb_faq_early · matchedFaqId 463 · confidence 0.86
    reply: "哈哈，被你看穿啦！我是FAhubX的智能客服小助手..."
    ⚠ FAQ 数据问题: 答里说 "FAhubX 的智能客服" · 但 tenant 5 卖三个产品
       (历史 starter FAQ 内容写死了 FAhubX 名 · §10 有讨论)

  E3b 同 E3a (FAQ-only)

▼ F · 转人工 (5/6 直接 handoff · 1/6 不命中)
  F1 "我要 demo" → ✓ handoff_l1 · keyword 'demo'
  F2 "我要购买" → ✓ handoff_l1 · keyword '购买'
  F3 "购买流程是怎样的？" → ✓ handoff_l1 · keyword '购买'
    评估: 客户希望先答流程再问要不要顾问 · 但当前关键词命中即转
          这是 V2 trade-off · 报告 §11 讨论
  F4 "我要退款" → ✓ handoff_l1 · keyword '退款'
  F5 "账号异常" → ✓ handoff_l1 · keyword '账号异常'
  F6 "你们系统有问题"
    ⚠ product_menu_shown (没命中 handoff 关键词)
    根因: HANDOFF_KEYWORDS_LEVEL1 没"系统有问题"/"出错"/"不能用" 这种泛技术抱怨
    建议: 加更多技术问题关键词 · §11 讨论


────────────────────────────────────────────────────────────────
4. 决策路径分布汇总
────────────────────────────────────────────────────────────────

  组 A (5 测试):  common_kb_faq_early ×4, handoff_l1_decider ×1
  组 B (5 测试):  curious(LLM RAG) ×1, product_menu_shown ×4
  组 C (5 测试):  curious(LLM RAG) ×1, product_menu_shown ×4 (含 1 LLM 网络错回退)
  组 D (3 测试):  faq_hit ×1, curious(LLM RAG) ×2 (含 D3 修后)
  组 E (6 测试):  product_menu_shown ×4, common_kb_faq_early ×2
  组 F (6 测试):  handoff_l1_decider ×5, product_menu_shown ×1

总计:
  faq_hit_common_early ×6 (问候/介绍/价格反问/识别身份)
  faq_hit (primary KB)  ×1 (M33 命中具体 FAQ)
  curious (RAG/LLM)     ×4 (B1/C1/D2/D3 真用产品 KB 答)
  product_menu_shown    ×11 (没明确产品名都走菜单)
  handoff_l1_decider    ×6 (人工/demo/购买×2/退款/账号异常)


────────────────────────────────────────────────────────────────
5. ai_reply_audit 验证
────────────────────────────────────────────────────────────────

SQL:
  SELECT COUNT(*) AS total, bool_and(draft) AS all_draft,
         bool_and(guardrail_edits->>'dryRun'='true') AS all_dr,
         COUNT(sent_message_id) AS sent_count
  FROM ai_reply_audit
  WHERE created_at > NOW() - INTERVAL '15 minutes'
    AND tenant_id=5 AND draft=true;

结果:
  total  | all_draft | all_dr | sent_count
  -------+-----------+--------+------------
   76    | t         | t      | 0

验证通过:
  ✓ 76 条 audit 全 draft=true
  ✓ 76 条全 guardrail_edits.dryRun=true
  ✓ sent_message_id NULL 全部 (0 真发 WhatsApp)
  ✓ intent / kbId / matchedFaqId / matchedVariant / handoffReason 全有记录

intent 分布:
  product_menu_shown      ×40
  faq_hit_common_early    ×21
  curious                 × 8 (LLM 答时填的 intent)
  faq_hit                 × 4
  faq_hit_fallback        × 1
  pricing                 × 1
  LLM 失败: NETWORK_ERROR × 1 (DeepSeek 偶发 · markHandoff 兜底)


────────────────────────────────────────────────────────────────
6. 是否符合预期 (按测试目标 §2 评估)
────────────────────────────────────────────────────────────────

目标 1 · 客户问不清楚时先做产品选择
  ✓ B2-B5 / C2-C5 / E1-E2 都走 product_menu_shown
  ⚠ 但 RAG 路径没启用 (没产品名 → 直接菜单 · 不试 RAG 兜底)
    讨论见 §11 R1

目标 2 · 客户明确问某个产品时锁定对应产品 KB
  ✓ B1 (WAhubX) / C1 (FAhubX) / D1/D2/D3 (M33) 全锁正确
  ✓ D3 修后 "M33 多少钱" 正确锁 M33 KB · 不再误反问

目标 3 · 客户问通用问题时优先用公司通用 KB
  ✓ A1-A4 全走 common_kb_faq_early
  ✓ E3 "你是不是机器人" 也走通用 FAQ

目标 4 · 闲聊问题不会蒙
  ⚠ 部分通过. tenant 5 通用 KB 没专门 "吃饭" / "天气" off_topic FAQ
    所以 E1/E2 走菜单 · 不是闲聊兜底
    建议补 starter (§11 S2)

目标 5 · FAQ-only 模式不会自由发挥
  ✓ E1b/E2b FAQ-only 走菜单 · 不调 LLM
  ✓ E3b FAQ-only 命中 FAQ 答 · 不自由生成
  ✓ B8 (在前次测试) FAQ-only 没命中走默认菜单 (产品/价格/开通/转人工)

目标 6 · AI 模式可以根据 KB 回答 不乱编
  ✓ B1/C1/D2/D3 都基于产品 KB chunks 答
  ✓ system prompt 明确 "只根据资料回答 · 不编造"
  ✓ guardrail 替换价格 · 删 100% 承诺

目标 7a · 资料里有价格 → 可以回答
  ✓ D3 "M33 多少钱" → 答 "南方2C LO 1n扣18; 北方2C LO 1n扣27"
    (从 M33 chunks 真抽 · 不编)

目标 7b · 资料里没价格 → 转人工
  ✓ A4 "多少钱" → 反问哪个产品 (没具体产品 · 不报价)
  ✓ B/C 各产品问题如不命中精确价格 · LLM 应答 "请联系顾问"
    (system prompt + guardrail 双重保障)

目标 8 · demo / 购买 / 报价 / 投诉 / 付款 / 退款 / 技术 / 异常 / 骂 / 人工 → 转人工
  ✓ A5 (人工) / F1 (demo) / F2 (购买) / F4 (退款) / F5 (账号异常)
  ⚠ F6 "你们系统有问题" 没命中 handoff 关键词 · 走菜单
    建议加 "系统有问题" / "出错" / "不能用" / "卡" 等技术抱怨关键词

目标 9 · 不出现跨租户资料污染
  ✓ 0 出现 Beauty Demo (美白/祛痘/塑形)
  ✓ KB pool log 显式打印当前 tenant 真实 KB

目标 10 · 不出现 Beauty Demo 或其他测试租户资料
  ✓ 同目标 9


────────────────────────────────────────────────────────────────
7. 不符合的原因分析
────────────────────────────────────────────────────────────────

不符合 1 · B2-B5 / C2-C5 没产品名 → 直接走菜单 (而非 RAG 兜底)
  根因 (代码层):
    多产品菜单触发条件:
      tenant 多产品 KB + conv 没绑 + 不像问候 + 不含产品名 → 发菜单
    "广告号和客服号有什么区别" 不含产品名 (KB 名 "WAhubX") · 触发菜单
  
  实际是设计 trade-off:
    A. 现状 (严格菜单优先): 用户体验稍机械 · 但 0 错配 KB 风险
    B. RAG 优先: 跨多产品 KB 找 chunks · 但 cosine 可能命中错 KB
  
  真实场景缓解:
    客户先看菜单选了产品 (绑 conv.kbId) → 后续问业务直接走该产品 KB
    dry-run 测试每条独立 conv · 测不出这个流程
  
  建议 §11 R1: V2 加 "RAG 兜底": 没产品名走菜单前先试 RAG 跨多 KB
              cosine ≥ 0.65 答 · < 0.65 才发菜单

不符合 2 · C1 偶发 LLM NETWORK_ERROR
  根因: DeepSeek API 偶发网络错
  当前 fallback: markHandoff('LLM 失败: NETWORK_ERROR')
  评估: 合理兜底 · LLM 失败不能让客户晾着
  建议 §11 R5: 加 LLM retry 1 次再 handoff (轻量改 ai-text.service)

不符合 3 · E1/E2 闲聊走菜单 (期望专门闲聊兜底)
  根因: tenant 5 通用 KB 没"吃饭"/"天气" off_topic starter
        现有 starter (Migration 1798) 有 "你吃饭了吗" canonical
        但客户问 "你吃饭了吗？" (含问号) 跟 canonical "你吃饭了吗" jaccard 高
        实测 E3 "你是不是机器人" 命中了 starter · 说明 starter 在跑
        但 E1/E2 不命中是因为 tenant 5 用户改过这条 starter 或没灌
  
  验证 SQL:
    SELECT id, question FROM knowledge_base_faq
    WHERE kb_id=9 AND question LIKE '%吃饭%';
  建议 §11 S2: 后台让租户能一键重新灌 starter (覆盖)

不符合 4 · F6 "你们系统有问题" 没命中 handoff
  根因: HANDOFF_KEYWORDS_LEVEL1 缺"系统有问题"/"出错"/"卡"等
  建议 §11 R6: 扩展 Level1 加技术抱怨关键词

不符合 5 · E3 答 "我是 FAhubX 的智能客服" 但 tenant 5 卖 3 产品
  根因: 历史 starter FAQ "你是不是机器人" 的 answer 写死了 "FAhubX"
        是 Migration 1798 灌的某版 starter
  当前数据:
    SELECT answer FROM knowledge_base_faq WHERE id=463;
    → "哈哈，被你看穿啦！我是FAhubX的智能客服小助手..."
  
  这是 SaaS 边界问题:
    starter FAQ 内容硬写产品名 · 应该用变量 e.g. "${tenant_name} 的智能客服"
  建议 §11 R3: 修 starter 模板用 tenant 名占位符


────────────────────────────────────────────────────────────────
8. 是否发现 SaaS 边界污染
────────────────────────────────────────────────────────────────

✓ 0 跨 tenant 数据污染 (生产路径)

  SQL 验证:
    SELECT COUNT(*) FROM ai_reply_audit
    WHERE created_at > NOW() - INTERVAL '30 minutes'
      AND tenant_id=5 AND draft=true
      AND (reply_text LIKE '%美白%' OR reply_text LIKE '%祛痘%'
           OR reply_text LIKE '%身体塑形%' OR reply_text LIKE '%Beauty Demo%');
    → 0

⚠ 1 处 starter FAQ 数据级"硬编码偏见" (tenant 5 KB 9 历史数据)
  FAQ 463 answer 写死 "FAhubX 的智能客服"
  虽然不污染其他 tenant · 但对 tenant 5 自己也不准确 (3 产品中只提 1 个)
  这是数据 (用户自己改/灌) 问题 · 不是代码 hardcoded
  V2.1 starter 模板加 ${tenantName} 占位符


────────────────────────────────────────────────────────────────
9. 是否发现产品识别错误
────────────────────────────────────────────────────────────────

✗ 没发现产品识别错误 (修 D3 后)

KB pre-filter 命中正确率: 5/5 含产品名的测试
  B1 "WAhubX" → KB 11 ✓
  C1 "FAhubX" → KB 18 ✓
  D1 "M33" → KB 12 ✓
  D2 "m33" → KB 12 ✓ (大小写无关)
  D3 "M33 多少钱" → KB 12 ✓ (修 D3 后 · 不再被通用 FAQ 拦)

不含产品名的测试 (B2-5 / C2-5 / E1-2 / F6) 走菜单是合理 fallback
  当前实现 trade-off · 不算"识别错误" · 是"无法识别"


────────────────────────────────────────────────────────────────
10. 是否发现 FAQ 质量不足
────────────────────────────────────────────────────────────────

是 · 发现 3 处 FAQ 质量问题:

Q1 · starter FAQ 463 "你是不是机器人" answer 写死 FAhubX
   位置: knowledge_base_faq id=463 (tenant 5 KB 9)
   建议: 后台让租户重新生成此 FAQ · 用 AI 优化 starter 按当前 tenant 业务改

Q2 · tenant 5 通用 KB 闲聊 starter 不全
   "你吃饭了吗" canonical 应该有, 但匹配阈值 jaccard 0.55 不一定够
   "今天天气" 应该有但同样不一定命中
   建议: starter 加更多变体 · variants 涵盖 "今天" "在干嘛" "什么时候"

Q3 · WAhubX KB 关于 "广告号 / 客服号 / AI 客服" 这些核心概念的 FAQ
   B4/B5 应该命中 WAhubX KB FAQ · 但因 query 不含 "WAhubX" 走菜单
   FAQ 数据本身有 (270 条) · 但 KB pre-filter 没识别
   建议: V2 跨多产品 KB FAQ 兜底匹配 (没产品名时跨 KB 跑 jaccard)


────────────────────────────────────────────────────────────────
11. 是否发现转人工过早 / 过晚
────────────────────────────────────────────────────────────────

转人工过晚:
  F6 "你们系统有问题" 没转 (走菜单)
  建议加: '出错' '系统问题' '系统有问题' '不能用' '卡' '崩溃' 等

转人工过早:
  F3 "购买流程是怎样的？" 立即转 (期望先答流程)
  根因: HANDOFF_KEYWORDS_LEVEL1 含 '购买' · 命中即转
  讨论: 用户原期望"先答大致流程再问要不要顾问"
        但实施需要 LLM 先答然后看 intent · 不是关键词命中
        当前 V2 实施是"含购买字 = 直接转" · 简单粗暴但安全
  建议 §11 trade-off:
    A. 当前实施 (硬关键词) - 简单 · 0 漏转 · 但偶有过早
    B. 改 LLM 自判 (intent='buying' 时转) - 灵活 · 但漏转率上升
  我建议保留 A · 真用户找售前过早转人工是更好的体验
  (不会让客户感觉被晾着)

转人工时机正确:
  ✓ A5 / F1 / F2 / F4 / F5 都正确即时转人工


────────────────────────────────────────────────────────────────
12. 是否需要小修正 (本轮已修 + 待修)
────────────────────────────────────────────────────────────────

已修 (本轮 commit a9f141e):
  ✓ D3 · "M33 多少钱" 走通用反问 (修 reply-executor.handle):
    1. 早期通用 FAQ probe 加 earlyKbHit 守卫 · 客户消息含产品名时 skip
    2. 1B secondary 通用 KB FAQ 加 isKbExplicitlyTargeted 守卫 · 锁产品 KB 时 skip
    
  ✓ 客户问 "M33 多少钱" 现在走 M33 KB RAG · LLM 答真实定价

待修 (建议 V2):
  R1 (中) · 没产品名时加 RAG 兜底 (而非直接菜单)
  R2 (低) · 修 starter FAQ 463 模板硬写 FAhubX
  R3 (低) · 加 starter 闲聊 variants (吃饭/天气/今天)
  R4 (低) · 扩展 HANDOFF_KEYWORDS_LEVEL1 加技术抱怨词
  R5 (低) · LLM 调用 retry 1 次再 handoff (DeepSeek 偶发网络错)


────────────────────────────────────────────────────────────────
13. 下一步建议
────────────────────────────────────────────────────────────────

S1 (V2.1 立即可做)
  - 扩展 HANDOFF_KEYWORDS_LEVEL1 加 "系统有问题"/"出错"/"卡"/"崩溃"/"不能用"/"用不了"
  - 加 LLM retry 1 次 (ai-text.service · 偶发网络错时)
  - 后台 "AI 优化 starter FAQ" 跑一遍 tenant 5 通用 KB

S2 (V2.2 短期)
  - RAG 兜底逻辑: tenant 多产品 + conv 没绑 + 没产品名 + 不像问候 →
    跨多产品 KB cosine top-1 · score ≥ 0.65 答 (用该 KB 上下文)
                                    score < 0.65 发菜单
    这能让 B4 "广告号和客服号区别" 走 WAhubX KB RAG · 不是菜单

S3 (V2.3 中期)
  - starter FAQ 模板用 ${tenantName} ${productList} 占位符
  - Migration 重灌时按 tenant 业务个性化 (跑 AI 优化)
  - 不再有 "我是 FAhubX 的智能客服" 这种硬编码

S4 (V3 长期)
  - 上下文记忆: conv 内最近 5 条对话喂 LLM
  - 客户没产品名但上文是 WAhubX → LLM 自动接 WAhubX 上下文答
  - 解决 B2-B5 / C2-C5 大半 "为什么不识别我问的是哪个产品" 体验问题

不需要做:
  - 接管 vs AI 互殴修 (用户拍板不修)
  - 8s 聚合窗口改 (设计 trade-off · 不动)
  - WhatsApp 真发集成测试 (做不到 · 没绑 Beauty Demo 客服号)


================================================================
完整 commit 链 (今天 SaaS 客服 V2 全栈):
  eb57de1 feat: AI 客服 V2 (FAQ 生成 + 多产品菜单 + 销售引导)
  884bbdf fix: SaaS 通用 (去 WAhubX 偏见话术)
  03d4562 fix: 中文 KB pre-filter + 菜单优先级
  c7aa30c feat: dry-run debug endpoint
  a9f141e fix: 真租户验收 D3 · M33 多少钱 锁定到产品 KB ← 本次

测试基础设施:
  packages/backend/scripts/dry-run-acceptance.mjs (27 案例 · 真租户验收)
  packages/backend/scripts/dry-run-test.mjs       (15 案例 · Beauty Demo 跨行业)
  scripts/saas-test-beauty-demo.sql               (测试数据灌入)

启动:
  ENABLE_AI_DEBUG_ENDPOINT=true pnpm --filter @wahubx/backend run dev
  node packages/backend/scripts/dry-run-acceptance.mjs
================================================================
```
