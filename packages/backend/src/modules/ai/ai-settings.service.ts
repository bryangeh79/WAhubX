import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSettingEntity } from '../../common/app-setting.entity';

const KEY_TEXT_ENABLED = 'ai.text_enabled';
const KEY_MARKETING_PROMPT = 'ai.marketing_system_prompt';

// 2026-04-24 · 默认营销人设 (租户可在 AI 配置覆盖)
// 用途: 广告 + 开场白 AI 变体生成时注入 system prompt
// 关键规则: 保留联系方式
export const DEFAULT_MARKETING_PROMPT = `你是 WAhubX 的高级营销型 AI 助手, 专门负责广告文案、客户沟通和销售转化.

你的目标: 帮用户把产品表达得更清楚、更有吸引力、更容易让客户产生兴趣. 文案必须适合 WhatsApp 发送 · 简短、自然、可信、有行动引导.

你擅长: 广告文案 / 产品介绍 / 功能卖点 / WhatsApp 群发内容 / 销售话术优化 / 客户疑问回复 / 多个广告变体生成.

风格: 专业、自然、简洁、有说服力 · 不夸张、不虚假、不像机器人.

每次生成优先考虑: 客户为什么需要这个产品? 能帮客户节省什么? 下一步应该做什么?

结尾尽量加入行动引导, 例如:
- 想了解更多, 可以 WhatsApp 联系我们.
- 需要 demo, 可以联系我安排.
- 想看系统效果, 可以预约演示.

⚠️ 最重要规则 · 联系方式必须原样保留:
当你优化 / 改写 / 扩写 / 缩短 / 翻译 / 生成变体时, 如果原文包含任何联系信息, 必须 100% 完整保留 · 不删除 · 不改错 · 不替换.

必须原样保留的信息类型:
- WhatsApp 链接 (如 https://wa.me/xxx)
- 电话号码
- 网站链接 (如 https://xxx.com)
- Email
- 公司名称 / 地址
- Telegram / Facebook / Instagram / TikTok 等社交账号
- CTA 联系句, 如"联系我们"/"点击了解更多"/"预约演示"

原文有联系方式 · 所有变体必须带上相同联系方式. 可优化正文、标题、卖点、语气, 但不能删除或改动底部联系方式.`;

@Injectable()
export class AiSettingsService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(AppSettingEntity) private readonly settingRepo: Repository<AppSettingEntity>,
  ) {}

  async isTextEnabled(): Promise<boolean> {
    const row = await this.settingRepo.findOne({ where: { key: KEY_TEXT_ENABLED } });
    if (row) return row.value === 'true';
    return this.config.get<string>('AI_TEXT_ENABLED', 'false') === 'true';
  }

  async setTextEnabled(enabled: boolean): Promise<boolean> {
    await this.settingRepo.save({ key: KEY_TEXT_ENABLED, value: enabled ? 'true' : 'false' });
    return enabled;
  }

  // 2026-04-24 · 营销人设 · 专给广告/开场白 AI 变体用 · 跟 ScriptRunner 聊天改写分开
  async getMarketingPrompt(): Promise<string> {
    const row = await this.settingRepo.findOne({ where: { key: KEY_MARKETING_PROMPT } });
    if (row && row.value.trim().length > 0) return row.value;
    return DEFAULT_MARKETING_PROMPT;
  }

  async setMarketingPrompt(prompt: string): Promise<string> {
    const trimmed = prompt.trim();
    await this.settingRepo.save({ key: KEY_MARKETING_PROMPT, value: trimmed });
    return trimmed;
  }

  async resetMarketingPrompt(): Promise<string> {
    await this.settingRepo.delete({ key: KEY_MARKETING_PROMPT });
    return DEFAULT_MARKETING_PROMPT;
  }

  async snapshot(): Promise<Record<string, string>> {
    const rows = await this.settingRepo
      .createQueryBuilder('s')
      .where('s.key LIKE :prefix', { prefix: 'ai.%' })
      .getMany();
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key.replace(/^ai\./, '')] = r.value;
    if (out.text_enabled === undefined) {
      out.text_enabled = this.config.get<string>('AI_TEXT_ENABLED', 'false');
    }
    // 永远把 marketing prompt 暴露 (前端 UI 要回显)
    if (out.marketing_system_prompt === undefined || out.marketing_system_prompt.trim().length === 0) {
      out.marketing_system_prompt = DEFAULT_MARKETING_PROMPT;
    }
    return out;
  }
}
