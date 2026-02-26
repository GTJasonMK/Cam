// ============================================================
// 时间格式化工具
// 统一页面中的日期/时间展示与安全时间戳转换
// ============================================================

import { parseIsoMs } from './parse-iso.ts';

function parseDate(input?: string | null): Date | null {
  const ms = parseIsoMs(input);
  if (ms === null) return null;
  return new Date(ms);
}

export function toSafeTimestamp(input?: string | null): number {
  const ms = parseIsoMs(input);
  return ms === null ? 0 : ms;
}

export function formatDateTimeZhCn(input?: string | null, fallback = '-'): string {
  const date = parseDate(input);
  if (!date) return fallback;
  return date.toLocaleString('zh-CN');
}

export function formatTimeZhCn(input?: string | null, fallback = '-'): string {
  const date = parseDate(input);
  if (!date) return fallback;
  return date.toLocaleTimeString('zh-CN');
}

export function formatDateZhCn(input?: string | null, fallback = '-'): string {
  const date = parseDate(input);
  if (!date) return fallback;
  return date.toLocaleDateString('zh-CN');
}
