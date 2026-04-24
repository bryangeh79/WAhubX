#!/usr/bin/env node
/* eslint-disable no-console */
// 2026-04-22 · 视频素材下载脚本 · 读 videos-100.json

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const ROOT = path.resolve(__dirname, '..', '..');
const CATALOG = path.join(__dirname, 'videos-100.json');
const OUT_ROOT = path.join(ROOT, 'packages', 'backend', 'data', 'assets', 'videos');

const args = process.argv.slice(2);
const onlyPool = args.find((a) => a.startsWith('--pool='))?.split('=')[1];

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function fetch(url, outPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outPath);
    const req = https.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        try { fs.unlinkSync(outPath); } catch {}
        return fetch(res.headers.location, outPath).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(outPath); } catch {}
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let bytes = 0;
      res.on('data', (c) => (bytes += c.length));
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(bytes)));
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

async function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf-8'));
  let done = 0, skip = 0, fail = 0;

  for (const pool of catalog.pools) {
    if (onlyPool && pool.pool !== onlyPool) continue;
    const dir = path.join(OUT_ROOT, pool.pool);
    ensureDir(dir);
    console.log(`\n📁 ${pool.pool} (${pool.label}) · ${pool.items.length} 条`);
    for (const it of pool.items) {
      const filename = `${it.id}_${it.slug}.mp4`;
      const outPath = path.join(dir, filename);
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10_000) {
        console.log(`  ⏭ ${it.id}`);
        skip++;
        continue;
      }
      try {
        const bytes = await fetch(it.url, outPath);
        const mb = (bytes / 1024 / 1024).toFixed(1);
        console.log(`  ✅ ${it.id} · ${it.slug} · ${mb}MB`);
        done++;
      } catch (err) {
        console.error(`  ❌ ${it.id} · ${err.message}`);
        fail++;
      }
    }
  }
  console.log(`\n═══ 完成 · 新 ${done} · 跳 ${skip} · 失 ${fail}`);
}

void main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
