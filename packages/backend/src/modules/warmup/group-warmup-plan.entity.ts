import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ExecutionGroupEntity } from '../execution-groups/execution-group.entity';

// 2026-04-22 · 按执行组跑养号 · 整组共享 plan
@Entity('group_warmup_plan')
export class GroupWarmupPlanEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'group_id' })
  groupId!: number;

  @ManyToOne(() => ExecutionGroupEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: ExecutionGroupEntity;

  @Column({ type: 'text', default: 'v1_7day' })
  template!: string;

  @Column({ type: 'int', name: 'current_day', default: 1 })
  currentDay!: number;

  @Column({ type: 'int', name: 'current_phase', default: 0 })
  currentPhase!: number;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'boolean', default: false })
  paused!: boolean;

  // 近 7 天配对历史 · [{day, pairs: [[aid, bid], ...]}, ...]
  @Column({ type: 'jsonb', name: 'last_pair_history', default: () => "'[]'" })
  lastPairHistory!: Array<{ day: number; pairs: Array<[number, number]>; at: string }>;

  // 2026-04-22 · Day 15+ 成熟运营档位 · null=未开 · 'light'/'standard'/'aggressive'
  @Column({ type: 'varchar', length: 20, name: 'mature_level', nullable: true })
  matureLevel!: 'light' | 'standard' | 'aggressive' | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
