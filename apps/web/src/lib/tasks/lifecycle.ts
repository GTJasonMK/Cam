import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { buildTaskReplayResetFields } from './reset-fields';
import { computeNextRetryWindow } from './retry-window';
import { emitTaskRerunRequested } from './task-events';
import {
  DEFAULT_CANCELLABLE_TASK_STATUSES,
  isTaskTerminalStatus,
  TERMINAL_TASK_STATUSES,
} from './status';

export type TaskRetrySnapshot = {
  id: string;
  status: string;
  retryCount: number;
  maxRetries: number;
  feedback: string | null;
};

export { TERMINAL_TASK_STATUSES, DEFAULT_CANCELLABLE_TASK_STATUSES, isTaskTerminalStatus };

function buildTaskCancelledFields(cancelledAt: string): Pick<
  typeof tasks.$inferInsert,
  'status' | 'assignedWorkerId' | 'completedAt'
> {
  return {
    status: 'cancelled',
    assignedWorkerId: null,
    completedAt: cancelledAt,
  };
}

export async function cancelTaskBySnapshot(input: {
  taskId: string;
  expectedStatus: string;
  cancelledAt: string;
}): Promise<typeof tasks.$inferSelect | null> {
  const cancelledRows = await db
    .update(tasks)
    .set(buildTaskCancelledFields(input.cancelledAt))
    .where(and(eq(tasks.id, input.taskId), eq(tasks.status, input.expectedStatus)))
    .returning();

  return cancelledRows[0] || null;
}

export async function cancelTasksByIds(input: {
  taskIds: string[];
  cancellableStatuses: string[];
  cancelledAt: string;
}): Promise<string[]> {
  if (input.taskIds.length === 0 || input.cancellableStatuses.length === 0) {
    return [];
  }

  const cancelledRows = await db
    .update(tasks)
    .set(buildTaskCancelledFields(input.cancelledAt))
    .where(and(
      inArray(tasks.id, input.taskIds),
      inArray(tasks.status, input.cancellableStatuses),
    ))
    .returning({ id: tasks.id });

  return cancelledRows.map((row) => row.id);
}

export async function rerunTaskFromSnapshot(input: {
  snapshot: TaskRetrySnapshot;
  actor?: string | null;
  feedbackInput?: string | null;
  eventPayload?: Record<string, unknown>;
  rerunBroadcastPayload?: Record<string, unknown>;
  queuedAt?: string;
}): Promise<{
  updated: boolean;
  nextRetryCount: number;
  nextMaxRetries: number;
  updatedTask: typeof tasks.$inferSelect | null;
}> {
  const { snapshot } = input;
  const { nextRetryCount, nextMaxRetries } = computeNextRetryWindow(
    snapshot.retryCount,
    snapshot.maxRetries,
  );
  const queuedAt = input.queuedAt || new Date().toISOString();

  const updated = await db
    .update(tasks)
    .set(buildTaskReplayResetFields({
      status: 'queued',
      feedback: input.feedbackInput ?? snapshot.feedback ?? null,
      retryCount: nextRetryCount,
      maxRetries: nextMaxRetries,
      queuedAt,
    }))
    .where(and(eq(tasks.id, snapshot.id), eq(tasks.status, snapshot.status)))
    .returning();

  if (updated.length === 0) {
    return {
      updated: false,
      nextRetryCount,
      nextMaxRetries,
      updatedTask: null,
    };
  }

  await emitTaskRerunRequested({
    taskId: snapshot.id,
    actor: input.actor,
    eventPayload: {
      previousStatus: snapshot.status,
      retryCount: nextRetryCount,
      maxRetries: nextMaxRetries,
      ...(input.eventPayload || {}),
    },
    rerunBroadcastPayload: input.rerunBroadcastPayload,
  });

  return {
    updated: true,
    nextRetryCount,
    nextMaxRetries,
    updatedTask: updated[0],
  };
}
