import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// 2026-04-21 · License Server HTTPS client · 对接 VPS 上的 wahubx-license-server
// 部署状态:
//   - VPS 端代码: license-server/ (Cloudflare Worker · 已就位 · 待 deploy)
//   - 本地 backend: 默认 LICENSE_SERVER_URL 未设时走本地 DB (dev), 设了则走 VPS (production)
//
// VPS 部署步骤 (用户需手动):
//   1. cd license-server && pnpm install
//   2. wrangler login
//   3. wrangler d1 create wahubx-license-db  → 拿真实 database_id 填 wrangler.toml
//   4. wrangler d1 execute wahubx-license-db --file=src/db/schema.sql --remote
//   5. wrangler secret put ADMIN_API_KEY
//   6. wrangler deploy
//   7. 在 Cloudflare DNS 配置 license.wahubx.com → worker
//   8. 本地 backend .env 加: LICENSE_SERVER_URL=https://license.wahubx.com

export interface RemoteLicense {
  plan: string;
  slotLimit: number;
  maxTasks: number;
  expiresAt: string | null;
  subscriptionExpiry: string | null;
  tenantName: string;
  tenantEmail: string | null;
  tenantUsername: string | null;
  passwordHash: string | null;
}

export interface ActivateResponse {
  success: boolean;
  license?: RemoteLicense;
  error?: string;
}

export interface HeartbeatResponse {
  valid: boolean;
  expiresAt?: string | null;
  slotLimit?: number;
  maxTasks?: number;
  plan?: string;
  error?: string;
  message?: string | null;
}

@Injectable()
export class LicenseServerClient {
  private readonly logger = new Logger(LicenseServerClient.name);
  private readonly serverUrl: string | null;

  constructor(private readonly config: ConfigService) {
    // 未设 = 走本地 DB (dev). 设了 = 走 VPS (production).
    this.serverUrl = this.config.get<string>('LICENSE_SERVER_URL') ?? null;
    if (this.serverUrl) {
      this.logger.log(`LicenseServer 模式: 远程 VPS · ${this.serverUrl}`);
    } else {
      this.logger.log('LicenseServer 模式: 本地 DB (dev fallback · 生产应配 LICENSE_SERVER_URL)');
    }
  }

  isRemoteMode(): boolean {
    return this.serverUrl !== null;
  }

  /** 激活 license · 返完整 tenant metadata 给本地建 admin user */
  async activate(licenseKey: string, machineId: string): Promise<ActivateResponse> {
    if (!this.serverUrl) {
      throw new Error('LicenseServerClient.activate 在本地模式下不应调用');
    }
    try {
      const res = await fetch(`${this.serverUrl}/activate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ licenseKey, machineId }),
        signal: AbortSignal.timeout(15000),
      });
      const json = (await res.json()) as ActivateResponse;
      return json;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`activate VPS failed: ${msg}`);
      return { success: false, error: `License Server 不可达: ${msg}` };
    }
  }

  /** 心跳 · 每 30 min 一次 (配合 @Cron) */
  async heartbeat(
    licenseKey: string,
    machineId: string,
    extra: { currentSlots?: number; currentTasks?: number; version?: string } = {},
  ): Promise<HeartbeatResponse> {
    if (!this.serverUrl) {
      throw new Error('LicenseServerClient.heartbeat 在本地模式下不应调用');
    }
    try {
      const res = await fetch(`${this.serverUrl}/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ licenseKey, machineId, ...extra }),
        signal: AbortSignal.timeout(10000),
      });
      const json = (await res.json()) as HeartbeatResponse;
      return json;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`heartbeat VPS failed (将走 offline grace): ${msg}`);
      return { valid: false, error: `License Server 不可达: ${msg}` };
    }
  }
}
