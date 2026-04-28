import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-25 · D11-1 · slot.role 角色架构 (Codex 锁定 · 5 边界)
//
// 加字段:
//   account_slot.role  enum('broadcast' | 'customer_service') · 默认 'broadcast'
//
// 加约束:
//   uq_account_slot_tenant_customer_service · partial unique index
//     WHERE role = 'customer_service' · 强制每 tenant 最多 1 个客服号
//     这是 D11-1 核心 · UI 不算约束 · backend 必须硬拦
//
// 老数据补位 (Codex 边界 2):
//   每个 tenant 选 slotIndex 最小的 slot · UPDATE role = 'customer_service'
//   其余保持默认 'broadcast'
//   规则写死 · 不需要人工补数据
//
// 回滚:
//   DROP 约束 + DROP 字段 · 不删 enum type (PG 留 enum 不影响)

export class AccountSlotRole1797000000000 implements MigrationInterface {
  name = 'AccountSlotRole1797000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 创建 enum type
    await queryRunner.query(
      `DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_slot_role_enum') THEN
            CREATE TYPE "account_slot_role_enum" AS ENUM ('broadcast', 'customer_service');
          END IF;
        END $$;`,
    );

    // 2. 加字段 · 默认 'broadcast'
    await queryRunner.query(
      `ALTER TABLE "account_slot"
         ADD COLUMN IF NOT EXISTS "role" "account_slot_role_enum" NOT NULL DEFAULT 'broadcast'`,
    );

    // 3. 老数据补位 · 每 tenant slotIndex 最小的 → customer_service
    // 用 DISTINCT ON 高效拿每 tenant 最小 slotIndex 的 id
    await queryRunner.query(
      `UPDATE "account_slot" AS s
         SET "role" = 'customer_service'
         FROM (
           SELECT DISTINCT ON (tenant_id) id
           FROM "account_slot"
           ORDER BY tenant_id, slot_index ASC
         ) AS first_slot
         WHERE s.id = first_slot.id`,
    );

    // 4. 加 partial unique index · 强制 per-tenant 唯一客服号 (Codex 边界 1)
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_account_slot_tenant_customer_service"
         ON "account_slot" (tenant_id)
         WHERE role = 'customer_service'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_account_slot_tenant_customer_service"`,
    );
    await queryRunner.query(`ALTER TABLE "account_slot" DROP COLUMN IF EXISTS "role"`);
    // enum type 留着 · 不删 (回滚后再 up 时不必重建 · PG enum 不影响)
  }
}
