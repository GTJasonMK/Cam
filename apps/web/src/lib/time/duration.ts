// ============================================================
// 任务耗时工具
// 统一格式化任务执行时长（已完成/进行中）
// ============================================================

export type DurationTarget = {
  startedAt?: string | null;
  completedAt?: string | null;
};

function parseTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function getTaskDurationMs(
  task: DurationTarget,
  options?: { nowMs?: number; requireCompleted?: boolean }
): number | null {
  const startMs = parseTimeMs(task.startedAt);
  if (startMs === null) return null;

  const endMs = parseTimeMs(task.completedAt);
  if (options?.requireCompleted && endMs === null) return null;

  const nowMs = options?.nowMs ?? Date.now();
  const finalEndMs = endMs ?? nowMs;
  return Math.max(0, finalEndMs - startMs);
}

export function formatDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '-';
  if (durationMs < 1_000) return '<1s';

  const totalSeconds = Math.floor(durationMs / 1_000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (totalHours > 0) {
    return `${totalHours}h ${minutes}m`;
  }
  if (totalMinutes > 0) {
    return `${totalMinutes}m ${seconds}s`;
  }
  return `${totalSeconds}s`;
}

export function formatTaskElapsed(
  task: DurationTarget,
  options?: { nowMs?: number }
): { text: string; ongoing: boolean } {
  const durationMs = getTaskDurationMs(task, options);
  if (durationMs === null) {
    return { text: '-', ongoing: false };
  }

  const endMs = parseTimeMs(task.completedAt);

  return {
    text: formatDurationMs(durationMs),
    ongoing: endMs === null,
  };
}
