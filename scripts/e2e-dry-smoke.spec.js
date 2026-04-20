#!/usr/bin/env node
/**
 * scripts/e2e-dry-smoke.spec.js · Cascade [31] UT (standalone node assertions)
 *
 * 脚本本身的可靠性 UT · 不跑真的 E2E (那个需要 live backend)
 * 不依赖 jest · 直接 node 跑 · 避免 jest-haste-map 与邻近 FAhubX 项目冲突
 *
 * 用法:
 *   node scripts/e2e-dry-smoke.spec.js
 * Exit code: 0 all pass / 1 any fail
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const scriptPath = path.join(__dirname, 'e2e-dry-smoke.js');
const sqlPath = path.join(__dirname, 'demo-fixtures.sql');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('脚本文件存在且可读', () => {
  assert.ok(fs.existsSync(scriptPath), `missing ${scriptPath}`);
  const stat = fs.statSync(scriptPath);
  assert.ok(stat.size > 1000, `too small: ${stat.size}`);
});

test('脚本语法合法 · Function 解析不抛', () => {
  let src = fs.readFileSync(scriptPath, 'utf-8');
  // strip shebang (Node runtime handles it but JS parser rejects)
  if (src.startsWith('#!')) src = src.replace(/^#![^\n]*\n/, '');
  assert.doesNotThrow(() => new Function(src));
});

test('包含 ≥ 9 个 addStep 调用', () => {
  const src = fs.readFileSync(scriptPath, 'utf-8');
  const matches = src.match(/addStep\(/g) ?? [];
  assert.ok(matches.length >= 9, `got ${matches.length}`);
});

test('包含关键 step 名称', () => {
  const src = fs.readFileSync(scriptPath, 'utf-8');
  assert.ok(src.includes('Backend + deps health'));
  assert.ok(src.includes('Login platform admin'));
  assert.ok(src.includes('Apply demo fixtures'));
  assert.ok(src.includes('Inject risk event'));
  assert.ok(src.includes('Upgrade apply dryRun'));
});

test('HTTP helper 10s 超时', () => {
  const src = fs.readFileSync(scriptPath, 'utf-8');
  assert.ok(src.includes('setTimeout(10000'));
  assert.ok(src.includes('HTTP timeout 10s'));
});

test('SKIP 参数解析支持 --skip=6,7', () => {
  const src = fs.readFileSync(scriptPath, 'utf-8');
  assert.ok(src.includes("startsWith('--skip=')"));
  assert.ok(src.includes("split(',').map(Number)"));
});

test('summary 三状态 PASS/FAIL/SKIP', () => {
  const src = fs.readFileSync(scriptPath, 'utf-8');
  assert.ok(src.includes("'PASS'"));
  assert.ok(src.includes("'FAIL'"));
  assert.ok(src.includes("'SKIP'"));
});

test('critical step (1-2) 失败 break', () => {
  const src = fs.readFileSync(scriptPath, 'utf-8');
  assert.ok(src.includes('step.n <= 2'));
  assert.ok(src.includes('critical step failed'));
});

test('exit code · FAIL→1 · all PASS→0', () => {
  const src = fs.readFileSync(scriptPath, 'utf-8');
  assert.ok(src.includes('process.exit(fail > 0 ? 1 : 0)'));
});

test('demo-fixtures.sql 存在', () => {
  assert.ok(fs.existsSync(sqlPath), `missing ${sqlPath}`);
});

// ── runner ──
let pass = 0, fail = 0;
console.log('\n=== e2e-dry-smoke script UT ===\n');
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    → ${err.message}`);
    fail++;
  }
}
console.log(`\n${pass}/${tests.length} pass · ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
