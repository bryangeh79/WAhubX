import { MigrationInterface, QueryRunner } from 'typeorm';

// M6: AI provider 配置表 + 全局 setting 表
export class CreateAiProviders1776800000000 implements MigrationInterface {
  name = 'CreateAiProviders1776800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "ai_provider_type_enum" AS ENUM (
        'openai', 'deepseek', 'custom_openai_compat', 'gemini', 'claude'
      );
    `);
    await queryRunner.query(`
      CREATE TABLE "ai_provider" (
        "id" SERIAL NOT NULL,
        "provider_type" "ai_provider_type_enum" NOT NULL,
        "name" text NOT NULL,
        "model" text NOT NULL,
        "base_url" text NOT NULL,
        "api_key_encrypted" text NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "last_tested_at" timestamptz,
        "last_test_ok" boolean,
        "last_test_error" text,
        "default_params" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_provider_id" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(`CREATE INDEX "idx_ai_provider_type" ON "ai_provider" ("provider_type");`);
    await queryRunner.query(`CREATE INDEX "idx_ai_provider_enabled" ON "ai_provider" ("enabled");`);

    await queryRunner.query(`
      CREATE TABLE "ai_setting" (
        "key" text NOT NULL,
        "value" text NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_setting_key" PRIMARY KEY ("key")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_setting";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_ai_provider_enabled";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_ai_provider_type";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_provider";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ai_provider_type_enum";`);
  }
}
