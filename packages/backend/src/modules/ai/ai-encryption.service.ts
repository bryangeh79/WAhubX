import * as crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { MASTER_KEY_PROVIDER, type MasterKeyProvider } from './master-key.provider';

// AES-256-GCM 对 API key 加解密
//   format = "gcm:v1:{iv_hex}:{ciphertext_hex}:{authtag_hex}"
//   每次加密独立 IV (12 bytes 随机), 防重放
//   authtag 16 bytes, 解密时校验, 篡改抛错
// 密钥旋转 (rotate) 策略: v1 已定, 将来 v2 换算法时共存版本号, 读时按 v 分派
@Injectable()
export class AiEncryptionService {
  private static readonly IV_LEN = 12;
  private static readonly VERSION = 'gcm:v1';

  constructor(
    @Inject(MASTER_KEY_PROVIDER) private readonly keyProvider: MasterKeyProvider,
  ) {}

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(AiEncryptionService.IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.keyProvider.getKey(), iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      AiEncryptionService.VERSION,
      iv.toString('hex'),
      enc.toString('hex'),
      tag.toString('hex'),
    ].join(':');
  }

  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 5) {
      throw new Error(`invalid ciphertext format (expect 5 parts, got ${parts.length})`);
    }
    const [algo, version, ivHex, encHex, tagHex] = parts;
    if (algo !== 'gcm' || version !== 'v1') {
      throw new Error(`unsupported ciphertext version: ${algo}:${version}`);
    }
    const iv = Buffer.from(ivHex, 'hex');
    const enc = Buffer.from(encHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.keyProvider.getKey(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  }

  /**
   * UI 显示用脱敏 (e.g. sk-abc123... → sk-ab***123). 不走日志这条路由
   * (日志的 redact 由 pino 那边做), 这里是"安全可视化".
   */
  maskKey(plaintext: string): string {
    if (!plaintext) return '';
    if (plaintext.length <= 8) return '***';
    return `${plaintext.slice(0, 4)}***${plaintext.slice(-3)}`;
  }
}
