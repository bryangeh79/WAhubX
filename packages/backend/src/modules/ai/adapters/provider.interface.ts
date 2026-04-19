// Provider adapter 契约 — rewrite(text, opts) 返 string variant
// 每个 provider 实现 RewriteAdapter, 错误分级明确给 AiTextService 做 fallback 决策
export interface RewriteInput {
  originalText: string;
  personaHint?: string;   // 已压成一行的 persona 简要 (性别/年龄/职业/语言口味), 为空时 prompt 不带
  maxTokens?: number;
  timeoutMs?: number;
}

export interface RewriteSuccess {
  ok: true;
  text: string;
  providerUsed: string;
  latencyMs: number;
  modelUsed: string;
}

export interface RewriteFailure {
  ok: false;
  error: AdapterErrorCode;
  message: string;
  providerUsed: string;
  latencyMs: number;
}

export type RewriteResult = RewriteSuccess | RewriteFailure;

export enum AdapterErrorCode {
  NotImplemented = 'NOT_IMPLEMENTED',
  Timeout = 'TIMEOUT',
  NetworkError = 'NETWORK_ERROR',
  AuthFailure = 'AUTH_FAILURE',   // 401 / 403
  QuotaExceeded = 'QUOTA_EXCEEDED', // 429 / 余额不足
  BadResponse = 'BAD_RESPONSE',    // 5xx / 返回格式异常
  EmptyResult = 'EMPTY_RESULT',    // provider 返回空 string
}

export interface RewriteAdapter {
  readonly providerType: string;
  rewrite(
    cfg: { baseUrl: string; apiKey: string; model: string },
    input: RewriteInput,
  ): Promise<RewriteResult>;
  /**
   * 连通性 ping — 发最小请求验 auth + endpoint 可达
   */
  ping(cfg: { baseUrl: string; apiKey: string; model: string }): Promise<RewriteResult>;
}
