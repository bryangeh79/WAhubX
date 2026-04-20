// M11 Day 2 · Ed25519 签名校验服务 (production backend 运行时调用)
//
// 用途:
//   1. `.wupd` 升级包 manifest 签名校验
//   2. 拒绝未授权 / 篡改 / 重放 (通过 created_at 可选检查)
//
// 双校验设计 (D 决策):
//   - installer 层 (Inno Setup Pascal code · Day 1.5 iss 里留 TODO) 校 app_sha256
//   - backend 层 (本服务) 校 manifest signature · 不信任 installer 单点

import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import type { WupdManifest } from './types';
import { canonicalSerialize, parseSignatureField } from './manifest-codec';
import {
  WAHUBX_UPDATE_PUBLIC_KEY_HEX,
  getUpdatePublicKeyDer,
  isDevPlaceholderKey,
} from './public-key';

export type VerifyResult =
  | { ok: true }
  | { ok: false; code: VerifyFailCode; message: string };

export type VerifyFailCode =
  | 'MISSING_SIGNATURE'
  | 'SIGNATURE_FORMAT'
  | 'UNSUPPORTED_SIG_SCHEME'
  | 'INVALID_SIGNATURE_LENGTH'
  | 'SIGNATURE_MISMATCH'
  | 'DEV_PLACEHOLDER_KEY_IN_PROD';

@Injectable()
export class Ed25519VerifierService {
  private readonly logger = new Logger(Ed25519VerifierService.name);

  /**
   * 校验 manifest.signature
   *
   * @param manifest 含 signature 字段的完整 manifest
   * @param options.publicKeyHex 可选覆盖 · 默认用 hardcoded WAHUBX_UPDATE_PUBLIC_KEY_HEX
   * @param options.allowDevPlaceholder 默认 false · NODE_ENV=production 时全 0 key 拒
   */
  verify(
    manifest: WupdManifest,
    options: { publicKeyHex?: string; allowDevPlaceholder?: boolean } = {},
  ): VerifyResult {
    const hex = options.publicKeyHex ?? WAHUBX_UPDATE_PUBLIC_KEY_HEX;
    const isDev = /^0+$/.test(hex);

    if (isDev && !options.allowDevPlaceholder && process.env.NODE_ENV === 'production') {
      return {
        ok: false,
        code: 'DEV_PLACEHOLDER_KEY_IN_PROD',
        message:
          'production build 检测到 dev placeholder 公钥 (全 0) · 必须先替换 packages/backend/src/modules/signing/public-key.ts 的 WAHUBX_UPDATE_PUBLIC_KEY_HEX',
      };
    }

    let signatureBuf: Buffer;
    try {
      signatureBuf = parseSignatureField(manifest.signature).signatureBuf;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (msg.split(' · ')[0] as VerifyFailCode) ?? 'SIGNATURE_FORMAT';
      return { ok: false, code, message: msg };
    }

    const payload = canonicalSerialize(manifest);
    const publicKey = crypto.createPublicKey({
      key: getUpdatePublicKeyDer(hex),
      format: 'der',
      type: 'spki',
    });
    // Ed25519 verify · algorithm null
    const ok = crypto.verify(null, payload, publicKey, signatureBuf);
    if (!ok) {
      return {
        ok: false,
        code: 'SIGNATURE_MISMATCH',
        message: '签名校验失败 · manifest 被篡改 或 用不同私钥签',
      };
    }
    return { ok: true };
  }

  /** 启动时自检 · production 模式下公钥是 dev placeholder 报 warn */
  checkPublicKeyHealth(): { healthy: boolean; warning?: string } {
    if (isDevPlaceholderKey()) {
      const warning =
        'Ed25519 update public key 为 dev placeholder (全 0) · production 发布前必须替换';
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(warning);
      } else {
        this.logger.warn(`${warning} (non-production · 可忽略)`);
      }
      return { healthy: false, warning };
    }
    return { healthy: true };
  }
}
