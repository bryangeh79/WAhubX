import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-24 · customer_group_member 加健康追踪字段 · 避免下次投放重发问题号
// send_status: 0 ok · 1 bad_invalid (号不存在/443) · 2 bad_network · 3 opted_out (人工禁)
// 方向: 发广告失败后, executor 回填 member 对应行的 send_status + fail_count
// 下次 scheduler.collectPhones 跳过 send_status != 0 的成员

export class CustomerMemberHealth1792000000000 implements MigrationInterface {
  name = 'CustomerMemberHealth1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customer_group_member"
        ADD COLUMN IF NOT EXISTS "send_status" smallint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "send_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "fail_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "last_error_code" varchar(32) NULL,
        ADD COLUMN IF NOT EXISTS "last_error_msg" text NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_cgm_bad_status"
      ON "customer_group_member" ("send_status")
      WHERE "send_status" != 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_cgm_bad_status"`);
    await queryRunner.query(`
      ALTER TABLE "customer_group_member"
        DROP COLUMN IF EXISTS "send_status",
        DROP COLUMN IF EXISTS "send_count",
        DROP COLUMN IF EXISTS "fail_count",
        DROP COLUMN IF EXISTS "last_attempt_at",
        DROP COLUMN IF EXISTS "last_error_code",
        DROP COLUMN IF EXISTS "last_error_msg"
    `);
  }
}
