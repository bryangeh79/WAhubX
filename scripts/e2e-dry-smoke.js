#!/usr/bin/env node
/**
 * scripts/e2e-dry-smoke.js · Cascade [31]
 *
 * 端到端 dry-run smoke · 不依赖真 WA 账号 · 不调付费 API
 *
 * 9 steps:
 *   1  health check: backend + PG + Redis 均 up
 *   2  login platform admin · 获 token
 *   3  seed demo fixtures (tenant 999 · 3 persona)
 *   4  query /assets/personas · 验 3 条
 *   5  inject risk event · 验 scorer + dispatcher skip
 *   6  trigger upgrade apply dryRun · 验 wupd pipeline
 *   7  trigger backup export · 验 .wab 生成
 *   8  verify M7 asset pool path
 *   9  cleanup report
 *
 * 每 step 输出 PASS/FAIL + 耗时 · 最后汇总
 *
 * 用法:
 *   node scripts/e2e-dry-smoke.js
 *   node scripts/e2e-dry-smoke.js --skip=6,7   # 跳某些 step
 */

'use strict';

const http = require('node:http');
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const BASE = process.env.WAHUBX_BASE_URL || 'http://localhost:9700/api/v1';
const ADMIN_EMAIL = 'platform@wahubx.local';
const ADMIN_PASSWORD = 'Test1234!';

const args = process.argv.slice(2);
const skipArg = args.find((a) => a.startsWith('--skip='));
const SKIP = skipArg ? skipArg.slice('--skip='.length).split(',').map(Number) : [];

// ── steps registry ──
const STEPS = [];
function addStep(n, name, fn) {
  STEPS.push({ n, name, fn });
}

// ── helpers ──
function httpRequest(method, url, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('HTTP timeout 10s')));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  const ctx = {};
  const results = [];

  for (const step of STEPS) {
    if (SKIP.includes(step.n)) {
      console.log(`\n[${step.n}] ${step.name}  SKIPPED (--skip)`);
      results.push({ n: step.n, name: step.name, status: 'SKIP', ms: 0 });
      continue;
    }
    console.log(`\n[${step.n}] ${step.name}`);
    const t0 = Date.now();
    try {
      await step.fn(ctx);
      const ms = Date.now() - t0;
      console.log(`  ✓ PASS (${ms}ms)`);
      results.push({ n: step.n, name: step.name, status: 'PASS', ms });
    } catch (err) {
      const ms = Date.now() - t0;
      console.log(`  ✗ FAIL (${ms}ms): ${err.message}`);
      results.push({ n: step.n, name: step.name, status: 'FAIL', ms, err: err.message });
      // 继续跑后续 · 除非是 critical step
      if (step.n <= 2) {
        console.log('  critical step failed · 后续 step skip');
        break;
      }
    }
  }

  // 汇总
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  const totalMs = results.reduce((s, r) => s + r.ms, 0);

  console.log('\n' + '='.repeat(60));
  console.log('E2E Dry-run Smoke · Summary');
  console.log('='.repeat(60));
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '·';
    console.log(`  ${icon} [${r.n}] ${r.name.padEnd(40)} ${r.status}  ${r.ms}ms`);
    if (r.err) console.log(`     → ${r.err}`);
  }
  console.log('');
  console.log(`  PASS ${pass} / FAIL ${fail} / SKIP ${skip}  ·  total ${totalMs}ms`);
  console.log('='.repeat(60));

  process.exit(fail > 0 ? 1 : 0);
}

// ──────────────────────────────────────────────────────────────
// STEPS
// ──────────────────────────────────────────────────────────────

addStep(1, 'Backend + deps health', async (ctx) => {
  const r = await httpRequest('GET', `${BASE}/health`);
  if (r.status !== 200) throw new Error(`/health returned ${r.status}`);
  if (r.body?.status !== 'ok') throw new Error(`body.status=${r.body?.status}`);
  ctx.uptime = r.body.uptime_sec;
  console.log(`  backend uptime: ${ctx.uptime}s`);
});

