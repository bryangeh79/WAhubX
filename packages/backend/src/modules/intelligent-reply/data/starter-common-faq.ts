// 2026-04-28 · 通用 FAQ starter pack · 给所有 tenant 默认建一份"通用 KB"灌入
//
// 设计原则:
//   1. 中英双语覆盖 · 客户在 WA 上常见的招呼/简短问句都能命中
//   2. answer 用通用占位文案 + 占位符 (不绑死具体行业)
//   3. tags 必含 'starter' · 用于 UI 识别 + 后续 AI 优化时筛选
//   4. AI 优化后 → tags 加 'starter-customized' 区分 (UI 显蓝色标)
//
// 2026-04-29 · V2.2 R2/R3 升级:
//   - answer 支持占位符: {{tenantName}} / {{companyName}} / {{botName}}
//     灌入时 (seedCommonFaqs) 按当前 tenant 替换:
//       companyName fallback → tenant.name
//       botName     fallback → "AI 智能客服"
//       tenantName  fallback → tenant.name
//   - variants?: string[] · 客户真实问法 · 灌入时塞 tags 为 'var:xxx' 前缀
//     reply-executor.matchFaq 跨 canonical + 全 variants 取最高 jaccard
//
// 13 个场景共 ~55 条:
//   问候 8 / 身份 5 / 营业 4 / 联系 5 / 价格 4 / 产品 3 /
//   优惠 4 / 订单 4 / 退款 3 / 投诉 3 / 转人工 4 / 道别感谢 5 / 闲聊兜底 (R3 加)

export interface StarterFaqEntry {
  question: string;
  answer: string;             // 可含 {{tenantName}} / {{companyName}} / {{botName}} 占位符
  tags: string[];             // 必含 'starter' · 加场景标签 + 语言标签
  variants?: string[];        // 客户真实问法 (灌入时塞 tags 为 var:xxx)
}

