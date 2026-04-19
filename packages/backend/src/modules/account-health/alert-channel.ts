// §B.25 桌面告警类型表 · interface 层
// M8 只实装桌面 (node-notifier), email / Telegram 留接口不实装
// 未来加新 channel: new class implements AlertChannel + 注册到 AlertDispatcher 的 providers 数组

export const ALERT_CHANNELS = Symbol('ALERT_CHANNELS');

export type AlertSeverity = 'info' | 'warn' | 'critical';

export interface AlertPayload {
  title: string;
  message: string;
  severity: AlertSeverity;
  // §B.25 type 分类: qr_lost / offline / proxy_down / health_drop / banned /
  //                   balance_low / warmup_done / fail_streak / license_warn
  type: string;
  accountId?: number;
  slotIndex?: number;
  dryRun?: boolean; // true 时 channel 应加 [DRY-RUN] 前缀
  meta?: Record<string, unknown>;
}

export interface AlertChannel {
  readonly channelName: string;
  /**
   * 发告警. 失败应记日志但不抛 — 告警丢失是 degraded 而非 fatal
   */
  send(payload: AlertPayload): Promise<void>;
}
