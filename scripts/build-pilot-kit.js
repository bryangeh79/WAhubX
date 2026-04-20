#!/usr/bin/env node
/**
 * scripts/build-pilot-kit.js · Cascade [32]
 *
 * 打包给 pilot 客户的 zip 包 · 一键交付
 *
 * 内容:
 *   installer/ 若存在 WAhubX-Setup-v*.exe · copy (可选)
 *   docs/中文/                     9 个中文核心 doc
 *   docs/en/                        4 英文翻译
 *   docs/video/VIDEO-SCRIPT.md     拍摄脚本
 *   docs/contract/                 合同模板 (⚠ 律师审阅待)
 *   scripts/                       validate-env.ps1 + demo-fixtures.sql
 *   README.txt                     欢迎信 + 首步指引
 *
 * 输出:
 *   build/pilot-kit-v1.0.0.zip
 *
 * 用法:
 *   node scripts/build-pilot-kit.js
 *   node scripts/build-pilot-kit.js --version=v1.0.0
 *   node scripts/build-pilot-kit.js --no-installer   # 暂不附 .exe
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync, spawnSync } = require('node:child_process');

// ── args ──
const args = process.argv.slice(2);
function getArg(name, def) {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
}
const VERSION = getArg('version', 'v1.0.0-rc2');
const NO_INSTALLER = args.includes('--no-installer');
const OUT_DIR = getArg('out', path.join(__dirname, '..', 'build'));

const REPO_ROOT = path.join(__dirname, '..');
const STAGING = path.join(OUT_DIR, `pilot-kit-${VERSION}-staging`);
const ZIP_OUT = path.join(OUT_DIR, `pilot-kit-${VERSION}.zip`);

console.log(`=== Pilot Kit Builder · ${VERSION} ===\n`);
console.log(`Repo root: ${REPO_ROOT}`);
console.log(`Output   : ${ZIP_OUT}\n`);

// ── helpers ──
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function copyFile(src, dst) {
  ensureDir(path.dirname(dst));
  if (!fs.existsSync(src)) {
    console.log(`  ⚠ skip (missing): ${path.relative(REPO_ROOT, src)}`);
    return false;
  }
  fs.copyFileSync(src, dst);
  return true;
}
function copyDir(src, dst) {
  if (!fs.existsSync(src)) return 0;
  ensureDir(dst);
  let count = 0;
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const d = path.join(dst, item);
    if (fs.statSync(s).isDirectory()) count += copyDir(s, d);
    else { fs.copyFileSync(s, d); count++; }
  }
  return count;
}

// ── clean staging ──
if (fs.existsSync(STAGING)) {
  fs.rmSync(STAGING, { recursive: true, force: true });
}
ensureDir(STAGING);

// ── 1. installer ──
if (!NO_INSTALLER) {
  const installerDir = path.join(STAGING, 'installer');
  ensureDir(installerDir);
  const exeSearch = path.join(REPO_ROOT, 'installer', 'output');
  let exeFound = false;
  if (fs.existsSync(exeSearch)) {
    for (const f of fs.readdirSync(exeSearch)) {
      if (f.endsWith('.exe')) {
        fs.copyFileSync(path.join(exeSearch, f), path.join(installerDir, f));
        console.log(`  ✓ installer · ${f}`);
        exeFound = true;
      }
    }
  }
  if (!exeFound) {
    // 写说明文件
    fs.writeFileSync(
      path.join(installerDir, 'PLACEHOLDER-installer-not-built.txt'),
      'installer/output/WAhubX-Setup-*.exe 未构建 · 见 installer/build.bat\n' +
      '装机前运行: pwsh scripts/validate-env.ps1 (pre-flight check)\n' +
      '构建后重跑: node scripts/build-pilot-kit.js\n',
    );
    console.log(`  ⚠ installer · PLACEHOLDER (未 build · 参 installer/build.bat)`);
  }
}

// ── 2. 中文 docs ──
const zhDir = path.join(STAGING, 'docs', '中文');
ensureDir(zhDir);
const zhMap = [
  ['docs/user-guide/INSTALLATION.md', '01-安装部署手册.md'],
  ['docs/user-guide/QUICK-START.md',   '02-30分钟快速启动.md'],
  ['docs/user-guide/DEPLOYMENT-MODES.md', '03-部署模式-3档.md'],
  ['docs/user-guide/TROUBLESHOOTING.md', '04-故障排查.md'],
  ['docs/user-guide/ONBOARDING-VIDEO-SCRIPT.md', '05-视频脚本.md'],
  ['docs/user-guide/README.md', '00-文档索引.md'],
  ['docs/KNOWN-LIMITATIONS-V1.md', '06-V1已知限制.md'],
  ['docs/pilot/RECRUITMENT-PACK.md', '07-Pilot招募包.md'],
  ['docs/pilot/FEEDBACK-COLLECTION.md', '08-反馈收集模板.md'],
];
let zhCount = 0;
for (const [src, dst] of zhMap) {
  if (copyFile(path.join(REPO_ROOT, src), path.join(zhDir, dst))) zhCount++;
}
console.log(`  ✓ 中文 docs · ${zhCount} files`);

// ── 3. English docs ──
const enDir = path.join(STAGING, 'docs', 'en');
ensureDir(enDir);
const enMap = [
  ['docs/user-guide/INSTALLATION.en.md', '01-installation.md'],
  ['docs/user-guide/QUICK-START.en.md',   '02-quick-start.md'],
  ['docs/user-guide/DEPLOYMENT-MODES.en.md', '03-deployment-modes.md'],
  ['docs/user-guide/TROUBLESHOOTING.en.md', '04-troubleshooting.md'],
];
let enCount = 0;
for (const [src, dst] of enMap) {
  if (copyFile(path.join(REPO_ROOT, src), path.join(enDir, dst))) enCount++;
}
console.log(`  ✓ English docs · ${enCount} files`);

// ── 4. Contract (律师审阅待) ──
const contractDir = path.join(STAGING, 'docs', 'contract');
ensureDir(contractDir);
const contractNote = `# Pilot Agreement Template · 律师审阅待

> ⚠ 重要说明
>
> 本目录下合同模板为**非法律专业起草** · V1 发布前**必须经马来西亚本地律师审阅**.
>
> 特别注意:
>   - PDPA 2010 合规条款
>   - WhatsApp ToS 风险告知 (客户自担责)
>   - License 绑定 · 硬件变更条款
>   - 免责 + 争议解决
>
> 具体合同条款 · 价格 · 服务范围 · 由商务决策 · 不由本文档提供.

参考来源 · docs/pilot/RECRUITMENT-PACK.md §5

律师 signoff 后 · 把正式版 PDF 放入此目录取代本说明文件.
`;
fs.writeFileSync(path.join(contractDir, 'README.md'), contractNote);
console.log(`  ⚠ contract · 占位 README (律师审阅待)`);

// ── 5. scripts ──
const scriptsDir = path.join(STAGING, 'scripts');
ensureDir(scriptsDir);
copyFile(path.join(REPO_ROOT, 'scripts', 'validate-env.ps1'), path.join(scriptsDir, 'validate-env.ps1'));
copyFile(path.join(REPO_ROOT, 'scripts', 'demo-fixtures.sql'), path.join(scriptsDir, 'demo-fixtures.sql'));
console.log(`  ✓ scripts · validate-env.ps1 + demo-fixtures.sql`);

// ── 6. README.txt · 欢迎信 ──
const welcome = `WAhubX Pilot Kit · ${VERSION}
================================

欢迎 · 谢谢你加入 WAhubX pilot!

这个包里有你装机需要的所有东西.

第一步做什么
------------
1. 读 docs/中文/00-文档索引.md · 了解整体结构
2. 读 docs/中文/02-30分钟快速启动.md · 最短路径上手
3. 装机前 · 运行 scripts/validate-env.ps1 (预检 9 项)
4. 装 installer/WAhubX-Setup-*.exe (如果包含)
5. 遇到任何问题 · 查 docs/中文/04-故障排查.md

不会英文没关系
--------------
所有关键文档中文齐全. docs/en/ 下是 4 份英文翻译 · 给需要的人用.

视频教程
--------
docs/中文/05-视频脚本.md 是录屏分镜脚本 · 后期我们会把实际视频附上.

报告 bug
--------
参 docs/中文/08-反馈收集模板.md 的 Bug Report 格式 · 发给客服.

合同
----
docs/contract/ 目录 · 最终版由律师审阅后提供. 商务条款另行沟通.

核心原则
--------
你只需为 License Key 付费 · 其他 (代理 · AI API · 语音云) 全部可选.
零额外开销也能跑 · 见 docs/中文/03-部署模式-3档.md 的 "Mode A · 全免费".

祝你顺利!
WAhubX 团队

版本 · ${VERSION}
构建时间 · ${new Date().toISOString()}
`;
fs.writeFileSync(path.join(STAGING, 'README.txt'), welcome);
console.log(`  ✓ README.txt 欢迎信`);

// ── 7. zip ──
console.log(`\n打包 zip ...`);
ensureDir(OUT_DIR);
if (fs.existsSync(ZIP_OUT)) fs.unlinkSync(ZIP_OUT);

// 用 PowerShell Compress-Archive · spawnSync 避免 shell quoting
let zipped = false;
try {
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-Command',
      `Compress-Archive -Path "${STAGING}/*" -DestinationPath "${ZIP_OUT}" -Force`],
    { stdio: 'pipe' },
  );
  if (r.status === 0) {
    zipped = true;
  } else {
    console.log(`  powershell zip failed (exit ${r.status}): ${r.stderr?.toString().slice(0, 200)}`);
  }
} catch (err) {
  console.log(`  powershell spawn failed: ${err.message}`);
}

if (!zipped) {
  // fallback · tar.gz (Git Bash 自带 tar)
  console.log(`  fallback · tar.gz`);
  try {
    const tarOut = ZIP_OUT.replace(/\.zip$/, '.tar.gz');
    const r = spawnSync('tar', ['-czf', tarOut, '-C', STAGING, '.'], { stdio: 'pipe' });
    if (r.status === 0) {
      // rename zip path var for reporting
      fs.renameSync(tarOut, tarOut); // no-op · 保持 var 命名一致
      console.log(`  ✓ tar.gz: ${tarOut}`);
      global._actualOut = tarOut;
      zipped = true;
    } else {
      console.error(`  tar failed: ${r.stderr?.toString().slice(0, 200)}`);
    }
  } catch (err) {
    console.error(`  tar spawn failed: ${err.message}`);
  }
}

if (!zipped) {
  throw new Error('无法打包 · PowerShell + tar 都失败');
}

const actualOut = global._actualOut ?? ZIP_OUT;
const stat = fs.statSync(actualOut);
console.log(`\n=== DONE ===`);
console.log(`  output : ${actualOut}`);
console.log(`  size   : ${(stat.size / 1024).toFixed(1)} KB`);
console.log(`  version: ${VERSION}`);
console.log(`\n交付给 pilot 客户前:`);
console.log(`  1. 律师审阅合同 → 放入 docs/contract/`);
console.log(`  2. (可选) 拍 video → 附入 docs/中文/`);
console.log(`  3. 构建 installer → 重跑 build-pilot-kit.js`);
console.log(`  4. 最终 zip SHA-256 · 给客户一同发送`);

// cleanup staging
fs.rmSync(STAGING, { recursive: true, force: true });
