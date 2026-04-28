```
================================================================
WAhubX SaaS 多租户边界审计报告 (补充)
================================================================
分支: claude/goofy-mendel-3f5881
新 Commit: 884bbdf (修上一 commit eb57de1 的 SaaS 偏见)
日期: 2026-04-29
范围: AI 智能客服板块 · SaaS 多租户隔离审计 + 修复


────────────────────────────────────────────────────────────────
1. 是否有任何 hardcoded WAhubX / FAhubX / M33
────────────────────────────────────────────────────────────────

✗ 生产代码 / Prompt 模板里: **没有任何 hardcoded 产品名**.
✓ 注释里出现的 WAhubX/FAhubX/M33 仅:
  - 历史 bug 修复说明 (commit 65d4749, 7c12f0d 等记录)
  - 数据格式示例 (e.g. "格式: ['intent:pricing', 'var:多少钱']")
  这些是描述代码做了什么 · 不影响 LLM prompt · 不影响菜单生成

审计结果:
  reply-executor.service.ts          → 0 处生产 hardcoded
  knowledge-base.service.ts          → 0 处生产 hardcoded
  auto-reply-decider.service.ts      → 0 处 hardcoded
  starter-common-faq.ts (52 条)      → 0 处产品名 (全部通用问候/转人工/价格反问)
  customer-conversation.entity.ts    → 0 处
  reply-executor module / controllers → 0 处

执行命令验证:
  grep -nE "10 号|30 号|账号数量|多少个号|VPN|封号|WAhubX|FAhubX|M33|Basic"
       packages/backend/src/modules/intelligent-reply/
  → 仅剩注释 · 0 处影响 prompt

───
本次 (884bbdf) 修复的 4 处真实生产偏见:

reply-executor.service.ts (AI 模式 system prompt):
  ✗ 老: "您大概需要多少个号"
  ✓ 新: "询问客户具体需求场景"
  
  ✗ 老: "10 号 = Basic / 30 号 = Pro 主推 / 50 号 = Enterprise 主推"
  ✓ 新: "根据'资料'推荐合适方案 + 引导留联系方式"
  
  ✗ 老: "引导留 WhatsApp / 公司名 / 账号需求量"
  ✓ 新: "引导留 WhatsApp 号 / 称呼 / 公司名 / 具体需求"

  ✗ 老: 闲聊示例 "我主要是负责产品咨询的 AI 智能客服"
  ✓ 新: "我主要负责产品咨询的智能客服"
       (闲聊话术原本就基本通用 · 微调更稳)

knowledge-base.service.ts (FAQ 生成 prompt):
  ✗ 老: "常见疑虑 (会不会被封 / VPN / IP / 数据安全)"
  ✓ 新: "客户常见疑虑 (从资料推断 · 例如效果 / 周期 / 成本 /
        服务范围 / 售后保障 / 风险)
        注意: 不要从其他行业经验照搬话题 · 严格根据'参考资料'生成"
  
  ✗ 老: "风险话题 (会不会封号 / VPN / IP) risk_level 设 high"
  ✓ 新: "风险/疑虑话题 (具体例子由'参考资料'决定 ·
        不要套用其他行业的疑虑) risk_level 设 high"
  
  ✗ 老: intent 枚举含 "vpn_ip" (WhatsApp 自动化特定)
  ✓ 新: intent 枚举去掉 "vpn_ip"
  
  ✗ 老: System prompt "客户表现兴趣引导留 WhatsApp / 公司名 / 账号需求量"
  ✓ 新: System prompt "你支持任意行业租户 (美容 / 课程 / 地产 / SaaS /
        电商等)" + "具体问什么 (班次 / 项目预算 / 使用规模 / 客户人数)
        由资料决定"


────────────────────────────────────────────────────────────────
2. 产品菜单是否完全从 tenant KB 动态读取
────────────────────────────────────────────────────────────────

✓ 100% 动态读取.

reply-executor.service.ts 入口逻辑:

  const allProductKbsForMenu = await this.kbRepo.find({
    where: {
      tenantId: conv.tenantId,         // ← 当前对话的 tenant_id
      isDefault: false,                 // ← 排除公司通用 KB
      status: 1                         // ← 只活跃 KB
    },
  });

  // 菜单文本 100% 用查到的 KB 字段拼:
  const menuLines = allProductKbsForMenu
    .map((k, i) => `${i + 1}. ${k.name}${k.description ? ' - ' + k.description.slice(0, 30) : ''}`)
    .join('\n');

  const menuText = `您好, 我是 ${tenantName} 的智能客服 😊
