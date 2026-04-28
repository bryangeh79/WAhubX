// 2026-04-29 · AI 客服 dry-run endpoint 端到端测试
// 跑 Beauty Demo (tenant 99) + WAhubX (tenant 5) 共 15 个测试案例
// 不真发 WhatsApp · audit draft=true

const BACKEND = 'http://localhost:9700/api/v1';

async function login() {
  const r = await fetch(`${BACKEND}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'platform@wahubx.local', password: 'Test1234!' }),
  });
  const d = await r.json();
  return d.accessToken;
}

async function dryRun(token, body) {
  const r = await fetch(`${BACKEND}/intelligent-reply/debug/dry-run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

const FORBIDDEN_FOR_BEAUTY = [
  'WAhubX', 'FAhubX', 'M33', 'Lotto', 'Facebook Auto Bot',
  'WhatsApp 多账号', '养号', '广告号', '账号数量',
  '10 号', '30 号', '50 号', 'Basic ', 'Pro ', 'Enterprise',
  'VPN', '封号',
];

function biasCheck(tenantId, reply) {
  if (tenantId !== 99) return [];
  if (!reply) return [];
  return FORBIDDEN_FOR_BEAUTY.filter((w) => reply.includes(w));
}

const TESTS = [
  // ─── Beauty Demo (tenant 99) ────────────────────────────────
  { id: 'B1',  tenant: 99, mode: 'smart', msg: '你好', expect: 'common_kb_faq_early (greeting)' },
  { id: 'B2a', tenant: 99, mode: 'smart', msg: '你吃饭了吗', expect: 'common_kb_faq_early (off_topic 闲聊兜底)' },
  { id: 'B2b', tenant: 99, mode: 'faq',   msg: '你吃饭了吗', expect: 'common_kb_faq_early (FAQ-only · 同样命中通用 FAQ)' },
  { id: 'B3',  tenant: 99, mode: 'smart', msg: '我想了解祛痘', expect: 'KB pre-filter 锁 [202:祛痘护理配套]' },
  { id: 'B4',  tenant: 99, mode: 'smart', msg: '多少钱', expect: 'common_kb_faq_early (pricing · 反问哪个产品)' },
  { id: 'B5',  tenant: 99, mode: 'smart', msg: '我要预约', expect: 'handoff_l1_decider (预约关键词)' },
  { id: 'B6',  tenant: 99, mode: 'smart', msg: '想了解你们', expect: 'product_menu_shown' },
  { id: 'B7',  tenant: 99, mode: 'smart', msg: '我有 30 个号', expect: 'product_menu_shown (跨行业 · 美容租户不会答 WAhubX 套餐)' },
  { id: 'B8',  tenant: 99, mode: 'faq',   msg: '随便问问', expect: 'faq_only_fallback_menu (FAQ-only 没命中 → 兜底菜单)' },
  { id: 'B9',  tenant: 99, mode: 'smart', msg: '美白几次能见效', expect: 'KB pre-filter [201] + 产品 FAQ 命中' },
  // ─── WAhubX (tenant 5) ───────────────────────────────────────
  { id: 'W1', tenant: 5, mode: 'smart', msg: 'fahubx 是什么', expect: 'KB pre-filter 锁 [18:FAhubX]' },
  { id: 'W2', tenant: 5, mode: 'smart', msg: 'whatsapp 多账号可以几个号', expect: 'KB pre-filter 或 RAG · 锁 WAhubX' },
  { id: 'W3', tenant: 5, mode: 'smart', msg: '介绍一下', expect: '通用 FAQ 命中 反问哪个产品' },
  { id: 'W4', tenant: 5, mode: 'smart', msg: '你好', expect: '通用 FAQ greeting 命中' },
  { id: 'W5', tenant: 5, mode: 'smart', msg: '我想买', expect: 'handoff_l1_decider (买/购买关键词)' },
];

async function main() {
  const token = await login();
  console.log('═'.repeat(78));
  console.log('AI 客服 dry-run endpoint 端到端测试');
  console.log('═'.repeat(78));

  let totalContaminated = 0;
  const results = [];
  for (const tc of TESTS) {
    const r = await dryRun(token, {
      tenantId: tc.tenant,
      message: tc.msg,
      mode: tc.mode,
      phoneE164: '60100000000',
    });
    const reply = r.reply ?? null;
    const bias = biasCheck(tc.tenant, reply);
    const passBias = bias.length === 0;
    const ragChunks = r.ragChunks ?? [];
    results.push({ tc, r });
    console.log(`\n【${tc.id}】 tenant=${tc.tenant} mode=${tc.mode}`);
    console.log(`  输入: "${tc.msg}"`);
    console.log(`  期望: ${tc.expect}`);
    console.log(`  ─────────────────`);
    console.log(`  reply: ${reply ? `"${reply.slice(0, 80)}${reply.length > 80 ? '...' : ''}"` : '(none)'}`);
    console.log(`  modeResolved: ${r.modeResolved ?? '(none)'}`);
    console.log(`  intent: ${r.intent ?? '(none)'} · confidence: ${r.confidence ?? '(none)'}`);
    console.log(`  kb: ${r.kbId ?? '(none)'}${r.kbName ? ` (${r.kbName})` : ''}`);
    console.log(`  matchedFaqId: ${r.matchedFaqId ?? '(none)'} · variant: ${r.matchedVariant ?? '(canonical)'}`);
    console.log(`  handoff: ${r.handoff} · reason: ${r.handoffReason ?? '-'}`);
    console.log(`  productMenuShown: ${r.productMenuShown} · usedCommonKbEarly: ${r.usedCommonKbEarly}`);
    console.log(`  handoffKeywordHit: ${r.handoffKeywordHit ?? '-'}`);
    console.log(`  auditId: ${r.auditId ?? '(none)'} · conv: ${r.conversationId} (temp=${r.conversationIsTemporary})`);
    if (ragChunks.length > 0) console.log(`  ragChunks: ${ragChunks.length} 条`);
    console.log(`  bias check (Beauty only): ${passBias ? '✓ 0 处' : `❌ 含: ${bias.join(', ')}`}`);
    if (!passBias) totalContaminated++;
  }

  console.log('\n' + '═'.repeat(78));
  console.log(`SaaS 偏见汇总 · ${totalContaminated === 0 ? '✓ 0 处' : `❌ ${totalContaminated} 个测试有偏见`}`);
  console.log('─'.repeat(78));

  // 关键验证: 每个 tenant 的 KB pool 完全隔离
  const beautyKbs = results.find((x) => x.tc.tenant === 99)?.r.kbPool;
  const wahubxKbs = results.find((x) => x.tc.tenant === 5)?.r.kbPool;
  console.log(`Beauty Demo (99) KB pool: default=${beautyKbs?.defaultKbId}:${beautyKbs?.defaultKbName} · products=[${beautyKbs?.productKbs.map((k) => k.name).join(', ')}]`);
  console.log(`WAhubX (5) KB pool:        default=${wahubxKbs?.defaultKbId}:${wahubxKbs?.defaultKbName} · products=[${wahubxKbs?.productKbs.map((k) => k.name).join(', ')}]`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
