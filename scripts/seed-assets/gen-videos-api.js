#!/usr/bin/env node
/* eslint-disable no-console */
// 2026-04-22 · 视频下载 (Pexels API 版)
// 用 Pexels 搜索 API · 比写死 URL 稳.
// 免费 API key 申请: https://www.pexels.com/api/ (注册邮箱 · 秒发 key)
//
// 用法:
//   export PEXELS_KEY=你的key
//   node scripts/seed-assets/gen-videos-api.js
//
// Windows PowerShell:
//   $env:PEXELS_KEY="你的key"
//   node scripts\seed-assets\gen-videos-api.js

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_ROOT = path.join(ROOT, 'packages', 'backend', 'data', 'assets', 'videos');

const PEXELS_KEY = process.env.PEXELS_KEY;
if (!PEXELS_KEY) {
  console.error('❌ 需要 PEXELS_KEY 环境变量 · 免费 · https://www.pexels.com/api/');
  console.error('PowerShell: $env:PEXELS_KEY="你的key"');
  console.error('Bash:       export PEXELS_KEY=你的key');
  process.exit(1);
}

// 池配置 · 每池一个关键词 + 目标数量
const POOLS = [
  { pool: 'daily_life',  query: 'cooking breakfast coffee',  count: 25 },
  { pool: 'funny_cute',  query: 'cute cat dog',               count: 20 },
  { pool: 'business',    query: 'office work laptop',         count: 20 },
  { pool: 'scenery',     query: 'nature landscape beach',     count: 20 },
  { pool: 'food',        query: 'food cooking',               count: 15 },
];

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsGet(res.headers.location, headers).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function httpsDownload(url, outPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outPath);
    const req = https.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        try { fs.unlinkSync(outPath); } catch {}
        return httpsDownload(res.headers.location, outPath).then(resolve, reject);
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

async function searchPexels(query, perPage = 30) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  const body = await httpsGet(url, { Authorization: PEXELS_KEY });
  const json = JSON.parse(body.toString('utf-8'));
  return json.videos || [];
}

function pickHdFile(video) {
  // 2026-04-22 · 优先选 <= 16MB 的文件 (WA 媒体上限)
  // 短时长视频一般 SD 就 OK · 实在没有再 HD · 最差 HD 1080p
  const files = video.video_files || [];
  // 按文件大小排序 (Pexels API 没返 size · 但 width+duration 可估算)
  // 先试 SD (720p or below)
  const sd = files.find((f) => f.quality === 'sd' && f.width <= 1280);
  if (sd) return sd.link;
  const hdSmall = files.find((f) => f.quality === 'hd' && f.width <= 1280);
  if (hdSmall) return hdSmall.link;
  const hd = files.find((f) => f.quality === 'hd' && f.width <= 1920);
  return (hd || files[0])?.link;
}

async function main() {
  let totalDone = 0;
  let totalFail = 0;

  for (const { pool, query, count } of POOLS) {
    const dir = path.join(OUT_ROOT, pool);
    ensureDir(dir);
    console.log(`\n📁 ${pool} · 搜 "${query}" · 目标 ${count}`);

    let videos = [];
    try {
      videos = await searchPexels(query, Math.min(80, count * 3));
      console.log(`  🔍 API 返 ${videos.length} 条候选`);
    } catch (err) {
      console.error(`  ❌ 搜索失败: ${err.message}`);
      continue;
    }

    let got = 0;
    for (const v of videos) {
      if (got >= count) break;
      const url = pickHdFile(v);
      if (!url) continue;
      const id = `pv${v.id}`;
      const filename = `${id}.mp4`;
      const outPath = path.join(dir, filename);
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10_000) {
        console.log(`  ⏭ ${id}`);
        got++;
        continue;
      }
      try {
        const bytes = await httpsDownload(url, outPath);
        const mb = bytes / 1024 / 1024;
        // 2026-04-22 · WA 上限 16MB · 超标直接删掉 · 不计 got
        if (bytes > 16 * 1024 * 1024) {
          fs.unlinkSync(outPath);
          console.log(`  🚫 ${id} · ${mb.toFixed(1)}MB > 16MB · 丢弃`);
          totalFail++;
          continue;
        }
        console.log(`  ✅ ${id} · ${mb.toFixed(1)}MB · ${v.duration}s`);
        got++;
        totalDone++;
      } catch (err) {
        console.error(`  ❌ ${id} · ${err.message}`);
        totalFail++;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log(`  ✓ ${pool} · 下 ${got}/${count}`);
  }

  console.log(`\n═══ 完成 · 新 ${totalDone} · 失 ${totalFail}`);
}

void main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
