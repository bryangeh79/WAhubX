// 2026-04-29 · V2.2 · 重灌指定 tenant 的 starter FAQ (用新模板 + 占位符 + variants)
// 用法: node packages/backend/scripts/reseed-tenant-starter.mjs <tenantId>
//
// 行为:
//   1. 找 tenant 的 default KB
//   2. 跑 starter 占位符替换 (用 tenant.name 当 companyName)
//   3. variants 转 var:* tags
//   4. 跳重 question (跟 service 同款逻辑)
//
// 不通过 HTTP API · 因为 platform admin 没 tenant_id · API 用 tenantOf(currentUser) 失败

import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 复用 starter-common-faq.ts (TS 文件 · 但内容是 export const · 可以 dynamic import 编译后 dist 版本)
const compiled = resolve(__dirname, '../dist/modules/intelligent-reply/data/starter-common-faq.js');
const { STARTER_COMMON_FAQ, COMMON_KB_META, resolveStarterTemplate } = await import(`file://${compiled}`);

const tenantId = parseInt(process.argv[2] ?? '0', 10);
if (!tenantId) {
  console.error('Usage: node reseed-tenant-starter.mjs <tenantId>');
  process.exit(1);
}

const pool = new pg.Pool({
  host: 'localhost',
  port: 5434,
  user: 'wahubx',
  password: 'wahubx',
  database: 'wahubx',
});

async function main() {
  // 1. 拿 tenant
  const tenantRow = await pool.query('SELECT id, name FROM tenant WHERE id=$1', [tenantId]);
  if (tenantRow.rows.length === 0) throw new Error(`tenant ${tenantId} 不存在`);
  const tenant = tenantRow.rows[0];

  // 2. 找 default KB
  let defaultKb = (await pool.query(
    'SELECT id, name FROM knowledge_base WHERE tenant_id=$1 AND is_default=true LIMIT 1',
    [tenantId],
  )).rows[0];
  if (!defaultKb) {
    // 建一个
    const r = await pool.query(
      `INSERT INTO knowledge_base (tenant_id, name, description, goal_prompt, is_default, status)
       VALUES ($1, $2, $3, $4, true, 1) RETURNING id, name`,
      [tenantId, COMMON_KB_META.name, COMMON_KB_META.description, COMMON_KB_META.goalPrompt],
    );
    defaultKb = r.rows[0];
    console.log(`✓ 建新 default KB id=${defaultKb.id}`);
  }
  const kbId = defaultKb.id;

  console.log(`tenant ${tenantId} (${tenant.name}) · default KB ${kbId} (${defaultKb.name})`);

  // 3. 占位符 ctx
  const ctx = {
    tenantName: tenant.name,
    companyName: tenant.name,
    botName: 'AI 智能客服',
  };

  // 4. 跑灌入 (跳重 question · 跟 service.seedCommonFaqs 同款逻辑)
  let inserted = 0;
  let skipped = 0;
  for (const faq of STARTER_COMMON_FAQ) {
    const exist = await pool.query(
      'SELECT id FROM knowledge_base_faq WHERE kb_id=$1 AND question=$2 LIMIT 1',
      [kbId, faq.question],
    );
    if (exist.rows.length > 0) {
      skipped++;
      continue;
    }
    const resolvedAnswer = resolveStarterTemplate(faq.answer, ctx);
    const variantTags = (faq.variants ?? []).map((v) => `var:${v.trim()}`).filter((t) => t.length > 4);
    const finalTags = [...faq.tags, ...variantTags];
    await pool.query(
      `INSERT INTO knowledge_base_faq (kb_id, question, answer, tags, status, source, hit_count)
       VALUES ($1, $2, $3, $4, 'enabled', 'manual_bulk', 0)`,
      [kbId, faq.question, resolvedAnswer, finalTags],
    );
    inserted++;
  }

  console.log(`✓ 灌入 ${inserted} 条 starter · 跳重 ${skipped} 条`);
  await pool.end();
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
