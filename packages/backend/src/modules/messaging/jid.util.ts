// 2026-04-28 · Phase D · 从 BaileysService.normalizeJid 抽出
// 纯函数 · runtime 中性

import { BadRequestException } from '@nestjs/common';

export function normalizeJid(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('@')) return trimmed;
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) throw new BadRequestException(`手机号 "${input}" 无效`);
  return `${digits}@s.whatsapp.net`;
}
