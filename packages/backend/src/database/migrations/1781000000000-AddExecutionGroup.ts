import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-21 · 执行组 (调度分组) · §B.1 用户澄清: 调度方便用 · 不是互聊组
// - 成员数最少 1 · 最多 = 租户 slot_limit
// - 成员可跨组 (多对多)
// - 同 IP 多号 = 软警告, 不阻拦
export class AddExecutionGroup1781000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "execution_group" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" INT NOT NULL REFERENCES "tenant"("id") ON DELETE CASCADE,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "uq_execution_group_tenant_name" UNIQUE ("tenant_id", "name")
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_execution_group_tenant" ON "execution_group"("tenant_id");
    `);
    await queryRunner.query(`
      CREATE TABLE "execution_group_member" (
        "group_id" INT NOT NULL REFERENCES "execution_group"("id") ON DELETE CASCADE,
        "slot_id" INT NOT NULL REFERENCES "account_slot"("id") ON DELETE CASCADE,
        "added_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY ("group_id", "slot_id")
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_execution_group_member_slot" ON "execution_group_member"("slot_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "execution_group_member";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "execution_group";`);
  }
}
