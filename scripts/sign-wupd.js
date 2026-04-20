#!/usr/bin/env node
/**
 * WAhubX .wupd Signing CLI (M11 Day 5 准备)
 *
 * 用途: CI / 发版脚本调 · 用 Ed25519 私钥签 .wupd manifest · 写回完整签名 .wupd
 *
 * 安全约束:
 *   - 私钥文件只在本脚本 runtime 读 · 不落日志
 *   - 私钥路径必须从命令行 / env 传入 · 脚本**不**硬编码
 *   - 公钥 hex 输出给用户 · 贴到 packages/backend/src/modules/signing/public-key.ts
 *
 * 使用:
 *
 *   # 1. 一次性生成密钥对 (不入仓库!)
 *   node scripts/sign-wupd.js genkey --out-dir ~/wahubx-signing-keys/
 *     → 输出 privkey.pem + pubkey.pem + pubkey.hex
 *     → 把 pubkey.hex 内容复制到 WAHUBX_UPDATE_PUBLIC_KEY_HEX (public-key.ts)
 *
 *   # 2. 签名 .wupd
 *   node scripts/sign-wupd.js sign \
 *     --wupd ./WAhubX-0.11.0-m11.wupd \
 *     --privkey ~/wahubx-signing-keys/privkey.pem
 *     → 就地覆写 .wupd (填入 signature 字段 + 重算 magic/manifest)
 *
 *   # 3. 验证 (sanity check)
 *   node scripts/sign-wupd.js verify \
 *     --wupd ./WAhubX-0.11.0-m11.wupd \
 *     --pubkey-hex <64-hex-chars>
 *     → 打印 signature_valid + manifest 内容
 *
 * .wupd 格式见: packages/backend/src/modules/update/wupd-codec.ts
 */

'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const WUPD_MAGIC = Buffer.from('WUPD', 'utf8');
const WUPD_VERSION = 0x01;

// ── 工具 ──────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]?.replace(/^--/, '');
    if (!k) continue;
    out[k] = argv[i + 1];
  }
  return out;
}

function canonicalSerialize(manifest) {
  const clone = { ...manifest };
  delete clone.signature;
  return Buffer.from(JSON.stringify(sortKeys(clone)), 'utf-8');
}

function sortKeys(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortKeys);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
  return out;
}

function parseWupd(buf) {
  if (buf.length < 12) throw new Error('WUPD_TOO_SHORT');
  if (!buf.subarray(0, 4).equals(WUPD_MAGIC)) throw new Error('WUPD_MAGIC_MISMATCH');
  if (buf[4] !== WUPD_VERSION) throw new Error(`WUPD_VERSION_UNSUPPORTED · ${buf[4]}`);
  const manifestLen = buf.readUInt32BE(8);
  const manifestJson = buf.subarray(12, 12 + manifestLen).toString('utf-8');
  return {
    manifest: JSON.parse(manifestJson),
    innerZipOffset: 12 + manifestLen,
    headerBuf: buf.subarray(0, 12 + manifestLen),
    innerZip: buf.subarray(12 + manifestLen),
  };
}

function buildWupd(manifest, innerZip) {
  const manifestJson = Buffer.from(JSON.stringify(manifest), 'utf-8');
  const manifestLen = Buffer.alloc(4);
  manifestLen.writeUInt32BE(manifestJson.length, 0);
  return Buffer.concat([
    WUPD_MAGIC,
    Buffer.from([WUPD_VERSION]),
    Buffer.from([0, 0, 0]),
    manifestLen,
    manifestJson,
    innerZip,
  ]);
}

// ── 命令: genkey ──────────────────────────────
function cmdGenkey(args) {
  const outDir = args['out-dir'] || process.cwd();
  fs.mkdirSync(outDir, { recursive: true });

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ format: 'pem', type: 'spki' });
  const privPem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  const pubDer = publicKey.export({ format: 'der', type: 'spki' });
  const pubHex = pubDer.subarray(-32).toString('hex');

  const privPath = path.join(outDir, 'privkey.pem');
  const pubPath = path.join(outDir, 'pubkey.pem');
  const pubHexPath = path.join(outDir, 'pubkey.hex');

  fs.writeFileSync(privPath, privPem, { mode: 0o600 });
  fs.writeFileSync(pubPath, pubPem);
  fs.writeFileSync(pubHexPath, pubHex);

  console.log('✓ Ed25519 keypair generated');
  console.log(`  private: ${privPath} (mode 0600 · 务必离线保管 · 勿入仓库)`);
  console.log(`  public:  ${pubPath}`);
  console.log(`  hex:     ${pubHexPath}`);
  console.log('');
  console.log('下一步: 把 pubkey.hex 内容填入');
  console.log('  packages/backend/src/modules/signing/public-key.ts');
  console.log('  WAHUBX_UPDATE_PUBLIC_KEY_HEX = "...";');
  console.log('');
  console.log(`pubkey.hex: ${pubHex}`);
}

