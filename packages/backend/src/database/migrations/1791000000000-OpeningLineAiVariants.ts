import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-24 · 开场白 AI 变体池 (跟广告一样)
// · opening_line.content = 原文 · 相当于父开场白
// · variants[] = AI 优化的变体池 · 发送时随机抽
export class OpeningLineAiVariants1791000000000 implements MigrationInterface {
  name = 'OpeningLineAiVariants1791000000000';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(
      `ALTER TABLE "opening_line" ADD COLUMN IF NOT EXISTS "ai_enabled" BOOLEAN NOT NULL DEFAULT false`,
    );
    await qr.query(
      `ALTER TABLE "opening_line" ADD COLUMN IF NOT EXISTS "variants" JSONB NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE "opening_line" DROP COLUMN IF EXISTS "variants"`);
    await qr.query(`ALTER TABLE "opening_line" DROP COLUMN IF EXISTS "ai_enabled"`);
  }
}
