import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountHealthEntity, RiskLevel } from '../slots/account-health.entity';
import { RiskEventEntity, RiskEventCode } from './risk-event.entity';
import { RiskEventService } from './risk-event.service';
import { HealthSettingsService } from './health-settings.service';

// 健康分引擎 · §5.4 公式
//   baseline 100
//   - 验证码 × 5
//   - 被举报 × 15
//   - 发送失败率 × 100       (rate = send_failed count / (send_failed + normal_sent), 取 account_health 累计)
//   - 加好友被拒比例 × 20     (rate = rejected / (rejected + accepted))
//   - 同 IP 被封 × 10
//   + 连续在线天数 × 0.2 (max +20)
//   + 通讯录规模 × 0.1 (max +10)
//   + 自然消息接收占比 × 15
//
// 滚动窗口 (用户 2026-04-20 加固 #2): 所有 "次数" 累加 at > now - window
//   default 30 天, settings health.scoring_window_days 可配
//   理由: 6 个月前一次验证码不应永远扣分

export interface ScoreBreakdown {
  rule: string;
  delta: number;                  // +/- 实际扣分或加分
  count?: number;                 // 事件次数 (次数类 rules)
  value?: number | string;        // 其他 rules 的 raw 值 (e.g. online_days=12)
  explanation: string;            // UX tooltip 用教育性说明
}

export interface ScoreResult {
  accountId: number;
  score: number;
  riskLevel: RiskLevel;
  breakdown: ScoreBreakdown[];
  windowDays: number;
  computedAt: Date;
}

@Injectable()
export class HealthScorerService {
  private readonly logger = new Logger(HealthScorerService.name);

  constructor(
    @InjectRepository(AccountHealthEntity) private readonly healthRepo: Repository<AccountHealthEntity>,
    private readonly events: RiskEventService,
    private readonly settings: HealthSettingsService,
  ) {}

  /**
   * rescore · 从 risk_event 滚动窗口 + account_health 当前状态算分.
   * 总是写 DB (即使 dry_run), 返 ScoreResult.
   * dry_run 不影响算分, 只影响后续 auto-degrade 行为 (由调用方判断).
   */
  async rescore(accountId: number, now: Date = new Date()): Promise<ScoreResult> {
    const windowDays = await this.settings.getScoringWindowDays();
    const events = await this.events.findWithinWindow(accountId, windowDays);
    const prevHealth = await this.healthRepo.findOne({ where: { accountId } });

    const breakdown = this.compute(events, prevHealth);
    const score = Math.max(0, Math.min(100, Math.round(
      100 + breakdown.reduce((s, b) => s + b.delta, 0),
    )));
    const riskLevel = this.toRiskLevel(score);

    // 持久化. history 追加最新扣分明细摘要 (最多保 20 条, 避免 JSONB 膨胀)
    const flagsMeta = { at: now.toISOString(), score, riskLevel, windowDays };
    const entity = prevHealth ?? this.healthRepo.create({
      accountId,
      healthScore: 100,
      riskLevel: RiskLevel.Low,
      riskFlags: [],
      totalSent: 0,
      totalReceived: 0,
    });
    entity.healthScore = score;
    entity.riskLevel = riskLevel;
    entity.lastIncident = flagsMeta as unknown as Record<string, unknown>;
    // 追加一条 snapshot 到 risk_flags (简要, 扣分条数 + level)
    const flags = Array.isArray(entity.riskFlags) ? [...entity.riskFlags] : [];
    flags.push({
      code: 'rescore',
      severity: 'info',
      at: now.toISOString(),
    });
    entity.riskFlags = flags.slice(-20);
    await this.healthRepo.save(entity);

    this.logger.log(
      `rescore acc=${accountId} · score=${score} level=${riskLevel} · events=${events.length} window=${windowDays}d`,
    );
    return { accountId, score, riskLevel, breakdown, windowDays, computedAt: now };
  }

