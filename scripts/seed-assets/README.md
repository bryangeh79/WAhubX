# WAhubX 官方素材包 · 一键下载脚本

> 生成文件落到 `data/assets/{voices,images,videos}/<pool>/<file>`

## 🎙 语音 (200 条)

免费 · 用 Google Translate TTS · 无需 API key.

```bash
node scripts/seed-assets/gen-voices.js
# 或只生成某池
node scripts/seed-assets/gen-voices.js --pool=greeting_morning
# 只看不下 (dry run)
node scripts/seed-assets/gen-voices.js --dry-run
```

**耗时**: ~200 条 × 1 秒 ≈ 3-4 分钟
**总大小**: ~10-15 MB
**格式**: mp3 (Baileys sendMedia 支持 · 设 ptt=true 发成语音消息)

### 池清单

| Pool | 描述 | 条数 |
|---|---|---|
| greeting_morning | 早安问候 | 30 |
| greeting_night | 晚安 | 15 |
| thanks | 感谢 | 20 |
| confirm_ok | OK / 好的 | 20 |
| inquire | 问询 | 25 |
| business_common | 业务常用 | 30 |
| emotions | 情感表达 | 30 |
| festivals | 节日 (MY 本土) | 15 |
| casual | 闲聊 | 15 |

**合计**: 200 条

---

## 🖼 图片 (100 张)

来源 Pexels 免版权 · 免费商用.

```bash
node scripts/seed-assets/gen-images.js
node scripts/seed-assets/gen-images.js --pool=reaction_emoji
```

**耗时**: ~100 张 × 0.5 秒 ≈ 1 分钟
**总大小**: ~30-50 MB
**格式**: jpg 800px

### 池清单

| Pool | 描述 | 条数 |
|---|---|---|
| reaction_emoji | 表情反应 (猫狗/点赞) | 20 |
| food_general | 美食 | 20 |
| scenery | 风景 | 15 |
| festivals | 节日 | 10 |
| business_promo | 商业/促销 | 35 |

**合计**: 100 张

---

## 🎥 视频 (~25 条 demo · 用户补齐到 100)

Pexels Videos 免版权. 视频文件大 · 下载慢 · 按需选 pool.

```bash
node scripts/seed-assets/gen-videos.js
node scripts/seed-assets/gen-videos.js --pool=daily_life
```

**耗时**: ~25 条 × 5-15 秒 ≈ 3-5 分钟
**总大小**: ~500 MB-1 GB (HD 1080p)
**格式**: mp4 HD

### 池清单 (demo)

| Pool | 描述 | 条数 |
|---|---|---|
| daily_life | 日常生活 | 10 |
| funny_cute | 搞笑可爱 | 5 |
| business | 商业/产品 | 5 |
| scenery | 风景 | 5 |

**合计**: 25 (demo)

### 补齐到 100 的方法

1. 打开 Pexels · 搜关键词 (食物/节日/城市 等)
2. 复制视频的 **HD mp4 下载直链** (右键 Download → Copy Link)
3. 往 `videos-100.json` 的 pools 里加条目
4. 再跑 `gen-videos.js`

---

## 🚀 一键全跑

```bash
# Windows PowerShell / Bash 都行
node scripts/seed-assets/gen-voices.js
node scripts/seed-assets/gen-images.js
node scripts/seed-assets/gen-videos.js
```

跑完 · 文件结构大致:
```
data/assets/
├─ voices/
│  ├─ greeting_morning/  (30 mp3)
│  ├─ thanks/           (20 mp3)
│  └─ ... (9 pools · 200 总)
├─ images/
│  ├─ reaction_emoji/   (20 jpg)
│  └─ ... (5 pools · 100 总)
└─ videos/
   ├─ daily_life/       (10 mp4)
   └─ ... (4 pools · 25 demo)
```

## 📦 后端导入 · 让系统识别这些素材

首次下载完 · 调后端 admin 接口扫目录入 asset 表:

```
POST /api/v1/assets/reindex
→ 扫 data/assets/_builtin/* + data/assets/*
→ 每个文件入 asset 表 · 打 tag (pool 作为 tag)
```

(待实施 · 见下一批代码)

---

## 🛡 法律 / 版权

- **Pexels**: CC0 · 免费商用 · 无须署名
- **Google TTS**: 仅供个人 / 小规模商用 · 大规模走 Google Cloud TTS (付费)
- 视频如果要商用大规模发送 · 建议自拍或买正版

_Generated 2026-04-22_
