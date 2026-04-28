// 2026-04-29 · SaaS 多租户验证测试 · Beauty Demo Tenant
// 直接验证 reply-executor 纯函数行为 (不调 LLM · 不真发 WA)
// 数据从 PG 拉 · 函数从 reply-executor.service.ts 复制 (保持等价 · 单测无侧效)

import pg from 'pg';

const pool = new pg.Pool({
  host: 'localhost',
  port: 5434,
  user: 'wahubx',
  password: 'wahubx',
  database: 'wahubx',
});

// ═══════════════════════════════════════════════════════════════
// 复制自 reply-executor.service.ts (保持函数等价)
// ═══════════════════════════════════════════════════════════════

const TC_TO_SC = {
  '妳': '你', '您': '你',
  '們': '们', '個': '个', '麼': '么', '對': '对', '說': '说',
  '話': '话', '時': '时', '間': '间', '問': '问', '題': '题',
  '產': '产', '價': '价', '錢': '钱', '買': '买', '賣': '卖',
  '單': '单', '號': '号', '聯': '联', '繫': '系', '電': '电',
  '網': '网', '頁': '页', '應': '应', '該': '该', '當': '当',
  '會': '会', '為': '为', '從': '从', '進': '进', '這': '这',
  '裡': '里', '謝': '谢', '請': '请', '幫': '帮', '給': '给',
  '讓': '让', '見': '见', '聽': '听', '愛': '爱', '歡': '欢',
};

function normalizeZhVariants(s) {
  let out = '';
  for (const ch of s) out += TC_TO_SC[ch] ?? ch;
  return out;
}

function tokenize(s) {
  const normalized0 = normalizeZhVariants(s);
  const tokens = new Set();
  const normalized = normalized0.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  for (const m of normalized.matchAll(/[a-z]{2,}|\d+/g)) tokens.add(m[0]);
  for (const m of normalized.matchAll(/[\p{Script=Han}]/gu)) tokens.add(m[0]);
  return tokens;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function detectLang(s) {
  const hasHan = /\p{Script=Han}/u.test(s);
  const hasLatin = /[a-zA-Z]/.test(s);
  if (hasHan && hasLatin) return 'mixed';
  if (hasHan) return 'zh';
  if (hasLatin) return 'en';
  return 'unknown';
}

function faqLangsFromTags(tags) {
  const out = new Set();
  const lower = (tags ?? []).map((t) => t.toLowerCase());
  if (lower.includes('zh')) out.add('zh');
  if (lower.includes('en')) out.add('en');
  return out;
}

function extractVariantsFromTags(tags) {
  if (!tags) return [];
  return tags.filter((t) => typeof t === 'string' && t.startsWith('var:')).map((t) => t.slice(4).trim()).filter((v) => v);
}

function extractFaqMeta(tags) {
  const out = { variants: [], plainTags: [] };
  if (!tags) return out;
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    if (t.startsWith('intent:')) out.intent = t.slice(7).trim();
    else if (t.startsWith('handoff:')) out.handoffAction = t.slice(8).trim();
    else if (t.startsWith('risk:')) out.riskLevel = t.slice(5).trim();
    else if (t.startsWith('fu:')) out.followUp = t.slice(3).trim();
    else if (t.startsWith('var:')) out.variants.push(t.slice(4).trim());
    else out.plainTags.push(t);
  }
  return out;
}

// matchFaq 跨 variants 取最高分 (跟 reply-executor 等价)
function matchFaq(faqs, question) {
  if (faqs.length === 0) return null;
  const qTokens = tokenize(question);
  if (qTokens.size === 0) return null;
  const qLang = detectLang(question);
  let best = null;
  for (const f of faqs) {
    const candidates = [{ text: f.question, isVariant: false }];
    for (const v of extractVariantsFromTags(f.tags)) {
      candidates.push({ text: v, isVariant: true });
    }
    const fLangs = faqLangsFromTags(f.tags);
    let bestForFaq = null;
    for (const c of candidates) {
      const cTokens = tokenize(c.text);
      let score = jaccard(qTokens, cTokens);
      if (qLang !== 'mixed' && qLang !== 'unknown') {
        if (fLangs.has(qLang)) score *= 1.2;
        else if (fLangs.size > 0 && !fLangs.has('mixed')) score *= 0.8;
      }
      if (score > 1) score = 1;
      if (!bestForFaq || score > bestForFaq.score) {
        bestForFaq = { score, matchedVariant: c.isVariant ? c.text : undefined };
      }
    }
    if (bestForFaq && (!best || bestForFaq.score > best.score)) {
      best = { faq: f, score: bestForFaq.score, matchedVariant: bestForFaq.matchedVariant };
    }
  }
  return best;
}

