import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-29 · P0-CS-3 · recovery_audit 表
//
// 每次"账号体检 (diagnose)"或"一键恢复 (recover)"调用都写一行
// 用于事后排查 + 操作审计
//
// 设计:
//   - JSONB 存 before/after CheckupResult 完整 (单行 ~4KB)
//   - 不索引 JSONB 内字段 (P0 不需要)
//   - 索引 (slot_id, created_at DESC) + (tenant_id, created_at DESC)
//
// 回滚: down() 直接 DROP 表 (P0 数据无需保留)

export class RecoveryAudit1799000000000 implements MigrationInterface {
  name = 'RecoveryAudit1799000000000';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS recovery_audit (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        slot_id INT NOT NULL,
        account_id INT NULL,
        action_type VARCHAR(16) NOT NULL,
        result VARCHAR(20) NOT NULL,
        need_scan BOOLEAN NOT NULL DEFAULT false,
        before_snapshot JSONB NULL,
        after_snapshot JSONB NULL,
        actions_attempted JSONB NULL,
        actions_skipped JSONB NULL,
        operator_user_id INT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_recovery_audit_slot_created
        ON recovery_audit (slot_id, created_at DESC);
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_recovery_audit_tenant_created
        ON recovery_audit (tenant_id, created_at DESC);
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_recovery_audit_tenant_created;`);
    await qr.query(`DROP INDEX IF EXISTS idx_recovery_audit_slot_created;`);
    await qr.query(`DROP TABLE IF EXISTS recovery_audit;`);
  }
}
