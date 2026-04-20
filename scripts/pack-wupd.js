#!/usr/bin/env node
/**
 * WAhubX .wupd Packer (M11 Day 5 准备)
 *
 * 组装 .wupd 升级包: magic + manifest + inner zip (app.tar + migrations/*)
 *
 * 与 sign-wupd.js 配合:
 *   pack-wupd.js 生成**未签名**的 .wupd → sign-wupd.js sign 填 signature 字段
 *
 * 使用:
 *   node scripts/pack-wupd.js \
 *     --from 0.10.0-m10 --to 0.11.0-m11 \
 *     --app-tar ./staging/app.tar \
 *     --migrations "./migrations-to-include/*.sql" \
 *     --out ./output/WAhubX-0.11.0-m11.wupd
 *
 *   [--health-endpoint /api/v1/health] [--health-timeout 60] [--health-status 200]
 *   [--rollback restore_pre_update_snapshot] (当前仅此策略)
 *   [--notes "..."]  (不进 manifest · 仅 console 输出)
 *
 * 依赖 archiver (backend node_modules 复用 · 从仓库根跑):
 *   cd <repo-root> && node scripts/pack-wupd.js ...
 *   实现自行 require('archiver') · 若缺报错指引 pnpm install
 */

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const WUPD_MAGIC = Buffer.from('WUPD', 'utf8');
const WUPD_VERSION = 0x01;

// ── archiver 按需 require · 尝试多个路径 ──────────────
let archiver;
const archiverPaths = [
  'archiver', // 标准 resolve
  path.resolve(__dirname, '..', 'packages', 'backend', 'node_modules', 'archiver'),
  path.resolve(__dirname, '..', 'node_modules', 'archiver'),
];
for (const p of archiverPaths) {
  try {
    archiver = require(p);
    break;
  } catch {
    // try next
  }
}
if (!archiver) {
  console.error('ERROR: archiver 未安装. 从 repo root 跑:');
  console.error('  cd packages/backend && pnpm install');
  console.error('然后 从 repo root 跑: node scripts/pack-wupd.js ...');
  console.error('(archiver 是 backend 依赖 · pack-wupd 脚本自动 fallback 到 packages/backend/node_modules)');
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]?.replace(/^--/, '');
    if (!k) continue;
    out[k] = argv[i + 1];
  }
  return out;
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function expandGlob(pattern) {
  // 简单 glob 支持 · 只处理 */?
  // 正式 glob 需 glob pkg · 避免依赖 · 这里手搓
  if (!pattern.includes('*') && !pattern.includes('?')) {
    return fs.existsSync(pattern) ? [pattern] : [];
  }
  const dir = path.dirname(pattern);
  const baseGlob = path.basename(pattern);
  if (!fs.existsSync(dir)) return [];
  const re = new RegExp(
    '^' + baseGlob.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
  );
  return fs
    .readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => path.join(dir, f))
    .sort();
}

