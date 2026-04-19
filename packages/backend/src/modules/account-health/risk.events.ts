// Event bus payload types · domain services emit, health-scorer subscribes
// 统一 channel 'risk.*' 命名约定

import { RiskEventCode, RiskEventSeverity } from './risk-event.entity';

export const RISK_EVENT_CHANNEL = 'risk.raw';

export interface RiskRawEvent {
  accountId: number;
  code: RiskEventCode | string; // 允许 string 给未知/新增 code
  severity: RiskEventSeverity;
  source: string;              // 'task_runner' / 'baileys' / 'dispatcher' / 'executor'
  sourceRef?: string;          // 上游唯一 id; 不传走兜底 md5(code|minute)
  meta?: Record<string, unknown>;
  at?: Date;                   // 默认 now
}
