export function buildTaskReplayResetFields(input: {
  status: 'queued' | 'waiting';
  feedback: string | null;
  retryCount: number;
  maxRetries: number;
  queuedAt: string | null;
}): Record<string, unknown> {
  return {
    status: input.status,
    feedback: input.feedback,
    retryCount: input.retryCount,
    maxRetries: input.maxRetries,
    assignedWorkerId: null,
    queuedAt: input.queuedAt,
    startedAt: null,
    completedAt: null,
    reviewedAt: null,
    reviewComment: null,
    summary: null,
    logFileUrl: null,
  };
}
