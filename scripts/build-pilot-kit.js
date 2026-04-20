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
const installerDir = path.join(STAGING, 'installer');
if (!NO_INSTALLER) {
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
// Dogfood [MAJOR-02] · 原 markdown 内部链接会断 (INSTALLATION.md 等 → 01-安装部署手册.md)
// · 复制时 rewrite
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
const zhLinkRewrites = {
  'INSTALLATION.md': '01-安装部署手册.md',
  'QUICK-START.md': '02-30分钟快速启动.md',
  'DEPLOYMENT-MODES.md': '03-部署模式-3档.md',
  'TROUBLESHOOTING.md': '04-故障排查.md',
  'ONBOARDING-VIDEO-SCRIPT.md': '05-视频脚本.md',
  'KNOWN-LIMITATIONS-V1.md': '06-V1已知限制.md',
  'RECRUITMENT-PACK.md': '07-Pilot招募包.md',
  'FEEDBACK-COLLECTION.md': '08-反馈收集模板.md',
};
function rewriteMdLinks(content, rewrites) {
  let out = content;
  for (const [from, to] of Object.entries(rewrites)) {
    // Match any ](...FROM) closing with FROM as the filename portion
    // Covers: ](./FROM) ](../FROM) ](FROM) ](docs/FROM) etc.
    const escFrom = from.replace(/\./g, '\\.');
    const re = new RegExp(`\\]\\(([^)]*?)${escFrom}\\)`, 'g');
    out = out.replace(re, () => `](./${to})`);
  }
  return out;
}
function copyMarkdownWithRewrite(src, dst, rewrites) {
  if (!fs.existsSync(src)) {
    console.log(`  ⚠ skip (missing): ${path.relative(REPO_ROOT, src)}`);
    return false;
  }
  ensureDir(path.dirname(dst));
  const src_content = fs.readFileSync(src, 'utf-8');
  const rewritten = rewriteMdLinks(src_content, rewrites);
  fs.writeFileSync(dst, rewritten, 'utf-8');
  return true;
}
let zhCount = 0;
for (const [src, dst] of zhMap) {
  if (copyMarkdownWithRewrite(path.join(REPO_ROOT, src), path.join(zhDir, dst), zhLinkRewrites)) zhCount++;
}
console.log(`  ✓ 中文 docs · ${zhCount} files (links rewritten)`);

// ── 3. English docs ──
const enDir = path.join(STAGING, 'docs', 'en');
ensureDir(enDir);
const enMap = [
  ['docs/user-guide/INSTALLATION.en.md', '01-installation.md'],
  ['docs/user-guide/QUICK-START.en.md',   '02-quick-start.md'],
  ['docs/user-guide/DEPLOYMENT-MODES.en.md', '03-deployment-modes.md'],
  ['docs/user-guide/TROUBLESHOOTING.en.md', '04-troubleshooting.md'],
];
const enLinkRewrites = {
  'INSTALLATION.en.md': '01-installation.md',
  'QUICK-START.en.md': '02-quick-start.md',
  'DEPLOYMENT-MODES.en.md': '03-deployment-modes.md',
  'TROUBLESHOOTING.en.md': '04-troubleshooting.md',
};
let enCount = 0;
for (const [src, dst] of enMap) {
  if (copyMarkdownWithRewrite(path.join(REPO_ROOT, src), path.join(enDir, dst), enLinkRewrites)) enCount++;
}
console.log(`  ✓ English docs · ${enCount} files (links rewritten)`);

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
// Dogfood fix:
//   MAJOR-05 · rc2 无 installer · 加显眼警告
//   MAJOR-06 · VPS URL placeholder 提示
//   MINOR-10 · 本地时间 + UTC 标注
//   MINOR-11 · 视频脚本是产品方用 · 客户可跳
const isPreviewBuild = !fs.existsSync(path.join(installerDir, 'WAhubX-Setup-' + VERSION + '.exe'));
const previewBanner = isPreviewBuild
  ? `
!!! WARNING - PREVIEW BUILD (${VERSION}) !!!
================================================
本 RC (Release Candidate) 包不含 installer/WAhubX-Setup-*.exe.
仅供预览文档 + 跑 scripts/validate-env.ps1 预检.
真正的安装包 (WAhubX-Setup-v1.0.0.exe ~300MB) 将在 v1.0.0 GA 时随 kit 一起发布.

如果你是 pilot 客户提前收到此包 · 请:
  1. 读完 docs/中文/ 下 9 份文档 · 建立预期
  2. 跑 scripts/validate-env.ps1 · 确认机器 ready
  3. 反馈任何文档不清的地方 (见 docs/中文/08-反馈收集模板.md)
  4. 等产品方发 GA 包再真正安装
================================================

`
  : '';

const nowUtc = new Date();
const nowLocal = new Date(nowUtc.getTime() + 8 * 60 * 60 * 1000); // MY = UTC+8
const welcome = `WAhubX Pilot Kit · ${VERSION}
================================
${previewBanner}
欢迎 · 谢谢你加入 WAhubX pilot!

这个包里有你装机需要的所有东西 (真 GA 包会含 installer · 当前 RC 是文档+脚本).

第一步做什么
------------
1. 读 docs/中文/00-文档索引.md · 了解整体结构
2. 读 docs/中文/02-30分钟快速启动.md · 最短路径上手
3. 装机前 · 运行 scripts/validate-env.ps1 (预检 9 项)
   · 命令 · powershell -ExecutionPolicy Bypass -File scripts\\validate-env.ps1
   · (PowerShell 7 用户可直接 · pwsh scripts\\validate-env.ps1)
4. (GA 包才有) 装 installer/WAhubX-Setup-v1.0.0.exe
5. 遇到任何问题 · 查 docs/中文/04-故障排查.md

不会英文没关系
--------------
所有关键文档中文齐全. docs/en/ 下是 4 份英文翻译 (给需要的人用).

视频教程
--------
docs/中文/05-视频脚本.md 是**产品方录屏用的分镜** · 客户可跳 · 真视频 GA 时附.

报告 bug
--------
参 docs/中文/08-反馈收集模板.md 的 Bug Report 格式 · 发给客服.

合同
----
docs/contract/ 目录 · 最终版由律师审阅后提供. 商务条款另行沟通.

核心原则 (付费全可选)
---------------------
你只需为 License Key 付费 · 其他 (代理 · AI API · 语音云) 全部可选.
零额外开销也能跑 · 见 docs/中文/03-部署模式-3档.md 的 "Mode A · 全免费".

所有 USD 报价都是 USD · 币种若歧义以 USD 为准.

VPS License 服务器 URL
----------------------
由客服配置 · 激活时需网络连通. 具体 URL 联系客服获取.
 (客服: [你的 WhatsApp / Telegram 号])

祝你顺利!
WAhubX 团队

版本 · ${VERSION}
构建时间 · ${nowLocal.toISOString().replace('Z', '+08:00')} (MY local · UTC+8)
构建时间 · ${nowUtc.toISOString()} (UTC 参考)
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
