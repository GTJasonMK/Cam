// ============================================================
// ISO 时间解析工具
// 统一将 ISO 时间字符串解析为毫秒时间戳
// ============================================================

export function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
