import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M7 Day 1 #7 · 素材库 persona binding + ManualUpload enum 扩展
 *
 * 改动:
 *   1. asset_source_enum ADD VALUE 'manual_upload'
 *      (forward-only · PG enum ADD VALUE 不能回滚 · 显式文档化)
 *   2. asset.persona_id INT NULL + FK persona(persona_id) + idx
 *   3. persona table 建基础 schema (Day 2 PersonaGeneratorService 填)
 *
 * 设计决策:
 *   - persona 作独立表 · 非 account_slot.persona JSONB 覆盖 (那是 M3/M4 简单形态保留)
 *     · 一 persona 可绑多 asset · 也可一 slot 用多候选 persona
 *   - persona_id 作 TEXT 主键 (不用 serial) · 跨机稳定 · 对齐 PersonaV1.persona_id
 *   - asset.persona_id FK ON DELETE SET NULL · persona 删不删 asset 文件
 *   - persona.content JSONB · 存 PersonaV1 完整结构 · 应用层 Zod 校验
 *   - persona.content_hash 16-char · 应用层 computePersonaHash 算 · 不建唯一约束
 *     (同 hash 可 debounce cache · 非强去重)
 *
 * 回滚 (down):
 *   - asset.persona_id 列移除 · FK 自动 drop
 *   - persona 表 drop
 *   - asset_source_enum 'manual_upload' 值 **无法 drop** (PG 不支持 DROP VALUE)
 *     · down 留备忘注释 · 实际 rollback 通过重建 enum 完成 (代价高 · 暂不做)
 */
export class AddAssetPersonaId1780000000000 implements MigrationInterface {
  name = 'AddAssetPersonaId1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. enum 扩展 · forward-only · BEFORE any table touch
    //    PG 规则: ADD VALUE 不能在事务里若紧跟着用此 value · 但本次 migration
    //    不立即用此 value (应用层 AssetSource.ManualUpload TS 枚举已声明) · 安全
    await queryRunner.query(
      `ALTER TYPE "public"."asset_source_enum" ADD VALUE IF NOT EXISTS 'manual_upload'`,
    );

    // 2. persona 表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "persona" (
        "persona_id" TEXT PRIMARY KEY,
        "display_name" TEXT NOT NULL,
        "wa_nickname" TEXT NOT NULL,
        "ethnicity" TEXT NOT NULL,
        "country" VARCHAR(2) NOT NULL DEFAULT 'MY',
        "content" JSONB NOT NULL,
        "content_hash" VARCHAR(16) NOT NULL,
        "avatar_asset_id" INT NULL,
        "used_by_slot_ids" INT[] NOT NULL DEFAULT '{}',
        "source" TEXT NOT NULL DEFAULT 'ai_generated',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_persona_ethnicity" ON "persona" ("ethnicity")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_persona_hash" ON "persona" ("content_hash")`,
    );

    // 3. asset.persona_id 列 + FK + idx
    await queryRunner.query(`ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "persona_id" TEXT NULL`);
    await queryRunner.query(
      `ALTER TABLE "asset" ADD CONSTRAINT "FK_asset_persona"
         FOREIGN KEY ("persona_id") REFERENCES "persona" ("persona_id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_asset_persona" ON "asset" ("persona_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // asset.persona_id · FK + 列 drop
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_asset_persona"`);
    await queryRunner.query(
      `ALTER TABLE "asset" DROP CONSTRAINT IF EXISTS "FK_asset_persona"`,
    );
    await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN IF EXISTS "persona_id"`);

    // persona 表 drop
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_persona_hash"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_persona_ethnicity"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "persona"`);

    // asset_source_enum 'manual_upload' 值保留 (PG 不支持 DROP VALUE)
    // · 如需回滚: 重建 enum + 重建 asset 表 (本 migration 不做)
  }
}
