// 养号日历模板 · 技术交接文档 § B.2 + § 5.3 phase 机
// 2026-04-22 · 用户要求从 14 天压缩到 7 天 · 3 phase 压紧 · 保留核心 phase gate 规则
// 时刻表仅为示例 — 所有主动行为必须过其所属规则的 phase gate (§ B.20 Status phase gate 最严).
// 若被拒则空过或降级为被动动作, 不得强执行.

import { WarmupPhase } from './warmup-plan.entity';

export interface WarmupDayWindow {
  at: string;            // "HH:MM" 24h local time (tenant TZ · Asia/Kuala_Lumpur)
  durationMin: number;
  tasks: WarmupTaskSpec[];
}

export interface WarmupTaskSpec {
  // 2026-04-22 · 扩 Day 8-14 运营热身任务类型
  taskType:
    | 'warmup'
    | 'script_chat'
    | 'status_post'
    | 'status_browse'
    | 'status_browse_bulk'
    | 'status_react'
    | 'auto_accept'
    | 'auto_reply'
    | 'follow_channel'
    | 'join_group'
    | 'add_contact'
    | 'group_chat'
    | 'profile_refresh';
  payload?: Record<string, unknown>;
}

export interface WarmupDay {
  day: number;
  phase: WarmupPhase;
  windows: WarmupDayWindow[];
  note: string;
}

export interface WarmupTemplate {
  id: string;
  name: string;
  totalDays: number;
  phaseThresholds: Record<WarmupPhase, number>;
  days: WarmupDay[];
}

