import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TaskEntity } from './task.entity';

// 技术交接文档 § 3.6
export enum TaskRunStatus {
  Running = 'running',
  Success = 'success',
  Failed = 'failed',
  Skipped = 'skipped',  // 仲裁 soft-skip (e.g. warmup_stage 不够, 记录但允许后续重试)
}

@Entity('task_run')
@Index('idx_task_run_task', ['taskId'])
@Index('idx_task_run_account_started', ['accountId', 'startedAt'])
export class TaskRunEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'task_id' })
  taskId!: number;

  @ManyToOne(() => TaskEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task!: TaskEntity;

  // 绑定到具体账号 (task.target_ids 里挑一个展开). null = 组级任务预提交 (M4 会用).
  @Column({ type: 'int', name: 'account_id', nullable: true })
  accountId!: number | null;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'enum', enum: TaskRunStatus })
  status!: TaskRunStatus;

  @Column({ type: 'text', name: 'error_code', nullable: true })
  errorCode!: string | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage!: string | null;

  // executor 写结构化步骤日志: [{ at, step, ok, meta }]
  @Column({ type: 'jsonb', default: () => "'[]'" })
  logs!: Array<{ at: string; step: string; ok: boolean; meta?: Record<string, unknown> }>;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
