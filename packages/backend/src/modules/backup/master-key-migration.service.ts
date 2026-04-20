// M10 · E1 · MasterKey 透明自动迁移 (X1+E1 组合)
//
// 触发条件 (onModuleInit):
//   - app_setting 'master_key.migration_done' == 'false' 或缺失
//   - ai_provider 表有 env-encrypted 行 (detect: 尝试 MachineBound decrypt 失败 + Env decrypt 成功 = 旧数据)
//
// 流程 (防数据灾难):
//   1. Env key 可用? 不可 → 跳过 (新装 / 已迁移完)
//   2. 扫 ai_provider · 尝试 machine-bound decrypt, 全部成功 → 标 done, 跳过
//   3. 有需要迁移的 → 强制 pre-migration.wab 备份 (用 env key 加密当前 DB · 保证可还原)
//   4. verify 备份文件可 decode (magic + header + inner zip 解压试读)
//   5. 事务 re-encrypt · 逐行 update ai_provider.api_key_encrypted
//   6. 标 migration_done=true
//
// 任何步骤失败:
//   - 抛 + log 详细路径
//   - 事务未 commit 的 DB 状态 rollback
//   - pre-migration.wab 文件保留 (用户手动 restore)

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiEncryptionService } from '../ai/ai-encryption.service';
import { EnvMasterKeyProvider, type MasterKeyProvider } from '../ai/master-key.provider';
import { MachineBoundMasterKeyProvider } from '../ai/machine-bound-master-key.provider';
import { AiProviderEntity } from '../ai/ai-provider.entity';
import { AppSettingEntity } from '../../common/app-setting.entity';
import { BackupExportService } from './backup-export.service';

const SETTING_MIGRATION_DONE = 'master_key.migration_done';

/** 简易静态 key provider · 给 AiEncryptionService 临时换 key (不走 DI) */
class StaticKeyProvider implements MasterKeyProvider {
  constructor(private readonly key: Buffer, private readonly label: string) {}
  getKey(): Buffer {
    return this.key;
  }
  source(): string {
    return this.label;
  }
}

@Injectable()
export class MasterKeyMigrationService implements OnModuleInit {
  private readonly logger = new Logger(MasterKeyMigrationService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly envKey: EnvMasterKeyProvider,
    private readonly machineKey: MachineBoundMasterKeyProvider,
    private readonly exportSvc: BackupExportService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const done = await this.isMigrationDone();
      if (done) {
        this.logger.log(`master-key migration · already done · skip`);
        return;
      }

      // 扫 AI providers
      const providers = await this.dataSource.getRepository(AiProviderEntity).find();
      if (providers.length === 0) {
        this.logger.log(`master-key migration · 无 ai_provider · 标 done`);
        await this.markDone();
        return;
      }

      // 全部已用 machine-bound 加密? (decrypt 成功 = 已迁移 · 可能手动跑过一次)
      const machineEnc = new AiEncryptionService(new StaticKeyProvider(this.machineKey.getKey(), 'machine'));
      const unmigrated: AiProviderEntity[] = [];
      for (const p of providers) {
        try {
          machineEnc.decrypt(p.apiKeyEncrypted);
          // 解密成功 = 已是 machine-bound 格式
        } catch {
          unmigrated.push(p);
        }
      }
      if (unmigrated.length === 0) {
        this.logger.log(`master-key migration · ${providers.length} providers 全已 machine-bound · 标 done`);
        await this.markDone();
        return;
      }

      // 有需要迁移的 · 确认 env key 可用
      if (!this.envKey.isAvailable()) {
        this.logger.error(
          `master-key migration · ${unmigrated.length} providers 非 machine-bound 但 APP_ENCRYPTION_KEY 未设 · 无法迁移 · E2 recovery 路径待用户输入原 env key`,
        );
        // 不标 done · 不抛 (让 app 继续启动 · UI 显 E2 banner 引导用户)
        return;
      }

      // E1 流程正式走
      this.logger.warn(`master-key migration · 检测 ${unmigrated.length} 个 env-加密 provider · 开始迁移`);

      // 步骤 1: pre-migration 备份 · 用 env key 加密 (备份本身能被 env key 解)
      const preBackup = await this.exportSvc.export({
        source: 'pre-migration',
        notes: `before master-key migration · ${unmigrated.length} providers env→machine`,
        overrideKey: this.envKey.getKey(),
      });
      this.logger.log(`pre-migration backup · ${preBackup.filePath} · ${preBackup.sizeBytes}B`);

      // 步骤 2: verify pre-backup decodable
      const fs = await import('node:fs');
      const { decodeWab } = await import('./wab-codec');
      const buf = fs.readFileSync(preBackup.filePath);
      try {
        decodeWab({ wab: buf, key: this.envKey.getKey() });
        this.logger.log(`pre-migration backup verified`);
      } catch (err) {
        throw new Error(
          `pre-migration backup verify FAILED · 不继续迁移 · 备份文件 ${preBackup.filePath} 可能损坏. 错误: ${err instanceof Error ? err.message : err}`,
        );
      }

      // 步骤 3: 事务 re-encrypt
      const envEnc = new AiEncryptionService(new StaticKeyProvider(this.envKey.getKey(), 'env'));
      await this.dataSource.transaction(async (m) => {
        for (const p of unmigrated) {
          const plaintext = envEnc.decrypt(p.apiKeyEncrypted);
          p.apiKeyEncrypted = machineEnc.encrypt(plaintext);
          await m.save(p);
        }
      });
      this.logger.log(`master-key migration · ${unmigrated.length} providers re-encrypted`);

      // 步骤 4: 标 done
      await this.markDone();
      this.logger.log(`master-key migration · DONE · APP_ENCRYPTION_KEY 现可从 .env 移除`);
    } catch (err) {
      // 不抛出 · 让 app 继续启动 · E2 recovery 接手引导
      this.logger.error(
        `master-key migration FAILED · ${err instanceof Error ? err.message : err} · app 继续启动, E2 recovery 路径待用户处理`,
      );
    }
  }

  private async isMigrationDone(): Promise<boolean> {
    const row = await this.dataSource
      .getRepository(AppSettingEntity)
      .findOne({ where: { key: SETTING_MIGRATION_DONE } });
    return row?.value === 'true';
  }

  private async markDone(): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO "app_setting" ("key", "value", "updated_at") VALUES ($1, 'true', NOW())
       ON CONFLICT ("key") DO UPDATE SET "value" = 'true', "updated_at" = NOW()`,
      [SETTING_MIGRATION_DONE],
    );
  }
}
