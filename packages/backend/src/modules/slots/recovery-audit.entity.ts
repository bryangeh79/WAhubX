// 2026-04-29 · P0-CS-3 · 账号体检 / 一键恢复 审计表
//
// 每次 diagnose / recover 调用都写一行, 用于:
//   - 事后排查"为什么没恢复成功"
//   - 追踪 operator 操作历史
//   - 安全审计 (谁在什么时候动了哪个 slot)
//
// before/after snapshot 用 JSONB 存完整 CheckupResult (单行 ~4KB)
// 索引: (slot_id, created_at DESC) + (tenant_id, created_at DESC)
// 不索引 JSONB 内字段 (P0 不需要复杂查询)

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type RecoveryActionType = 'diagnose' | 'recover';
export type RecoveryResultCode =
  | 'success'
  | 'partial'
  | 'failed'
  | 'need_scan'
  | 'diagnose_only';

@Entity('recovery_audit')
@Index('idx_recovery_audit_slot_created', ['slotId', 'createdAt'])
@Index('idx_recovery_audit_tenant_created', ['tenantId', 'createdAt'])
export class RecoveryAuditEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'tenant_id' })
  tenantId!: number;

  @Column({ type: 'int', name: 'slot_id' })
  slotId!: number;

  @Column({ type: 'int', name: 'account_id', nullable: true })
  accountId!: number | null;

  /** 'diagnose' 或 'recover' · 见 RecoveryActionType */
  @Column({ type: 'varchar', length: 16, name: 'action_type' })
  actionType!: RecoveryActionType;

  /** 'success' / 'partial' / 'failed' / 'need_scan' / 'diagnose_only' */
  @Column({ type: 'varchar', length: 20 })
  result!: RecoveryResultCode;

  @Column({ type: 'boolean', name: 'need_scan', default: false })
  needScan!: boolean;

  /** 恢复前的完整 CheckupResult JSON (recover 时填; diagnose 时为 null) */
  @Column({ type: 'jsonb', name: 'before_snapshot', nullable: true })
  beforeSnapshot!: Record<string, unknown> | null;

  /** 完整 CheckupResult JSON (恢复后或 diagnose 结果) */
  @Column({ type: 'jsonb', name: 'after_snapshot', nullable: true })
  afterSnapshot!: Record<string, unknown> | null;

  /** Array<{ key, status, messageZh, raw? }> · recover 实际执行的动作 */
  @Column({ type: 'jsonb', name: 'actions_attempted', nullable: true })
  actionsAttempted!: Array<Record<string, unknown>> | null;

  /** Array<{ key, reasonZh, raw? }> · recover 跳过的动作 + 跳过原因 */
  @Column({ type: 'jsonb', name: 'actions_skipped', nullable: true })
  actionsSkipped!: Array<Record<string, unknown>> | null;

  /** 触发恢复的用户 id · platform admin 调用时也填 (cur.userId) */
  @Column({ type: 'int', name: 'operator_user_id', nullable: true })
  operatorUserId!: number | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