export const STARTER_COMMON_FAQ: StarterFaqEntry[] = [
  // ─── 1. 问候 (8 条) ─────────────────────────────────────
  {
    question: '你好',
    answer: '你好! 欢迎咨询. 请问有什么可以帮您?',
    tags: ['starter', 'greeting', 'zh'],
    variants: ['您好', '妳好', '嗨', '哈喽', '哈罗', '在吗', '在不在', 'hi 你好'],
  },
  {
    question: '您好',
    answer: '您好! 很高兴为您服务. 请问有什么可以帮到您?',
    tags: ['starter', 'greeting', 'zh'],
  },
  {
    question: 'Hi',
    answer: 'Hi! Thanks for reaching out. How may I help you today?',
    tags: ['starter', 'greeting', 'en'],
    variants: ['hi', 'hi there', 'hey', 'hey there'],
  },
  {
    question: 'Hello',
    answer: 'Hello! Welcome. How can I assist you today?',
    tags: ['starter', 'greeting', 'en'],
    variants: ['hello', 'hello there', 'good day'],
  },
  { question: '在吗', answer: '在的! 请问有什么可以帮您?', tags: ['starter', 'greeting', 'zh'], variants: ['在不在', '人在吗', '有人吗'] },
  { question: '早上好', answer: '早上好! 请问有什么可以帮您?', tags: ['starter', 'greeting', 'zh'], variants: ['早安', 'good morning', '早'] },
  { question: '下午好', answer: '下午好! 请问有什么可以帮您?', tags: ['starter', 'greeting', 'zh'], variants: ['午安', 'good afternoon'] },
  { question: '晚上好', answer: '晚上好! 请问有什么可以帮您?', tags: ['starter', 'greeting', 'zh'], variants: ['晚安', 'good evening'] },

  // ─── 2. 身份 / 客服 (5 条) — 用占位符 ────────────────────
  {
    question: '你是谁',
    answer: '您好, 我是 {{companyName}} 的 {{botName}}. 您的问题我会尽量帮您解决, 复杂问题会转给真人同事跟进.',
    tags: ['starter', 'identity', 'zh'],
    variants: ['你是哪位', '您是哪位', '请问您是', '你哪位'],
  },
  {
    question: '你是机器人吗',
    answer: '是的, 我是 {{companyName}} 的 {{botName}}. 不过遇到我处理不了的, 会立即帮您转给真人同事.',
    tags: ['starter', 'identity', 'zh'],
    variants: ['你是不是机器人', '是机器人吗', '是不是 AI', '是 AI 吗', '是真人吗', '你是真人吗', '机器人?', 'AI?'],
  },
  {
    question: 'Are you a bot',
    answer: 'Yes, I am the AI assistant of {{companyName}}. For complex issues I will transfer you to a human colleague.',
    tags: ['starter', 'identity', 'en'],
    variants: ['are you ai', 'are you human', 'is this a bot', 'real person?'],
  },
  {
    question: '是真人吗',
    answer: '我是 {{botName}} (AI 助手). 如需要真人客服请回复"人工".',
    tags: ['starter', 'identity', 'zh'],
    variants: ['你是真人?', '人还是机器'],
  },
  {
    question: '真人客服在吗',
    answer: '需要真人客服请回复"人工", 我会立即帮您转接.',
    tags: ['starter', 'identity', 'zh'],
    variants: ['人工客服在吗', '客服在吗', '真人在吗', '有真人吗'],
  },

  // ─── 3. 营业时间 (4 条) ─────────────────────────────────
  { question: '几点上班', answer: '我们的客服时间是工作日 9:00-18:00. 其他时间留言我们尽快回复.', tags: ['starter', 'hours', 'zh'], variants: ['什么时候上班', '上班时间', '客服几点'] },
  { question: '营业时间', answer: '客服在线时间 9:00-18:00 (工作日). 智能助手 24 小时在线.', tags: ['starter', 'hours', 'zh'], variants: ['几点营业', '什么时候营业'] },
  { question: '24 小时吗', answer: '智能客服 24 小时在线 · 真人客服工作日 9-18 点.', tags: ['starter', 'hours', 'zh'], variants: ['全天吗', '通宵吗'] },
  { question: '周末上班吗', answer: '周末真人客服休息, 智能助手在线. 紧急问题留言, 周一优先处理.', tags: ['starter', 'hours', 'zh'], variants: ['周末有人吗', '星期六上班吗', '星期天上班吗'] },

  // ─── 4. 联系信息 (5 条) ─────────────────────────────────
  { question: '电话多少', answer: '请稍等, 我让客服把电话发给您 (转人工).', tags: ['starter', 'contact', 'zh'], variants: ['电话号码', '联系电话', '怎么打电话', '号码多少'] },
  { question: '地址', answer: '具体地址请联系客服获取. 我先帮您转接.', tags: ['starter', 'contact', 'zh'], variants: ['公司在哪', '在哪里', '位置在哪'] },
  { question: '老板是谁', answer: '需要找负责人请说明事项, 我会帮您转给对应同事.', tags: ['starter', 'contact', 'zh'], variants: ['找老板', '找负责人', '找经理'] },
  { question: '加微信', answer: '请稍等, 客服会把联系方式发给您.', tags: ['starter', 'contact', 'zh'], variants: ['加微信吗', '有微信吗', '加你微信'] },
  { question: '怎么联系你们', answer: 'WhatsApp 直接说就行 · 真人客服请回复"人工".', tags: ['starter', 'contact', 'zh'], variants: ['怎么联系', '联系方式', '怎么找你们'] },

  // ─── 5. 价格 (4 条) ─────────────────────────────────────
  { question: '多少钱', answer: '请问您想了解哪类产品的价格? 我可以为您查询.', tags: ['starter', 'price', 'zh'], variants: ['啥价钱', '什么价位'] },
  { question: '怎么收费', answer: '不同产品收费不一. 请告诉我您要了解的具体产品, 我帮您查报价.', tags: ['starter', 'price', 'zh'], variants: ['如何收费', '收费方式', '怎么算钱'] },
  { question: '报价', answer: '请告诉我具体需求 · 我帮您整理报价.', tags: ['starter', 'price', 'zh'], variants: ['给我报价', '要报价'] },
  { question: '有没有便宜的', answer: '我们有不同价位的产品. 请告诉我您的预算和需求, 我帮您推荐.', tags: ['starter', 'price', 'zh'], variants: ['有便宜的吗', '便宜点', '划算的'] },

  // ─── 6. 产品 (3 条) ─────────────────────────────────────
  { question: '有什么产品', answer: '我们提供多种产品/服务. 请告诉我您的具体需求, 我为您介绍合适的.', tags: ['starter', 'product', 'zh'], variants: ['什么产品', '都有什么', '都卖啥'] },
  { question: '介绍一下', answer: '请问您想了解哪方面? 产品分类 / 价格 / 案例 / 流程 都可以. 您说一下需求方向.', tags: ['starter', 'product', 'zh'], variants: ['介绍下', '简单介绍', '说说看'] },
  { question: '你们卖什么', answer: '请问您具体想找什么? 我帮您推荐合适的产品.', tags: ['starter', 'product', 'zh'], variants: ['你们做什么', '主营什么'] },

  // ─── 7. 优惠 / 活动 (4 条) ──────────────────────────────
  { question: '有优惠吗', answer: '当前活动以最新公告为准, 我帮您转人工查最新优惠.', tags: ['starter', 'promo', 'zh'], variants: ['有活动吗', '有折扣吗'] },
  { question: '打折', answer: '不同时段有不同优惠, 我帮您转人工提供最新方案.', tags: ['starter', 'promo', 'zh'], variants: ['有折扣', '能打几折'] },
  { question: '活动', answer: '具体活动详情, 真人客服会发给您 (转人工).', tags: ['starter', 'promo', 'zh'] },
  { question: '新人有优惠吗', answer: '我们对新客户有专属优惠, 详情让客服跟您说.', tags: ['starter', 'promo', 'zh'], variants: ['新人优惠', '第一次有优惠吗'] },

  // ─── 8. 订单 / 发货 (4 条) ──────────────────────────────
  { question: '我的订单', answer: '请提供订单号, 我帮您查进度.', tags: ['starter', 'order', 'zh'], variants: ['订单进度', '查订单'] },
  { question: '物流', answer: '请发订单号, 我帮您查物流.', tags: ['starter', 'order', 'zh'], variants: ['查物流', '快递到哪了'] },
  { question: '多久到', answer: '一般 1-3 天发货, 3-7 天到货. 具体看产品和地区. 留下订单号我帮您查.', tags: ['starter', 'order', 'zh'], variants: ['几天到', '送货时间'] },
  { question: '发货了吗', answer: '请告诉我订单号, 我帮您查发货状态.', tags: ['starter', 'order', 'zh'], variants: ['发货没', '什么时候发货'] },

  // ─── 9. 退款 / 售后 (3 条) ──────────────────────────────
  { question: '能退吗', answer: '在 7 天内未使用可退. 请发订单号, 我帮您处理.', tags: ['starter', 'refund', 'zh'], variants: ['可以退吗', '可不可以退'] },
  { question: '怎么退货', answer: '请发订单号 + 退货原因, 客服会安排.', tags: ['starter', 'refund', 'zh'], variants: ['退货流程', '怎么退'] },
  { question: '不喜欢能退吗', answer: '在 7 天内符合退货条件可退. 详情让客服跟您确认.', tags: ['starter', 'refund', 'zh'] },

  // ─── 10. 投诉 (3 条) ────────────────────────────────────
  { question: '投诉', answer: '非常抱歉给您带来不便. 请告诉我具体情况, 我立即帮您转给负责人.', tags: ['starter', 'complaint', 'zh'], variants: ['我要投诉', '投诉一下'] },
  { question: '不满意', answer: '抱歉让您不开心. 请告诉我具体问题, 我立即转给同事处理.', tags: ['starter', 'complaint', 'zh'], variants: ['不开心', '体验不好'] },
  { question: '太慢了', answer: '抱歉让您等了. 我立即帮您转人工加急处理.', tags: ['starter', 'complaint', 'zh'], variants: ['太慢', '速度慢'] },

  // ─── 11. 转人工 (4 条) ──────────────────────────────────
  { question: '人工', answer: '好的, 正在为您转接真人客服, 请稍等...', tags: ['starter', 'handoff', 'zh'], variants: ['转人工', '要人工', '找人工'] },
  { question: '客服', answer: '正在为您转接客服, 请稍等...', tags: ['starter', 'handoff', 'zh'], variants: ['转客服', '要客服'] },
  { question: '真人', answer: '好的, 正在为您转接真人客服...', tags: ['starter', 'handoff', 'zh'], variants: ['真人客服', '找真人'] },
  { question: '不要机器人', answer: '明白, 立即转给真人客服, 请稍等.', tags: ['starter', 'handoff', 'zh'], variants: ['不想跟机器人', '机器人不行'] },

  // ─── 12. 道别 / 感谢 / 简短 ack (5 条) ──────────────────
  { question: '再见', answer: '再见! 后续有问题随时找我.', tags: ['starter', 'farewell', 'zh'], variants: ['拜拜', '88', 'bye bye'] },
  { question: 'Bye', answer: 'Bye! Feel free to reach out anytime if you have more questions.', tags: ['starter', 'farewell', 'en'], variants: ['bye', 'goodbye', 'see you'] },
  { question: '谢谢', answer: '不客气! 还有其他问题尽管说.', tags: ['starter', 'thanks', 'zh'], variants: ['多谢', '感谢', '谢谢您', 'thanks', 'thank you'] },
  { question: 'OK', answer: '好的, 还有其他需要帮忙的吗?', tags: ['starter', 'ack', 'zh'], variants: ['ok', '收到', '行'] },
  { question: '好的', answer: '收到. 还有问题随时说哦.', tags: ['starter', 'ack', 'zh'], variants: ['嗯', '嗯嗯', '👍', '可以'] },

  // ─── 13. R3 闲聊兜底 (3 条 · 客户跑题时简短拉回业务) ────
  {
    question: '你吃饭了吗',
    answer: '哈哈, 我是 {{companyName}} 的 {{botName}} 😊 您是想了解产品功能、价格、开通流程, 还是需要我帮您转人工呢?',
    tags: ['starter', 'off_topic', 'zh'],
    variants: ['吃饭了吗', '你吃了吗', '吃了吗', '吃饭没', '吃了没'],
  },
  {
    question: '今天天气怎样',
    answer: '我主要负责产品咨询哦 😊 您是想了解产品、价格、还是预约/转人工呢?',
    tags: ['starter', 'off_topic', 'zh'],
    variants: ['天气怎么样', '今天天气', '天气如何', '今天忙吗', '今天怎样'],
  },
  {
    question: '可以聊天吗',
    answer: '我主要是 {{companyName}} 的 {{botName}}, 帮您解答产品咨询哦 😊 想了解什么直接说就行!',
    tags: ['starter', 'off_topic', 'zh'],
    variants: ['和你聊', '聊聊', '陪我聊', '哈哈哈', '哈哈'],
  },
];