function buildInnerZip(appTar, migrations) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver.create('zip', { zlib: { level: 6 } });
    archive.on('data', (c) => chunks.push(c));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.on('warning', (err) => console.warn('[archiver warn]', err.message));
    archive.append(appTar, { name: 'app.tar' });
    for (const [name, buf] of migrations) {
      archive.append(buf, { name: `migrations/${name}.sql` });
    }
    archive.finalize();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const required = ['from', 'to', 'app-tar', 'out'];
  for (const k of required) {
    if (!args[k]) {
      console.error(`ERROR: 缺参数 --${k}`);
      console.error('Usage: node scripts/pack-wupd.js --from X --to Y --app-tar P --out O');
      console.error('         [--migrations "glob"] [--health-endpoint ...] [--notes ...]');
      process.exit(2);
    }
  }

  const fromVersion = args.from;
  const toVersion = args.to;
  const appTarPath = args['app-tar'];
  const outPath = args.out;
  const migrationsGlob = args.migrations; // 可选
  const healthEndpoint = args['health-endpoint'] || '/api/v1/health';
  const healthTimeout = parseInt(args['health-timeout'] || '60', 10);
  const healthStatus = parseInt(args['health-status'] || '200', 10);
  const rollbackStrategy = args.rollback || 'restore_pre_update_snapshot';

  // ── 读 app.tar ──
  if (!fs.existsSync(appTarPath)) {
    console.error(`ERROR: --app-tar ${appTarPath} 不存在`);
    process.exit(3);
  }
  const appTar = fs.readFileSync(appTarPath);

  // M7 Day 1 · 补强 3 · release blocker 级检查
  // 扫 tar 内 entry 名 · 若含 'data/' · 'data\\' · 'backups/' · 拒 pack
  // 防开发者误 include 用户数据 · 升级时覆盖客户 data/ (wipe assets 灾难)
  const suspiciousPatterns = ['data/', 'data\\', 'backups/', 'backups\\', 'keys/', '.env'];
  const tarText = appTar.toString('binary'); // 粗粒度扫 · tar 格式含 entry name 可读
  const found = suspiciousPatterns.filter((p) => tarText.includes(p));
  if (found.length > 0) {
    console.error('ERROR: app.tar 含禁止路径 · 拒 pack');
    console.error('  检测到: ' + found.join(', '));
    console.error('  app.tar 只应含 packages/backend/dist + packages/frontend/dist 等代码产物');
    console.error('  重新 tar: tar -cf app.tar -C packages/backend dist/ -C ../frontend dist/');
    console.error('  (不要 tar 整个仓库! data/ + backups/ + keys/ 是用户私密数据 · 升级会 wipe)');
    process.exit(10);
  }

  const appSha = sha256Hex(appTar);
  console.log(`✓ app.tar · ${appTar.length}B · sha=${appSha.slice(0, 16)}…`);

  // ── 扫 migrations ──
  const migrationEntries = [];
  const migrationMap = new Map();
  if (migrationsGlob) {
    const files = expandGlob(migrationsGlob);
    console.log(`  matched ${files.length} migration files from glob: ${migrationsGlob}`);
    for (const filePath of files) {
      const buf = fs.readFileSync(filePath);
      const name = path.basename(filePath).replace(/\.(ts|js|sql)$/, '');
      migrationMap.set(name, buf);
      migrationEntries.push({ name, sha256: sha256Hex(buf) });
      console.log(`    + ${name} · ${buf.length}B`);
    }
  }

  // ── 构造 manifest (无 signature) ──
  const manifest = {
    from_version: fromVersion,
    to_version: toVersion,
    app_sha256: appSha,
    migrations: migrationEntries,
    health_check: {
      endpoint: healthEndpoint,
      timeout_sec: healthTimeout,
      expect_status: healthStatus,
    },
    rollback: { strategy: rollbackStrategy },
    created_at: new Date().toISOString(),
  };

  // ── 构建 inner zip ──
  const innerZip = await buildInnerZip(appTar, migrationMap);
  console.log(`✓ inner zip · ${innerZip.length}B (app.tar + ${migrationEntries.length} migrations)`);

  // ── 组装 .wupd ──
  const manifestJson = Buffer.from(JSON.stringify(manifest), 'utf-8');
  const manifestLen = Buffer.alloc(4);
  manifestLen.writeUInt32BE(manifestJson.length, 0);
  const wupd = Buffer.concat([
    WUPD_MAGIC,
    Buffer.from([WUPD_VERSION]),
    Buffer.from([0, 0, 0]),
    manifestLen,
    manifestJson,
    innerZip,
  ]);

  // ── 写 ──
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, wupd);

  console.log(`✓ .wupd packed (unsigned) · ${outPath} · ${wupd.length}B`);
  console.log('');
  console.log('下一步:');
  console.log(`  node scripts/sign-wupd.js sign --wupd ${outPath} --privkey <path>`);
  console.log('');
  if (args.notes) console.log(`notes: ${args.notes}`);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
