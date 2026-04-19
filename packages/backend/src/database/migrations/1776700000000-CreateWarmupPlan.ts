import { MigrationInterface, QueryRunner } from 'typeorm';

// M5: 养号计划表. 每 wa_account 一行, 存 phase/day 运行态 + 模板引用 + history 流水.
export class CreateWarmupPlan1776700000000 implements MigrationInterface {
  name = 'CreateWarmupPlan1776700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "warmup_plan" (
        "id" SERIAL NOT NULL,
        "account_id" integer NOT NULL,
        "template" text NOT NULL DEFAULT 'v1_14day',
        "current_phase" integer NOT NULL DEFAULT 0,
        "current_day" integer NOT NULL DEFAULT 0,
        "started_at" timestamptz NOT NULL,
        "last_advanced_at" timestamptz,
        "regressed_at" timestamptz,
        "regress_reason" text,
        "paused" boolean NOT NULL DEFAULT false,
        "history" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_warmup_plan_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_warmup_plan_account" UNIQUE ("account_id"),
        CONSTRAINT "FK_warmup_plan_account"
          FOREIGN KEY ("account_id") REFERENCES "wa_account"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_warmup_plan_phase_day"
        ON "warmup_plan" ("current_phase", "current_day");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_warmup_plan_phase_day";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "warmup_plan";`);
  }
}
