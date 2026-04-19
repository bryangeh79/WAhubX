# 预置素材库 (§B.16)

本目录是 **AI 关闭时的降级兜底资源池**, 随安装包一起打包分发.

M5 开工时仅建目录骨架 (空 + `.gitkeep`), 实物素材由 M7 `asset-studio` 阶段批量生成并填入.

## 目录约定

| 路径 | 用途 | 预计数量 | 填充阶段 |
|---|---|---|---|
| `personas/` | 预置人设 JSON (华人女青年 / 马来男中年 / 印裔混血 ...) | 50 个 | M7 |
| `voices/zh/` | Piper 本地 TTS 生成的中文短语音 (greeting/笑/叹气/...) | 100 条 | M7 |
| `voices/en/` | 英文短语音 | 60 条 | M7 |
| `images/food/` | 马华食物照 (nasi lemak / durian / 叉烧饭...) | 30 张 | M7 (Flux) |
| `images/life/` | 生活场景 (家里 / 通勤 / 办公室...) | 30 张 | M7 |
| `images/scenery/` | 马来风景 (海边 / 高原 / KLCC...) | 20 张 | M7 |
| `images/shopping/` | 购物开箱 | 20 张 | M7 |
| `images/pets/` | 宠物 | 15 张 | M7 |
| `images/selfies/` | AI 生成自拍 | 20 张 | M7 |
| `stickers/` | 表情包 | 30 个 | M7 |

总计约 **200MB** (实装后). 空骨架只占几 KB.

## 命名约定 (M7 填物时遵守)

- 文件名用稳定的短 id: `food_001.jpg` / `zh_laugh_003.ogg` / `pet_cat_005.jpg`
- DB `asset` 表 `file_path` 存相对路径, 例: `assets/_builtin/images/food/food_001.jpg`
- `asset.pool_name` 对齐目录层级: `_builtin_images_food` / `_builtin_voices_zh`
- `asset.source = 'pack'` (代表随安装包打包)

## 消费顺序 (M5 status_post executor 硬编码 4 层降级)

1. `persona.custom_pool` — 租户后期 AI 生成的专属素材 (M7+)
2. `_builtin_*` 本目录 — 所有租户共享兜底 (M7 填, M5 期间空)
3. 剧本包 `status_posts` 类别纯文本 — 纯文本 Status (非优先)
4. skip — 完全没素材时不强发 (新号发纯文本 Status 比图文更可疑)

## installer 打包 (TODO · M11 Inno Setup 阶段确认)

- `installer/build-backend.bat` 需复制 `data/assets/_builtin/` → `%APPDATA%\WAhubX\data\assets\_builtin\` (如 Inno Setup 走 `[Files]` 段落则自动)
- 升级 `.wupd` 包 **不覆盖** 本目录 (一旦 M7 生成的实物入库不能被升级包冲掉)

## 引用

- §B.16 预置素材库兜底 (本文件的权威定义)
- §B.20 Status 发布任务设计 (4 层降级消费链的规则来源)
- §3.5 asset 表 schema
