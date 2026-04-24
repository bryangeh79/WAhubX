// 2026-04-22 · Status Post 种子文案库 · V1 种子 30-50 条
// 支持 tag 筛选 · 马来华语本土化
//
// 字段:
//   - tags: 行业 / 场景标签
//   - text: 文案本体
//   - emoji: 可选附加表情
//
// 使用方法:
//   const pool = STATUS_POST_SEEDS.filter(s => !tags || s.tags.some(t => tags.includes(t)));
//   const pick = pool[Math.floor(Math.random() * pool.length)];

export interface StatusPostSeed {
  id: string;
  text: string;
  tags: string[];
  language: 'zh' | 'en' | 'ms';
}

export const STATUS_POST_SEEDS: StatusPostSeed[] = [
  // 问候类 · 零配置默认池
  { id: 'g001', text: '早安 ☀️ 新的一天加油', tags: ['greeting', 'morning'], language: 'zh' },
  { id: 'g002', text: '下午好 · 咖啡时间 ☕', tags: ['greeting', 'afternoon'], language: 'zh' },
  { id: 'g003', text: '晚安 · 好梦 🌙', tags: ['greeting', 'night'], language: 'zh' },
  { id: 'g004', text: 'Weekend mood 😎', tags: ['greeting', 'weekend'], language: 'en' },
  { id: 'g005', text: 'Selamat pagi 🌞', tags: ['greeting', 'morning'], language: 'ms' },

  // 生活类
  { id: 'l001', text: '今天吃什么好呢 🤔', tags: ['lifestyle', 'food'], language: 'zh' },
  { id: 'l002', text: '忙到飞起 😅', tags: ['lifestyle', 'work'], language: 'zh' },
  { id: 'l003', text: '周末该放松一下 🏖️', tags: ['lifestyle', 'weekend'], language: 'zh' },
  { id: 'l004', text: '刚看完一本好书 📖', tags: ['lifestyle', 'reading'], language: 'zh' },
  { id: 'l005', text: 'Best nasi lemak ever 🤤', tags: ['lifestyle', 'food', 'malaysia'], language: 'en' },

  // 正能量类
  { id: 'p001', text: '每一天都是新机会', tags: ['motivation'], language: 'zh' },
  { id: 'p002', text: '不要怕累 · 努力值得', tags: ['motivation'], language: 'zh' },
  { id: 'p003', text: 'Stay positive 💪', tags: ['motivation'], language: 'en' },
  { id: 'p004', text: 'Small steps · big dreams', tags: ['motivation'], language: 'en' },

  // 商业类 (适合微商 · 业务号)
  { id: 'b001', text: '新品到货 · 欢迎询价 📦', tags: ['business', 'promo'], language: 'zh' },
  { id: 'b002', text: '感谢支持 · 生意兴隆 🙏', tags: ['business', 'thanks'], language: 'zh' },
  { id: 'b003', text: '今日优惠 · PM 我 📩', tags: ['business', 'promo'], language: 'zh' },
  { id: 'b004', text: 'New arrivals · DM me 📩', tags: ['business', 'promo'], language: 'en' },

  // 天气类
  { id: 'w001', text: '今天好热 🥵', tags: ['weather', 'hot'], language: 'zh' },
  { id: 'w002', text: '下雨了 · 开车小心 🌧️', tags: ['weather', 'rain'], language: 'zh' },

  // 健身 / 运动
  { id: 's001', text: '今天健身打卡 💪', tags: ['fitness'], language: 'zh' },
  { id: 's002', text: '早跑 · 一身汗 🏃', tags: ['fitness', 'morning'], language: 'zh' },

  // 节日类 · 马来西亚
  { id: 'f001', text: '新年快乐 恭喜发财 🧧', tags: ['festival', 'cny', 'malaysia'], language: 'zh' },
  { id: 'f002', text: 'Selamat Hari Raya 🕌', tags: ['festival', 'raya', 'malaysia'], language: 'ms' },
  { id: 'f003', text: 'Happy Deepavali 🪔', tags: ['festival', 'deepavali', 'malaysia'], language: 'en' },

  // 通用感叹
  { id: 'u001', text: '心情不错 😊', tags: ['mood', 'happy'], language: 'zh' },
  { id: 'u002', text: '有点累 · 需要休息 😴', tags: ['mood', 'tired'], language: 'zh' },
  { id: 'u003', text: 'Good vibes only ✨', tags: ['mood', 'happy'], language: 'en' },
];

export function pickStatusPostSeed(opts: { tags?: string[]; language?: 'zh' | 'en' | 'ms' } = {}): StatusPostSeed {
  let pool = STATUS_POST_SEEDS;
  if (opts.tags && opts.tags.length > 0) {
    pool = pool.filter((s) => s.tags.some((t) => opts.tags!.includes(t)));
  }
  if (opts.language) {
    pool = pool.filter((s) => s.language === opts.language);
  }
  if (pool.length === 0) pool = STATUS_POST_SEEDS; // 兜底
  return pool[Math.floor(Math.random() * pool.length)];
}

export function listSeedTags(): Array<{ tag: string; count: number }> {
  const tagCount = new Map<string, number>();
  for (const s of STATUS_POST_SEEDS) {
    for (const t of s.tags) {
      tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }
  }
  return Array.from(tagCount.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}
