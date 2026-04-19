// 养号日历模板 · 技术交接文档 § B.2 + § 5.3 phase 机
// 硬编码 14 天模板 (v1_14day). M5 scope 只支持 1 个模板, 未来多模板换这里.
// 时刻表仅为示例 — 所有主动行为必须过其所属规则的 phase gate (§ B.20 Status phase gate 最严).
// 若被拒则空过或降级为被动动作, 不得强执行. 此权威性约定来自 § B.2 顶部.

import { WarmupPhase } from './warmup-plan.entity';

export interface WarmupDayWindow {
  at: string;            // "HH:MM" 24h local time (tenant TZ 后续 M6+ 处理, 现 Asia/Kuala_Lumpur)
  durationMin: number;   // 挂载窗口分钟数
  tasks: WarmupTaskSpec[]; // 窗口内要触发的任务
}

export interface WarmupTaskSpec {
  taskType: 'warmup' | 'script_chat' | 'status_post' | 'status_browse';
  // script_chat 专属: 随机挑 eligible script (min_warmup_stage ≤ account.warmup_stage + 同租户 pair 过滤)
  // status_post 专属: 4 层降级素材链
  // warmup 专属: 就一个 presence tick, 让 slot keep-alive
  payload?: Record<string, unknown>;
}

export interface WarmupDay {
  day: number;            // 1..N (Day 0 注册当天不进 plan, plan 从 Day 1 起)
  phase: WarmupPhase;
  windows: WarmupDayWindow[];
  // 人类可读备注 (对齐 §B.2 原文)
  note: string;
}

export interface WarmupTemplate {
  id: string;
  name: string;
  totalDays: number;
  // Phase 阈值 (current_day >= threshold → 推到该 phase)
  phaseThresholds: Record<WarmupPhase, number>;
  days: WarmupDay[];
}

// §B.2 节奏 (冲突处取严: Day 4 Status broadcast 去掉 · 改 status_browse reactive
// 对齐 §B.20 "Phase 0-1 禁 status_post". Day 8+ 才进 status_post.)
export const V1_14DAY_TEMPLATE: WarmupTemplate = {
  id: 'v1_14day',
  name: '马来华语 · 14 天标准养号',
  totalDays: 14,
  phaseThresholds: {
    [WarmupPhase.Incubate]: 1,   // Day 1 起 Phase 0
    [WarmupPhase.Preheat]: 4,    // Day 4 升 Phase 1
    [WarmupPhase.Activate]: 8,   // Day 8 升 Phase 2 (首个允许 status_post 的 phase)
    [WarmupPhase.Mature]: 15,    // Day 15+ Phase 3 (每天 ≤ 1 status)
  },
  days: [
    {
      day: 1,
      phase: WarmupPhase.Incubate,
      note: '冷却期 Day 1/3 · 只挂载',
      windows: [
        { at: '10:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
        { at: '15:00', durationMin: 40, tasks: [{ taskType: 'warmup' }] },
        { at: '21:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 2,
      phase: WarmupPhase.Incubate,
      note: '冷却期 Day 2/3 · 接收不回',
      windows: [
        { at: '09:30', durationMin: 35, tasks: [{ taskType: 'warmup' }] },
        { at: '14:00', durationMin: 45, tasks: [{ taskType: 'warmup' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 3,
      phase: WarmupPhase.Incubate,
      note: '冷却期 Day 3/3 · 72h 解除 is_new_account',
      windows: [
        { at: '10:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
        { at: '14:30', durationMin: 40, tasks: [{ taskType: 'warmup' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 4,
      phase: WarmupPhase.Preheat,
      note: '破壳冲刺 · reactive (浏览/点赞他人 Status, 禁发)',
      windows: [
        { at: '09:30', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
        { at: '13:00', durationMin: 30, tasks: [{ taskType: 'status_browse' }] },
        { at: '15:00', durationMin: 40, tasks: [{ taskType: 'status_browse', payload: { react: true } }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 5,
      phase: WarmupPhase.Preheat,
      note: '破壳 Day 2 · 被动回复开启 (AI 兜底)',
      windows: [
        { at: '10:00', durationMin: 40, tasks: [{ taskType: 'warmup' }] },
        { at: '15:00', durationMin: 40, tasks: [{ taskType: 'status_browse' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 6,
      phase: WarmupPhase.Preheat,
      note: '破壳 Day 3 · 首次低频互聊 (min_warmup_stage ≤ 1)',
      windows: [
        { at: '10:30', durationMin: 40, tasks: [{ taskType: 'warmup' }, { taskType: 'script_chat' }] },
        { at: '15:30', durationMin: 35, tasks: [{ taskType: 'status_browse' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 7,
      phase: WarmupPhase.Preheat,
      note: '破壳 Day 4 · 互聊频率提升',
      windows: [
        { at: '10:00', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '14:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 40, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 8,
      phase: WarmupPhase.Activate,
      note: '激活 Day 1 · Phase 2 开启, status_post 解锁 (§B.20 每 3 天 ≤ 1)',
      windows: [
        { at: '10:00', durationMin: 30, tasks: [{ taskType: 'script_chat' }] },
        { at: '13:00', durationMin: 30, tasks: [{ taskType: 'status_post' }] },
        { at: '15:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 35, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 9,
      phase: WarmupPhase.Activate,
      note: '激活 Day 2',
      windows: [
        { at: '10:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '15:00', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 10,
      phase: WarmupPhase.Activate,
      note: '激活 Day 3',
      windows: [
        { at: '10:00', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '15:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 40, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 11,
      phase: WarmupPhase.Activate,
      note: '激活 Day 4 · 下一个 status_post 窗口 (Day 8 + 3 = Day 11)',
      windows: [
        { at: '10:00', durationMin: 30, tasks: [{ taskType: 'script_chat' }] },
        { at: '13:30', durationMin: 30, tasks: [{ taskType: 'status_post' }] },
        { at: '15:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 12,
      phase: WarmupPhase.Activate,
      note: '激活 Day 5',
      windows: [
        { at: '10:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '15:00', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:30', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 13,
      phase: WarmupPhase.Activate,
      note: '激活 Day 6',
      windows: [
        { at: '10:00', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '15:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 14,
      phase: WarmupPhase.Activate,
      note: '激活 Day 7 · Day 14 末 · 下一个 status_post 窗口 (Day 11 + 3 = Day 14)',
      windows: [
        { at: '10:00', durationMin: 30, tasks: [{ taskType: 'script_chat' }] },
        { at: '13:00', durationMin: 30, tasks: [{ taskType: 'status_post' }] },
        { at: '15:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
  ],
};

// Phase 3 (Day 15+) 日历: 不再用 day-by-day 明细, 改用"每日标准套餐"
// 理由: 成熟号没必要继续读 template, 进入常态运营
export const MATURE_DAILY_WINDOWS: WarmupDayWindow[] = [
  { at: '10:00', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
  { at: '13:30', durationMin: 30, tasks: [{ taskType: 'status_post' }] }, // 每天 ≤ 1, §B.20
  { at: '15:30', durationMin: 45, tasks: [{ taskType: 'script_chat' }] },
  { at: '20:00', durationMin: 35, tasks: [{ taskType: 'warmup' }] },
];

const TEMPLATES = new Map<string, WarmupTemplate>([
  [V1_14DAY_TEMPLATE.id, V1_14DAY_TEMPLATE],
]);

export function getTemplate(id: string): WarmupTemplate | undefined {
  return TEMPLATES.get(id);
}
