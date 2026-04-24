# WAhubX 官方频道种子库 · Tag 目录

> 20 大类 · 覆盖马来华人场景 + 全球通用行业
> 每个大类建议填 50 条频道 → 目标总量 1000+

---

## 🏦 金融 / 投资 (150 条)

| Tag | 中文 | 英文名 | 建议数 |
|---|---|---|---|
| `forex` | 外汇 | Forex | 50 |
| `crypto` | 加密货币 | Crypto | 50 |
| `stocks-global` | 全球股市 | Stock Market | 20 |
| `stocks-my` | 马股 | Bursa Malaysia | 10 |
| `finance-edu` | 理财教学 | Finance Edu | 20 |

## 💼 商业 / 创业 (150 条)

| Tag | 中文 | 建议数 |
|---|---|---|
| `marketing` | 营销 | 40 |
| `ecommerce` | 电商 | 30 |
| `startup` | 创业 | 20 |
| `sme` | 中小企业 | 20 |
| `branding` | 品牌 | 20 |
| `dropshipping` | 代发货 | 10 |
| `amazon-fba` | Amazon FBA | 10 |

## 💻 科技 (100 条)

| Tag | 中文 | 建议数 |
|---|---|---|
| `tech` | 科技综合 | 30 |
| `ai` | AI | 20 |
| `coding` | 编程 | 20 |
| `web3` | Web3 | 10 |
| `gadgets` | 数码产品 | 10 |
| `gaming` | 游戏 | 10 |

## 📰 新闻 / 时事 (100 条)

| Tag | 中文 | 建议数 |
|---|---|---|
| `news-my` | 马来西亚新闻 | 30 |
| `news-sg` | 新加坡新闻 | 15 |
| `news-zh` | 中文新闻 | 20 |
| `news-cn` | 中国新闻 | 15 |
| `news-tw` | 台湾新闻 | 10 |
| `news-world` | 国际新闻 | 10 |

## 🍜 生活 (150 条)

| Tag | 中文 | 建议数 |
|---|---|---|
| `food` | 美食 | 30 |
| `food-my` | 马来美食 | 20 |
| `food-kl` | KL 美食 | 15 |
| `travel` | 旅游 | 25 |
| `lifestyle` | 生活风格 | 20 |
| `parenting` | 育儿 | 20 |
| `pets` | 宠物 | 20 |

## 👗 时尚 / 美妆 (100 条)

| Tag | 建议数 |
|---|---|
| `fashion` | 40 |
| `beauty` | 30 |
| `skincare` | 20 |
| `luxury` | 10 |

## 🏠 房产 / 汽车 (80 条)

| Tag | 建议数 |
|---|---|
| `real-estate` | 30 |
| `real-estate-my` | 20 |
| `auto` | 20 |
| `motorcycle` | 10 |

## 🎓 教育 (80 条)

| Tag | 建议数 |
|---|---|
| `education` | 30 |
| `english-learning` | 20 |
| `mandarin-learning` | 10 |
| `productivity` | 20 |

## 💪 健康 / 健身 (60 条)

| Tag | 建议数 |
|---|---|
| `health` | 20 |
| `fitness` | 20 |
| `wellness` | 10 |
| `yoga` | 10 |

## 🎬 娱乐 (80 条)

| Tag | 建议数 |
|---|---|
| `entertainment` | 20 |
| `movies` | 15 |
| `music` | 20 |
| `kpop` | 15 |
| `memes` | 10 |

## ⚽ 体育 (50 条)

| Tag | 建议数 |
|---|---|
| `sports` | 20 |
| `football` | 20 |
| `basketball` | 10 |

---

## 如何填真数据 (Admin 操作流程)

### 方法 1 · 自己收集

1. 加入马来本地行业群 · 看群友贴的频道链接
2. 搜索引擎: `site:whatsapp.com/channel forex`
3. 第三方聚合网站 (whatsappchannels.net, waufo.com) — 注意 ToS
4. 客户推荐

### 方法 2 · 用 CSV 批量填

打开 `scripts/channel-seeds/template.csv` · 每行填:
```csv
name,invite_code,tags,description
Forex Signals Daily,0029VaXXXXXXXXX,forex|finance-edu,每日外汇信号分析
MyForex Malaysia,0029VaYYYYYYYYY,forex|news-my,马来外汇社群
```

### 方法 3 · Admin UI 单条录

1. 登 platform@wahubx.local
2. 设置 → 素材库 → 频道 (tab)
3. "+ 添加频道" · 粘 invite 链接 · 自动预览 · 打 tag · 保存

---

## 部署策略

- **种子作为 global=true** · 租户所有可见 (看不到不到真 invite code · 但能选 tag 随机 follow)
- 通过 migration SQL 或 CSV import 一次性灌进 production DB
- 每半年更新一次 (频道 invite 可能失效)
