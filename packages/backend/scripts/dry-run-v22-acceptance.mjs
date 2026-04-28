// 2026-04-29 · V2.2 R2/R3/R4 验收测试 · 13 案例
// A. SaaS 占位符 (Beauty Demo + WAAutoBot 各 1)
// B. 闲聊 (新 variants 命中)
// C. 技术转人工 (R4 新关键词)
// D. 防误伤 (产品识别仍正确)

const BACKEND = 'http://localhost:9700/api/v1';

async function login() {
  const r = await fetch(`${BACKEND}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'platform@wahubx.local', password: 'Test1234!' }),
  });
  return (await r.json()).accessToken;
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

const FORBIDDEN_FOR_BEAUTY = ['FAhubX', 'WAhubX', 'M33', 'Lotto', 'Facebook'];

const TESTS = [
  // ─── A · SaaS 占位符 ────────────────────────────────
  { id: 'A1', tenant: 99, mode: 'smart', msg: '你是谁？', expect: 'Beauty Demo · 答含 "Beauty Demo Tenant" · 不含 FAhubX/WAhubX' },
  { id: 'A2', tenant:  5, mode: 'smart', msg: '你是谁？', expect: 'WAAutoBot · 不强求字面 · 但不能写硬编码 FAhubX (老 starter 已 customize 过)' },

  // ─── B · 闲聊 (R3 variants 命中) ──────────────────────
  { id: 'B1a', tenant: 99, mode: 'smart', msg: '你吃饭了吗？', expect: '命中 off_topic · 简短回 + 拉回业务' },
  { id: 'B1b', tenant: 99, mode: 'faq',   msg: '你吃饭了吗？', expect: 'FAQ-only · 命中 off_topic FAQ' },
  { id: 'B2',  tenant: 99, mode: 'smart', msg: '今天天气怎样？', expect: '命中 off_topic 闲聊 FAQ (新加 variants)' },
  { id: 'B3',  tenant: 99, mode: 'smart', msg: '你是机器人吗？', expect: '命中 identity FAQ · variant 命中' },

  // ─── C · 技术转人工 (R4 新关键词) ─────────────────────
  { id: 'C1', tenant: 99, mode: 'smart', msg: '系统有问题', expect: 'handoff_l1 · keyword "系统有问题"' },
  { id: 'C2', tenant: 99, mode: 'smart', msg: '登录不了', expect: 'handoff_l1 · keyword "登录不了"' },
  { id: 'C3', tenant: 99, mode: 'smart', msg: '发不出去', expect: 'handoff_l1 · keyword "发不出"' },
  { id: 'C4', tenant: 99, mode: 'smart', msg: 'AI 没回', expect: 'handoff_l1 · keyword "AI 没回"' },
  { id: 'C5', tenant: 99, mode: 'smart', msg: '账号异常', expect: 'handoff_l1 · keyword "账号异常"' },

  // ─── D · 防误伤 (产品识别仍正确) ──────────────────────
  { id: 'D1', tenant: 5, mode: 'smart', msg: '我想了解 WAhubX', expect: 'KB pre-filter 锁 [11:WAhubX] · 不被闲聊拦' },
  { id: 'D2', tenant: 5, mode: 'smart', msg: 'fahubx 是什么', expect: 'KB pre-filter 锁 [18:FAhubX]' },
  { id: 'D3', tenant: 5, mode: 'smart', msg: 'M33 多少钱', expect: 'KB pre-filter 锁 [12:M33 Lotto Bot]' },
];

async function main() {
  const token = await login();
  console.log('═'.repeat(78));
  console.log('AI 客服 V2.2 R2/R3/R4 验收测试 · 14 案例');
  console.log('═'.repeat(78));

  let beautyLeak = 0;
  for (const tc of TESTS) {
    const r = await dryRun(token, {
      tenantId: tc.tenant,
      message: tc.msg,
      mode: tc.mode,
      phoneE164: '60100000022',
    });
    const reply = r.reply ?? null;
    let leaks = [];
    if (tc.tenant === 99 && reply) {
      leaks = FORBIDDEN_FOR_BEAUTY.filter((w) => reply.includes(w));
      if (leaks.length > 0) beautyLeak++;
    }

    console.log(`\n【${tc.id}】 tenant=${tc.tenant} mode=${tc.mode}`);
    console.log(`  输入: "${tc.msg}"`);
    console.log(`  期望: ${tc.expect}`);
    console.log(`  ─────`);
    console.log(`  reply: ${reply ? `"${reply.replace(/\n/g, ' ').slice(0, 120)}${reply.length > 120 ? '...' : ''}"` : '(none · handoff)'}`);
    console.log(`  modeResolved: ${r.modeResolved ?? '(none)'}`);
    console.log(`  intent: ${r.intent ?? '(none)'}`);
    console.log(`  matchedFaqId: ${r.matchedFaqId ?? '(none)'} · variant: ${r.matchedVariant ?? '(canonical)'}`);
    console.log(`  kb: ${r.kbId ?? '(none)'}${r.kbName ? ` (${r.kbName})` : ''}`);
    console.log(`  handoff: ${r.handoff} · keywordHit: ${r.handoffKeywordHit ?? '-'}`);
    if (tc.tenant === 99) {
      console.log(`  Beauty leak (FAhubX/WAhubX/M33): ${leaks.length === 0 ? '✓ 0' : `❌ ${leaks.join(', ')}`}`);
    }
  }

  console.log('\n' + '═'.repeat(78));
  console.log(`SaaS 占位符审计 · Beauty Demo 输出含 FAhubX/WAhubX/M33: ${beautyLeak === 0 ? '✓ 0 次' : `❌ ${beautyLeak} 次`}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
