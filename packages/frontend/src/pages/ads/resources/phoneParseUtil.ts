// 2026-04-24 · 客户群导入号码解析工具 · 前端独立解析 + 预览 · 后端最终入库

import * as XLSX from 'xlsx';

// 规范化为 E.164 (不带 +, 纯数字, 8-15 位)
// 规则跟后端 phone-utils.ts 对齐: 0 开头 → 加 60 前缀 (马来)
export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (s.startsWith('+')) s = s.slice(1);
  s = s.replace(/\D/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('0') && s.length >= 9 && s.length <= 11) s = '60' + s.slice(1);
  if (s.length < 8 || s.length > 15) return null;
  return s;
}

export interface ParsedRow {
  raw: string;          // 原始文本
  phone: string | null; // 规范化后的手机号 (null = 格式错误)
  name?: string;        // 姓名 (可选)
  tag?: string;         // 标签 (可选)
}

export interface PreviewStat {
  total: number;
  validUnique: string[];     // 去重后的有效 e164
  duplicateCount: number;    // 本批内重复次数
  invalidRows: ParsedRow[];  // 格式错误的行
}

// 从纯文本解析 (粘贴场景 · 一行一个或逗号/空格分隔)
export function parsePastedText(raw: string): ParsedRow[] {
  if (!raw) return [];
  const tokens = raw.split(/[,\s\n\r\t;]+/).map((t) => t.trim()).filter(Boolean);
  return tokens.map((t) => ({ raw: t, phone: normalizePhone(t) }));
}

// 从 CSV 文本解析 · 认识列名 phone / name / tag · 缺则把第 1 列当 phone
export function parseCsvText(raw: string): ParsedRow[] {
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const firstCells = splitCsvLine(lines[0]);
  const headerMap = detectHeader(firstCells);
  const dataLines = headerMap ? lines.slice(1) : lines;
  const out: ParsedRow[] = [];
  for (const line of dataLines) {
    const cells = splitCsvLine(line);
    const phoneRaw = headerMap ? cells[headerMap.phone] : cells[0];
    if (!phoneRaw) continue;
    const phone = normalizePhone(phoneRaw);
    const name = headerMap && headerMap.name >= 0 ? cells[headerMap.name]?.trim() : undefined;
    const tag = headerMap && headerMap.tag >= 0 ? cells[headerMap.tag]?.trim() : undefined;
    out.push({ raw: phoneRaw.trim(), phone, name, tag });
  }
  return out;
}

// 从 xlsx 文件 ArrayBuffer 解析
export function parseXlsxBuffer(buffer: ArrayBuffer): ParsedRow[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = wb.Sheets[firstSheetName];
  // 转二维数组形式, 保留所有行 (包括可能的 header)
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  if (rows.length === 0) return [];

  const firstRow = rows[0].map((c) => String(c ?? '').trim());
  const headerMap = detectHeader(firstRow);
  const dataRows = headerMap ? rows.slice(1) : rows;
  const out: ParsedRow[] = [];
  for (const r of dataRows) {
    const cells = r.map((c) => String(c ?? '').trim());
    const phoneRaw = headerMap ? cells[headerMap.phone] : cells[0];
    if (!phoneRaw) continue;
    const phone = normalizePhone(phoneRaw);
    const name = headerMap && headerMap.name >= 0 ? cells[headerMap.name] : undefined;
    const tag = headerMap && headerMap.tag >= 0 ? cells[headerMap.tag] : undefined;
    out.push({ raw: phoneRaw, phone, name, tag });
  }
  return out;
}

// 汇总统计
export function summarize(rows: ParsedRow[]): PreviewStat {
  const total = rows.length;
  const seen = new Set<string>();
  const validUnique: string[] = [];
  const invalidRows: ParsedRow[] = [];
  let duplicateCount = 0;
  for (const r of rows) {
    if (!r.phone) {
      invalidRows.push(r);
      continue;
    }
    if (seen.has(r.phone)) {
      duplicateCount++;
      continue;
    }
    seen.add(r.phone);
    validUnique.push(r.phone);
  }
  return { total, validUnique, duplicateCount, invalidRows };
}

// ── helpers ─────────────────────────────────────────────

function splitCsvLine(line: string): string[] {
  // 简化 CSV: 支持逗号/tab/分号分隔 · 不处理带引号的复杂值 (V1 够用)
  return line.split(/[,\t;]/).map((c) => c.trim());
}

interface HeaderMap {
  phone: number;
  name: number;
  tag: number;
}

function detectHeader(cells: string[]): HeaderMap | null {
  // 如果第 1 行含"phone / 手机 / 号码 / mobile / number"任一, 认为是表头
  const lower = cells.map((c) => c.toLowerCase());
  const phoneIdx = lower.findIndex((c) =>
    /^(phone|手机|号码|电话|mobile|number|tel|whatsapp)/i.test(c),
  );
  if (phoneIdx < 0) return null;
  const nameIdx = lower.findIndex((c) => /^(name|姓名|称呼|昵称|nickname)/i.test(c));
  const tagIdx = lower.findIndex((c) => /^(tag|标签|分类|group|category|备注|note)/i.test(c));
  return { phone: phoneIdx, name: nameIdx, tag: tagIdx };
}
