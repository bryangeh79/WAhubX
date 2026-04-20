import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// 技术交接文档 § 3.6
export enum TaskStatus {
  Pending = 'pending',      // 等调度
  Queued = 'queued',        // dispatcher 已放入 BullMQ (仲裁后)
  Running = 'running',      // executor 正在跑
  Done = 'done',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Skipped = 'skipped',
}

// target_type: 任务作用对象类型
export enum TaskTargetType {
  Account = 'account',      // 作用于单一账号 (target_ids = [accountId])
  Group = 'group',          // 作用于执行组 (target_ids = [groupId]) — M4 接入
}

@Entity('task')
@Index('idx_task_status_scheduled', ['status', 'scheduledAt'])
@Index('idx_task_tenant_status', ['tenantId', 'status'])
export class TaskEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'tenant_id' })
  tenantId!: number;

  // task_type 是自由字符串 — dispatcher 用 executor registry 路由, 未注册的 type 保留 pending + warn log
  // 不 hardcode enum, M4/M5/M6/M7 才加新 type 时 M3 代码不需改
  @Column({ type: 'varchar', length: 64, name: 'task_type' })
  taskType!: string;

  @Column({ type: 'int', default: 5 })
  priority!: number; // 1=高 9=低

  @Column({ type: 'timestamptz', name: 'scheduled_at', nullable: true })
  scheduledAt!: Date | null;

  // 'once' | cron-like 表达式 (M5 养号日历会用)
  @Column({ type: 'text', name: 'repeat_rule', nullable: true })
  repeatRule!: string | null;

  @Column({ type: 'enum', enum: TaskTargetType, name: 'target_type' })
  targetType!: TaskTargetType;

  // account_id 列表 (target_type=account) 或 group_id 列表 (target_type=group)
  @Column({ type: 'int', array: true, name: 'target_ids', default: () => "'{}'" })
  targetIds!: number[];

  // 任务参数 (自由结构) — executor 自行解析
  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.Pending })
  status!: TaskStatus;

  // 用户提交后的错误 (比如 dispatcher 判定永久拒绝); 临时 pending 中的不写这里
  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'updated_at', default: () => 'now()', onUpdate: 'now()' })
  updatedAt!: Date;

  // M9 · 接管抢占暂停时刻 · 非 null = 任务被接管 pause, release 后 dispatcher 按 scheduledAt 续跑
  @Column({ type: 'timestamptz', name: 'paused_at', nullable: true })
  pausedAt!: Date | null;
}
