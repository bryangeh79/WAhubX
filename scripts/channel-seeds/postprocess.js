#!/usr/bin/env node
// 后处理: 清洗 channels.raw.csv + 重新抓 tag · 输出 channels.final.csv
// 格式符合 WAhubX bulk-import CSV: name,invite_code,tags,description

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RAW = path.join(__dirname, 'channels.raw.csv');
const OUT = path.join(__dirname, 'channels.final.csv');

// HTML entity decode (简化版)
const decodeHtml = (s) => {
  if (!s) return '';
  return s
    .replace(/&amp;amp;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
};

// 按关键词推断 tags (当原站 tag 抓不到时)
const inferTags = (name, desc) => {
  const text = `${name} ${desc}`.toLowerCase();
  const tags = [];
  const rules = [
    ['forex|trading signal|forex signal|fx ', 'forex'],
    ['crypto|bitcoin|ethereum|nft|web3|blockchain', 'crypto'],
    ['stock|invest|market|trading', 'stocks-global'],
    ['bursa|klse|kl stock', 'stocks-my'],
    ['marketing|digital marketing|ads', 'marketing'],
    ['shopee|lazada|ecommerce|e-commerce|dropship', 'ecommerce'],
    ['startup|founder|saas|venture', 'startup'],
    ['sme|small business', 'sme'],
    ['malaysia|kl |kuala lumpur|bursa|ringgit| my ', 'news-my'],
    ['singapore| sg ', 'news-sg'],
    ['chinese|中文|华文|华人|华裔|sin chew|oriental|china press', 'news-zh'],
    ['china|中国|cctv', 'news-cn'],
    ['taiwan|台湾', 'news-tw'],
    ['tech|technology|tech news|gadget', 'tech'],
    ['ai |artificial intelligence|chatgpt|openai|claude|gemini', 'ai'],
    ['coding|programming|developer|github|code', 'coding'],
    ['web3|defi|dao|nft', 'web3'],
    ['gaming|game|roblox|minecraft|fortnite', 'gaming'],
    ['food|recipe|restaurant|foodie|makan', 'food'],
    ['travel|tourism|vacation|holiday|visit', 'travel'],
    ['fashion|outfit|style|clothing', 'fashion'],
    ['beauty|makeup|cosmetic|skincare', 'beauty'],
    ['skincare', 'skincare'],
    ['health|wellness|medical', 'health'],
    ['fitness|gym|workout|exercise', 'fitness'],
    ['yoga|meditation', 'yoga'],
    ['parenting|baby|kids|mother|child', 'parenting'],
    ['pet|dog|cat|animal', 'pets'],
    ['real estate|property|housing|rental', 'real-estate'],
    ['auto|car|vehicle', 'auto'],
    ['motorcycle|bike|motorbike', 'motorcycle'],
    ['education|learning|course|study|edu', 'education'],
    ['english|esl|tefl', 'english-learning'],
    ['productivity|hack|tip', 'productivity'],
    ['movie|film|cinema|bollywood|hollywood', 'movies'],
    ['music|song|kpop|k-pop|album', 'music'],
    ['kpop|k-pop|bts|blackpink', 'kpop'],
    ['meme|funny|humor', 'memes'],
    ['sport|sports', 'sports'],
    ['football|soccer|premier league|epl|fc |mufc|liverpool|arsenal|chelsea|tottenham|juventus|barcelona|madrid|psg', 'football'],
    ['basketball|nba', 'basketball'],
    ['news|breaking news|daily news', 'news-world'],
    ['luxury|lv|gucci|chanel', 'luxury'],
    ['entertainment|celebrity|gossip', 'entertainment'],
    ['lifestyle|life|daily', 'lifestyle'],
  ];
  for (const [pattern, tag] of rules) {
    if (new RegExp(pattern, 'i').test(text)) tags.push(tag);
  }
  return [...new Set(tags)];
};

// 清洗 name · 去掉 "WhatsApp Channel | WH channels" 后缀等
const cleanName = (n) => {
  // 顺序: 先剥最长尾巴 · 再剥短的
  return decodeHtml(n)
    .replace(/\s*[|_]\s*WH channels\s*$/i, '')     // " _ WH channels" 最外层先剥
    .replace(/\s*WhatsApp Channel\s*$/i, '')       // 剥 "WhatsApp Channel" 后缀
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 128);
};

// CSV 字段转义 (用于 WAhubX import · 符合他们 "," 分隔 "|" tag 分隔 的格式)
const esc = (s) => {
  if (!s) return '';
  return s.replace(/,/g, ';').replace(/\n/g, ' ').replace(/"/g, '').trim();
};

// ──── main ────
const raw = fs.readFileSync(RAW, 'utf-8');
const lines = raw.split(/\r?\n/).filter((l) => l.trim());
console.log(`Input: ${lines.length} rows`);

const seenInvite = new Set();
const out = ['name,invite_code,tags,description'];
let skipped = 0;
let written = 0;

for (const line of lines) {
  const parts = line.split('|');
  if (parts.length < 4) {
    skipped++;
    continue;
  }
  let [rawName, invite, tags, desc, _subs] = parts;
  if (!invite || invite.length < 20) {
    skipped++;
    continue;
  }
  if (seenInvite.has(invite)) {
    skipped++;
    continue;
  }
  seenInvite.add(invite);

  const name = cleanName(rawName);
  const description = decodeHtml(desc ?? '').replace(/\s+/g, ' ').substring(0, 200);

  let tagList = (tags ?? '').split('|').filter(Boolean);
  if (tagList.length === 0) {
    tagList = inferTags(name, description);
  }
  // 必加 · 如果完全没 tag · 打个 "uncategorized"
  if (tagList.length === 0) tagList = ['uncategorized'];

  out.push(`${esc(name)},${invite},${tagList.join('|')},${esc(description)}`);
  written++;
}

fs.writeFileSync(OUT, out.join('\n'));
console.log(`Output: ${written} rows · skipped ${skipped}`);
console.log(`File: ${OUT}`);
