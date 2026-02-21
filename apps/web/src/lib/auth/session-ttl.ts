const DEFAULT_SESSION_TTL_HOURS = 24;
const MAX_SESSION_TTL_HOURS = 24 * 365;

export function normalizeSessionTtlHours(raw: string | undefined): number {
  const parsed = Number.parseInt((raw || '').trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SESSION_TTL_HOURS;
  if (parsed < 1 || parsed > MAX_SESSION_TTL_HOURS) return DEFAULT_SESSION_TTL_HOURS;
  return parsed;
}
