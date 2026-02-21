export const WORKER_STATUSES = ['idle', 'busy', 'offline', 'draining'] as const;

export type WorkerStatus = (typeof WORKER_STATUSES)[number];

const WORKER_STATUS_SET = new Set<string>(WORKER_STATUSES);

export function parseWorkerStatus(value: unknown): WorkerStatus | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  return WORKER_STATUS_SET.has(raw) ? (raw as WorkerStatus) : null;
}

