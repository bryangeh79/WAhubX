// 2026-04-25 · child_process.exec promise wrap · 带超时 · 不抛出 · 包结构化结果
//
// 用途: D3 integrity-checks 跑 iptables / dig / nslookup / curl 等 · 必须能拿
// exit code · timedOut 标志 · 不能因为 dig 退非 0 就抛.

import { exec, type ExecOptions } from 'node:child_process';

export interface ExecResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;       // 进程 exit code · 0 = 成功 · 非 0 = 失败
  timedOut: boolean;      // 是否被超时 kill
  durationMs: number;
  signal: string | null;  // 被信号 kill 时 (SIGTERM/SIGKILL)
}

/**
 * 跑 shell 命令 · 永不抛 · 返结构化结果.
 * timeoutMs 默认 5s · 命中超时 stderr 含 "ETIMEDOUT" 或进程被 SIGTERM
 */
export function execAsync(command: string, timeoutMs = 5000, options: ExecOptions = {}): Promise<ExecResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const proc = exec(command, { timeout: timeoutMs, ...options }, (err, stdout, stderr) => {
      const durationMs = Date.now() - start;
      const e = err as (Error & { code?: number; signal?: string; killed?: boolean }) | null;
      resolve({
        command,
        stdout: typeof stdout === 'string' ? stdout : stdout?.toString('utf-8') ?? '',
        stderr: typeof stderr === 'string' ? stderr : stderr?.toString('utf-8') ?? '',
        exitCode: e ? (typeof e.code === 'number' ? e.code : 1) : 0,
        timedOut: !!(e && (e.killed || (e as { code?: string }).code === 'ETIMEDOUT')),
        durationMs,
        signal: e?.signal ?? null,
      });
    });
    // 防 proc 引用导致 lint 警告
    void proc;
  });
}
