import type { Repository } from 'typeorm';
import { WarmupPairService } from './warmup-pair.service';
import { AccountSlotEntity, AccountSlotStatus } from '../slots/account-slot.entity';
import type { WaAccountEntity } from '../slots/wa-account.entity';

interface SlotStub {
  id: number;
  tenantId: number;
  accountId: number | null;
  proxyId: number | null;
  status: AccountSlotStatus;
  takeoverActive: boolean;
}
interface AccountStub {
  id: number;
  warmupStage: number;
}

function buildPairSvc(slots: SlotStub[], accounts: AccountStub[]) {
  const slotRepo = {
    findOne: async ({ where }: { where: { accountId: number } }) =>
      slots.find((s) => s.accountId === where.accountId) as unknown as AccountSlotEntity,
    find: async ({ where }: {
      where: {
        tenantId: number;
        takeoverActive: boolean;
        status: { _type: 'in'; _value: AccountSlotStatus[] };
      };
    }) => {
      const allowed = (where.status as unknown as { _value: AccountSlotStatus[] })._value;
      return slots.filter(
        (s) =>
          s.tenantId === where.tenantId &&
          s.takeoverActive === where.takeoverActive &&
          allowed.includes(s.status),
      ) as unknown as AccountSlotEntity[];
    },
  } as unknown as Repository<AccountSlotEntity>;

  const accountRepo = {
    find: async ({ where: { id } }: { where: { id: { _value: number[] } } }) => {
      const ids = (id as unknown as { _value: number[] })._value;
      return accounts.filter((a) => ids.includes(a.id)) as unknown as WaAccountEntity[];
    },
  } as unknown as Repository<WaAccountEntity>;

  return new WarmupPairService(slotRepo, accountRepo);
}

// 基础 fixture: 4 个同租户槽位
//   A  account=1, proxy=P1, stage=2, active, no takeover — initiator 自身 (不能自配对)
//   B  account=2, proxy=P1, stage=2  (同 proxy 同 IP 组 → FILTER OUT)
//   C  account=3, proxy=P2, stage=2, active, no takeover — 合格
//   D  account=4, proxy=P3, stage=0  (warmup_stage 不够 → FILTER OUT)
function baseFixture() {
  const slots: SlotStub[] = [
    { id: 10, tenantId: 1, accountId: 1, proxyId: 1, status: AccountSlotStatus.Warmup, takeoverActive: false },
    { id: 11, tenantId: 1, accountId: 2, proxyId: 1, status: AccountSlotStatus.Warmup, takeoverActive: false },
    { id: 12, tenantId: 1, accountId: 3, proxyId: 2, status: AccountSlotStatus.Active, takeoverActive: false },
    { id: 13, tenantId: 1, accountId: 4, proxyId: 3, status: AccountSlotStatus.Warmup, takeoverActive: false },
  ];
  const accounts: AccountStub[] = [
    { id: 1, warmupStage: 2 },
    { id: 2, warmupStage: 2 },
    { id: 3, warmupStage: 2 },
    { id: 4, warmupStage: 0 },
  ];
  return { slots, accounts };
}

describe('WarmupPairService.pickPartner', () => {
  it('选合格候选 (exclude self / 同 IP 组 / 不够 stage)', async () => {
    const { slots, accounts } = baseFixture();
    const svc = buildPairSvc(slots, accounts);
    const partner = await svc.pickPartner(1, 1);
    expect(partner).toBe(3); // 只 C 通过全部过滤链
  });

  it('IP 组过滤: initiator proxy=1 排除所有 proxy=1 的候选', async () => {
    // 造一个所有候选都同 IP 组的场景 → 必 skip
    const slots: SlotStub[] = [
      { id: 10, tenantId: 1, accountId: 1, proxyId: 5, status: AccountSlotStatus.Warmup, takeoverActive: false },
      { id: 11, tenantId: 1, accountId: 2, proxyId: 5, status: AccountSlotStatus.Warmup, takeoverActive: false },
      { id: 12, tenantId: 1, accountId: 3, proxyId: 5, status: AccountSlotStatus.Active, takeoverActive: false },
    ];
    const accounts: AccountStub[] = [
      { id: 1, warmupStage: 2 },
      { id: 2, warmupStage: 2 },
      { id: 3, warmupStage: 2 },
    ];
    const svc = buildPairSvc(slots, accounts);
    expect(await svc.pickPartner(1, 1)).toBeNull();
  });

  it('takeover_active 槽位过滤', async () => {
    const { slots, accounts } = baseFixture();
    const mutated = slots.map((s) => (s.accountId === 3 ? { ...s, takeoverActive: true } : s));
    const svc = buildPairSvc(mutated, accounts);
    expect(await svc.pickPartner(1, 1)).toBeNull(); // 剩 D 被 stage gate 再拒
  });

  it('suspended 槽位过滤', async () => {
    const { slots, accounts } = baseFixture();
    const mutated = slots.map((s) => (s.accountId === 3 ? { ...s, status: AccountSlotStatus.Suspended } : s));
    const svc = buildPairSvc(mutated, accounts);
    expect(await svc.pickPartner(1, 1)).toBeNull();
  });

  it('stage 门槛: 需 >= 2 时 stage=0 的 D 被拒', async () => {
    const { slots, accounts } = baseFixture();
    // 把 C 禁掉, 只剩 D (stage=0), 仍然返 null
    const mutated = slots.map((s) => (s.accountId === 3 ? { ...s, status: AccountSlotStatus.Suspended } : s));
    const svc = buildPairSvc(mutated, accounts);
    expect(await svc.pickPartner(1, 2)).toBeNull();
  });

  it('initiator 无 slot → null', async () => {
    const svc = buildPairSvc([], []);
    expect(await svc.pickPartner(999, 1)).toBeNull();
  });

  it('initiator 同 proxy null · 所有 null proxy 候选一律同组 (保守)', async () => {
    const slots: SlotStub[] = [
      { id: 10, tenantId: 1, accountId: 1, proxyId: null, status: AccountSlotStatus.Warmup, takeoverActive: false },
      { id: 11, tenantId: 1, accountId: 2, proxyId: null, status: AccountSlotStatus.Warmup, takeoverActive: false },
      { id: 12, tenantId: 1, accountId: 3, proxyId: 2, status: AccountSlotStatus.Active, takeoverActive: false },
    ];
    const accounts: AccountStub[] = [
      { id: 1, warmupStage: 2 },
      { id: 2, warmupStage: 2 },
      { id: 3, warmupStage: 2 },
    ];
    const svc = buildPairSvc(slots, accounts);
    const partner = await svc.pickPartner(1, 1);
    expect(partner).toBe(3); // 2 被"都 null=同组"规则排除, 3 合格
  });
});
