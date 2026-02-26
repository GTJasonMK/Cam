// ============================================================
// 流水线表单通用工具
// 统一步骤输入文件解析与重试次数规范化
// ============================================================

export function parseInputFiles(raw: string): string[] {
  const files = raw
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(files));
}

export function formatInputFiles(files?: string[]): string {
  if (!files || files.length === 0) return '';
  return files.join(', ');
}

export function normalizeRetries(value: number): number {
  if (!Number.isFinite(value)) return 2;
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  if (rounded > 20) return 20;
  return rounded;
}
