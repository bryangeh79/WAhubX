import { MigrationInterface, QueryRunner } from 'typeorm';

// M8: 健康分 + 风险事件. 同步把 M6 ai_setting 改 app_setting (通用 k-v)
export class CreateRiskEventAndAppSetting1776900000000 implements MigrationInterface {
  name = 'CreateRiskEventAndAppSetting1776900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. ai_setting → app_setting (rename + 已有行 key 加 ai. 前缀)
    await queryRunner.query(`ALTER TABLE "ai_setting" RENAME TO "app_setting";`);
    await queryRunner.query(`UPDATE "app_setting" SET "key" = 'ai.text_enabled' WHERE "key" = 'text_enabled';`);
    await queryRunner.query(
      `ALTER TABLE "app_setting" RENAME CONSTRAINT "PK_ai_setting_key" TO "PK_app_setting_key";`,
    );

    // 2. risk_event — 扣分原始信号, 去重 + 滚动窗口的基础
    //    UNIQUE (account_id, code, source_ref) + ON CONFLICT DO NOTHING 防重复事件虚降分
    await queryRunner.query(`
      CREATE TABLE "risk_event" (
        "id" BIGSERIAL NOT NULL,
        "account_id" integer NOT NULL,
        "code" text NOT NULL,
        "severity" text NOT NULL,
        "source" text NOT NULL,
        "source_ref" text NOT NULL,
        "meta" jsonb,
        "at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_risk_event_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_risk_event_dedupe" UNIQUE ("account_id", "code", "source_ref"),
        CONSTRAINT "FK_risk_event_account"
          FOREIGN KEY ("account_id") REFERENCES "wa_account"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`CREATE INDEX "idx_risk_event_account_at" ON "risk_event" ("account_id", "at" DESC);`);
    await queryRunner.query(`CREATE INDEX "idx_risk_event_code" ON "risk_event" ("code");`);
    await queryRunner.query(`CREATE INDEX "idx_risk_event_at" ON "risk_event" ("at" DESC);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_risk_event_at";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_risk_event_code";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_risk_event_account_at";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "risk_event";`);

    await queryRunner.query(
      `ALTER TABLE "app_setting" RENAME CONSTRAINT "PK_app_setting_key" TO "PK_ai_setting_key";`,
    );
    await queryRunner.query(`UPDATE "app_setting" SET "key" = 'text_enabled' WHERE "key" = 'ai.text_enabled';`);
    await queryRunner.query(`ALTER TABLE "app_setting" RENAME TO "ai_setting";`);
  }
}
