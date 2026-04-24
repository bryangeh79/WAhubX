import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-25 · 稳定性重构 Phase 1 · 数据层改动
// 加字段:
//   account_slot.suspended_until          挂起到何时 (冷却期 · 防止其他路径翻回 active)
//   account_slot.socket_last_heartbeat_at 最后一次心跳时间 (UI 判真实存活)
//   tenant.last_bind_at                   租户上次发起绑号时间 (cooldown 依据)
// 扩枚举:
//   account_slot_status_enum += 'quarantine' (440 明确判死 · 不可自动恢复)
//
// 不动已有数据 · 全部 nullable + default null

export class StabilityHardening1796000000000 implements MigrationInterface {
  name = 'StabilityHardening1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // account_slot 加 2 列
    await queryRunner.query(
      `ALTER TABLE "account_slot"
         ADD COLUMN IF NOT EXISTS "suspended_until" TIMESTAMPTZ,
         ADD COLUMN IF NOT EXISTS "socket_last_heartbeat_at" TIMESTAMPTZ`,
    );

    // tenant 加 1 列
    await queryRunner.query(
      `ALTER TABLE "tenant"
         ADD COLUMN IF NOT EXISTS "last_bind_at" TIMESTAMPTZ`,
    );

    // 枚举加 quarantine (PG 支持 ADD VALUE IF NOT EXISTS)
    await queryRunner.query(
      `ALTER TYPE "account_slot_status_enum" ADD VALUE IF NOT EXISTS 'quarantine'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 删列可逆 · 删枚举值不可逆 (PG 限制) · 枚举值留着无害
    await queryRunner.query(
      `ALTER TABLE "account_slot"
         DROP COLUMN IF EXISTS "suspended_until",
         DROP COLUMN IF EXISTS "socket_last_heartbeat_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant" DROP COLUMN IF EXISTS "last_bind_at"`,
    );
  }
}
