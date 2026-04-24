import { Injectable, Logger } from '@nestjs/common';

// 2026-04-22 · 养号组内动态配对算法
// 输入: group 成员 accountIds + 近 7 天配对历史
// 输出: 当前窗口的 pairs (不重叠 · 优先从未配过的)
// 硬规则:
//   - 一个 account 一个 window 最多出现 1 次
//   - 同一对 (A,B) 近 7 天内不再配 (史料不够才允许)
//   - 若奇数 · 最后 1 个号此窗不参与 script_chat
@Injectable()
export class WarmupPairPicker {
  private readonly logger = new Logger(WarmupPairPicker.name);

  pickPairs(
    members: number[],
    history: Array<{ day: number; pairs: Array<[number, number]>; at: string }>,
    opts: { maxPairs?: number } = {},
  ): Array<[number, number]> {
    if (members.length < 2) return [];
    // 历史 pair 频率图
    const pairFreq = new Map<string, number>();
    const normalize = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    for (const h of history) {
      for (const [a, b] of h.pairs) {
        const k = normalize(a, b);
        pairFreq.set(k, (pairFreq.get(k) ?? 0) + 1);
      }
    }

    // 枚举所有可能 pair · 按 freq 升序 (+ 随机扰动打破平手)
    const candidates: Array<{ a: number; b: number; freq: number; jitter: number }> = [];
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const k = normalize(members[i], members[j]);
        candidates.push({
          a: members[i],
          b: members[j],
          freq: pairFreq.get(k) ?? 0,
          jitter: Math.random(),
        });
      }
    }
    candidates.sort((x, y) => x.freq - y.freq || x.jitter - y.jitter);

    const used = new Set<number>();
    const picked: Array<[number, number]> = [];
    const maxPairs = opts.maxPairs ?? Math.floor(members.length / 2);
    for (const c of candidates) {
      if (picked.length >= maxPairs) break;
      if (used.has(c.a) || used.has(c.b)) continue;
      picked.push([c.a, c.b]);
      used.add(c.a);
      used.add(c.b);
    }
    this.logger.debug(
      `pickPairs · members=[${members.join(',')}] history=${history.length}d · picked=${JSON.stringify(picked)}`,
    );
    return picked;
  }

  /** 记录本次配对到 history (调用方持久化到 DB) */
  appendToHistory(
    history: Array<{ day: number; pairs: Array<[number, number]>; at: string }>,
    day: number,
    pairs: Array<[number, number]>,
    keepDays = 7,
  ): Array<{ day: number; pairs: Array<[number, number]>; at: string }> {
    const next = [
      ...history,
      { day, pairs, at: new Date().toISOString() },
    ];
    // 保留近 keepDays 天
    if (next.length > keepDays * 5) {
      return next.slice(-keepDays * 5);
    }
    return next;
  }
}
