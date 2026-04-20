import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// 主密钥抽象 — M6 用 Env 版, M10 计划加 MachineBoundMasterKeyProvider 派生自机器指纹
// 两点目标:
//   1. AiEncryptionService 拿的接口统一, 切换实现不改使用方
//   2. 密钥来源的安全属性清晰 (env 泄漏风险 / 机器绑定风险)
export const MASTER_KEY_PROVIDER = Symbol('MASTER_KEY_PROVIDER');

export interface MasterKeyProvider {
  /**
   * 返回 32 字节 Buffer. 必须保证每次调用在进程生命周期内相同
   * (否则已加密的数据无法解密).
   */
  getKey(): Buffer;

  /**
   * 供日志打印用的 key 来源标识, 不泄漏 key 本身.
   */
  source(): string;
}

// M10 · 改宽容: 允许 APP_ENCRYPTION_KEY 缺失 (迁移完成后 env 可移除). getKey() 才
// 报错 · 构造不抛. MasterKeyMigrationService 检查 isAvailable() 决定是否执行迁移分支.
@Injectable()
export class EnvMasterKeyProvider implements MasterKeyProvider {
  private readonly logger = new Logger(EnvMasterKeyProvider.name);
  private readonly key: Buffer | null;

  constructor(config: ConfigService) {
    const hex = config.get<string>('APP_ENCRYPTION_KEY', '');
    if (!hex) {
      this.key = null;
      this.logger.log(`APP_ENCRYPTION_KEY 未设 · EnvMasterKey 不可用 (M10 后若已迁移到 MachineBound 此为正常)`);
      return;
    }
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error('APP_ENCRYPTION_KEY 必须是 64 位 hex 字符 (32 字节)');
    }
    this.key = Buffer.from(hex, 'hex');
    this.logger.log(`env master key loaded · source=${this.source()} · len=${this.key.length}B`);
  }

  isAvailable(): boolean {
    return this.key !== null;
  }

  getKey(): Buffer {
    if (!this.key) {
      throw new Error(
        'EnvMasterKeyProvider.getKey() 调用但 APP_ENCRYPTION_KEY 未设. ' +
        '若在 E2 recovery 路径, 请先让用户提供 env key.',
      );
    }
    return this.key;
  }

  /** 允许 E2 recovery 路径动态设置 env key (用户在 UI 输入) · 内存中保留, 不持久化 */
  setKeyFromHex(hex: string): void {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error('env key 必须是 64 位 hex 字符');
    }
    // @ts-expect-error reassign readonly for recovery path (intentional)
    this.key = Buffer.from(hex, 'hex');
    this.logger.warn('env master key set via recovery path (runtime only, not persisted)');
  }

  source(): string {
    return 'env:APP_ENCRYPTION_KEY';
  }
}