/**
 * 通用 KB 元信息
 */
export const COMMON_KB_META = {
  name: '通用 FAQ',
  description:
    '适用所有产品 · 问候 / 身份 / 转人工 / 道别 等共性问答 · 用户问题在产品 KB 找不到时自动 fallback 到这里',
  goalPrompt: '友善亲切回答常见问候和通用问题 · 引导客户说出具体需求 · 复杂问题转人工',
  language: 'zh',
};

/**
 * 2026-04-29 · V2.2 · starter answer 占位符替换
 *   {{companyName}} → ctx.companyName ?? tenant.name ?? '本公司'
 *   {{tenantName}}  → ctx.tenantName  ?? tenant.name ?? '本公司'
 *   {{botName}}     → ctx.botName     ?? 'AI 智能客服'
 */
export interface StarterTemplateContext {
  companyName?: string | null;
  tenantName?: string | null;
  botName?: string | null;
}

export function resolveStarterTemplate(
  template: string,
  ctx: StarterTemplateContext,
): string {
  const company = (ctx.companyName ?? ctx.tenantName ?? '本公司').trim() || '本公司';
  const tenant = (ctx.tenantName ?? ctx.companyName ?? '本公司').trim() || '本公司';
  const bot = (ctx.botName ?? 'AI 智能客服').trim() || 'AI 智能客服';
  return template
    .replace(/\{\{\s*companyName\s*\}\}/g, company)
    .replace(/\{\{\s*tenantName\s*\}\}/g, tenant)
    .replace(/\{\{\s*botName\s*\}\}/g, bot);
}
