#!/usr/bin/env node
// 合并 2 个源 (whchannels + wachannelsfinder) · 去重 · 产出 final CSV
// 再直接调 bulk-import API 导入 global seeds
const fs = require('fs');
const path = require('path');
const http = require('http');

const SCRIPT_DIR = __dirname;
const SOURCES = [
  { file: path.join(SCRIPT_DIR, 'channels.raw.csv'), tag: 'whchannels' },
  { file: path.join(SCRIPT_DIR, 'wacf.raw.csv'), tag: 'wacf' },
];
const FINAL = path.join(SCRIPT_DIR, 'channels.merged.csv');

const decodeHtml = (s) => (s || '')
  .replace(/&amp;amp;/g, '&').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
  .replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ');

// wacf 的 raw category slugs 映射到我们 TAGS-CATALOG 的 tag 名
const TAG_MAP = {
  'cryptocurrencies': 'crypto',
  'crypto': 'crypto',
  'bitcoin': 'crypto',
  'trading': 'stocks-global',
  'earning': 'marketing',
  'actor': 'entertainment',
  'movies': 'movies',
  'movie': 'movies',
  'film': 'movies',
  'music': 'music',
  'song': 'music',
  'kpop': 'kpop',
  'fashion': 'fashion',
  'beauty': 'beauty',
  'makeup': 'beauty',
  'skincare': 'skincare',
  'news': 'news-world',
  'entertainment': 'entertainment',
  'sports': 'sports',
  'sport': 'sports',
  'football': 'football',
  'cricket': 'sports',
  'basketball': 'basketball',
  'education': 'education',
  'learning': 'education',
  'english': 'english-learning',
  'tech': 'tech',
  'technology': 'tech',
  'gaming': 'gaming',
  'games': 'gaming',
  'game': 'gaming',
  'food': 'food',
  'recipe': 'food',
  'travel': 'travel',
  'health': 'health',
  'fitness': 'fitness',
  'yoga': 'yoga',
  'pets': 'pets',
  'pet': 'pets',
  'dog': 'pets',
  'cat': 'pets',
  'parenting': 'parenting',
  'baby': 'parenting',
  'real-estate': 'real-estate',
  'property': 'real-estate',
  'auto': 'auto',
  'cars': 'auto',
  'motorcycle': 'motorcycle',
  'marketing': 'marketing',
  'business': 'marketing',
  'ecommerce': 'ecommerce',
  'startup': 'startup',
  'lifestyle': 'lifestyle',
  'memes': 'memes',
  'humor': 'memes',
  'funny': 'memes',
  'ai': 'ai',
  'chatgpt': 'ai',
  'coding': 'coding',
  'programming': 'coding',
  'malaysia': 'news-my',
  'singapore': 'news-sg',
  'chinese': 'news-zh',
  'india': 'news-world',
  'pakistan': 'news-world',
  'indonesia': 'news-world',
};

const mapTags = (raw) => {
  if (!raw) return [];
  const parts = raw.split(/[|,]/).map(t => t.trim().toLowerCase()).filter(Boolean);
  const mapped = new Set();
  for (const p of parts) {
    const t = TAG_MAP[p];
    if (t) mapped.add(t);
    else if (/^[a-z-]+$/.test(p)) mapped.add(p); // 保留小写有效 tag
  }
  return [...mapped];
};

