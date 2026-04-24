import type { CampaignSchedule } from '@/lib/campaigns-api';

// 2026-04-23 · 用人话描述 schedule

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function describeSchedule(s: CampaignSchedule): string {
  if (!s) return '';
  if (s.mode === 'immediate') return '立即开始';
  if (s.mode === 'once' && s.fireAt) {
    const d = new Date(s.fireAt);
    const fmt = d.toLocaleString('zh-CN', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    return `单次 · ${fmt}`;
  }
  if (s.mode === 'daily') {
    const end = s.endDate ? ` 至 ${s.endDate}` : '';
    return `每天 ${s.time ?? ''} · ${s.startDate ?? ''}${end}`;
  }
  if (s.mode === 'weekly') {
    const days = (s.days ?? []).map((d) => DAY_NAMES[d]).join('/');
    const end = s.endDate ? ` 至 ${s.endDate}` : '';
    return `每周 ${days} ${s.time ?? ''} · 从 ${s.startDate ?? ''}${end}`;
  }
  return s.mode;
}
