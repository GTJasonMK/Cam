import { and, eq } from 'drizzle-orm';
import { writeSystemEvent } from '@/lib/audit/system-event';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { sseManager } from '@/lib/sse/manager';
import { broadcastTaskProgress } from './task-events';

export async function updateTaskWhenAwaitingReview(
  taskId: string,
  changes: Record<string, unknown>,
): Promise<typeof tasks.$inferSelect | null> {
  const rows = await db
    .update(tasks)
    .set(changes)
    .where(and(eq(tasks.id, taskId), eq(tasks.status, 'awaiting_review')))
    .returning();
  return rows[0] || null;
}

export async function emitTaskReviewOutcome(input: {
  taskId: string;
  actor: string;
  status: 'completed' | 'failed' | 'queued';
  eventType: 'task.review_approved' | 'task.review_rejected' | 'task.review_rejected_max_retries';
  eventPayload: Record<string, unknown>;
  reviewRejectedFinal?: boolean;
}): Promise<void> {
  await writeSystemEvent({
    type: input.eventType,
    actor: input.actor,
    payload: {
      taskId: input.taskId,
      ...input.eventPayload,
    },
  });

  if (input.eventType === 'task.review_approved') {
    sseManager.broadcast('task.review_approved', { taskId: input.taskId });
  } else {
    sseManager.broadcast('task.review_rejected', {
      taskId: input.taskId,
      ...(input.reviewRejectedFinal ? { final: true } : {}),
    });
  }
  broadcastTaskProgress(input.taskId, input.status);
}
