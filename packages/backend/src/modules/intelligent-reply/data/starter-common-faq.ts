// 2026-04-28 · 通用 FAQ starter pack · 给所有 tenant 默认建一份"通用 KB"灌入
//
// 设计原则:
//   1. 中英双语覆盖 · 客户在 WA 上常见的招呼/简短问句都能命中
//   2. answer 用通用占位文案 · 不绑死具体行业 · 不报具体价格 · 不做承诺
//   3. tags 必含 'starter' · 用于 UI 识别 + 后续 AI 优化时筛选
//   4. AI 优化后 → tags 加 'starter-customized' 区分 (UI 显蓝色标)
//
// 12 个场景共 52 条 (问候 8 / 身份 5 / 营业 4 / 联系 5 / 价格 4 /
//                  产品 3 / 优惠 4 / 订单 4 / 退款 3 / 投诉 3 / 转人工 4 / 道别感谢 5)

export interface StarterFaqEntry {
  question: string;
  answer: string;
  tags: string[]; // 必含 'starter' · 加场景标签 + 语言标签
}

export const STARTER_COMMON_FAQ: StarterFaqEntry[] = [
  // ─── 1. 问候 (8 条) ─────────────────────────────────────
  { question: '你好', answer: '你好! 欢迎咨询. 请问有什么可以帮您?', tags: ['starter', 'greeting', 'zh'] },
  { question: '您好', answer: '您好! 很高兴为您服务. 请问有什么可以帮到您?', tags: ['starter', 'greeting', 'zh'] },
  { question: 'Hi', answer: 'Hi! Thanks for reaching out. How may I help you today?', tags: ['starter', 'greeting', 'en'] },
  { question: 'Hello', answer: 'Hello! Welcome. How can I assist you today?', tags: ['starter', 'greeting', 'en'] },
  { question: '在吗', answer: '在的! 请问有什么可以帮您?', tags: ['starter', 'greeting', 'zh'] },
  { question: '早上好', answer: '早上好! 请问有什么可以帮您?', tags: ['starter', 'greeting', 'zh'] },
  { question: '下午好', answer: '下午好! 请问有什么可以帮您?', tags: ['starter', 'greeting', 'zh'] },
  { question: '晚上好', answer: '晚上好! 请问有什么可以帮您?', tags: ['starter', 'greeting', 'zh'] },

  // ─── 2. 身份 / 客服 (5 条) ──────────────────────────────
  { question: '你是谁', answer: '您好, 我是智能客服. 您的问题我会尽量帮您解决, 复杂问题会转给真人同事跟进.', tags: ['starter', 'identity', 'zh'] },
  { question: '你是机器人吗', answer: '是的, 我是智能客服助手. 不过遇到我处理不了的, 会立即帮您转给真人同事.', tags: ['starter', 'identity', 'zh'] },
  { question: 'Are you a bot', answer: 'Yes, I am the AI customer service assistant. For complex issues I will transfer you to a human colleague.', tags: ['starter', 'identity', 'en'] },
  { question: '是真人吗', answer: '我是 AI 助手. 如需要真人客服请回复"人工".', tags: ['starter', 'identity', 'zh'] },
  { question: '真人客服在吗', answer: '需要真人客服请回复"人工", 我会立即帮您转接.', tags: ['starter', 'identity', 'zh'] },

  // ─── 3. 营业时间 (4 条) ─────────────────────────────────
  { question: '几点上班', answer: '我们的客服时间是工作日 9:00-18:00. 其他时间留言我们尽快回复.', tags: ['starter', 'hours', 'zh'] },
  { question: '营业时间', answer: '客服在线时间 9:00-18:00 (工作日). 智能助手 24 小时在线.', tags: ['starter', 'hours', 'zh'] },
  { question: '24 小时吗', answer: '智能客服 24 小时在线 · 真人客服工作日 9-18 点.', tags: ['starter', 'hours', 'zh'] },
  { question: '周末上班吗', answer: '周末真人客服休息, 智能助手在线. 紧急问题留言, 周一优先处理.', tags: ['starter', 'hours', 'zh'] },

  // ─── 4. 联系信息 (5 条) ─────────────────────────────────
  { question: '电话多少', answer: '请稍等, 我让客服把电话发给您 (转人工).', tags: ['starter', 'contact', 'zh'] },
  { question: '地址', answer: '具体地址请联系客服获取. 我先帮您转接.', tags: ['starter', 'contact', 'zh'] },
  { question: '老板是谁', answer: '需要找负责人请说明事项, 我会帮您转给对应同事.', tags: ['starter', 'contact', 'zh'] },
  { question: '加微信', answer: '请稍等, 客服会把联系方式发给您.', tags: ['starter', 'contact', 'zh'] },
  { question: '怎么联系你们', answer: 'WhatsApp 直接说就行 · 真人客服请回复"人工".', tags: ['starter', 'contact', 'zh'] },

  // ─── 5. 价格 (4 条) ─────────────────────────────────────
  { question: '多少钱', answer: '请问您想了解哪类产品的价格? 我可以为您查询.', tags: ['starter', 'price', 'zh'] },
  { question: '怎么收费', answer: '不同产品收费不一. 请告诉我您要了解的具体产品, 我帮您查报价.', tags: ['starter', 'price', 'zh'] },
  { question: '报价', answer: '请告诉我具体需求 · 我帮您整理报价.', tags: ['starter', 'price', 'zh'] },
  { question: '有没有便宜的', answer: '我们有不同价位的产品. 请告诉我您的预算和需求, 我帮您推荐.', tags: ['starter', 'price', 'zh'] },

  // ─── 6. 产品 (3 条) ─────────────────────────────────────
  { question: '有什么产品', answer: '我们提供多种产品/服务. 请告诉我您的具体需求, 我为您介绍合适的.', tags: ['starter', 'product', 'zh'] },
  { question: '介绍一下', answer: '请问您想了解哪方面? 产品分类 / 价格 / 案例 / 流程 都可以. 您说一下需求方向.', tags: ['starter', 'product', 'zh'] },
  { question: '你们卖什么', answer: '请问您具体想找什么? 我帮您推荐合适的产品.', tags: ['starter', 'product', 'zh'] },

  // ─── 7. 优惠 / 活动 (4 条) ──────────────────────────────
  { question: '有优惠吗', answer: '当前活动以最新公告为准, 我帮您转人工查最新优惠.', tags: ['starter', 'promo', 'zh'] },
  { question: '打折', answer: '不同时段有不同优惠, 我帮您转人工提供最新方案.', tags: ['starter', 'promo', 'zh'] },
  { question: '活动', answer: '具体活动详情, 真人客服会发给您 (转人工).', tags: ['starter', 'promo', 'zh'] },
  { question: '新人有优惠吗', answer: '我们对新客户有专属优惠, 详情让客服跟您说.', tags: ['starter', 'promo', 'zh'] },

  // ─── 8. 订单 / 发货 (4 条) ──────────────────────────────
  { question: '我的订单', answer: '请提供订单号, 我帮您查进度.', tags: ['starter', 'order', 'zh'] },
  { question: '物流', answer: '请发订单号, 我帮您查物流.', tags: ['starter', 'order', 'zh'] },
  { question: '多久到', answer: '一般 1-3 天发货, 3-7 天到货. 具体看产品和地区. 留下订单号我帮您查.', tags: ['starter', 'order', 'zh'] },
  { question: '发货了吗', answer: '请告诉我订单号, 我帮您查发货状态.', tags: ['starter', 'order', 'zh'] },

  // ─── 9. 退款 / 售后 (3 条) ──────────────────────────────
  { question: '能退吗', answer: '在 7 天内未使用可退. 请发订单号, 我帮您处理.', tags: ['starter', 'refund', 'zh'] },
  { question: '怎么退货', answer: '请发订单号 + 退货原因, 客服会安排.', tags: ['starter', 'refund', 'zh'] },
  { question: '不喜欢能退吗', answer: '在 7 天内符合退货条件可退. 详情让客服跟您确认.', tags: ['starter', 'refund', 'zh'] },

  // ─── 10. 投诉 (3 条) ────────────────────────────────────
  { question: '投诉', answer: '非常抱歉给您带来不便. 请告诉我具体情况, 我立即帮您转给负责人.', tags: ['starter', 'complaint', 'zh'] },
  { question: '不满意', answer: '抱歉让您不开心. 请告诉我具体问题, 我立即转给同事处理.', tags: ['starter', 'complaint', 'zh'] },
  { question: '太慢了', answer: '抱歉让您等了. 我立即帮您转人工加急处理.', tags: ['starter', 'complaint', 'zh'] },

  // ─── 11. 转人工 (4 条) ──────────────────────────────────
  { question: '人工', answer: '好的, 正在为您转接真人客服, 请稍等...', tags: ['starter', 'handoff', 'zh'] },
  { question: '客服', answer: '正在为您转接客服, 请稍等...', tags: ['starter', 'handoff', 'zh'] },
  { question: '真人', answer: '好的, 正在为您转接真人客服...', tags: ['starter', 'handoff', 'zh'] },
  { question: '不要机器人', answer: '明白, 立即转给真人客服, 请稍等.', tags: ['starter', 'handoff', 'zh'] },

  // ─── 12. 道别 / 感谢 / 简短 ack (5 条) ──────────────────
  { question: '再见', answer: '再见! 后续有问题随时找我.', tags: ['starter', 'farewell', 'zh'] },
  { question: 'Bye', answer: 'Bye! Feel free to reach out anytime if you have more questions.', tags: ['starter', 'farewell', 'en'] },
  { question: '谢谢', answer: '不客气! 还有其他问题尽管说.', tags: ['starter', 'thanks', 'zh'] },
  { question: 'OK', answer: '好的, 还有其他需要帮忙的吗?', tags: ['starter', 'ack', 'zh'] },
  { question: '好的', answer: '收到. 还有问题随时说哦.', tags: ['starter', 'ack', 'zh'] },
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
