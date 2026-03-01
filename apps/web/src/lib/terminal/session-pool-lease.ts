import { toSafeTimestamp } from '../time/format.ts';

export function buildLeaseStaleBeforeIso(nowMs: number, staleMs: number): string {
  return new Date(nowMs - staleMs).toISOString();
}

export function isLeaseExpired(updatedAt: string, nowMs: number, staleMs: number): boolean {
  const updatedAtMs = toSafeTimestamp(updatedAt);
  if (updatedAtMs <= 0) return false;
  return nowMs - updatedAtMs >= staleMs;
}