const inferTags = (name, desc) => {
  const text = `${name} ${desc}`.toLowerCase();
  const tags = [];
  const rules = [
    ['forex|trading signal|fx ', 'forex'],
    ['crypto|bitcoin|ethereum|nft|web3|blockchain', 'crypto'],
    ['stock|invest|market', 'stocks-global'],
    ['marketing|digital marketing|ads', 'marketing'],
    ['shopee|lazada|ecommerce|dropship', 'ecommerce'],
    ['startup|founder|saas', 'startup'],
    ['malaysia|kl |kuala lumpur|bursa|ringgit', 'news-my'],
    ['singapore| sg ', 'news-sg'],
    ['chinese|中文|华文|华人|sin chew|oriental|china press', 'news-zh'],
    ['china|中国|cctv', 'news-cn'],
    ['taiwan|台湾', 'news-tw'],
    ['tech|technology|gadget', 'tech'],
    ['ai |chatgpt|openai', 'ai'],
    ['coding|programming|developer|github', 'coding'],
    ['web3|defi|dao', 'web3'],
    ['gaming|game|roblox|minecraft|fortnite', 'gaming'],
    ['food|recipe|restaurant|foodie|makan', 'food'],
    ['travel|tourism|vacation|holiday', 'travel'],
    ['fashion|outfit|style', 'fashion'],
    ['beauty|makeup|cosmetic', 'beauty'],
    ['skincare', 'skincare'],
    ['health|wellness|medical', 'health'],
    ['fitness|gym|workout', 'fitness'],
    ['yoga|meditation', 'yoga'],
    ['parenting|baby|kids|mother', 'parenting'],
    ['pet|dog|cat|animal', 'pets'],
    ['real estate|property|housing', 'real-estate'],
    ['auto|car|vehicle', 'auto'],
    ['motorcycle|bike|motorbike', 'motorcycle'],
    ['education|learning|course|study', 'education'],
    ['english|esl', 'english-learning'],
    ['productivity|hack|tip', 'productivity'],
    ['movie|film|cinema|bollywood|hollywood', 'movies'],
    ['music|song|album', 'music'],
    ['kpop|k-pop|bts|blackpink', 'kpop'],
    ['meme|funny|humor', 'memes'],
    ['sport|sports', 'sports'],
    ['football|soccer|premier league|epl|mufc|liverpool|arsenal|chelsea|barcelona|madrid', 'football'],
    ['basketball|nba', 'basketball'],
    ['news|breaking news|daily news', 'news-world'],
    ['luxury|lv |gucci|chanel', 'luxury'],
    ['entertainment|celebrity|gossip', 'entertainment'],
    ['lifestyle|daily life', 'lifestyle'],
  ];
  for (const [pattern, tag] of rules) {
    if (new RegExp(pattern, 'i').test(text)) tags.push(tag);
  }
  return [...new Set(tags)];
};

const cleanName = (n) => decodeHtml(n)
  .replace(/\s*[|_]\s*WH channels\s*$/i, '')
  .replace(/\s*WhatsApp Channel\s*$/i, '')
  .replace(/\s*WhatsApp Channels Finder\s*$/i, '')
  .replace(/\s*-\s*Whatsapp Channels Finder\s*$/i, '')
  .replace(/\s+/g, ' ')
  .trim()
  .substring(0, 128);

const escField = (s) => (s || '').replace(/,/g, ';').replace(/\n/g, ' ').replace(/"/g, '').trim();

// ── Main ──
const seen = new Set();
const out = ['name,invite_code,tags,description'];
let total = 0, skipped = 0;
const tagCount = {};

for (const src of SOURCES) {
  if (!fs.existsSync(src.file)) {
    console.log(`SKIP: ${src.tag} (file not found)`);
    continue;
  }
  const lines = fs.readFileSync(src.file, 'utf-8').split(/\r?\n/).filter(l => l.trim());
  console.log(`${src.tag}: ${lines.length} rows`);
  for (const line of lines) {
    total++;
    const parts = line.split('|');
    if (parts.length < 4) { skipped++; continue; }
    const [rawName, invite, rawTags, desc] = parts;
    if (!invite || invite.length < 20) { skipped++; continue; }
    if (seen.has(invite)) { skipped++; continue; }
    seen.add(invite);

    const name = cleanName(rawName);
    const description = decodeHtml(desc || '').replace(/\s+/g, ' ').substring(0, 200);

    // 2026-04-21 · wacf raw tags 抓到整页导航 · 不可用. 一律 infer from name+desc.
    // whchannels raw 已为空 · inferTags 也会生效.
    let tags = inferTags(name, description);
    // 但如 rawTags 里有 "football" / "crypto" 这种**明确**单 tag (<=5 个) · 叠加可靠 source 信号
    const mappedRaw = mapTags(rawTags);
    if (mappedRaw.length <= 5) {
      for (const t of mappedRaw) if (!tags.includes(t)) tags.push(t);
    }
    if (tags.length === 0) tags = ['uncategorized'];
    for (const t of tags) tagCount[t] = (tagCount[t] || 0) + 1;

    out.push(`${escField(name)},${invite},${tags.join('|')},${escField(description)}`);
  }
}

fs.writeFileSync(FINAL, out.join('\n'));
console.log(`\n─── Merged ───`);
console.log(`Total seen: ${total}`);
console.log(`Skipped (dup/invalid): ${skipped}`);
console.log(`Unique written: ${out.length - 1}`);
console.log(`File: ${FINAL}`);

console.log(`\n─── Top 20 tags ───`);
const sorted = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 20);
sorted.forEach(([t, c]) => console.log(`  ${c}\t${t}`));
