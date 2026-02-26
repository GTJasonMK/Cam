export const TERMINAL_TASK_STATUSES = ['cancelled', 'completed', 'failed'] as const;
export const SCHEDULER_CLAIMABLE_TASK_STATUSES = ['queued', 'waiting'] as const;
export const TERMINAL_SESSION_ACTIVE_TASK_STATUSES = ['draft', 'queued', 'waiting', 'running'] as const;
export const TERMINAL_PIPELINE_PENDING_TASK_STATUSES = ['draft', 'queued', 'waiting'] as const;
export const DEFAULT_CANCELLABLE_TASK_STATUSES = [
  'draft',
  'queued',
  'waiting',
  'running',
  'awaiting_review',
] as const;

export function isTaskTerminalStatus(status: string): boolean {
  return TERMINAL_TASK_STATUSES.includes(status as (typeof TERMINAL_TASK_STATUSES)[number]);
}