function isGreetingOrSimple(s) {
  const trimmed = s.trim().toLowerCase();
  if (trimmed.length === 0) return true;
  if (trimmed.length <= 4) return true;
  const greetingPatterns = [
    /^(hi|hello|hey|您好|你好|妳好|嗨|哈囉|哈罗|在吗|在嗎)[\s!,.]*$/i,
    /^(早|早上好|下午好|晚上好|good\s*(morning|afternoon|evening))[\s!,.]*$/i,
    /^(谢谢|多谢|thanks?|thank\s*you|感谢|ok|好的|嗯|嗯嗯|👍)[\s!,.]*$/i,
    /^(再见|拜拜|88|bye)[\s!,.]*$/i,
    /^(人工|真人|客服|转人工|要人工|找人工|转客服|sales|agent)[\s!,.]*$/i,
  ];
  return greetingPatterns.some((p) => p.test(trimmed));
}

function parseProductMenuReply(s, productKbs) {
  const trimmed = s.trim();
  const numMatch = trimmed.match(/^[1-9]\d?$/);
  if (numMatch) {
    const idx = parseInt(numMatch[0], 10) - 1;
    if (idx >= 0 && idx < productKbs.length) return productKbs[idx];
  }
  const norm = trimmed.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
  if (norm.length >= 2) {
    for (const k of productKbs) {
      const kn = k.name.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
      if (kn.length >= 2 && (norm.includes(kn) || kn.includes(norm))) return k;
    }
  }
  return null;
}

// KB pre-filter (产品名 keyword) · 跟 reply-executor.service.ts 等价
function kbPreFilter(question, productKbs) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
  const qNorm = norm(question);
  const kbNameMatchesQuery = (kbNorm, qN) => {
    if (kbNorm.length < 2 || qN.length < 2) return false;
    if (qN.includes(kbNorm) || kbNorm.includes(qN)) return true;
    const maxLen = Math.min(kbNorm.length, 8);
    for (let len = maxLen; len >= 2; len--) {
      for (let i = 0; i + len <= kbNorm.length; i++) {
        const sub = kbNorm.substring(i, i + len);
        if (qN.includes(sub)) return true;
      }
    }
    return false;
  };
  return productKbs.filter((k) => kbNameMatchesQuery(norm(k.name), qNorm));
}

// Level 1 handoff 关键词 (跟 decider 等价)
const HANDOFF_KEYWORDS_LEVEL1 = [
  '投诉', '退款', '退货', '律师', '报警', '骂', '操', '傻逼', '滚', '垃圾', '骗子',
  'scam', 'refund', 'lawyer', 'sue', 'cheat',
  '人工', '真人', '转人工', '要人工', '找人工', '转客服', '老板',
  'sales', 'agent', 'human', 'real person', 'real human',
  'demo', '演示', '试一下', '试用',
  '购买', '下单', '我要买', '想买', '要买', '怎么买', 'buy', 'purchase', 'order',
  '报价', '合同', '签合同', '见面', '约见', '预约',
  '付款', '付不了', '付不出', '付款失败', '不能付款', 'payment failed',
  '账号异常', '不能登录', '登不上', '登录不了', '上不去', '出错', '报错',
  '账号被封', '账号封', '号封了', 'account banned', 'cannot login',
];

