import { MigrationInterface, QueryRunner } from 'typeorm';
import { STARTER_COMMON_FAQ, COMMON_KB_META } from '../../modules/intelligent-reply/data/starter-common-faq';

// 2026-04-28 · 通用 KB Fallback · 给每个 tenant 自动建一个"通用 FAQ" KB +
//                  灌 52 条 starter FAQ + 设为 tenant_reply_settings.default_kb_id
//
// 为啥做:
//   reply-executor 实装双层 KB fallback (产品 KB → 通用 KB → RAG)
//   通用 KB 装问候 / 身份 / 转人工 / 道别 等通用问答 · 不用每个产品 KB 重复
//
// 行为:
//   1. 扫所有 tenant
//   2. 若该 tenant 没有 is_default=true 的 KB → 建一个新 KB '通用 FAQ' + 灌 52 条 starter FAQ
//   3. 若 tenant_reply_settings.default_kb_id 没设 → 设为新 KB id
//   4. 若该 tenant 已有 default KB (老用户) → 跳过 KB 创建 · 但向 default KB 增量加 starter FAQ
//      (跳过已存在的 question · 防重复)
//
// 回滚:
//   down() 只删本 migration 创建的 KB ('通用 FAQ' name + is_default=true) · 不动用户后加的 FAQ
//   保守起见 down() 只删本 KB 没改 default_kb_id · 让用户手动 reset

export class CommonKbStarter1798000000000 implements MigrationInterface {
  name = 'CommonKbStarter1798000000000';

  public async up(qr: QueryRunner): Promise<void> {
    // 1. 列所有 tenant
    const tenants = (await qr.query(
      `SELECT id FROM tenant WHERE id IS NOT NULL ORDER BY id`,
    )) as Array<{ id: number }>;

    for (const t of tenants) {
      const tenantId = Number(t.id);

      // 2. 看 tenant 有没有 is_default=true 的 KB
      const existingDefault = (await qr.query(
        `SELECT id FROM knowledge_base WHERE tenant_id = $1 AND is_default = true LIMIT 1`,
        [tenantId],
      )) as Array<{ id: number }>;

      let kbId: number;
      if (existingDefault.length > 0) {
        // 老 tenant 已有 default KB · 不重建 · 增量灌 FAQ (跳重)
        kbId = Number(existingDefault[0].id);
      } else {
        // 没有 default · 建一个新的"通用 FAQ" KB
        // 注意 unique idx (tenant_id, name) · 若已有同名 (但 is_default=false) 也会冲突
        // 所以先 check
        const sameName = (await qr.query(
          `SELECT id FROM knowledge_base WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
          [tenantId, COMMON_KB_META.name],
        )) as Array<{ id: number }>;
        if (sameName.length > 0) {
          // 已有同名 KB · 把它升为 default + 灌 FAQ
          kbId = Number(sameName[0].id);
          await qr.query(
            `UPDATE knowledge_base SET is_default = true WHERE id = $1`,
            [kbId],
          );
        } else {
          // 真新建
          const inserted = (await qr.query(
            `INSERT INTO knowledge_base (tenant_id, name, description, goal_prompt, language, is_default, status)
             VALUES ($1, $2, $3, $4, $5, true, 1)
             RETURNING id`,
            [
              tenantId,
              COMMON_KB_META.name,
              COMMON_KB_META.description,
              COMMON_KB_META.goalPrompt,
              COMMON_KB_META.language,
            ],
          )) as Array<{ id: number }>;
          kbId = Number(inserted[0].id);
        }
      }

      // 3. 灌 starter FAQ · 跳过已存在的 question (按 question 文本严格相等)
      let inserted = 0;
      let skipped = 0;
      for (const faq of STARTER_COMMON_FAQ) {
        const exist = (await qr.query(
          `SELECT id FROM knowledge_base_faq WHERE kb_id = $1 AND question = $2 LIMIT 1`,
          [kbId, faq.question],
        )) as Array<{ id: number }>;
        if (exist.length > 0) {
          skipped++;
          continue;
        }
        await qr.query(
          `INSERT INTO knowledge_base_faq (kb_id, question, answer, tags, status, source, hit_count)
           VALUES ($1, $2, $3, $4, 'enabled', 'manual_bulk', 0)`,
          [kbId, faq.question, faq.answer, faq.tags],
        );
        inserted++;
      }

      // 4. 设 tenant_reply_settings.default_kb_id (若还没设)
      const settings = (await qr.query(
        `SELECT default_kb_id FROM tenant_reply_settings WHERE tenant_id = $1 LIMIT 1`,
        [tenantId],
      )) as Array<{ default_kb_id: number | null }>;
      if (settings.length === 0) {
        // 没 settings 行 · 直接 INSERT
        await qr.query(
          `INSERT INTO tenant_reply_settings (tenant_id, mode, default_kb_id, daily_ai_reply_limit, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, blacklist_keywords, custom_handoff_keywords)
           VALUES ($1, 'smart', $2, 200, false, '22:00', '08:00', '{}', '{}')
           ON CONFLICT (tenant_id) DO NOTHING`,
          [tenantId, kbId],
        );
      } else if (settings[0].default_kb_id === null) {
        // 有 settings 但 default_kb_id null · UPDATE 设
        await qr.query(
          `UPDATE tenant_reply_settings SET default_kb_id = $1 WHERE tenant_id = $2`,
          [kbId, tenantId],
        );
      }
      // 若 settings.default_kb_id 已有值 (=kbId 或别的 KB) · 不动 · 用户自己选的优先

      // log via console (不用 logger · migration 阶段无 nest 上下文)
      // eslint-disable-next-line no-console
      console.log(
        `[CommonKbStarter] tenant ${tenantId} · kb ${kbId} · faq inserted=${inserted} skipped=${skipped}`,
      );
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 保守 down: 只删本 migration 创建的 starter FAQ · 不删 KB · 不动 settings
    // (因为可能用户手动加 FAQ 到该 KB · 删 KB 会丢用户工作)
    for (const faq of STARTER_COMMON_FAQ) {
      await qr.query(
        `DELETE FROM knowledge_base_faq WHERE question = $1 AND source = 'manual_bulk'`,
        [faq.question],
      );
    }
  }
}
