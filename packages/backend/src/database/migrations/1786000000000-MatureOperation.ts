import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-22 · 成熟运营期 · group_warmup_plan 加 mature_level
export class MatureOperation1786000000000 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE "group_warmup_plan"
        ADD COLUMN IF NOT EXISTS "mature_level" VARCHAR(20)
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE "group_warmup_plan" DROP COLUMN IF EXISTS "mature_level"`);
  }
}
