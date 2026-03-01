// ============================================================
// 环境变量布尔值解析
// ============================================================

export function parseBooleanEnv(raw: string | undefined): boolean | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return null;
}

