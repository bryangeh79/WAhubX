# WAhubX 剧本包 · 马来华语 v1.0 · 交付索引

## ✅ 100 剧本全部完成

| 文件 | 范围 | 剧本数 | 轮次估算 |
|---|---|---|---|
| `scripts_pack_my_zh_v1.json` | 001–020 | 20 | ~240 |
| `scripts_pack_my_zh_v1_batch2.json` | 021–040 | 20 | ~260 |
| `scripts_pack_my_zh_v1_batch3.json` | 041–060 | 20 | ~260 |
| `scripts_pack_my_zh_v1_batch4.json` | 061–080 | 20 | ~260 |
| `scripts_pack_my_zh_v1_batch5.json` | 081–100 | 20 | ~260 |
| **合计** | **001–100** | **100** | **~1280** |

## 分类分布

| # | 分类 | 数量 | 剧本 ID 范围 |
|---|---|---|---|
| 01 | 🌅 日常问候 | 18 | s001–s018 |
| 02 | 🍜 饮食美食 | 15 | s019–s033 |
| 03 | 💼 工作生活 | 13 | s034–s046 |
| 04 | 🎬 休闲娱乐 | 13 | s047–s059 |
| 05 | 🛍️ 购物消费 | 10 | s060–s069 |
| 06 | 🗓️ 周末计划 | 10 | s070–s079 |
| 07 | 👨‍👩‍👧 家庭亲友 | 8  | s080–s087 |
| 08 | 💪 健康运动 | 7  | s088–s094 |
| 09 | 🎉 节日季节 | 6  | s095–s100 |

## 统一特征

- 每条文本消息含 4–5 个 `content_pool` 变体
- 自然混入 `lah / leh / lor / la / haha / 🥹` 本地口语
- 融入本地地标：`PJ / SS2 / KLCC / Mid Valley / Sunway / Genting / Ipoh`
- 本地品牌：`Grab / Lazada / Shopee / Maybank / Tealive / Chagee / Celcom`
- 每剧本含至少 1 个媒体步骤（图/语音）+ `caption_fallback` 降级
- `typing_delay_ms` + `send_delay_sec` 双重节奏模拟真人打字
- `safety.min_hours_between_runs` 防重复滥用（20–168h 按敏感度）

## 剧本 JSON 关键字段

| 字段 | 作用 |
|---|---|
| `content_pool` | 文本变体池，每次随机抽一条 |
| `asset_pool` | 媒体池 ID，引用素材库 |
| `caption_fallback` | 媒体禁用时改发的文本 |
| `on_disabled` | `skip` 跳过 / `send_fallback_text` 降级文本 |
| `typing_delay_ms` | 模拟打字持续时长 |
| `send_delay_sec` | 上条结束后等多久再发 |
| `delay_from_start` | Session 级别延迟（跨时段对话） |
| `min_warmup_stage` | 号必须达到该阶段才能跑 |
| `ai_rewrite` | 是否过 GPT 改写 |

## 所需素材池清单

### 语音池（Piper 本地生成可）
- `voices_casual_laugh` — 笑声 🤭
- `voices_ok_casual` — 好啊、ok、行
- `voices_tired_sigh` — 叹气 🫠
- `voices_wow_surprise` — 哇、惊喜
- `voices_haha_short` — 短笑声

### 图片池（Flux 本地 / Replicate 生成可）
- `images_food_malaysian` — 马来本地食物
- `images_weather_scenery` — 天气/风景
- `images_daily_life` — 日常生活
- `images_drinks_boba` — 奶茶/咖啡
- `images_shopping_haul` — 购物/开箱
- `images_pet_cat_dog` — 宠物
- `images_selfie_casual` — 自拍
- `stickers_friendly` — 表情包
- `memes_local_funny` — 本地梗图

## 后续扩展

- [ ] 英文版（马新） my_en_basic_v1
- [ ] 马来语版 my_ms_basic_v1
- [ ] 客服业务类剧本包 business_support_v1
- [ ] 行业专属（电商 / 教育 / 房产 / 金融）
