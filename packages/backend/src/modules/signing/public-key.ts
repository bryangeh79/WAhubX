// M11 Day 2 · Ed25519 升级公钥 · 硬编码进 backend + installer 双处
//
// 用途: 校验 `.wupd` manifest 的 ed25519 签名 · 拒绝未授权 / 篡改过的升级包
//
// 私钥管理 (产品层 · 非代码 scope):
//   - 离线单机保存 · 绝不入仓库
//   - 生成命令 (一次性):
//       openssl genpkey -algorithm ed25519 -out wahubx-update-private.pem
//       openssl pkey -in wahubx-update-private.pem -pubout -out wahubx-update-public.pem
//     或 Node:
//       const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
//       // publicKey.export({ format: 'der', type: 'spki' }).slice(-32).toString('hex')
//
//   - 签名命令 (每发版):
//       node scripts/sign-wupd.js wahubx-v0.11.0.wupd wahubx-update-private.pem
//
// 公钥轮换 (罕见场景):
//   - 若发生私钥泄漏 · 所有后续 .wupd 必须换新密钥对签
//   - 旧版本 backend / installer **无法**验证新签名 · 用户必须手动升级到过渡版 (带双公钥的一次性桥接版)
//   - 设计边缘 · V1 假定私钥不会泄漏 · 物理保管得当
//
// 当前值: **dev placeholder** (全 0) · 本地开发 · 不验真签名 · UT 用临时生成对
//   生产发布前必须换成真公钥 · build.bat 加检查步骤 · 全 0 拒绝进 production build

/** 32B Ed25519 公钥 · hex 编码 (64 hex 字符)
 *
 * **M11 Day 5 smoke 用 dev key** · 对应 keys/privkey.pem (gitignored)
 * Production 发布前生成新的 keypair · 替换此 hex · 重 build.
 *
 * 当前 dev key 公钥 (2026-04-20 生成):
 */
export const WAHUBX_UPDATE_PUBLIC_KEY_HEX =
  '3dfd279320bee09e67a5dc6a2fd8268e4cd65edb2b7edb15632709c36260e78f';

/** 判断当前是否为 dev 占位公钥 (全 0) · production build 必须替换 */
export function isDevPlaceholderKey(): boolean {
  return /^0+$/.test(WAHUBX_UPDATE_PUBLIC_KEY_HEX);
}

/** 获取 DER 格式 publicKey buffer (Ed25519 SPKI 前缀 12B + 32B raw) · node crypto.verify 要 DER */
export function getUpdatePublicKeyDer(hexOverride?: string): Buffer {
  const hex = hexOverride ?? WAHUBX_UPDATE_PUBLIC_KEY_HEX;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`Ed25519 public key 必须 64 hex 字符, got ${hex.length}`);
  }
  // Ed25519 SPKI DER prefix: 302a300506032b6570032100 (12 bytes · 固定, 标识 curve)
  const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
  return Buffer.concat([SPKI_PREFIX, Buffer.from(hex, 'hex')]);
}
