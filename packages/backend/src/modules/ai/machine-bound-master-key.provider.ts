// M10 · MachineBoundMasterKeyProvider (替 M6 EnvMasterKeyProvider)
//
// 设计 (§B.18 / E 决策):
//   - 密钥来源 = HMAC-SHA256(HARDCODED_SALT, fingerprint)
//   - fingerprint = SHA-256(hostname | platform | mac | cpuModel | ramGB)
//   - 首次启动: 计算 → 持久化到 data/config/master-key-fingerprint.txt (0600 权限)
//   - 后续启动: 读文件. **不再重算** (防硬件小变动 / 网卡替换导致 key 漂移)
//
// 文件丢失时行为:
//   - 旧加密数据 (ai_provider.api_key_encrypted) 用已丢失的 key 加密
//   - 新启动无法 decrypt · HardwareRecoveryService (M10 task 10) 探测 GCM auth fail 进入
//     E2 recovery 路径 (UI 提示 · 允许输入原 env key / 导入 .wab 恢复)
//
// 安全边界:
//   - 离线桌面 app 场景 · 对手拿到 DB backup 但没拿到 fingerprint 文件 → 无法 decrypt AI keys
//   - 对手拿到二进制 → 能反编译出 SALT · 但还需机器上的 fingerprint 文件 → 保护 DB-only 拷走
//   - 非目标: 防御拿到完整文件系统的对手 (那种级别超出本地桌面 app 威胁模型)
//
// Key 长度: HMAC-SHA256 输出 32B · 匹配 AES-256-GCM 需求.

import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MasterKeyProvider } from './master-key.provider';

// 盐 hardcoded · 唯一于 WAhubX · 将来版本轮换改此常量需配合数据迁移
// 盐被反编译出来不是核心威胁 (盐非密钥), 保护的是"同一机器 fingerprint 派生密钥稳定"
const MASTER_KEY_SALT = Buffer.from('WAhubX-v1.0-master-key-salt-bytes-32bytes', 'utf8');

// 持久化文件路径 · 跟随 data/ 走 (升级不丢)
export function getFingerprintFilePath(): string {
  return path.resolve(process.cwd(), 'data', 'config', 'master-key-fingerprint.txt');
}

/**
 * 计算**当前**机器硬件指纹 (每次调用可能不同, 若硬件变过).
 * 不直接当密钥用 · 只作为**首次**落盘的种子.
 */
export function computeRawFingerprint(): string {
  const host = os.hostname() || 'unknown-host';
  const platform = os.platform();
  const arch = os.arch();
  const cpuModel = os.cpus()?.[0]?.model ?? 'unknown-cpu';
  const ramGB = Math.round(os.totalmem() / (1024 ** 3));
  // 首个非内部 & 非全 0 MAC · 稳定于网卡不换
  let mac = '00:00:00:00:00:00';
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        mac = iface.mac;
        break;
      }
    }
    if (mac !== '00:00:00:00:00:00') break;
  }
  const raw = [host, platform, arch, mac, cpuModel, `${ramGB}GB`].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class MachineBoundMasterKeyProvider implements MasterKeyProvider {
  private readonly logger = new Logger(MachineBoundMasterKeyProvider.name);
  private readonly key: Buffer;
  private readonly fingerprint: string;
  private readonly wasFreshlyGenerated: boolean;

  constructor() {
    const fpPath = getFingerprintFilePath();
    if (fs.existsSync(fpPath)) {
      this.fingerprint = fs.readFileSync(fpPath, 'utf8').trim();
      this.wasFreshlyGenerated = false;
      if (!/^[0-9a-f]{64}$/.test(this.fingerprint)) {
        throw new Error(
          `master-key-fingerprint.txt 格式非法 (需 64 hex 字符) · 路径=${fpPath}. 若要重置: 删除此文件 + 用 env key 恢复 → 导入 .wab 走 E2 recovery.`,
        );
      }
      this.logger.log(`machine fingerprint loaded from ${fpPath}`);
    } else {
      this.fingerprint = computeRawFingerprint();
      fs.mkdirSync(path.dirname(fpPath), { recursive: true });
      fs.writeFileSync(fpPath, this.fingerprint, { mode: 0o600 });
      this.wasFreshlyGenerated = true;
      this.logger.warn(
        `machine fingerprint 首次生成 · 写入 ${fpPath} · 勿丢此文件 (丢失=所有 AI key 需 E2 recovery)`,
      );
    }
    // HMAC-SHA256(salt, fingerprint) → 32B key
    this.key = crypto.createHmac('sha256', MASTER_KEY_SALT).update(this.fingerprint).digest();
    this.logger.log(
      `master key derived · source=${this.source()} · len=${this.key.length}B · fresh=${this.wasFreshlyGenerated}`,
    );
  }

  getKey(): Buffer {
    return this.key;
  }

  source(): string {
    return `machine:${this.fingerprint.substring(0, 8)}…`;
  }

  /**
   * 当前进程启动时是否刚生成过 fingerprint (vs 读已有文件).
   * MasterKeyMigrationService (E1) 用此判断是否是全新安装.
   */
  isFreshInstall(): boolean {
    return this.wasFreshlyGenerated;
  }
}
