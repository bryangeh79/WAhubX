import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-24 · Z 方案 · 客户回复归因
// campaign_target 加 replied_at 标记首次回复时间
// baileys 收到 inbound 时查本租户 7 天内 Sent + 同 phone 的 target, 标上
// 次回复不覆盖 first_reply_at (只记首次)

export class CampaignTargetReply1793000000000 implements MigrationInterface {
  name = 'CampaignTargetReply1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaign_target"
        ADD COLUMN IF NOT EXISTS "replied_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "reply_count" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_campaign_target_phone_sent"
      ON "campaign_target" ("phone_e164", "sent_at")
      WHERE "status" = 2
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_campaign_target_replied"
      ON "campaign_target" ("campaign_id", "replied_at")
      WHERE "replied_at" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_campaign_target_replied"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_campaign_target_phone_sent"`);
    await queryRunner.query(`
      ALTER TABLE "campaign_target"
        DROP COLUMN IF EXISTS "replied_at",
        DROP COLUMN IF EXISTS "reply_count"
    `);
  }
}
