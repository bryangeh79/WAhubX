// M10 · E2 · Hardware Change Recovery
//
// 触发场景:
//   - MachineBound 已生成过 fingerprint 文件, 但文件丢失 (用户换硬件 / 重装 / rm 了 data/config/)
//   - 启动生成新 fingerprint → 与 DB 里的加密 API keys 不匹配 → decrypt 失败
//
// Detection (onModuleInit):
//   1. 扫 ai_provider · 尝试 current-machine-key decrypt
//   2. 全失败且有数据 → 进入 LOCKED 态 · 前端 red banner + recovery modal
//   3. 至少一条解开 → NORMAL
//
// Recovery paths (用户 UI 二选):
//   (a) `recoverWithEnvKey(hex)` — 输入原 APP_ENCRYPTION_KEY (32B hex)
//        用 env key 试 decrypt · 成功 → 重走 MasterKeyMigrationService 逻辑 (env → machine)
//   (b) `recoverFromWab(buffer, overrideKey?)` — 导入 pre-migration.wab / .wab 备份
//        先试 current machine key decrypt · 失败给原 env key 选项
//
// State:
//   - 内存 Map · 进程生命期 · 重启会重走 detection
//   - UI 轮询 `GET /backup/recovery/status` 显示 locked 状态

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiEncryptionService } from '../ai/ai-encryption.service';
import { EnvMasterKeyProvider, MASTER_KEY_PROVIDER, type MasterKeyProvider } from '../ai/master-key.provider';
import { MachineBoundMasterKeyProvider } from '../ai/machine-bound-master-key.provider';
import { AiProviderEntity } from '../ai/ai-provider.entity';
import { BackupImportService } from './backup-import.service';

class StaticKeyProvider implements MasterKeyProvider {
  constructor(private readonly key: Buffer, private readonly label: string) {}
  getKey(): Buffer {
    return this.key;
  }
  source(): string {
    return this.label;
  }
}

export type RecoveryStatus =
  | { state: 'normal' }
  | {
      state: 'locked';
      reason: string;
      providersCount: number;
      machineFingerprint: string;
    };

@Injectable()
export class HardwareRecoveryService implements OnModuleInit {
  private readonly logger = new Logger(HardwareRecoveryService.name);
  private status: RecoveryStatus = { state: 'normal' };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(MASTER_KEY_PROVIDER) private readonly machineKey: MasterKeyProvider, // alias of MachineBound
    private readonly machineKeyConcrete: MachineBoundMasterKeyProvider,
    private readonly envKey: EnvMasterKeyProvider,
    private readonly importSvc: BackupImportService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.detect();
  }

  /**
   * 检测当前 machine key 能否 decrypt 现有 ai_provider keys
   * 无 provider → normal · 全失败 → locked · 至少 1 条成功 → normal
   */
  async detect(): Promise<RecoveryStatus> {
    const providers = await this.dataSource.getRepository(AiProviderEntity).find();
    if (providers.length === 0) {
      this.status = { state: 'normal' };
      return this.status;
    }

    const enc = new AiEncryptionService(new StaticKeyProvider(this.machineKey.getKey(), 'machine'));
    let okCount = 0;
    for (const p of providers) {
      try {
        enc.decrypt(p.apiKeyEncrypted);
        okCount++;
      } catch {
        // ignore
      }
    }

    if (okCount === 0) {
      this.status = {
        state: 'locked',
        reason: `检测到 ${providers.length} 个 AI provider 但当前 machine-bound 密钥无法解密 · 可能硬件指纹文件丢失 / 换机器 · AI 功能暂禁用`,
        providersCount: providers.length,
        machineFingerprint: this.machineKey.source(),
      };
      this.logger.error(this.status.reason);
    } else {
      if (this.status.state === 'locked') this.logger.log(`recovery unlocked · ${okCount}/${providers.length} providers decryptable`);
      this.status = { state: 'normal' };
    }
    return this.status;
  }

  getStatus(): RecoveryStatus {
    return this.status;
  }

  isLocked(): boolean {
    return this.status.state === 'locked';
  }

  /**
   * Recovery A · 用户输入原 APP_ENCRYPTION_KEY (32B hex)
   * 成功 → 用 env key 解 · 用 machine key 重加密 · 标 migration_done
   */
  async recoverWithEnvKey(envKeyHex: string): Promise<{ migratedCount: number }> {
    if (this.status.state !== 'locked') {
      throw new Error('当前非 locked 状态 · 无需 recovery');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(envKeyHex)) {
      throw new Error('env key 必须 64 位 hex · 32B');
    }
    const envKeyBuf = Buffer.from(envKeyHex, 'hex');
    const envEnc = new AiEncryptionService(new StaticKeyProvider(envKeyBuf, 'env-recovery'));
    const machineEnc = new AiEncryptionService(
      new StaticKeyProvider(this.machineKey.getKey(), 'machine'),
    );

    // 验证 env key 能解 · 任一条成功就认为 key 正确
    const providers = await this.dataSource.getRepository(AiProviderEntity).find();
    let verified = false;
    for (const p of providers) {
      try {
        envEnc.decrypt(p.apiKeyEncrypted);
        verified = true;
        break;
      } catch {
        // try next
      }
    }
    if (!verified) {
      throw new Error(
        'env key 验证失败 · 提供的 key 无法解密任何 provider · 请确认是否为原 APP_ENCRYPTION_KEY',
      );
    }

    // 同步 EnvMasterKeyProvider 的内存 key (给将来若还需要)
    this.envKey.setKeyFromHex(envKeyHex);

    // 事务 re-encrypt
    let migratedCount = 0;
    await this.dataSource.transaction(async (m) => {
      for (const p of providers) {
        try {
          const plain = envEnc.decrypt(p.apiKeyEncrypted);
          p.apiKeyEncrypted = machineEnc.encrypt(plain);
          await m.save(p);
          migratedCount++;
        } catch (err) {
          this.logger.warn(`recovery · provider ${p.id} skip (env key 仍无法 decrypt): ${err}`);
        }
      }
    });

    // 标 migration_done
    await this.dataSource.query(
      `INSERT INTO "app_setting" ("key", "value", "updated_at") VALUES ('master_key.migration_done', 'true', NOW())
       ON CONFLICT ("key") DO UPDATE SET "value" = 'true', "updated_at" = NOW()`,
    );

    // 重 detect · 清 locked
    await this.detect();
    this.logger.log(`recovery via env key · migrated ${migratedCount} providers · status=${this.status.state}`);
    return { migratedCount };
  }

  /**
   * Recovery B · 导入 pre-migration / 历史 .wab
   * 尝试用当前 machine key · 失败时用户须额外提供 env key · 这里 delegate 到 BackupImportService
   * import 后 re-detect
   */
  async recoverFromWab(wab: Buffer, overrideKeyHex?: string): Promise<{ imported: boolean }> {
    const overrideKey = overrideKeyHex
      ? Buffer.from(overrideKeyHex, 'hex')
      : undefined;
    if (overrideKey && overrideKey.length !== 32) throw new Error('overrideKey 必须 32B hex');

    await this.importSvc.import(wab, { overrideKey });
    // import 成功 · 当前 DB 已覆盖 · 重 detect
    await this.detect();

    return { imported: true };
  }

  // machineKeyConcrete 目前未直接用 · 保留给未来 V1.1 需要区分 source 的逻辑
  getMachineFingerprintSource(): string {
    return this.machineKeyConcrete.source();
  }
}
