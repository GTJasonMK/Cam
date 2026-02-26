const DEFAULT_WORKER_STALE_TIMEOUT_MS = 30_000;

export function getWorkerStaleTimeoutMs(raw = process.env.WORKER_STALE_TIMEOUT_MS): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_WORKER_STALE_TIMEOUT_MS;
  if (parsed <= 0) return DEFAULT_WORKER_STALE_TIMEOUT_MS;
  return Math.floor(parsed);
}
