import type { Repository } from 'typeorm';
import { RiskEventService } from './risk-event.service';
import type { RiskEventEntity } from './risk-event.entity';

// Integration-style unit test 模拟 TypeORM QueryBuilder 的 orIgnore 返回.
// 不覆盖 createQueryBuilder 实际 SQL 行为 (要真 DB), 只验服务层的去重/窗口/fallback ref 逻辑.
function buildService(opts: { existingKeys?: Set<string> } = {}) {
  const existingKeys = opts.existingKeys ?? new Set<string>();
  const inserted: Array<Partial<RiskEventEntity>> = [];

  // orIgnore 的 execute() 返回 identifiers=[] 表示已存在, identifiers=[{id}] 表示插入了
  const qb = {
    insert() { return this; },
    into() { return this; },
    values(v: Partial<RiskEventEntity>) {
      (this as unknown as { _pending: Partial<RiskEventEntity> })._pending = v;
      return this;
    },
    orIgnore() { return this; },
    async execute() {
      const pending = (this as unknown as { _pending: Partial<RiskEventEntity> })._pending;
      const key = `${pending.accountId}|${pending.code}|${pending.sourceRef}`;
      if (existingKeys.has(key)) return { identifiers: [] };
      existingKeys.add(key);
      inserted.push(pending);
      return { identifiers: [{ id: `${inserted.length}` }] };
    },
  };

  const repo = {
    createQueryBuilder: () => qb,
    find: async ({ where }: { where: { accountId: number } }) =>
      inserted.filter((e) => e.accountId === where.accountId) as RiskEventEntity[],
  } as unknown as Repository<RiskEventEntity>;

  return { svc: new RiskEventService(repo), inserted, existingKeys };
}

describe('RiskEventService.record · 去重', () => {
  it('explicit source_ref 同值重复插入 → 只保留 1', async () => {
    const { svc, inserted } = buildService();
    const a = await svc.record({
      accountId: 1, code: 'captcha_triggered', severity: 'warn', source: 'baileys', sourceRef: 'msg_abc',
    });
    const b = await svc.record({
      accountId: 1, code: 'captcha_triggered', severity: 'warn', source: 'baileys', sourceRef: 'msg_abc',
    });
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(false);
    expect(inserted).toHaveLength(1);
  });

  it('无 source_ref → 按 minute 兜底去重, 同分钟重复只 1 条', async () => {
    const { svc, inserted } = buildService();
    const at = new Date('2026-04-20T10:00:30Z');
    await svc.record({
      accountId: 1, code: 'send_failed', severity: 'warn', source: 'task_runner', at,
    });
    await svc.record({
      accountId: 1, code: 'send_failed', severity: 'warn', source: 'task_runner', at: new Date('2026-04-20T10:00:55Z'),
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].sourceRef).toMatch(/^auto:[a-f0-9]{16}$/);
  });

  it('无 source_ref 跨分钟 → 两条独立事件', async () => {
    const { svc, inserted } = buildService();
    const at1 = new Date('2026-04-20T10:00:30Z');
    const at2 = new Date('2026-04-20T10:01:30Z');
    await svc.record({ accountId: 1, code: 'send_failed', severity: 'warn', source: 'x', at: at1 });
    await svc.record({ accountId: 1, code: 'send_failed', severity: 'warn', source: 'x', at: at2 });
    expect(inserted).toHaveLength(2);
  });

  it('不同 account 相同 code 相同 ref → 两条 (UNIQUE 是三元组)', async () => {
    const { svc, inserted } = buildService();
    await svc.record({
      accountId: 1, code: 'reported', severity: 'warn', source: 'wa', sourceRef: 'r1',
    });
    await svc.record({
      accountId: 2, code: 'reported', severity: 'warn', source: 'wa', sourceRef: 'r1',
    });
    expect(inserted).toHaveLength(2);
  });
});
