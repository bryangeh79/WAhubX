// 2026-04-29 · WAhubX 真租户验收测试 · 27 案例
// Tenant 5 (WAAutoBot) · KB 9/11/12/18 · 全部 dry-run · 不发 WA

const BACKEND = 'http://localhost:9700/api/v1';
const TENANT_WAHUBX = 5;
// Beauty Demo (跨租户污染测试 · 期望 0 出现)
const FORBIDDEN_BEAUTY_LEAK = ['美白护理配套', '祛痘护理配套', '身体塑形课程', 'Beauty Demo'];

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

const TESTS = [
  // ─── A · 通用入口 (5) ──────────────────────────────────────
  { id: 'A1', g: 'A', mode: 'smart', msg: '你好', expect: 'greeting / common KB · 不进 RAG' },
  { id: 'A2', g: 'A', mode: 'smart', msg: '介绍一下', expect: '通用 FAQ 反问 / 列产品菜单' },
  { id: 'A3', g: 'A', mode: 'smart', msg: '你们有什么产品？', expect: '列当前 tenant 自己的产品 (WAhubX/FAhubX/M33)' },
  { id: 'A4', g: 'A', mode: 'smart', msg: '多少钱？', expect: '反问哪个产品 · 不乱报价' },
  { id: 'A5', g: 'A', mode: 'smart', msg: '我要人工', expect: 'handoff_l1 立即转人工' },

  // ─── B · WAhubX (5) ────────────────────────────────────────
  { id: 'B1', g: 'B', mode: 'smart', msg: '我想了解 WAhubX', expect: 'KB pre-filter 锁 [11:WAhubX]' },
  { id: 'B2', g: 'B', mode: 'smart', msg: 'WhatsApp 多账号可以几个号？', expect: '锁 WAhubX (多账号关键词或 RAG)' },
  { id: 'B3', g: 'B', mode: 'smart', msg: '30 个号适合什么方案？', expect: 'WAhubX KB · 资料有套餐说 · 没有转人工' },
  { id: 'B4', g: 'B', mode: 'smart', msg: '广告号和客服号有什么区别？', expect: 'WAhubX KB · 答两类号区别' },
  { id: 'B5', g: 'B', mode: 'smart', msg: 'AI 客服可以做什么？', expect: 'WAhubX KB · 答 AI 客服功能' },

  // ─── C · FAhubX (5) ────────────────────────────────────────
  { id: 'C1', g: 'C', mode: 'smart', msg: '我想了解 FAhubX', expect: '锁 [18:FAhubX]' },
  { id: 'C2', g: 'C', mode: 'smart', msg: '自动养号是怎样的？', expect: '锁 FAhubX 或养号 KB' },
  { id: 'C3', g: 'C', mode: 'smart', msg: 'P1 P2 P3 是什么意思？', expect: '阶段说明' },
  { id: 'C4', g: 'C', mode: 'smart', msg: '会不会封号？', expect: '谨慎答 · 不承诺 100% 安全' },
  { id: 'C5', g: 'C', mode: 'smart', msg: '需要 VPN 吗？', expect: '根据资料答 VPN/IP 建议' },

  // ─── D · M33 (3) ───────────────────────────────────────────
  { id: 'D1', g: 'D', mode: 'smart', msg: 'M33 是什么？', expect: '锁 [12:M33 Lotto Bot]' },
  { id: 'D2', g: 'D', mode: 'smart', msg: 'm33 怎么用？', expect: '锁 M33 / 答使用方式' },
  { id: 'D3', g: 'D', mode: 'smart', msg: 'M33 多少钱？', expect: '资料有价格答 · 没有转人工' },

  // ─── E · 闲聊 / 跑题 (3 × 2 mode = 6) ─────────────────────
  { id: 'E1a', g: 'E', mode: 'smart', msg: '你吃饭了吗？', expect: 'AI 模式 · 简短陪聊 + 拉回业务' },
  { id: 'E1b', g: 'E', mode: 'faq',   msg: '你吃饭了吗？', expect: 'FAQ-only · 命中 off_topic FAQ 或 fallback' },
  { id: 'E2a', g: 'E', mode: 'smart', msg: '今天天气怎样？', expect: 'AI 模式 · 不展开天气' },
  { id: 'E2b', g: 'E', mode: 'faq',   msg: '今天天气怎样？', expect: 'FAQ-only · 没命中 → fallback' },
  { id: 'E3a', g: 'E', mode: 'smart', msg: '你是不是机器人？', expect: '承认 AI · 引导转人工/咨询' },
  { id: 'E3b', g: 'E', mode: 'faq',   msg: '你是不是机器人？', expect: 'FAQ-only · 命中 identity FAQ' },

  // ─── F · 转人工 (6) ────────────────────────────────────────
  { id: 'F1', g: 'F', mode: 'smart', msg: '我要 demo', expect: 'handoff_l1' },
  { id: 'F2', g: 'F', mode: 'smart', msg: '我要购买', expect: 'handoff_l1' },
  { id: 'F3', g: 'F', mode: 'smart', msg: '购买流程是怎样的？', expect: '注意: 不要太早转 · 先答流程再问要不要顾问 (但当前实装是关键词 hit "购买" 直接转)' },
  { id: 'F4', g: 'F', mode: 'smart', msg: '我要退款', expect: 'handoff_l1' },
  { id: 'F5', g: 'F', mode: 'smart', msg: '账号异常', expect: 'handoff_l1' },
  { id: 'F6', g: 'F', mode: 'smart', msg: '你们系统有问题', expect: 'handoff_l1 或 technical_support' },
];

