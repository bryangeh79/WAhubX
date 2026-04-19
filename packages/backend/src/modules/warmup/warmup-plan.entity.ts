import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WaAccountEntity } from '../slots/wa-account.entity';

// 养号计划 · 技术交接文档 § 5.3 phase 机 + § B.2 5 天日历
// 每个 wa_account 一行; 注册完成时自动插.
// current_phase 0..3 (孵化/预热/激活/成熟), 按 current_day 触发阈值自动推进.
// 14-day 模板硬编码在 warmup-plan-templates.ts, DB 只记 template id + 运行态.
export enum WarmupPhase {
  Incubate = 0, // Day 1-3 · 72h 硬规则, 只挂载 / 被动
  Preheat = 1,  // Day 4-7 · 破壳 · 接受好友 / 被动回复
  Activate = 2, // Day 8-14 · 可内部互聊 · Phase 2 开放 status_post (每 3 天 ≤ 1)
  Mature = 3,   // Day 15+ · 全开放 · 每天 ≤ 1 status
}

export interface WarmupHistoryEvent {
  at: string;                  // ISO timestamp
  event: 'advance' | 'regress' | 'skip' | 'pause' | 'resume' | 'start';
  fromPhase?: number;
  toPhase?: number;
  fromDay?: number;
  toDay?: number;
  reason?: string;
}

@Entity('warmup_plan')
@Index('idx_warmup_plan_phase_day', ['currentPhase', 'currentDay'])
export class WarmupPlanEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'account_id', unique: true })
  accountId!: number;

  @OneToOne(() => WaAccountEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account!: WaAccountEntity;

  // 模板 id — 对应 warmup-plan-templates.ts 的常量. v1_14day 默认.
  @Column({ type: 'text', default: 'v1_14day' })
  template!: string;

  @Column({ type: 'int', name: 'current_phase', default: 0 })
  currentPhase!: number;

  @Column({ type: 'int', name: 'current_day', default: 0 })
  currentDay!: number;

  // Day 0 起算时间 (注册完成时 set)
  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', name: 'last_advanced_at', nullable: true })
  lastAdvancedAt!: Date | null;

  // 最近一次 regress (health 掉到 high / 封号) 发生时
  @Column({ type: 'timestamptz', name: 'regressed_at', nullable: true })
  regressedAt!: Date | null;

  @Column({ type: 'text', name: 'regress_reason', nullable: true })
  regressReason!: string | null;

  // expert mode / 租户手动暂停 — calendar 扫到 paused=true 跳过发任务
  @Column({ type: 'boolean', default: false })
  paused!: boolean;

  // 事件流水 [{ at, event, fromPhase, toPhase, reason }]
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  history!: WarmupHistoryEvent[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
