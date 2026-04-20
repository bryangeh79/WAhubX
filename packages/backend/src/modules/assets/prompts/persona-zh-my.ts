// M7 Day 1 · Persona Prompt Template · 马来华人场景 (补强 1 · 强约束马华画像)
//
// ⚠ 腔调说明 (补强 4):
//   Piper zh-CN voice 为大陆腔 · 无马华 voice 模型 · 3-5s 短语音差异不明显 · >10s 长语音
//   可能露馅. 当前 persona 通过 speech_habits.sentence_endings + code_switching 弥补
//   (文字层对齐, voice 层仍有腔差). V1.1 评估 fine-tune 马华 zh 声音模型.
//
// 用于 PersonaGeneratorService (Day 2 实装) 调 AI Provider 生成 PersonaV1 JSON
// 禁止大陆网络梗 · 禁止大陆 app 名 · 禁止大陆城市 · 见 MAINLAND_LEAKAGE_TERMS

import {
  EthnicityMY,
  assertEthnicityImplementedInV1,
  type PersonaV1,
} from '../persona.types';

// ── 马华人口统计 seed · 从概率分布采样 ──────────────────

/** 年龄分布 · 私域码商目标客群 · 22-45 偏年轻 */
export const AGE_DISTRIBUTION = [
  { range: [22, 27], weight: 0.25 }, // 刚毕业 · 国潮 / 网红店打卡
  { range: [28, 33], weight: 0.40 }, // 主力 · 白领 / 副业
  { range: [34, 40], weight: 0.25 }, // 家庭主妇 / 中小企主
  { range: [41, 48], weight: 0.10 }, // 保险 / 美容 / 传销资深
];

/** 城市分布 · Klang Valley 为主 · 次 Penang / Johor */
export const MY_CITIES = [
  { name: 'Petaling Jaya', weight: 0.20 },
  { name: 'Subang Jaya', weight: 0.15 },
  { name: 'Kuala Lumpur', weight: 0.20 },
  { name: 'Shah Alam', weight: 0.10 },
  { name: 'Penang', weight: 0.10 },
  { name: 'Johor Bahru', weight: 0.10 },
  { name: 'Puchong', weight: 0.05 },
  { name: 'Cheras', weight: 0.05 },
  { name: 'Klang', weight: 0.05 },
];

/** 职业池 · MY 私域运营实际常见 · 非纯白领 */
export const MY_OCCUPATIONS = [
  '电商客服', '微商', '保险代理', '美容院主', '咖啡店老板',
  '烘焙工作室主理人', '自媒体博主', '瑜伽教练', 'Grab 司机',
  '中介', '餐厅前台', '直播带货', '宝妈副业', '纹眉师',
  '奶茶店员', '化妆师', '摄影师助手', '私厨',
];

/** 本地语料 · sentence_endings 必带 */
export const MY_SENTENCE_ENDINGS = [
  'la', 'lah', 'lor', 'leh', 'meh', 'wor', 'hor', 'liao', 'ah',
  '啦', '喽', '咯', '哦', '嘛', '呢', '吧', '~',
];

/** 本地高频短语 · common_phrases · 至少 3 条进 persona */
export const MY_COMMON_PHRASES = [
  '真的吗 la', '我 kena 啦', '酱子咯', 'can can', 'ok can', 'no lah',
  '蛤', '傻眼', '笑死', '吃饱没', '等阵先', 'aiyo',
  '真的假的', '哇塞', 'tapao 回家', '等下咯',
  '不要 lah', '酱也行', '我先 go',
];

/** Emoji · 马华私域常用 · 不太欧美也不太台湾 */
export const MY_EMOJI_PREFERENCE = [
  ['😊', '🙈', '😋', '🤤', '😂', '🥰'], // 温和派
  ['💕', '✨', '🌸', '☕', '🌿', '💅'], // 精致派
  ['🔥', '💯', '🎉', '👀', '😎', '🤯'], // 年轻派
  ['🙏', '❤️', '🤲', '🌙', '🤍'], // 穆斯林元素轻
];

/** 兴趣本地化 · 至少 2 条马华 specific */
export const MY_INTERESTS_LOCAL = [
  '吃 mamak', '找 cafe 打卡', 'Grab 外卖点 nasi lemak', '周末跑 Pasar 巴刹',
  'Bersih 追剧', '逛 1 Utama', '香港茶餐厅', '美妆 haul',
  'K-pop BTS aespa', '马来剧', '下南洋追剧', 'Shopee 促销抢',
  'Lazada double-day', 'TikTok 刷视频', '拜大伯公', '妈祖庙',
];

/** 活跃时段模式 · MY 工作 9:30-18:30 + 宵夜文化 */
export const ACTIVITY_PATTERNS = [
  {
    name: 'office-worker',
    wake_up: '08:30',
    sleep: '23:30',
    peak_hours: ['12:00-13:30', '19:00-22:30'],
    work_hours: '09:30-18:30',
  },
  {
    name: 'homemaker',
    wake_up: '07:00',
    sleep: '23:00',
    peak_hours: ['10:00-12:00', '14:00-16:00', '20:00-22:00'],
    work_hours: null as string | null,
  },
  {
    name: 'night-owl-entrepreneur',
    wake_up: '10:00',
    sleep: '02:00',
    peak_hours: ['14:00-17:00', '21:00-24:00'],
    work_hours: '自由',
  },
];

// ── Prompt 主模板 ──────────────────────────────────────

export interface BuildPersonaPromptParams {
  count: number;
  ethnicity: EthnicityMY; // V1 仅 chinese-malaysian · 其他 throw
  gender_ratio_female?: number;
  style_hint?: string;
}