async function main() {
  const token = await login();
  console.log('═'.repeat(80));
  console.log('WAhubX 真租户 V2 验收测试 · 27 案例 · tenant=5 (WAAutoBot)');
  console.log('═'.repeat(80));

  const results = [];
  let leakCount = 0;

  for (const tc of TESTS) {
    const r = await dryRun(token, {
      tenantId: TENANT_WAHUBX,
      message: tc.msg,
      mode: tc.mode,
      phoneE164: '60100000099',
    });
    const reply = r.reply ?? null;
    // Beauty Demo 跨租户污染检测
    const allText = JSON.stringify({ reply, intent: r.intent, kbName: r.kbName });
    const leaks = FORBIDDEN_BEAUTY_LEAK.filter((w) => allText.includes(w));
    if (leaks.length > 0) leakCount += 1;
    results.push({ tc, r, leaks });

    console.log(`\n【${tc.id}】 [${tc.g}] mode=${tc.mode}`);
    console.log(`  输入: "${tc.msg}"`);
    console.log(`  期望: ${tc.expect}`);
    console.log(`  ─────`);
    console.log(`  reply: ${reply ? `"${reply.replace(/\n/g, ' ').slice(0, 90)}${reply.length > 90 ? '...' : ''}"` : '(none · handoff)'}`);
    console.log(`  modeResolved: ${r.modeResolved ?? '(none)'}`);
    console.log(`  intent: ${r.intent ?? '(none)'} · confidence: ${r.confidence ?? '(none)'}`);
    console.log(`  kb: ${r.kbId ?? '(none)'}${r.kbName ? ` (${r.kbName})` : ''}`);
    console.log(`  matchedFaqId: ${r.matchedFaqId ?? '(none)'} · variant: ${r.matchedVariant ?? '(canonical)'}`);
    console.log(`  handoff: ${r.handoff} · keywordHit: ${r.handoffKeywordHit ?? '-'}`);
    console.log(`  productMenu: ${r.productMenuShown} · earlyCommon: ${r.usedCommonKbEarly}`);
    console.log(`  audit: ${r.auditId ?? '(none)'} · conv: ${r.conversationId} (temp=${r.conversationIsTemporary})`);
    if (leaks.length > 0) console.log(`  ⚠ Beauty Demo leak: ${leaks.join(', ')}`);
  }

  console.log('\n' + '═'.repeat(80));
  console.log(`SaaS 跨租户污染审计 · Beauty Demo (美白/祛痘/塑形) 出现次数: ${leakCount === 0 ? '✓ 0 次' : `❌ ${leakCount} 次`}`);
  console.log('─'.repeat(80));

  // KB pool 印证
  const wahubxPool = results[0].r.kbPool;
  console.log(`tenant=5 KB pool: default=${wahubxPool.defaultKbId}:${wahubxPool.defaultKbName}`);
  console.log(`               products=[${wahubxPool.productKbs.map((k) => k.name).join(', ')}]`);

  // 决策路径汇总
  console.log('\n决策路径汇总:');
  const groups = ['A', 'B', 'C', 'D', 'E', 'F'];
  for (const g of groups) {
    const grp = results.filter((x) => x.tc.g === g);
    const dist = {};
    for (const x of grp) {
      const key = x.r.modeResolved ?? (x.r.handoff ? 'handoff_l1_decider' : x.r.intent ?? '(none)');
      dist[key] = (dist[key] ?? 0) + 1;
    }
    console.log(`  组 ${g} (${grp.length} 测试): ${Object.entries(dist).map(([k, v]) => `${k}×${v}`).join(', ')}`);
  }

  // audit 验证 (查 DB 看 draft/dryRun)
  console.log('\n执行后建议 SQL 验证:');
  console.log(`  docker exec wahubx-dev-pg psql -U wahubx -d wahubx -c \\`);
  console.log(`    "SELECT COUNT(*), bool_and(draft) AS all_draft, bool_and(guardrail_edits->>'dryRun'='true') AS all_dr FROM ai_reply_audit WHERE conversation_id IN (SELECT id FROM customer_conversation WHERE phone_e164 LIKE 'dry_%' AND tenant_id=5);"`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
