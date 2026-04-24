#!/usr/bin/env node
/* eslint-disable no-console */
// 2026-04-22 · 图片素材批量下载脚本
// 读 images-100.json · 从 Pexels 下载 · 放 data/assets/images/<pool>/<id>_<slug>.jpg

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const ROOT = path.resolve(__dirname, '..', '..');
const CATALOG = path.join(__dirname, 'images-100.json');
const OUT_ROOT = path.join(ROOT, 'packages', 'backend', 'data', 'assets', 'images');

const args = process.argv.slice(2);
const onlyPool = args.find((a) => a.startsWith('--pool='))?.split('=')[1];

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function fetch(url, outPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outPath);
    const req = https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(outPath);
        return fetch(res.headers.location, outPath).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(outPath);
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    req.on('error', (err) => {
      file.close();
      try { fs.unlinkSync(outPath); } catch {}
      reject(err);
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf-8'));
  let done = 0, skip = 0, fail = 0;

  for (const pool of catalog.pools) {
    if (onlyPool && pool.pool !== onlyPool) continue;
    const dir = path.join(OUT_ROOT, pool.pool);
    ensureDir(dir);
    console.log(`\n📁 ${pool.pool} (${pool.label}) · ${pool.items.length} 张`);

    for (const it of pool.items) {
      const filename = `${it.id}_${it.slug}.jpg`;
      const outPath = path.join(dir, filename);
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1024) {
        console.log(`  ⏭ ${it.id}`);
        skip++;
        continue;
      }
      try {
        await fetch(it.url, outPath);
        console.log(`  ✅ ${it.id} · ${it.slug}`);
        done++;
      } catch (err) {
        console.error(`  ❌ ${it.id} · ${err.message}`);
        fail++;
      }
      await sleep(300);
    }
  }

  console.log(`\n═══ 完成 · 新 ${done} · 跳 ${skip} · 失 ${fail}`);
}

void main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
