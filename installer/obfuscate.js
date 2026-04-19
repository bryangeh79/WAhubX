/**
 * WAhubX Backend Code Obfuscation
 *
 * 选择性混淆 license / auth / machine-id 关键文件, 保护:
 *   - License Key 生成 / 激活 / 校验逻辑
 *   - 机器指纹计算 (防绕过 machine binding)
 *   - 用户密码 hash / 锁定策略 (降低逆向价值)
 *
 * 不混淆 Nest controller / entity / DTO — DI 反射要求类名保留.
 * 不混淆 nestjs-pino / TypeORM metadata — 会炸运行时.
 *
 * 用法: node obfuscate.js [--backend-dist <absolute path>]
 */

const fs = require('node:fs');
const path = require('node:path');
const JavaScriptObfuscator = require('javascript-obfuscator');

// 相对 backend/dist/ 的路径. Nest 编译后保留 src/ 同样的目录结构.
const TARGET_FILES = [
  'modules/licenses/license.service.js',
  'modules/licenses/machine-id.util.js',
  'modules/auth/auth.service.js',
  'modules/auth/user-session.service.js',
  'modules/users/users.service.js',
];

// 调优: 过强会破坏 NestJS DI, 保守配置
const OBFUSCATION_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: false,              // 禁: 会炸 Node 调试器
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,                // 禁: Nest DI 依赖类名
  selfDefending: false,                // 禁: strict mode 冲突
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  transformObjectKeys: false,          // 禁: TypeORM / REST body key 必须保持
  unicodeEscapeSequence: false,
  numbersToExpressions: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
};

function resolveBackendDist() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--backend-dist');
  if (idx !== -1 && args[idx + 1]) {
    return path.resolve(args[idx + 1]);
  }
  return path.resolve(__dirname, '..', 'packages', 'backend', 'dist');
}

function obfuscateOne(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`  [SKIP] ${path.relative(process.cwd(), filePath)}`);
    return false;
  }

  const code = fs.readFileSync(filePath, 'utf-8');
  const originalSize = Buffer.byteLength(code, 'utf-8');

  const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATION_OPTIONS);
  let obfuscated = result.getObfuscatedCode();

  // 删 source map 避免反向溯源
  obfuscated = obfuscated.replace(/\/\/# sourceMappingURL=.*$/gm, '');
  fs.writeFileSync(filePath, obfuscated, 'utf-8');
  const mapFile = filePath + '.map';
  if (fs.existsSync(mapFile)) fs.unlinkSync(mapFile);

  const newSize = Buffer.byteLength(obfuscated, 'utf-8');
  const pct = ((newSize / originalSize) * 100).toFixed(0);
  console.log(
    `  [OK] ${path.basename(filePath).padEnd(32)} ${(originalSize / 1024).toFixed(1)}KB → ${(newSize / 1024).toFixed(1)}KB (${pct}%)`,
  );
  return true;
}

function main() {
  const distPath = resolveBackendDist();

  console.log('========================================');
  console.log('  WAhubX Backend Obfuscation');
  console.log('========================================');
  console.log(`dist: ${distPath}`);
  console.log('');

  if (!fs.existsSync(distPath)) {
    console.error(`ERROR: backend dist 不存在: ${distPath}`);
    console.error('先跑: pnpm --filter @wahubx/backend build');
    process.exit(1);
  }

  let ok = 0;
  let skip = 0;
  for (const rel of TARGET_FILES) {
    const full = path.join(distPath, rel);
    if (obfuscateOne(full)) ok++;
    else skip++;
  }

  console.log('');
  console.log(`完成: ${ok} 文件已混淆, ${skip} 跳过`);
  console.log('========================================');

  if (ok === 0) {
    console.error('ERROR: 没有文件被混淆, 检查 TARGET_FILES 路径是否对应当前 dist 结构');
    process.exit(1);
  }
}

main();
