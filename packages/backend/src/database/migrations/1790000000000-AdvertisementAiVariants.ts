import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-24 · 广告 AI 变体池 · 给每条广告加 10 条 AI 优化变体
// 存储结构: advertisement.variants JSONB = [{ index: 1, content: "...", enabled: true }]
// · 原文案 = ad.content (相当于 #1 或 "主文案")
// · 变体池 = variants[] (相当于 1.1 / 1.2 / 1.3 / ...)
// · 发送时 send-ad.executor 随机挑一条 (若 ai_enabled=true 且 variants 非空)
//
// 注: advertisement 是本模块 1789 新建的表, 非核心表, ALTER 安全
export class AdvertisementAiVariants1790000000000 implements MigrationInterface {
  name = 'AdvertisementAiVariants1790000000000';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(
      `ALTER TABLE "advertisement" ADD COLUMN IF NOT EXISTS "ai_enabled" BOOLEAN NOT NULL DEFAULT false`,
    );
    await qr.query(
      `ALTER TABLE "advertisement" ADD COLUMN IF NOT EXISTS "variants" JSONB NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE "advertisement" DROP COLUMN IF EXISTS "variants"`);
    await qr.query(`ALTER TABLE "advertisement" DROP COLUMN IF EXISTS "ai_enabled"`);
  }
}