// 2026-04-22 · 14 天完整托管模板 (前 7 养号 + 后 7 运营热身)
// Phase 0 (Day 1-2) · Phase 1 (Day 3-4) · Phase 2 (Day 5-7) · Phase 3 Day 8-14 "运营热身" (实际还属 Mature 前期)
export const V1_14DAY_FULL_TEMPLATE: WarmupTemplate = {
  id: 'v1_14day_full',
  name: '马来华语 · 14 天全托管 (养号 + 运营热身)',
  totalDays: 14,
  phaseThresholds: {
    [WarmupPhase.Incubate]: 1,
    [WarmupPhase.Preheat]: 3,
    [WarmupPhase.Activate]: 5,
    [WarmupPhase.Mature]: 8,
  },
  days: [
    // Day 1-7 沿用 7 天模板 (将在下面扩展)
    {
      day: 1,
      phase: WarmupPhase.Incubate,
      note: '孵化 Day 1',
      windows: [
        { at: '10:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
        { at: '15:00', durationMin: 40, tasks: [{ taskType: 'warmup' }] },
        { at: '21:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 2, phase: WarmupPhase.Incubate, note: '孵化 Day 2',
      windows: [
        { at: '10:00', durationMin: 35, tasks: [{ taskType: 'warmup' }] },
        { at: '14:00', durationMin: 40, tasks: [{ taskType: 'status_browse' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 3, phase: WarmupPhase.Preheat, note: '破壳 Day 1',
      windows: [
        { at: '10:30', durationMin: 35, tasks: [{ taskType: 'warmup' }, { taskType: 'script_chat' }] },
        { at: '15:00', durationMin: 40, tasks: [{ taskType: 'status_browse' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 4, phase: WarmupPhase.Preheat, note: '破壳 Day 2',
      windows: [
        { at: '10:00', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '14:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 5, phase: WarmupPhase.Activate, note: '激活 Day 1',
      windows: [
        { at: '10:00', durationMin: 30, tasks: [{ taskType: 'script_chat' }] },
        { at: '13:00', durationMin: 30, tasks: [{ taskType: 'status_post' }] },
        { at: '15:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 6, phase: WarmupPhase.Activate, note: '激活 Day 2',
      windows: [
        { at: '10:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '15:00', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 7, phase: WarmupPhase.Activate, note: '激活 Day 3 · 养号完成',
      windows: [
        { at: '10:00', durationMin: 30, tasks: [{ taskType: 'script_chat' }] },
        { at: '13:00', durationMin: 30, tasks: [{ taskType: 'status_post' }] },
        { at: '15:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    // Day 8-14 · 运营热身期
    {
      day: 8, phase: WarmupPhase.Mature, note: '运营热身 Day 1',
      windows: [
        { at: '09:30', durationMin: 30, tasks: [{ taskType: 'status_browse' }, { taskType: 'status_react' }] },
        { at: '11:00', durationMin: 30, tasks: [{ taskType: 'script_chat' }] },
        { at: '13:30', durationMin: 30, tasks: [{ taskType: 'auto_accept' }] },
        { at: '15:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }, { taskType: 'auto_reply' }] },
        { at: '19:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
        { at: '21:00', durationMin: 20, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 9, phase: WarmupPhase.Mature, note: '运营热身 Day 2',
      windows: [
        { at: '09:30', durationMin: 25, tasks: [{ taskType: 'status_browse' }] },
        { at: '11:30', durationMin: 30, tasks: [{ taskType: 'follow_channel', payload: { mode: 'random', count: 2 } }] },
        { at: '14:00', durationMin: 30, tasks: [{ taskType: 'auto_reply' }] },
        { at: '16:00', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'status_post' }] },
      ],
    },
    {
      day: 10, phase: WarmupPhase.Mature, note: '运营热身 Day 3',
      windows: [
        { at: '10:00', durationMin: 30, tasks: [{ taskType: 'status_browse' }, { taskType: 'status_react' }] },
        { at: '13:00', durationMin: 30, tasks: [{ taskType: 'join_group', payload: { count: 1 } }] },
        { at: '15:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }, { taskType: 'auto_reply' }] },
        { at: '19:30', durationMin: 30, tasks: [{ taskType: 'auto_accept' }] },
        { at: '21:00', durationMin: 20, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 11, phase: WarmupPhase.Mature, note: '运营热身 Day 4',
      windows: [
        { at: '09:30', durationMin: 25, tasks: [{ taskType: 'status_browse_bulk', payload: { maxItems: 20 } }] },
        { at: '12:00', durationMin: 30, tasks: [{ taskType: 'script_chat' }] },
        { at: '14:30', durationMin: 30, tasks: [{ taskType: 'status_post' }] },
        { at: '17:00', durationMin: 40, tasks: [{ taskType: 'script_chat' }, { taskType: 'auto_reply' }] },
        { at: '20:30', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 12, phase: WarmupPhase.Mature, note: '运营热身 Day 5',
      windows: [
        { at: '10:00', durationMin: 30, tasks: [{ taskType: 'status_browse' }] },
        { at: '11:30', durationMin: 30, tasks: [{ taskType: 'follow_channel', payload: { mode: 'random', count: 2 } }] },
        { at: '14:00', durationMin: 30, tasks: [{ taskType: 'auto_accept' }] },
        { at: '16:00', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'auto_reply' }] },
      ],
    },
    {
      day: 13, phase: WarmupPhase.Mature, note: '运营热身 Day 6',
      windows: [
        { at: '09:30', durationMin: 25, tasks: [{ taskType: 'status_browse' }, { taskType: 'status_react' }] },
        { at: '12:00', durationMin: 30, tasks: [{ taskType: 'script_chat' }] },
        { at: '14:30', durationMin: 30, tasks: [{ taskType: 'status_post' }] },
        { at: '17:00', durationMin: 40, tasks: [{ taskType: 'auto_reply' }] },
        { at: '20:30', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 14, phase: WarmupPhase.Mature, note: '运营热身 Day 7 · 托管结束 · 进成熟常态',
      windows: [
        { at: '10:00', durationMin: 30, tasks: [{ taskType: 'status_browse' }] },
        { at: '12:00', durationMin: 30, tasks: [{ taskType: 'script_chat' }] },
        { at: '14:00', durationMin: 30, tasks: [{ taskType: 'join_group', payload: { count: 1 } }] },
        { at: '16:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }, { taskType: 'auto_reply' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'status_post' }] },
      ],
    },
  ],
};

// 7 天压缩方案 (从 14 天精简 · 保 phase 关键节点)
export const V1_7DAY_TEMPLATE: WarmupTemplate = {
  id: 'v1_7day',
  name: '马来华语 · 7 天快速养号',
  totalDays: 7,
  phaseThresholds: {
    [WarmupPhase.Incubate]: 1,
    [WarmupPhase.Preheat]: 3,     // Day 3 升 Phase 1 (原 Day 4)
    [WarmupPhase.Activate]: 5,    // Day 5 升 Phase 2 (原 Day 8 · status_post 解锁)
    [WarmupPhase.Mature]: 8,      // Day 8+ Phase 3 (原 Day 15)
  },
  days: [
    {
      day: 1,
      phase: WarmupPhase.Incubate,
      note: '孵化 Day 1 · 只挂载 keep-alive',
      windows: [
        { at: '10:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
        { at: '15:00', durationMin: 40, tasks: [{ taskType: 'warmup' }] },
        { at: '21:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 2,
      phase: WarmupPhase.Incubate,
      note: '孵化 Day 2 · 开始浏览他人 status (reactive)',
      windows: [
        { at: '10:00', durationMin: 35, tasks: [{ taskType: 'warmup' }] },
        { at: '14:00', durationMin: 40, tasks: [{ taskType: 'status_browse' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 3,
      phase: WarmupPhase.Preheat,
      note: '破壳 Day 1 · 首次低频互聊 (min_warmup_stage ≤ 1)',
      windows: [
        { at: '10:30', durationMin: 35, tasks: [{ taskType: 'warmup' }, { taskType: 'script_chat' }] },
        { at: '15:00', durationMin: 40, tasks: [{ taskType: 'status_browse' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 4,
      phase: WarmupPhase.Preheat,
      note: '破壳 Day 2 · 互聊频率提升',
      windows: [
        { at: '10:00', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '14:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 5,
      phase: WarmupPhase.Activate,
      note: '激活 Day 1 · Phase 2 开启 · status_post 解锁 (§B.20 每 3 天 ≤ 1)',
      windows: [
        { at: '10:00', durationMin: 30, tasks: [{ taskType: 'script_chat' }] },
        { at: '13:00', durationMin: 30, tasks: [{ taskType: 'status_post' }] },
        { at: '15:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 6,
      phase: WarmupPhase.Activate,
      note: '激活 Day 2',
      windows: [
        { at: '10:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '15:00', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
    {
      day: 7,
      phase: WarmupPhase.Activate,
      note: '激活 Day 3 · 养号完成 · Day 8+ 进成熟常态',
      windows: [
        { at: '10:00', durationMin: 30, tasks: [{ taskType: 'script_chat' }] },
        { at: '13:00', durationMin: 30, tasks: [{ taskType: 'status_post' }] },
        { at: '15:30', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
        { at: '20:00', durationMin: 30, tasks: [{ taskType: 'warmup' }] },
      ],
    },
  ],
};

// Day 8+ (Mature) 日常套餐 · 不再按 day 细分
export const MATURE_DAILY_WINDOWS: WarmupDayWindow[] = [
  { at: '10:00', durationMin: 40, tasks: [{ taskType: 'script_chat' }] },
  { at: '13:30', durationMin: 30, tasks: [{ taskType: 'status_post' }] }, // 每天 ≤ 1, §B.20
  { at: '15:30', durationMin: 45, tasks: [{ taskType: 'script_chat' }] },
  { at: '20:00', durationMin: 35, tasks: [{ taskType: 'warmup' }] },
];

// 2026-04-22 · 改默认 7 天 · 14 天版保留 (租户可选更谨慎的老号过渡)
export const V1_14DAY_TEMPLATE: WarmupTemplate = V1_7DAY_TEMPLATE; // alias · 暂保持向后兼容, 新号默认跑 7 天

const TEMPLATES = new Map<string, WarmupTemplate>([
  [V1_7DAY_TEMPLATE.id, V1_7DAY_TEMPLATE],
  [V1_14DAY_FULL_TEMPLATE.id, V1_14DAY_FULL_TEMPLATE], // 2026-04-22 · 14 天全托管
  ['v1_14day', V1_7DAY_TEMPLATE], // 兼容: 老的 template id 映射到 7 天 (旧 plan 继续跑但按 7 天 phase)
]);

export function getTemplate(id: string): WarmupTemplate | undefined {
  return TEMPLATES.get(id);
}
