import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

// 风险事件原始流水 · §5.4 所有 "次数" 源头
// 去重规则 (用户 2026-04-20 定): UNIQUE(account_id, code, source_ref) + ON CONFLICT DO NOTHING
//   source_ref 上游唯一 id (task_run_id / baileys_msg_id / proxy_log_hash)
//   兜底 md5(code || at_floor_to_minute) 按分钟去重
// 滚动窗口: scorer 只读 at > now - N 天 (default 30), 防 6 个月前验证码永远扣分
export const RISK_EVENT_SEVERITY = ['info', 'warn', 'critical'] as const;
export type RiskEventSeverity = (typeof RISK_EVENT_SEVERITY)[number];

// 已知事件 code — 扣分规则引擎按此 switch
// 新增 code 步骤: 1. 这里加常量 · 2. scorer 加 weight · 3. tech doc §5.4 同步
export const RiskEventCode = {
  CaptchaTriggered: 'captcha_triggered',     // §5.4 × 5
  Reported: 'reported',                      // × 15
  SendFailed: 'send_failed',                 // × (send_fail_rate × 100)
  FriendRejected: 'friend_rejected',         // × 20
  SameIpBanned: 'same_ip_banned',            // × 10
  QrExpired: 'qr_expired',                   // 掉线 warn
  ConnectionLost: 'connection_lost',         // warn
  ProxyDown: 'proxy_down',                   // warn
  BannedByWa: 'banned_by_wa',                // critical (封号 → M5 regress Phase 0)
  PhaseGateBlocked: 'phase_gate_blocked',    // info (记录不扣分, M5 已 gate)
} as const;
export type RiskEventCode = (typeof RiskEventCode)[keyof typeof RiskEventCode];

@Entity('risk_event')
@Unique('UQ_risk_event_dedupe', ['accountId', 'code', 'sourceRef'])
@Index('idx_risk_event_account_at', ['accountId', 'at'])
@Index('idx_risk_event_code', ['code'])
@Index('idx_risk_event_at', ['at'])
export class RiskEventEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string; // bigint 避 int 溢出 (事件量大)

  @Column({ type: 'int', name: 'account_id' })
  accountId!: number;

  @Column({ type: 'text' })
  code!: string;

  @Column({ type: 'text' })
  severity!: RiskEventSeverity;

  // 发 event 的 domain service 名, e.g. 'task_runner' / 'baileys' / 'dispatcher'
  @Column({ type: 'text' })
  source!: string;

  // 去重锚点 — 上游稳定 id. 拼接 'auto:md5' 前缀时表示兜底分钟去重
  @Column({ type: 'text', name: 'source_ref' })
  sourceRef!: string;

  @Column({ type: 'jsonb', nullable: true })
  meta!: Record<string, unknown> | null;

  // 事件发生时间 (注: 不是 insert 时间; created_at 另记)
  @Column({ type: 'timestamptz' })
  at!: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
