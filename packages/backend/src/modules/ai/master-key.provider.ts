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

@Injectable()
export class EnvMasterKeyProvider implements MasterKeyProvider {
  private readonly logger = new Logger(EnvMasterKeyProvider.name);
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const hex = config.get<string>('APP_ENCRYPTION_KEY', '');
    if (!hex) {
      throw new Error(
        'APP_ENCRYPTION_KEY 必须设置 (32B hex). 生成: openssl rand -hex 32',
      );
    }
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error('APP_ENCRYPTION_KEY 必须是 64 位 hex 字符 (32 字节)');
    }
    this.key = Buffer.from(hex, 'hex');
    this.logger.log(`master key loaded · source=${this.source()} · len=${this.key.length}B`);
  }

  getKey(): Buffer {
    return this.key;
  }

  source(): string {
    return 'env:APP_ENCRYPTION_KEY';
  }
}