function checkHandoffKeyword(question) {
  const lower = question.toLowerCase();
  for (const k of HANDOFF_KEYWORDS_LEVEL1) {
    if (lower.includes(k.toLowerCase())) return k;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 测试 runner
// ═══════════════════════════════════════════════════════════════

async function loadTenantKbs(tenantId) {
  const r = await pool.query(
    `SELECT id, name, description, is_default FROM knowledge_base
     WHERE tenant_id = $1 AND status = 1 ORDER BY id`,
    [tenantId],
  );
  return r.rows;
}

async function loadKbFaqs(kbId) {
  const r = await pool.query(
    `SELECT id, kb_id, question, answer, tags FROM knowledge_base_faq
     WHERE kb_id = $1 AND status = 'enabled' ORDER BY id`,
    [kbId],
  );
  return r.rows;
}

const FAQ_THRESHOLD = 0.55;

// 模拟 reply-executor.handle 的核心决策
async function simulateHandle(tenantId, mergedQuestion, options = {}) {
  const allKbs = await loadTenantKbs(tenantId);
  const productKbs = allKbs.filter((k) => !k.is_default);
  const defaultKb = allKbs.find((k) => k.is_default);
  const isUnboundOrDefault = !options.bindedKbId || options.bindedKbId === defaultKb?.id;

  const trace = [];
  trace.push(`tenant=${tenantId} · KB pool · default=${defaultKb?.id}:${defaultKb?.name} · products=[${productKbs.map((k) => `${k.id}:${k.name}`).join(', ')}]`);

  // Step 0 · handoff 关键词 Level 1 (decider 那一层 · 不进 8s 聚合就转人工)
  const hk = checkHandoffKeyword(mergedQuestion);
  if (hk) {
    trace.push(`L1 handoff keyword 命中: '${hk}' → markHandoff (decider 拦截 · executor 不会跑)`);
    return { decision: 'handoff_l1', keyword: hk, trace };
  }

  // Step 0.5 · 多产品菜单触发前 · 先扫通用 KB FAQ (问候/闲聊/转人工不发菜单)
  // 跟 reply-executor.service.ts 等价
  if (productKbs.length >= 2 && isUnboundOrDefault && defaultKb) {
    const commonFaqs = await loadKbFaqs(defaultKb.id);
    const earlyMatch = matchFaq(commonFaqs, mergedQuestion);
    if (earlyMatch && earlyMatch.score >= FAQ_THRESHOLD) {
      const meta = extractFaqMeta(earlyMatch.faq.tags);
      trace.push(`早期通用 FAQ 命中 kb=${defaultKb.id} · score=${earlyMatch.score.toFixed(2)} · faq="${earlyMatch.faq.question}" · 跳过菜单 · 直接答`);
      return {
        decision: 'faq_hit_common_early',
        faq: earlyMatch.faq,
        score: earlyMatch.score,
        matchedVariant: earlyMatch.matchedVariant,
        faqMeta: meta,
        trace,
      };
    }
  }

  // Step 1 · 多产品菜单
  if (productKbs.length >= 2 && isUnboundOrDefault) {
    if (options.lastWasProductMenu) {
      const picked = parseProductMenuReply(mergedQuestion, productKbs);
      if (picked) {
        trace.push(`product menu reply 命中 · 绑 kb=${picked.id}:${picked.name}`);
        return { decision: 'product_menu_picked', pickedKb: picked, trace };
      }
      trace.push(`product menu reply 没解析出产品 · 继续走主流程`);
    }
    const containsProductName = kbPreFilter(mergedQuestion, productKbs).length > 0;
    const looksGreeting = isGreetingOrSimple(mergedQuestion);
    if (!containsProductName && !looksGreeting && !options.lastWasProductMenu) {
      const menuLines = productKbs.map((k, i) => `${i + 1}. ${k.name}${k.description ? ' - ' + k.description.slice(0, 30) : ''}`).join('\n');
      trace.push(`shouldShowMenu=true · 发产品菜单`);
      return {
        decision: 'product_menu_shown',
        menuText: `您好, 我是 [Tenant Name] 的智能客服 😊\n请问您想咨询哪一个产品?\n\n${menuLines}\n\n直接回复编号或产品名称即可`,
        trace,
      };
    }
  }

  // Step 2 · KB pre-filter
  const hitKbs = kbPreFilter(mergedQuestion, productKbs);
  let primaryKbIds = [];
  let isKbExplicitlyTargeted = false;
  if (hitKbs.length > 0) {
    primaryKbIds = hitKbs.map((k) => k.id);
    isKbExplicitlyTargeted = true;
    trace.push(`KB pre-filter 命中: [${hitKbs.map((k) => `${k.id}:${k.name}`).join(', ')}]`);
  } else if (options.bindedKbId && options.bindedKbId !== defaultKb?.id) {
    primaryKbIds = [options.bindedKbId];
    trace.push(`conv 已绑产品 KB: ${options.bindedKbId}`);
  } else {
    primaryKbIds = productKbs.map((k) => k.id);
    trace.push(`conv 没绑产品 KB · 跨所有产品 KB · primaryKbIds=[${primaryKbIds.join(', ')}]`);
  }
  const secondaryKbId = defaultKb && !primaryKbIds.includes(defaultKb.id) ? defaultKb.id : null;

  // Step 3 · FAQ Jaccard 跨 primary KBs
  let bestPrimary = null;
  for (const pKbId of primaryKbIds) {
    const faqs = await loadKbFaqs(pKbId);
    const m = matchFaq(faqs, mergedQuestion);
    if (m && (!bestPrimary || m.score > bestPrimary.score)) {
      bestPrimary = { kbId: pKbId, ...m };
    }
  }
  if (bestPrimary && bestPrimary.score >= FAQ_THRESHOLD) {
    const meta = extractFaqMeta(bestPrimary.faq.tags);
    trace.push(`FAQ 命中 primary kb=${bestPrimary.kbId} · score=${bestPrimary.score.toFixed(2)} · faq="${bestPrimary.faq.question}" · variant="${bestPrimary.matchedVariant ?? '(canonical)'}" · intent=${meta.intent}`);
    return {
      decision: 'faq_hit_primary',
      faq: bestPrimary.faq,
      score: bestPrimary.score,
      matchedVariant: bestPrimary.matchedVariant,
      faqMeta: meta,
      trace,
    };
  }

  // Step 4 · FAQ secondary 通用 KB
  if (secondaryKbId) {
    const faqs = await loadKbFaqs(secondaryKbId);
    const m = matchFaq(faqs, mergedQuestion);
    if (m && m.score >= FAQ_THRESHOLD) {
      const meta = extractFaqMeta(m.faq.tags);
      trace.push(`FAQ 命中 secondary kb=${secondaryKbId} · score=${m.score.toFixed(2)} · faq="${m.faq.question}" · variant="${m.matchedVariant ?? '(canonical)'}" · intent=${meta.intent}`);
      return {
        decision: 'faq_hit_secondary',
        faq: m.faq,
        score: m.score,
        matchedVariant: m.matchedVariant,
        faqMeta: meta,
        trace,
      };
    }
  }

  // Step 5 · FAQ 都没命中 · 模式分支
  if (options.mode === 'faq') {
    trace.push(`FAQ-only 没命中 → 发兜底菜单 (产品介绍/价格/开通流程/转人工)`);
    return { decision: 'faq_only_fallback_menu', trace };
  }
  // smart 模式 · 走 RAG (本测试不跑 LLM)
  trace.push(`smart 模式 · FAQ 没命中 · 转 RAG · isKbExplicitlyTargeted=${isKbExplicitlyTargeted}`);
  return {
    decision: 'rag_or_clarify',
    isKbExplicitlyTargeted,
    primaryKbIds,
    secondaryKbId,
    trace,
  };
}

// ═══════════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════════

const TENANT_BEAUTY = 99;
const TENANT_WAHUBX = 5;

const TEST_CASES = [
  // T1 · 客户问候 · 通用 FAQ 命中, 不发产品菜单
  { id: 'T1', tenant: TENANT_BEAUTY, q: '你好', expect: 'faq_hit', desc: '问候 → 通用 FAQ "你好" 命中' },
  // T2 · 介绍一下 → 通用 FAQ "介绍一下" 命中
  { id: 'T2', tenant: TENANT_BEAUTY, q: '介绍一下', expect: 'faq_hit', desc: '"介绍一下" 命中通用 FAQ · 反问哪个产品' },
  { id: 'T2b', tenant: TENANT_BEAUTY, q: '想了解你们', expect: 'menu_or_rag', desc: '没明确产品 → 走菜单或 RAG' },
  // T3 · "我想了解祛痘" → KB pre-filter 命中祛痘 KB
  { id: 'T3', tenant: TENANT_BEAUTY, q: '我想了解祛痘', expect: 'kb_targeted', desc: 'KB pre-filter 命中 "祛痘护理配套"' },
  // T4 · "多少钱" → 通用 FAQ "多少钱" 命中 (反问哪个产品 · handoff:if_no_price)
  { id: 'T4', tenant: TENANT_BEAUTY, q: '多少钱', expect: 'faq_hit', desc: '"多少钱" 通用 FAQ 命中 · 反问产品' },
  // T5 · "可以预约吗" → 通用 FAQ "怎么预约" handoff:always
  { id: 'T5', tenant: TENANT_BEAUTY, q: '可以预约吗', expect: 'faq_hit_handoff', desc: '"预约" 通用 FAQ 命中 · 触发 handoff' },
  // T6a · "我要 demo" → Level 1 handoff 关键词
  { id: 'T6a', tenant: TENANT_BEAUTY, q: '我要 demo', expect: 'handoff_l1', desc: 'demo 关键词 → 立即 handoff' },
  // T6b · "我要预约" → Level 1 handoff 关键词
  { id: 'T6b', tenant: TENANT_BEAUTY, q: '我要预约', expect: 'handoff_l1', desc: '预约 关键词 → 立即 handoff' },
  // T7a · 闲聊 (FAQ-only 模式)
  { id: 'T7a', tenant: TENANT_BEAUTY, q: '你吃饭了吗', expect: 'faq_hit', desc: '通用 FAQ "你吃饭了吗" 命中' },
  // T8 · "我有 30 个号" → 美容租户应该走菜单或 RAG, 不出现 WAhubX 套餐
  { id: 'T8', tenant: TENANT_BEAUTY, q: '我有 30 个号', expect: 'menu_or_rag', desc: '美容租户里"30 个号" 应走菜单/RAG, 不会自动解释 WAhubX 套餐' },
  // 对比 · 同一句话在 WAhubX 租户行为
  { id: 'T8-W', tenant: TENANT_WAHUBX, q: '我有 30 个号', expect: 'menu_or_rag', desc: '对比: 同一句话在 WAhubX 租户的行为' },
  // T9 · 多产品菜单回复
  { id: 'T9a', tenant: TENANT_BEAUTY, q: '想了解你们', expect: 'menu_shown', desc: 'no greeting + no product name → 发菜单', options: { mode: 'smart' } },
  { id: 'T9b', tenant: TENANT_BEAUTY, q: '2', expect: 'menu_picked', desc: '客户回 "2" · 在 lastWasProductMenu 状态下 → 绑 KB 202 (祛痘)', options: { lastWasProductMenu: true } },
  { id: 'T9c', tenant: TENANT_BEAUTY, q: '塑形', expect: 'menu_picked', desc: '客户回 "塑形" → 绑 KB 203 (身体塑形课程)', options: { lastWasProductMenu: true } },
];

console.log('═'.repeat(70));
console.log('SaaS 多租户验证测试 · Beauty Demo Tenant');
console.log('═'.repeat(70));

for (const tc of TEST_CASES) {
  console.log(`\n【${tc.id}】 tenant=${tc.tenant} · "${tc.q}"`);
  console.log(`  期望: ${tc.expect} · ${tc.desc}`);
  const r = await simulateHandle(tc.tenant, tc.q, tc.options ?? {});
  console.log(`  决策: ${r.decision}`);
  for (const t of r.trace) console.log(`  trace: ${t}`);
  if (r.faq) {
    console.log(`  ┃ 命中 FAQ: id=${r.faq.id} kb_id=${r.faq.kb_id}`);
    console.log(`  ┃ Q: "${r.faq.question}"`);
    console.log(`  ┃ A: "${r.faq.answer.slice(0, 100)}${r.faq.answer.length > 100 ? '...' : ''}"`);
    console.log(`  ┃ matched_variant: ${r.matchedVariant ?? '(canonical)'}`);
    console.log(`  ┃ tags: [${r.faq.tags.join(', ')}]`);
    if (r.faqMeta?.handoffAction === 'always') console.log(`  ┃ ⚠ handoff:always · 答完立即转人工`);
  }
  if (r.pickedKb) console.log(`  ┃ 绑定 KB: ${r.pickedKb.id}:${r.pickedKb.name}`);
  if (r.menuText) console.log(`  ┃ 菜单文本:\n${r.menuText.split('\n').map((l) => '       ' + l).join('\n')}`);
  if (r.keyword) console.log(`  ┃ Handoff keyword: "${r.keyword}"`);
}

// ═══════════════════════════════════════════════════════════════
// SaaS 偏见审计 (检查任意输出是否含 WAhubX/账号系统词)
// ═══════════════════════════════════════════════════════════════

console.log('\n' + '═'.repeat(70));
console.log('SaaS 偏见审计 · Beauty Demo 输出不应含 WAhubX 词');
console.log('═'.repeat(70));

const FORBIDDEN_WORDS = ['WAhubX', 'FAhubX', 'M33', 'Lotto', 'Facebook Auto Bot', 'WhatsApp 多账号', '养号', '广告号', '账号数量', '10 号', '30 号', '50 号', 'Basic ', 'Pro ', 'Enterprise', 'VPN', '封号'];

let totalContaminated = 0;
for (const tc of TEST_CASES.filter((c) => c.tenant === TENANT_BEAUTY)) {
  const r = await simulateHandle(tc.tenant, tc.q, tc.options ?? {});
  const allText = JSON.stringify({
    answer: r.faq?.answer ?? '',
    menuText: r.menuText ?? '',
    pickedKbName: r.pickedKb?.name ?? '',
    trace: r.trace.join(' '),
  });
  const hits = FORBIDDEN_WORDS.filter((w) => allText.includes(w));
  if (hits.length > 0) {
    totalContaminated++;
    console.log(`  ❌ ${tc.id} "${tc.q}" 输出含禁止词: ${hits.join(', ')}`);
  } else {
    console.log(`  ✓ ${tc.id} "${tc.q}" · 无 WAhubX 偏见`);
  }
}

console.log(`\n审计结果: ${totalContaminated === 0 ? '✓ 0 处 WAhubX 偏见' : `❌ ${totalContaminated} 处偏见残留`}`);

await pool.end();
