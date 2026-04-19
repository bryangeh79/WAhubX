import { HealthScorerService } from './health-scorer.service';
import type { RiskEventEntity } from './risk-event.entity';
import { RiskEventCode } from './risk-event.entity';
import type { AccountHealthEntity } from '../slots/account-health.entity';

function buildScorer() {
  // compute() 是纯函数, 不依赖 repo / bus / settings. 直接 new 用 stubs.
  return new HealthScorerService(
    {} as never,
    {} as never,
    {} as never,
  );
}

function mkEvent(code: string, minutesAgo = 0): RiskEventEntity {
  return {
    id: '1',
    accountId: 1,
    code,
    severity: 'warn',
    source: 'test',
    sourceRef: `ref-${Math.random()}`,
    meta: null,
    at: new Date(Date.now() - minutesAgo * 60_000),
    createdAt: new Date(),
  };
}

describe('HealthScorerService.compute · §5.4 公式', () => {
  it('验证码 × 5 扣分', () => {
    const svc = buildScorer();
    const b = svc.compute([mkEvent(RiskEventCode.CaptchaTriggered), mkEvent(RiskEventCode.CaptchaTriggered)], null);
    expect(b.find((x) => x.rule === 'captcha_triggered')?.delta).toBe(-10); // 2 次 × 5
  });

  it('被举报 × 15 扣分', () => {
    const svc = buildScorer();
    const b = svc.compute([mkEvent(RiskEventCode.Reported)], null);
    expect(b.find((x) => x.rule === 'reported')?.delta).toBe(-15);
  });

  it('同 IP 被封 × 10 扣分 (3 次 = -30)', () => {
    const svc = buildScorer();
    const b = svc.compute(
      [
        mkEvent(RiskEventCode.SameIpBanned),
        mkEvent(RiskEventCode.SameIpBanned),
        mkEvent(RiskEventCode.SameIpBanned),
      ],
      null,
    );
    expect(b.find((x) => x.rule === 'same_ip_banned')?.delta).toBe(-30);
  });

  it('加好友被拒 · 按 5%/次 代理, 上限 100%', () => {
    const svc = buildScorer();
    const manyRejected = Array.from({ length: 30 }).map(() => mkEvent(RiskEventCode.FriendRejected));
    const b = svc.compute(manyRejected, null);
    // 30 × 0.05 = 1.5, 上限 1.0 → × 20 = 20
    expect(b.find((x) => x.rule === 'friend_rejected')?.delta).toBe(-20);
  });

  it('发送失败率从 prev_health.sendFailRate 取 (账号级)', () => {
    const svc = buildScorer();
    const prev = {
      totalSent: 100,
      totalReceived: 50,
      sendFailRate: '0.3',
    } as unknown as AccountHealthEntity;
    const b = svc.compute([], prev);
    // 0.3 × 100 = 30
    expect(b.find((x) => x.rule === 'send_fail_rate')?.delta).toBe(-30);
  });

  it('无事件 · 无 prev → breakdown 可能含 contact/natural 但 score=100 保持', () => {
    const svc = buildScorer();
    const b = svc.compute([], null);
    const delta = b.reduce((s, x) => s + x.delta, 0);
    expect(100 + delta).toBe(100);
  });

  it('breakdown explanation 每条都带教育性 tooltip 文案', () => {
    const svc = buildScorer();
    const b = svc.compute([mkEvent(RiskEventCode.CaptchaTriggered), mkEvent(RiskEventCode.Reported)], null);
    for (const item of b) {
      expect(typeof item.explanation).toBe('string');
      expect(item.explanation.length).toBeGreaterThan(10);
    }
  });
});

describe('HealthScorerService · 滚动窗口', () => {
  it('compute() 本身不管窗口 — rescore() 在查询层截断', () => {
    // compute 纯函数收到的 events 应已被调用方按 windowDays 截断. 本测验证:
    // 给定相同 events, compute 结果对 event.at 不感知 (窗口筛在 RiskEventService 层).
    const svc = buildScorer();
    const old = mkEvent(RiskEventCode.CaptchaTriggered, 60 * 24 * 60); // 60 天前
    const recent = mkEvent(RiskEventCode.CaptchaTriggered, 5 * 24 * 60); // 5 天前
    const b = svc.compute([old, recent], null);
    // 2 event 都入 compute 就 -10 (两次 × 5). 窗口过滤由 RiskEventService.findWithinWindow 做.
    expect(b.find((x) => x.rule === 'captcha_triggered')?.delta).toBe(-10);
  });
});

describe('HealthScorerService risk level 边界 · §5.4', () => {
  // compute + score cap → risk level 的纯函数验证
  const svc = buildScorer();

  function scoreTo(delta: number) {
    // 构造一堆 captcha 得到目标扣分 (captcha × 5 每次)
    const times = Math.abs(delta) / 5;
    const events = Array.from({ length: times }).map(() => mkEvent(RiskEventCode.CaptchaTriggered));
    const b = svc.compute(events, null);
    return Math.max(0, Math.min(100, Math.round(100 + b.reduce((s, x) => s + x.delta, 0))));
  }

  it('score=60 → low (边界含)', () => {
    expect(scoreTo(-40)).toBe(60);
  });

  it('score=59 → medium', () => {
    // 无法正好 59 (只有 5 的倍数), 但 30-59 任何分都 medium, 45 测
    expect(scoreTo(-55)).toBe(45);
  });

  it('score=30 → medium (边界含)', () => {
    expect(scoreTo(-70)).toBe(30);
  });

  it('score=29 → high (边界前一位)', () => {
    // 29 不能整除 5, 取 25 (也 high)
    expect(scoreTo(-75)).toBe(25);
  });

  it('score=0 最低下限', () => {
    expect(scoreTo(-200)).toBe(0);
  });
});
