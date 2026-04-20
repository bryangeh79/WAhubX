#!/usr/bin/env node
/**
 * M7 Day 7 · _builtin-seed CI 脚本
 *
 * 目的: 为 installer 预置的 data/assets/_builtin/ 池生成种子素材.
 *      产出目录会 copy 到 installer 的 staging/data/assets/_builtin/ (见 installer/build.bat Step 7c)
 *
 * 生成规模 (per sketch):
 *   - 5 chinese-malaysian persona variants
 *   - 每 persona: 10 images + 10 voice
 *   - 池: _builtin_images_life / _builtin_voices_greeting / ...
 *   - 总大小目标: ~50 MB · 上限 100 MB (超则 HALT · 商讨 GitHub Releases)
 *
 * 模式:
 *   --mode real        真调 Flux + Piper (需本地 ComfyUI + piper.exe 就绪)
 *   --mode stub (默认)  生成占位文件 (tiny PNG + tiny wav) · CI 可跑 · 不是真素材
 *
 * 产出:
 *   data/assets/_builtin/<kind>/<pool>/<persona_id>_NNN.<ext>
 *
 * Exit code:
 *   0 · 成功
 *   10 · 超 100MB · HALT (见 WAhubX v1.0 release checklist §2)
 *   20 · 外部依赖未就绪 (ComfyUI / piper · mode=real)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ── 参数 ──
const args = process.argv.slice(2);
const mode = getArg('--mode', 'stub');
const outDir = getArg(
  '--out',
  path.resolve(__dirname, '..', 'data', 'assets', '_builtin'),
);
const personaCount = parseInt(getArg('--personas', '5'), 10);
const imagesPerPersona = parseInt(getArg('--images', '10'), 10);
const voicesPerPersona = parseInt(getArg('--voices', '10'), 10);

console.log(`=== M7 _builtin-seed CI · mode=${mode} · out=${outDir} ===`);

// ── Persona seed (chinese-malaysian variants · 写死 · 不调 AI) ──
const SEED_PERSONAS = [
  { persona_id: 'builtin_pj_jasmine_01', display_name: 'Jasmine', age: 28, occupation: '电商客服', city: 'Petaling Jaya' },
  { persona_id: 'builtin_kl_amy_02',     display_name: 'Amy',     age: 32, occupation: '美容院主', city: 'Kuala Lumpur' },
  { persona_id: 'builtin_penang_linda_03', display_name: 'Linda', age: 26, occupation: '奶茶店员', city: 'Penang' },
  { persona_id: 'builtin_sj_karen_04',   display_name: 'Karen',   age: 35, occupation: '保险代理', city: 'Subang Jaya' },
  { persona_id: 'builtin_jb_mei_05',     display_name: 'Mei',     age: 29, occupation: '瑜伽教练', city: 'Johor Bahru' },
].slice(0, personaCount);

// ── Pool 映射 ──
const IMAGE_POOLS = ['_builtin_images_life', '_builtin_images_food', '_builtin_images_cafe'];
const VOICE_POOLS = ['_builtin_voices_greeting', '_builtin_voices_casual_laugh', '_builtin_voices_confirmation'];

// ── 实装 ──
(async () => {
  ensureDir(outDir);
  let totalBytes = 0;
  const report = { images: 0, voices: 0, failed: 0 };

  for (const persona of SEED_PERSONAS) {
    console.log(`--- persona ${persona.persona_id} (${persona.display_name}) ---`);
    for (let i = 0; i < imagesPerPersona; i++) {
      const pool = IMAGE_POOLS[i % IMAGE_POOLS.length];
      const filename = `${persona.persona_id}_${String(i).padStart(3, '0')}.jpg`;
      const dir = path.join(outDir, 'image', pool);
      ensureDir(dir);
      const abs = path.join(dir, filename);
      try {
        const bytes = await generateImage(persona, pool, abs, mode);
        totalBytes += bytes;
        report.images++;
      } catch (err) {
        console.error(`  image fail · ${filename}: ${err.message}`);
        report.failed++;
        if (mode === 'real') process.exit(20);
      }
    }
    for (let i = 0; i < voicesPerPersona; i++) {
      const pool = VOICE_POOLS[i % VOICE_POOLS.length];
      const filename = `${persona.persona_id}_${String(i).padStart(3, '0')}.ogg`;
      const dir = path.join(outDir, 'voice', pool);
      ensureDir(dir);
      const abs = path.join(dir, filename);
      try {
        const bytes = await generateVoice(persona, pool, abs, mode);
        totalBytes += bytes;
        report.voices++;
      } catch (err) {
        console.error(`  voice fail · ${filename}: ${err.message}`);
        report.failed++;
        if (mode === 'real') process.exit(20);
      }
    }
  }

  const mb = totalBytes / (1024 * 1024);
  console.log('');
  console.log('=== DONE ===');
  console.log(`  images: ${report.images}`);
  console.log(`  voices: ${report.voices}`);
  console.log(`  failed: ${report.failed}`);
  console.log(`  total : ${mb.toFixed(2)} MB`);
  console.log(`  out   : ${outDir}`);

  if (mb > 100) {
    console.error('');
    console.error('!! 超 100MB 上限 · 见 v1.0-release-checklist §2 · 建议 GitHub Releases 分发 !!');
    process.exit(10);
  }
  if (mb > 50 && mode === 'real') {
    console.warn('');
    console.warn('?? 超 50MB · 可接受但接近上限 · 监控增长');
  }
})();

// ── helpers ──

function getArg(name, def) {
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return def;
}

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

/**
 * Stub mode: 写 ~200KB 的 deterministic 伪 JPEG (header + random-looking body)
 * Real mode: 调 FluxService · 需 WAhubX backend 启 · /assets/generate (暂未建)
 */
async function generateImage(persona, pool, abs, m) {
  if (m === 'stub') {
    const header = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    ]);
    const body = crypto.randomBytes(200 * 1024 - header.length);
    const buf = Buffer.concat([header, body]);
    fs.writeFileSync(abs, buf);
    return buf.length;
  }
  throw new Error('real mode not implemented · TODO Day 8 · 需起 ComfyUI + 调 FluxService');
}

/**
 * Stub mode: 写 ~40KB 的 deterministic 伪 OGG
 * Real mode: 调 PiperService · 需 piper.exe 就绪
 */
async function generateVoice(persona, pool, abs, m) {
  if (m === 'stub') {
    const header = Buffer.from('OggS', 'ascii');
    const body = crypto.randomBytes(40 * 1024 - header.length);
    const buf = Buffer.concat([header, body]);
    fs.writeFileSync(abs, buf);
    return buf.length;
  }
  throw new Error('real mode not implemented · TODO Day 8 · 需 piper.exe + 模型');
}