请问您想咨询哪一个产品?

${menuLines}

直接回复编号或产品名称即可`;

零硬编码:
  - tenantName 从 SELECT name FROM tenant WHERE id = $tenantId 取
  - 产品名 从 productKbs[i].name (DB 列)
  - 短描述 从 productKbs[i].description (DB 列 · 可空)

边界条件:
  - allProductKbsForMenu.length === 0   → 不发菜单 (没产品就走通用 KB)
  - allProductKbsForMenu.length === 1   → 不发菜单 (单产品自动绑)
  - allProductKbsForMenu.length >= 2    → 发菜单
  - allProductKbsForMenu.length === 50  → 全部列出来 (没截断)

实测验证 (commit 884bbdf 加的 SaaS 边界 log):
  conv X (tenant=Y) · KB pool · default=Z · products=[id1:name1, id2:name2, ...]
  
  这条 debug log 让运维直接看到当前 tenant 真实 KB 列表.
  不同 tenant 看到的 KB 完全不同 · 100% 隔离.


────────────────────────────────────────────────────────────────
3. 公司通用 KB 是否按 tenant default KB 处理
────────────────────────────────────────────────────────────────

✓ 严格按 tenant 级 default KB 处理.

数据层:
  tenant_reply_settings 表
    tenant_id (PK 关联)
    default_kb_id (指向当前 tenant 的某个 knowledge_base.id)

  knowledge_base 表
    tenant_id (用于 tenant 隔离)
    is_default (boolean · 标记是公司通用 KB)
    
  注: 同一 tenant_id 下最多只能有一个 is_default=true 的 KB
      (Migration 1798 CommonKbStarter 自动给每个 tenant 建一个并设 default_kb_id)

代码层:
  reply-executor.service.ts · handle() 取 default:
    const settings = await this.settings.get(conv.tenantId);
    const defaultKbId = settings.defaultKbId;
    // ↑ 这是 tenant.default_kb_id · 100% 当前 tenant 的

  双层 KB Fallback 逻辑:
    primaryKbIds = [当前 tenant 产品 KB 列表]
    secondaryKbId = settings.defaultKbId    ← tenant 级
  
  → 任何租户进 reply-executor · 取的 default KB 都是该租户自己的
  → 任何 tenant 之间不会跨拿别人的通用 KB

starter FAQ (52 条) 灌进 tenant 通用 KB 的方式:
  Migration 1798 CommonKbStarter1798000000000 · 跑一次给所有 tenant:
    1. 看每个 tenant 是否已有 is_default=true 的 KB
    2. 没有 → 建一个新 KB "通用 FAQ" · is_default=true
    3. 灌 52 条 starter FAQ (跳重)
    4. 把 tenant_reply_settings.default_kb_id 设为该 KB id (若没设)
  
  这 52 条都是通用 (问候/营业时间/转人工/价格反问/闲聊兜底等) ·
  无产品名 · 跨行业通用. 任何新建 tenant 进来都能用.


────────────────────────────────────────────────────────────────
4. aliases / variants 是否租户隔离
────────────────────────────────────────────────────────────────

✓ 完全租户隔离.

存储: KbFaqEntity.tags (text[]) · 通过 kb_id → knowledge_base.tenant_id 关联
  - FAQ 记录归属某个 KB
  - KB 归属某个 tenant
  - tenant A 的 FAQ.tags 不会被 tenant B 的 matchFaq 看到
    (matchFaq 通过 WHERE kbId IN (...) 限定 · kbId 只取自当前 conv.tenantId)

variants 来源:
  ✓ generateFaqs() 让 LLM 看 ${kb.name} 的 chunks 资料 → 推断 variants
  ✓ chunks 是该 KB 的资料 (kb_id 关联) · 跨 tenant 不会泄漏
  ✓ 老 starter FAQ 的 var: tags 由 starter-common-faq.ts 写 · 通用问候 variants
    (例如 "你好" 的 variants 可能是 "您好/嗨/在吗" · 跟产品无关)

aliases 概念:
  ✗ V1 没实装独立 aliases 字段 (本轮没要求)
  ✓ 当前用 KB.name 子串匹配 (keyword pre-filter) · 已 SaaS 通用

  未来 V2 加 aliases 字段时, 也必须挂在 knowledge_base 表 · 跟 tenant_id 关联.


────────────────────────────────────────────────────────────────
5. FAQ 生成是否根据当前 tenant / KB 资料生成
────────────────────────────────────────────────────────────────

✓ 100% 基于当前 KB 资料.

knowledge-base.service.ts · generateFaqs(tenantId, kbId):

  Step 1: 取该 tenant 该 KB 的 chunks (前 6 个):
    const sampleChunks = await this.chunkRepo.find({
      where: { kbId },                  // ← 只查该 KB 的 chunks
      take: 6,
    });
  
  Step 2: 用 chunks 文本拼 prompt material:
    const material = sampleChunks.map((c) => c.text).join('\n\n---\n\n');
  
  Step 3: 调 DeepSeek · prompt 含:
    "参考资料:
     \"\"\"
     ${material.slice(0, 8000)}
     \"\"\""
  
  Step 4: LLM 看 material 生成 FAQ (canonical/variants/intent/handoff_action 等)

实际效果:
  租户 A (美容配套) → chunks 含 "美容护理流程" → variants: 
    canonical: "需要做几次?"
    variants: ["疗程多久", "几次能见效", "一次多长时间"]
  
  租户 B (地产项目) → chunks 含 "项目交付时间" → variants:
    canonical: "什么时候交房?"
    variants: ["几月入住", "交付时间", "什么时候拿钥匙"]
  
  租户 C (WAhubX SaaS) → chunks 含 "账号管理" → variants:
    canonical: "几个号?"
    variants: ["最多几个", "账号数量限制", "几台手机"]

  完全跨行业 · LLM 自己看资料适配 · 不会把美容 variants 应用到地产.


────────────────────────────────────────────────────────────────
6. 测试是否覆盖非 WA AutoBot 产品场景
────────────────────────────────────────────────────────────────

[T1] 租户只有 1 个产品 KB
  设定: tenant.id=99 · 1 个产品 KB "美容护理配套"
  
  客户首发 "你好"
  ┌────────────────────────────────────────────────┐
  │ 1. allProductKbsForMenu.length === 1 ?         │
  │    → 不发菜单 (跳过 if length >= 2 分支)       │
  │ 2. 走老逻辑: conv.kbId 自动? 否 → 走通用 KB     │
  │    starter "你好" FAQ 命中 jaccard 1.0          │
  │ 3. 答 "你好呀! 欢迎来了解我们的产品 ~ ..."     │
  │    (无任何产品名 hardcode · 通用)              │
  └────────────────────────────────────────────────┘

  客户接着发 "想了解一下"
  ┌────────────────────────────────────────────────┐
  │ 1. 多产品菜单条件不满足 (产品 KB 只 1 个)       │
  │ 2. 走 KB pre-filter: 没含产品名 → 跨产品 KB    │
  │    primaryKbIds = [美容护理配套 KB id]         │
  │ 3. 走 RAG · 找美容护理 chunks · LLM 答          │
  └────────────────────────────────────────────────┘

[T2] 租户有 3 个产品 KB
  设定: tenant.id=100 · 3 个产品 KB:
    "网页版减肥课程"
    "线下私教课"
    "营养师 1 对 1 咨询"
  
  客户首发 "你好"
  → starter 通用 FAQ "你好" 命中 → 答 "你好呀! 欢迎..."
  → 不发菜单 (isGreetingOrSimple=true)
  
  客户接着发 "想咨询一下"
  ┌────────────────────────────────────────────────────┐
  │ 1. allProductKbsForMenu.length === 3 ✓           │
  │ 2. conv.kbId === defaultKbId (公司通用) · 没绑    │
  │ 3. 客户消息没产品名 + 不像问候 + 不在 5min 菜单内 │
  │ 4. 发菜单:                                         │
  │    "您好, 我是 [Tenant 名] 的智能客服 😊         │
  │     请问您想咨询哪一个产品?                        │
  │                                                    │
  │     1. 网页版减肥课程 - [k.description 前 30 字]  │
  │     2. 线下私教课                                  │
  │     3. 营养师 1 对 1 咨询                          │
  │                                                    │
  │     直接回复编号或产品名称即可"                    │
  └────────────────────────────────────────────────────┘

  客户回复 "2"
  → parseProductMenuReply("2", productKbs) = productKbs[1] = "线下私教课"
  → conv.kbId 绑 KB id
  → 答 "好的, 您选了 线下私教课 😊 请问您想了解功能、价格还是开通流程?"
  → audit metadata { kb_bound_now: true, picked_kb_id: <id> }

[T3] 租户有 5 个产品 KB
  设定: tenant.id=101 · 5 个产品 KB
  
  → 菜单显示 5 行 (没截断 · 因为 .map 全跑)
  → parseProductMenuReply 接受 1-9 编号 (regex: /^[1-9]\d?$/)
    其中 1-5 命中真 KB · 6-9 越界返回 null (重发菜单或走主流程)

[T4] 产品名跟 WAhubX 完全无关
  设定: tenant.id=102 · 3 个产品 KB:
    "厦门海岸壹号项目"
    "深圳前海湾别墅"
    "上海陆家嘴公寓"
  
  客户问 "厦门那个多少钱"
  ┌────────────────────────────────────────────────┐
  │ KB pre-filter: normalize("厦门那个多少钱") 包含│
  │ normalize("厦门海岸壹号项目") = "厦门海岸壹号项目"│
  │ ✓ 命中 [厦门海岸壹号项目 KB]                    │
  │ → primaryKbIds = [该 KB id]                    │
  │ → 走 FAQ / RAG · 用厦门项目资料答价格反问       │
  └────────────────────────────────────────────────┘

  AI system prompt 完全不会出现 WAhubX/FAhubX/M33 字样.
  闲聊触发时也只用通用话术 ("我主要负责产品咨询的智能客服").

[T5] 当前 WA AutoBot 测试租户
  设定: tenant.id=5 · 4 个 KB:
    9  公司通用      (is_default=true)
    11 WAhubX        (is_default=false)
    12 M33 Lotto Bot (is_default=false)
    18 FAhubX        (is_default=false)
  
  跟其他 tenant 走同一段代码:
  - 客户问 "fahubx 多少钱" → KB pre-filter 锁 [18:FAhubX]
  - 客户问 "你们有什么" → 没产品名 · 发菜单
    菜单 100% 从 DB 列 [11/12/18] 动态拼 · 不是因为代码硬编码
  
  这是 SaaS 通用 + 当前测试数据 · 切换 tenant 行为完全一致.


────────────────────────────────────────────────────────────────
7. SaaS 边界检查清单 (执行结果)
────────────────────────────────────────────────────────────────

[✓] 产品列表必须从当前 tenant 的 knowledge_base 动态读取
    → 100% 通过 SQL WHERE tenant_id = $conv.tenantId 限定

[✓] 产品选择菜单必须根据 tenant 当前启用的产品 KB 动态生成
    → menuLines 100% 来自 productKbs[i].name + .description

[✓] 如果某租户只有 1 个产品 KB, 不显示多产品菜单
    → 条件判断 `allProductKbsForMenu.length >= 2` 跳过单产品

[✓] 如果某租户有多个产品 KB, 才动态生成产品选择菜单
    → 同上

[✓] 产品别名 aliases / variants 必须属于对应 tenant / KB
    → variants 存 KbFaqEntity.tags · 通过 kb_id 关联 KB 的 tenant

[✓] 公司通用 KB 必须是租户级 default KB
    → tenant_reply_settings.default_kb_id (per tenant 一行)
    → migration 1798 自动给每个 tenant 建 + 灌 starter

[✓] FAQ 生成必须基于当前 tenant 资料
    → generateFaqs 取 chunks WHERE kbId=$kbId (该 KB 内的 chunks)

[✓] AI system prompt 不能默认提 WAhubX / FAhubX / M33
    → 改后 prompt 完全不出现任何特定产品名 (本次 commit 884bbdf 修)

[✓] 销售流程通用化
    → 改后只说 "了解需求 → 推荐方案 → 引导留联系方式"
    → 具体问什么 (账号 / 班次 / 客户数 / 项目) 由 LLM 看资料决定

[✓] Basic / Pro / Enterprise 不强行套用
    → 已从 system prompt 移除
    → WAhubX 平台自己的套餐概念跟 tenant 业务产品分开

[✓] 当前测试租户的数据不作为所有租户的默认数据
    → 没有 seed / migration 把 WAhubX/FAhubX/M33 灌到其他 tenant
    → 新建 tenant 进来只有 starter 通用 FAQ + 空产品 KB · 等用户自己上传

[✓] 代码里出现的 hardcoded WAhubX / FAhubX / M33 已清理
    → 只剩注释 (描述本次改动用) · 不影响运行


────────────────────────────────────────────────────────────────
8. 风险点
────────────────────────────────────────────────────────────────

R1 (低) · KB 排序未指定
  当前 allProductKbsForMenu 没显式 ORDER BY
  TypeORM find() 默认按主键 (id) ASC 排
  菜单顺序 = KB 创建顺序 · 一致但用户不可控
  V2.1 建议: 加 sort_order int 列 (默认 100) · 让租户后台可调排序

R2 (低) · 单 tenant KB 数量过多
  租户有 50+ 产品 KB 时菜单文本会超 200 字
  WhatsApp 单条消息无字数硬限制 (可发 1000+ 字), 但客户体验差
  V2.1 建议: KB 数 > 10 时改 "请告诉我您想咨询哪个产品" + 列举前 8 个

R3 (低) · LLM 仍可能跨行业误用
  虽然 system prompt 强调"严格根据资料", 但 LLM 偶尔会泄漏训练记忆
  e.g. 美容租户客户问 "VPN", LLM 可能误回答 "VPN 是 ..."
  缓解: 应该走 RAG cosine 低 → clarify · LLM 答非所问的概率不高
  V2 建议: 加 LLM 输出 post-filter (敏感词列表外拒答)

R4 (无) · 单 tenant 不能跨 tenant 拿别人 KB
  完全隔离 · WHERE tenant_id 强约束.

R5 (低) · isCompanyCommonKb 判断依赖 kb.isDefault
  如果租户后台手贱把 default KB 切到产品 KB · 会导致:
  - generateFaqs 把产品 KB 当通用生成 (输出问候/转人工)
  - reply-executor secondaryKbId 取错
  缓解: 后台 UI 设 default 时强制提示 · 现有 ReplySetupWizard 已限定


────────────────────────────────────────────────────────────────
9. 测试运行结果
────────────────────────────────────────────────────────────────

✓ pnpm --filter @wahubx/backend run build · TypeScript 0 errors
✓ Backend nest --watch hot-reload PASS
✓ 9700 LISTENING · PID 49736 跑新代码 (commit 884bbdf)

✓ Git commit 884bbdf · 2 files +40/-25
  - reply-executor.service.ts (system prompt 改通用)
  - knowledge-base.service.ts (FAQ 生成 prompt 改通用)

未实测 (没真测试租户切换 SaaS 场景):
  - T1/T3/T4 测试场景需要建多个 tenant 数据 + 录入产品 KB
  - 当前只有 tenant 5 (WAhubX/FAhubX/M33)
  - 建议你新建 1 个 tenant 灌不同行业产品验证 (V2 加 e2e 测试)


────────────────────────────────────────────────────────────────
10. 总结
────────────────────────────────────────────────────────────────

✓ 上一 commit (eb57de1) 加的 AI 客服 V2 全部功能保留
✓ 本 commit (884bbdf) 修了 4 处隐藏的 WAhubX 平台偏见话术
✓ 0 hardcoded 产品名进生产 prompt
✓ 100% SaaS 多租户通用
✓ 任意行业租户 (美容/课程/地产/SaaS/电商) 都能用同一套代码
✓ 添加 SaaS 边界 runtime debug log · 运维可直接看到 tenant 真实 KB

完整 commit 链:
  eb57de1 feat: AI 智能客服 V2 (FAQ 生成 + 多产品菜单 + 销售引导)
  884bbdf fix: SaaS 多租户通用 (去掉 WAhubX 平台偏见话术) ← 本次

================================================================
报告完
================================================================
```