// ── 命令: sign ────────────────────────────────
function cmdSign(args) {
  if (!args.wupd || !args.privkey) {
    console.error('usage: sign --wupd <path> --privkey <pem path>');
    process.exit(2);
  }

  const wupdBuf = fs.readFileSync(args.wupd);
  const parsed = parseWupd(wupdBuf);
  const manifest = parsed.manifest;

  const privPem = fs.readFileSync(args.privkey);
  const privKey = crypto.createPrivateKey({ key: privPem, format: 'pem' });
  if (privKey.asymmetricKeyType !== 'ed25519') {
    console.error(`ERROR: 私钥不是 Ed25519 (got ${privKey.asymmetricKeyType})`);
    process.exit(3);
  }

  const canonical = canonicalSerialize(manifest);
  const sigBuf = crypto.sign(null, canonical, privKey);
  if (sigBuf.length !== 64) {
    console.error(`ERROR: 签名长度异常 ${sigBuf.length}B (应 64B)`);
    process.exit(4);
  }

  manifest.signature = `ed25519:${sigBuf.toString('base64url')}`;

  const signed = buildWupd(manifest, parsed.innerZip);
  fs.writeFileSync(args.wupd, signed);

  console.log(`✓ .wupd signed`);
  console.log(`  file:      ${args.wupd}`);
  console.log(`  signature: ${manifest.signature.slice(0, 50)}...`);
  console.log(`  bytes:     ${signed.length}`);
}

// ── 命令: verify ──────────────────────────────
function cmdVerify(args) {
  if (!args.wupd || !args['pubkey-hex']) {
    console.error('usage: verify --wupd <path> --pubkey-hex <64 hex chars>');
    process.exit(2);
  }

  const wupdBuf = fs.readFileSync(args.wupd);
  const { manifest } = parseWupd(wupdBuf);
  if (!manifest.signature) {
    console.error('ERROR: .wupd 未签名 (manifest.signature 缺)');
    process.exit(3);
  }

  const hex = args['pubkey-hex'];
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    console.error('ERROR: pubkey-hex 必须 64 hex 字符');
    process.exit(4);
  }

  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  const pubDer = Buffer.concat([spkiPrefix, Buffer.from(hex, 'hex')]);
  const pubKey = crypto.createPublicKey({ key: pubDer, format: 'der', type: 'spki' });

  const [scheme, b64] = manifest.signature.split(':');
  if (scheme !== 'ed25519') {
    console.error(`ERROR: 签名方案 ${scheme} 不支持`);
    process.exit(5);
  }
  const sigBuf = Buffer.from(b64, 'base64url');

  const canonical = canonicalSerialize(manifest);
  const ok = crypto.verify(null, canonical, pubKey, sigBuf);

  console.log(ok ? '✓ signature_valid' : '✗ signature INVALID');
  console.log('');
  console.log('Manifest:');
  console.log('  from_version: ' + manifest.from_version);
  console.log('  to_version:   ' + manifest.to_version);
  console.log('  app_sha256:   ' + (manifest.app_sha256 || '').slice(0, 16) + '...');
  console.log('  migrations:   ' + (manifest.migrations || []).length);
  console.log('  created_at:   ' + manifest.created_at);

  process.exit(ok ? 0 : 1);
}

// ── main ──────────────────────────────────────
const [, , cmd, ...rest] = process.argv;
const args = parseArgs(rest);

switch (cmd) {
  case 'genkey':
    cmdGenkey(args);
    break;
  case 'sign':
    cmdSign(args);
    break;
  case 'verify':
    cmdVerify(args);
    break;
  default:
    console.log('Usage:');
    console.log('  node scripts/sign-wupd.js genkey --out-dir <dir>');
    console.log('  node scripts/sign-wupd.js sign   --wupd <path> --privkey <pem path>');
    console.log('  node scripts/sign-wupd.js verify --wupd <path> --pubkey-hex <64 hex>');
    process.exit(cmd ? 1 : 0);
}