/**
 * 生成 AI prompt · 让 Provider (Claude/DeepSeek/OpenAI) 按 schema 产 PersonaV1 JSON
 * V1 仅支持 ethnicity=chinese-malaysian · 其他抛 EthnicityNotImplementedError
 */
export function buildPersonaGenPrompt(params: BuildPersonaPromptParams): string {
  assertEthnicityImplementedInV1(params.ethnicity);

  const female_ratio = params.gender_ratio_female ?? 0.6;

  return `你是马来西亚华人社交网络虚拟人设生成器. 产 ${params.count} 个独立 persona, **严格对齐马华私域运营场景**.

# 硬约束 (违一条整批作废)

1. \`ethnicity\` 必须 = "chinese-malaysian" (V1 仅支持此值)
2. 每 persona 必有 \`sentence_endings\` · 3-5 个 · **至少 2 个**取自: ${JSON.stringify(MY_SENTENCE_ENDINGS)}
3. 每 persona 必有 \`common_phrases\` · 4-6 条 · **至少 3 条**取自: ${JSON.stringify(MY_COMMON_PHRASES.slice(0, 10))}
   允许自创类似本地化短语 · 但 **绝对禁止**大陆网络梗 (如"绝绝子" "yyds" "集美")
4. \`city\` 必须从: ${MY_CITIES.map((c) => c.name).join(' / ')}
5. \`occupation\` 必须本地化场景 · 参考: ${MY_OCCUPATIONS.slice(0, 8).join(' / ')}
6. \`interests\` · 5-8 条 · **至少 2 条**本地化 (mamak / 巴刹 / Grab / 拜神 / Shopee 等)
7. \`emoji_preference\` · 4-6 个 · 混用中英文 emoji · 避免 "🇨🇳" 等显露地缘 tag
8. \`activity_schedule.timezone\` === "Asia/Kuala_Lumpur"
9. \`languages.code_switching\` = true · secondary 至少含 "en" "ms" 之一
10. \`age\` 按分布: ${AGE_DISTRIBUTION.map((a) => `${a.range[0]}-${a.range[1]} (${(a.weight * 100).toFixed(0)}%)`).join(', ')}
11. \`gender\` · female 占 ${(female_ratio * 100).toFixed(0)}% · 其余 male
12. \`speech_habits.typing_style\` · 示例 "短句 + 偶尔错字" · "中英夹杂" · **禁止**"文采飞扬"
13. \`country\` = "MY" · \`persona_lock\` = true
14. \`avatar_prompt\` 须英文 · 描述具体可被 Flux text-to-image 理解 · 含 "Chinese Malaysian"

# 输出格式

严格 JSON 数组 · 无 markdown fence · 无 comment · 无 preamble.
每元素为 PersonaV1 结构.

${params.style_hint ? `\n# 风格提示\n${params.style_hint}\n` : ''}

# Example

\`\`\`json
{
  "persona_id": "persona_auto_assigned",
  "display_name": "Jasmine Chen",
  "wa_nickname": "Jas 🌸",
  "gender": "female",
  "age": 28,
  "ethnicity": "chinese-malaysian",
  "country": "MY",
  "city": "Petaling Jaya",
  "occupation": "电商客服",
  "languages": {
    "primary": "zh-CN",
    "secondary": ["en", "ms"],
    "code_switching": true
  },
  "personality": ["开朗", "碎碎念", "爱分享美食"],
  "speech_habits": {
    "sentence_endings": ["lah", "lor", "啦", "咯"],
    "common_phrases": ["真的吗 la", "我 kena 啦", "aiyo", "酱也行"],
    "emoji_preference": ["😊", "🙈", "😋", "🤤"],
    "typing_style": "短句 + 偶尔错字 + 中英夹杂",
    "avg_msg_length": 12
  },
  "interests": ["吃 mamak", "美妆 haul", "K-pop", "找 cafe 打卡", "咖啡"],
  "activity_schedule": {
    "timezone": "Asia/Kuala_Lumpur",
    "wake_up": "08:30",
    "sleep": "23:30",
    "peak_hours": ["12:00-13:30", "19:00-22:30"],
    "work_hours": "09:30-18:30"
  },
  "avatar_prompt": "28-year-old Chinese Malaysian woman, shoulder-length black hair, casual street fashion in Petaling Jaya cafe",
  "signature_candidates": ["吃饱没 🍜", "吃 nasi lemak 是人生意义"],
  "persona_lock": true
}
\`\`\`

# 输出

返 ${params.count} 元素 JSON 数组 · 仅 JSON · 无其他文字.`;
}

// ── Anti-patterns · Validator 应拒 ────────────────────

/** 这些词出现 = 大陆腔 · 批量 regenerate */
export const MAINLAND_LEAKAGE_TERMS = [
  // 大陆网络梗
  // 注: 去掉 'emo' (与 'emoji_preference' 字段名 substring 冲突) · 用多字符明显词
  '绝绝子', 'yyds', '集美', '鸡汤', '内卷', '打工人', '社畜', '躺平', '摆烂',
  // 大陆 app
  '高德地图', '美团', '饿了么', '抖音', '小红书', '微信红包', '支付宝', '淘宝',
  // 大陆城市
  '北京', '上海', '广州', '深圳', '杭州', '成都',
];

/**
 * 简易校验 · 扫 persona 所有 string 字段 · 含 mainland term 返 leaked
 */
export function detectMainlandLeakage(persona: PersonaV1): string[] {
  const leaked: string[] = [];
  const json = JSON.stringify(persona);
  for (const term of MAINLAND_LEAKAGE_TERMS) {
    if (json.includes(term)) leaked.push(term);
  }
  return leaked;
}
