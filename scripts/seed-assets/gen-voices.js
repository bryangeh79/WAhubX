#!/usr/bin/env node
/* eslint-disable no-console */
// 2026-04-22 · WAhubX · 语音素材批量生成脚本
// 读 voices-200.json · 逐条调 Google Translate TTS 拉 mp3 · 放到 data/assets/voices/<pool>/<id>.mp3
// Google Translate TTS 完全免费 · 不用 API key · 但有速率限制 · 加 800ms 间隔
//
// 用法:
//   node scripts/seed-assets/gen-voices.js
//   node scripts/seed-assets/gen-voices.js --pool=greeting_morning   (只生成某池)
//   node scripts/seed-assets/gen-voices.js --dry-run                  (只打印不下载)
//
// 注意: 下载的是 mp3 · WA 可直接发. 若要强制 ptt opus 格式 · 加 ffmpeg 转码 (可选扩展)

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const ROOT = path.resolve(__dirname, '..', '..');
const CATALOG = path.join(__dirname, 'voices-200.json');
const OUT_ROOT = path.join(ROOT, 'packages', 'backend', 'data', 'assets', 'voices');

const args = process.argv.slice(2);
const onlyPool = args.find((a) => a.startsWith('--pool='))?.split('=')[1];
const dryRun = args.includes('--dry-run');

function sanitize(text) {
  return text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '_').slice(0, 20);
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function fetch(url, outPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outPath);
    https
      .get(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0',
          Referer: 'https://translate.google.com/',
        },
      }, (res) => {
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(outPath);
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      })
      .on('error', (err) => {
        file.close();
        try { fs.unlinkSync(outPath); } catch {}
        reject(err);
      });
  });
}

function ttsUrl(text) {
  const encoded = encodeURIComponent(text);
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=zh-CN&q=${encoded}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf-8'));
  let totalDone = 0;
  let totalSkip = 0;
  let totalFail = 0;

  for (const pool of catalog.pools) {
    if (onlyPool && pool.pool !== onlyPool) continue;
    const poolDir = path.join(OUT_ROOT, pool.pool);
    ensureDir(poolDir);
    console.log(`\n📁 ${pool.pool} (${pool.label}) · ${pool.items.length} 条`);

    for (const item of pool.items) {
      const filename = `${item.id}_${sanitize(item.text)}.mp3`;
      const outPath = path.join(poolDir, filename);

      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 200) {
        console.log(`  ⏭ ${item.id} 已存在 · 跳过`);
        totalSkip++;
        continue;
      }

      if (dryRun) {
        console.log(`  🔸 ${item.id} · "${item.text}" → ${filename}`);
        continue;
      }

      const url = ttsUrl(item.text);
      try {
        await fetch(url, outPath);
        const size = fs.statSync(outPath).size;
        console.log(`  ✅ ${item.id} · "${item.text}" · ${size}B`);
        totalDone++;
      } catch (err) {
        console.error(`  ❌ ${item.id} · ${err.message}`);
        totalFail++;
      }
      await sleep(800); // 速率限制 · Google 会封 IP
    }
  }

  console.log(`\n═══ 完成 · 新生成 ${totalDone} · 跳过 ${totalSkip} · 失败 ${totalFail}`);
  console.log(`文件位置: ${OUT_ROOT}`);
}

void main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
