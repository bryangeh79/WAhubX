// M11 Day 2 · Ed25519 签名服务
//
// 用途 (**开发/发版**机器上才用):
//   - CI / 发版脚本调 · 给 `.wupd` manifest 签名
//   - 私钥路径由 env / 命令行参数传入 · 运行时绝不硬编码
//
// **不**在 production backend 里调用 · 只 verifier 在 production 跑

import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import type { WupdManifest } from './types';
import { buildSignatureField, canonicalSerialize } from './manifest-codec';

@Injectable()
export class Ed25519SignerService {
  private readonly logger = new Logger(Ed25519SignerService.name);

  /**
   * 用 Ed25519 私钥签 manifest · 返完整带 signature 字段的 manifest
   *
   * @param manifest 不含 signature (传入含也会被覆盖 · canonical 序列化时跳过 signature)
   * @param privateKeyPem Ed25519 私钥 PEM (PKCS#8 格式 · openssl genpkey 输出)
   *
   * @returns 新 manifest · signature 字段已填
   */
  sign(manifest: WupdManifest, privateKeyPem: string | Buffer): WupdManifest {
    const payload = canonicalSerialize(manifest);
    const privateKey = crypto.createPrivateKey({
      key: privateKeyPem,
      format: 'pem',
    });
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error(
        `私钥必须是 Ed25519, got ${privateKey.asymmetricKeyType ?? 'unknown'}`,
      );
    }
    // Ed25519: crypto.sign() 第一参 algorithm 必须 null (Ed25519 自带 hash)
    const sigBuf = crypto.sign(null, payload, privateKey);
    if (sigBuf.length !== 64) {
      throw new Error(`签名长度异常 ${sigBuf.length}B (应 64B)`);
    }
    const signed: WupdManifest = {
      ...manifest,
      signature: buildSignatureField(sigBuf),
    };
    this.logger.log(
      `.wupd manifest signed · from=${manifest.from_version} to=${manifest.to_version} · sig=${signed.signature!.slice(0, 30)}…`,
    );
    return signed;
  }

  /**
   * 生成新 Ed25519 密钥对 (一次性发版用)
   * 返 PEM 格式便于保存/传输 · 不在 production 跑
   */
  static generateKeyPair(): {
    publicKeyPem: string;
    privateKeyPem: string;
    publicKeyHex: string;
  } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    // 从 DER SPKI 提 32B raw public key
    const publicDer = publicKey.export({ format: 'der', type: 'spki' });
    const publicKeyHex = publicDer.subarray(-32).toString('hex');
    return { publicKeyPem, privateKeyPem, publicKeyHex };
  }
}
