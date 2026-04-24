import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-22 · 按执行组跑养号 · 整组共享 plan · script_chat 动态配对
// 参考: staging/warmup-group-based-rework.md
export class GroupWarmupPlan1785000000000 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS "group_warmup_plan" (
        "id" SERIAL PRIMARY KEY,
        "group_id" INT NOT NULL REFERENCES "execution_group"("id") ON DELETE CASCADE,
        "template" TEXT NOT NULL DEFAULT 'v1_7day',
        "current_day" INT NOT NULL DEFAULT 1,
        "current_phase" INT NOT NULL DEFAULT 0,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "paused" BOOLEAN NOT NULL DEFAULT false,
        "last_pair_history" JSONB NOT NULL DEFAULT '[]',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_gwp_group" ON "group_warmup_plan"("group_id")
    `);

    // 关联字段加到现有 warmup_plan (per-account) · NULL = 独立 · 非 NULL = 属于 group plan
    await qr.query(`
      ALTER TABLE "warmup_plan"
        ADD COLUMN IF NOT EXISTS "group_plan_id" INT REFERENCES "group_warmup_plan"("id") ON DELETE SET NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE "warmup_plan" DROP COLUMN IF EXISTS "group_plan_id"`);
    await qr.query(`DROP TABLE IF EXISTS "group_warmup_plan"`);
  }
}
