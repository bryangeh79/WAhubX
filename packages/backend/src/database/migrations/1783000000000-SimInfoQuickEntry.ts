import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-22 · SIM 信息快速录入
// · sim_info 加 country_code / carrier_id / custom_carrier_name / custom_country_name / iccid_suffix
// · 新 unknown_country_request 表 · 记录租户填的冷门国家 · 下版本定是否入预置库
export class SimInfoQuickEntry1783000000000 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    // sim_info 扩字段
    await qr.query(`
      ALTER TABLE "sim_info"
        ADD COLUMN IF NOT EXISTS "country_code" VARCHAR(2),
        ADD COLUMN IF NOT EXISTS "carrier_id" VARCHAR(40),
        ADD COLUMN IF NOT EXISTS "custom_carrier_name" VARCHAR(80),
        ADD COLUMN IF NOT EXISTS "custom_country_name" VARCHAR(80),
        ADD COLUMN IF NOT EXISTS "iccid_suffix" VARCHAR(10)
    `);

    // 未知国家请求累计
    await qr.query(`
      CREATE TABLE IF NOT EXISTS "unknown_country_request" (
        "id" SERIAL PRIMARY KEY,
        "calling_code" VARCHAR(6) NOT NULL,
        "country_name" VARCHAR(80) NOT NULL,
        "carrier_name" VARCHAR(80),
        "tenant_id" INT REFERENCES "tenant"("id") ON DELETE SET NULL,
        "count" INT NOT NULL DEFAULT 1,
        "first_seen" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "last_seen" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_ucr_code_country"
        ON "unknown_country_request"("calling_code", "country_name")
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS "unknown_country_request"`);
    await qr.query(`
      ALTER TABLE "sim_info"
        DROP COLUMN IF EXISTS "iccid_suffix",
        DROP COLUMN IF EXISTS "custom_country_name",
        DROP COLUMN IF EXISTS "custom_carrier_name",
        DROP COLUMN IF EXISTS "carrier_id",
        DROP COLUMN IF EXISTS "country_code"
    `);
  }
}