  /**
   * 纯函数式算分 · 可单独单测. 传 events + prev health state 返明细.
   */
  compute(
    events: RiskEventEntity[],
    prevHealth: AccountHealthEntity | null,
  ): ScoreBreakdown[] {
    const breakdown: ScoreBreakdown[] = [];
    const countOf = (code: string) => events.filter((e) => e.code === code).length;

    // 扣分项
    const captcha = countOf(RiskEventCode.CaptchaTriggered);
    if (captcha > 0) {
      breakdown.push({
        rule: 'captcha_triggered',
        delta: -captcha * 5,
        count: captcha,
        explanation: `触发 ${captcha} 次验证码 · 每次 -5 · WA 侧对该号存疑, 需降频保号`,
      });
    }

    const reported = countOf(RiskEventCode.Reported);
    if (reported > 0) {
      breakdown.push({
        rule: 'reported',
        delta: -reported * 15,
        count: reported,
        explanation: `被举报 ${reported} 次 · 每次 -15 · 严重信号, 封号概率显著升高`,
      });
    }

    const rejected = countOf(RiskEventCode.FriendRejected);
    if (rejected > 0) {
      // §5.4 原文"加好友被拒比例 × 20" — 比例无分母数据时按次数估算 (每次视为 5% 比率)
      const proxy = Math.min(1, rejected * 0.05);
      breakdown.push({
        rule: 'friend_rejected',
        delta: -Math.round(proxy * 20),
        count: rejected,
        explanation: `加好友被拒 ${rejected} 次 · 按 5%/次 估算扣分 · 目标用户对该号排斥`,
      });
    }

    const sameIp = countOf(RiskEventCode.SameIpBanned);
    if (sameIp > 0) {
      breakdown.push({
        rule: 'same_ip_banned',
        delta: -sameIp * 10,
        count: sameIp,
        explanation: `同 IP 组其他号被封 ${sameIp} 次 · 每次 -10 · §B.15 IP 组连坐风险`,
      });
    }

    // 发送失败率 (取 prev_health 累计 — 注: 账号级累计数据, 不严格是窗口内)
    if (prevHealth && prevHealth.totalSent > 0) {
      const failRate = parseFloat(prevHealth.sendFailRate ?? '0');
      if (failRate > 0) {
        breakdown.push({
          rule: 'send_fail_rate',
          delta: -Math.round(failRate * 100),
          value: `${(failRate * 100).toFixed(1)}%`,
          explanation: `发送失败率 ${(failRate * 100).toFixed(1)}% · WA 在限制该号下行能力`,
        });
      }
    }

    // 加分项 — 从 prev health 字段推算 (累计), M8 不从滚动窗口取
    if (prevHealth) {
      // 连续在线天数: 用 last_incident.online_streak_days (M8 scope 不接, 保留字段预估 0)
      // 通讯录规模: 用 wa_contact count — 先用 account_health.totalReceived 做代理 (收过消息≈有联系人)
      const contactProxy = Math.min(10, Math.round((prevHealth.totalReceived ?? 0) * 0.1));
      if (contactProxy > 0) {
        breakdown.push({
          rule: 'contact_scale',
          delta: contactProxy,
          value: prevHealth.totalReceived,
          explanation: `通讯录估算 +${contactProxy} · 活跃号累计收过 ${prevHealth.totalReceived} 条消息, 加分 (上限 +10)`,
        });
      }
      // 自然消息占比 = received / (received + sent). 接近 50% 最自然 (人聊两边都说话)
      const total = (prevHealth.totalReceived ?? 0) + (prevHealth.totalSent ?? 0);
      if (total > 20) {
        const recvRatio = (prevHealth.totalReceived ?? 0) / total;
        const balanced = 1 - Math.abs(recvRatio - 0.5) * 2; // 0..1, 越接近 50/50 越高
        const bonus = Math.round(balanced * 15);
        if (bonus > 0) {
          breakdown.push({
            rule: 'natural_conversation',
            delta: bonus,
            value: `${(recvRatio * 100).toFixed(0)}% 收 / ${((1 - recvRatio) * 100).toFixed(0)}% 发`,
            explanation: `收发比例接近 50/50 (+${bonus}) · 真实人聊对话都双向流动, 单向号更像机器`,
          });
        }
      }
    }

    return breakdown;
  }

  private toRiskLevel(score: number): RiskLevel {
    if (score >= 60) return RiskLevel.Low;
    if (score >= 30) return RiskLevel.Medium;
    return RiskLevel.High;
  }
}