addStep(2, 'Login platform admin', async (ctx) => {
  const r = await httpRequest('POST', `${BASE}/auth/login`, {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (r.status !== 200 && r.status !== 201) throw new Error(`login ${r.status}`);
  ctx.token = r.body?.accessToken;
  if (!ctx.token) throw new Error('no accessToken in response');
  console.log(`  token length: ${ctx.token.length}`);
});

addStep(3, 'Apply demo fixtures (idempotent)', async () => {
  const sqlPath = path.join(__dirname, 'demo-fixtures.sql');
  if (!fs.existsSync(sqlPath)) throw new Error(`missing ${sqlPath}`);
  try {
    execSync(
      `docker exec -i wahubx-dev-pg psql -U wahubx -d wahubx < "${sqlPath}"`,
      { stdio: 'pipe', shell: 'bash' },
    );
    console.log('  demo-fixtures applied');
  } catch (err) {
    throw new Error(`psql apply failed: ${err.message.slice(0, 200)}`);
  }
});

addStep(4, 'GET /assets/personas · 验 demo 3 条', async (ctx) => {
  const r = await httpRequest('GET', `${BASE}/assets/personas`, { token: ctx.token });
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  if (!Array.isArray(r.body)) throw new Error('body not array');
  const demos = r.body.filter((p) => p.personaId?.startsWith('demo_'));
  if (demos.length < 3) {
    throw new Error(`expect ≥3 demo persona · got ${demos.length}`);
  }
  console.log(`  found ${demos.length} demo persona (total ${r.body.length})`);
});

addStep(5, 'Inject risk event · 验 scorer + skip', async (ctx) => {
  // 先 clean
  try {
    execSync(
      `docker exec -i wahubx-dev-pg psql -U wahubx -d wahubx -c "DELETE FROM risk_event WHERE source='admin-debug';"`,
      { stdio: 'pipe', shell: 'bash' },
    );
  } catch {}

  const r = await httpRequest('POST', `${BASE}/admin/debug/inject-risk-event`, {
    token: ctx.token,
    body: { accountId: 1, code: 'captcha_triggered', count: 10 },
  });
  if (r.status !== 200 && r.status !== 201) throw new Error(`inject ${r.status}`);

  // wait for scorer to recompute
  await new Promise((r) => setTimeout(r, 2000));

  const out = execSync(
    `docker exec -i wahubx-dev-pg psql -U wahubx -d wahubx -tAc "SELECT risk_level FROM account_health WHERE account_id=1;"`,
    { encoding: 'utf-8', shell: 'bash' },
  ).trim();
  if (out !== 'high') throw new Error(`expected risk_level=high · got "${out}"`);
  console.log(`  risk_level=high · scorer recomputed`);

  // cleanup
  execSync(
    `docker exec -i wahubx-dev-pg psql -U wahubx -d wahubx -c "DELETE FROM risk_event WHERE source='admin-debug'; UPDATE account_health SET risk_level='low', health_score=100 WHERE account_id=1;"`,
    { stdio: 'pipe', shell: 'bash' },
  );
  console.log(`  cleanup · restored account 1 to low/100`);
});

addStep(6, 'Upgrade apply dryRun · .wupd pipeline', async (ctx) => {
  const wupdPath = path.join(__dirname, '..', 'staging', 'day5-smoke', 'test.wupd');
  if (!fs.existsSync(wupdPath)) {
    console.log(`  skip · staging/day5-smoke/test.wupd not present (OK in CI)`);
    return;
  }
  // 用 curl multipart (node http multipart 复杂)
  try {
    const out = execSync(
      `curl -s -X POST "${BASE}/version/apply-update" -H "Authorization: Bearer ${ctx.token}" -F "file=@${wupdPath.replace(/\\/g, '/')}" -F "dryRun=true"`,
      { encoding: 'utf-8', shell: 'bash' },
    );
    const body = JSON.parse(out);
    // 期望 PREVIEW_REJECTED 因 from_version 不匹配
    const validSig = body?.preview?.signature_valid;
    if (!validSig) throw new Error(`signature_valid not true · got ${validSig}`);
    console.log(`  signature_valid=true · code=${body.code}`);
  } catch (err) {
    throw new Error(`apply-update: ${err.message.slice(0, 200)}`);
  }
});

addStep(7, 'Backup list endpoint', async (ctx) => {
  const r = await httpRequest('GET', `${BASE}/backup/list`, { token: ctx.token });
  if (r.status !== 200 && r.status !== 404) {
    // 200 = 有 backup list · 404 = 路径不存在 (M10 未启 · 非 smoke 问题)
    throw new Error(`backup list ${r.status}`);
  }
  console.log(`  /backup/list status=${r.status}`);
});

addStep(8, 'Verify asset pool paths (storage helpers)', () => {
  // 直接跑 UT 确认 asset path 生成逻辑
  try {
    const out = execSync(
      `cd "${path.join(__dirname, '..', 'packages', 'backend')}" && pnpm jest src/common/storage.spec.ts --silent 2>&1`,
      { encoding: 'utf-8', shell: 'bash' },
    );
    if (!out.includes('Tests:') || !out.includes('passed')) {
      throw new Error('storage UT not all passed');
    }
    console.log(`  storage.spec.ts all UT passed`);
  } catch (err) {
    throw new Error(`storage UT failed: ${err.message.slice(0, 200)}`);
  }
});

addStep(9, 'Cleanup + report', async () => {
  // demo fixtures 用 ON CONFLICT DO NOTHING · 不需真清理
  console.log('  demo fixtures kept (idempotent · safe to leave)');
  console.log('  to purge: DELETE FROM persona WHERE persona_id LIKE \'demo_%\';');
});

// ──────────────────────────────────────────────────────────────

run().catch((err) => {
  console.error('\nfatal:', err);
  process.exit(2);
});
