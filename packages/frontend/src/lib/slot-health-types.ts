// 2026-04-29 · P0-CS-3 · 账号体检 + 一键恢复 类型定义
// 跟 backend slot-health.service.ts 同步

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown';
export type OverallStatus = 'healthy' | 'warning' | 'critical' | 'unknown';
export type RecoverResultCode = 'success' | 'partial' | 'failed' | 'need_scan';

export interface HealthCheck {
  key: string;
  status: CheckStatus;
  labelZh: string;
  value: string | number | boolean | null;
  messageZh: string;
  raw?: Record<string, unknown>;
}

export interface CheckupResult {
  slotId: number;
  accountId: number | null;
  phone: string | null;
  role: 'customer_service' | 'broadcast' | 'unknown';
  overallStatus: OverallStatus;
  summaryZh: string;
  recommendedActionZh: string;
  checks: HealthCheck[];
  generatedAt: string;
}

export interface ActionAttempted {
  key: string;
  status: CheckStatus;
  messageZh: string;
  raw?: Record<string, unknown>;
}
export interface ActionSkipped {
  key: string;
  reasonZh: string;
  raw?: Record<string, unknown>;
}

export interface RecoverResult {
  slotId: number;
  accountId: number | null;
  phone: string | null;
  result: RecoverResultCode;
  needScan: boolean;
  summaryZh: string;
  actionsAttempted: ActionAttempted[];
  actionsSkipped: ActionSkipped[];
  beforeDiagnose: CheckupResult;
  afterDiagnose: CheckupResult;
}

// ─── UI helper · status → antd 颜色 ────
export const STATUS_COLOR: Record<CheckStatus, string> = {
  pass: 'success',
  warn: 'warning',
  fail: 'error',
  unknown: 'default',
};

export const OVERALL_COLOR: Record<OverallStatus, 'success' | 'warning' | 'error' | 'info'> = {
  healthy: 'success',
  warning: 'warning',
  critical: 'error',
  unknown: 'info',
};

export const OVERALL_LABEL: Record<OverallStatus, string> = {
  healthy: '健康',
  warning: '警告',
  critical: '严重',
  unknown: '未知',
};

export const RECOVER_RESULT_LABEL: Record<RecoverResultCode, string> = {
  success: '恢复成功',
  partial: '部分恢复',
  failed: '恢复失败',
  need_scan: '需要扫码',
};
