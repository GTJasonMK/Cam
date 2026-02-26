import { writeSystemEvent } from '@/lib/audit/system-event';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { sseManager } from '@/lib/sse/manager';
import { and, eq } from 'drizzle-orm';

export type RunningSchedulerTaskForRecovery = {
  id: string;
  retryCount: number;
  maxRetries: number;
};

export async function recoverRunningSchedulerTasksForWorker(input: {
  workerId: string;
  runningTasks: RunningSchedulerTaskForRecovery[];
  reason: 'worker_pruned_offline' | 'worker_offline_manual' | 'worker_heartbeat_timeout';
  actor?: string | null;
  includeWorkerIdInPayload?: boolean;
}): Promise<{ retried: number; failed: number }> {
  const includeWorkerIdInPayload = input.includeWorkerIdInPayload !== false;
  let retried = 0;
  let failed = 0;

  for (const runningTask of input.runningTasks) {
    const taskId = runningTask.id;

    if (runningTask.retryCount < runningTask.maxRetries) {
      const queuedAt = new Date().toISOString();
      const retriedRows = await db
        .update(tasks)
        .set({
          status: 'queued',
          retryCount: runningTask.retryCount + 1,
          assignedWorkerId: null,
          queuedAt,
          startedAt: null,
          completedAt: null,
        })
        .where(and(
          eq(tasks.id, taskId),
          eq(tasks.status, 'running'),
          eq(tasks.assignedWorkerId, input.workerId),
        ))
        .returning({ id: tasks.id });

      if (retriedRows.length === 0) {
        continue;
      }

      retried += 1;
      sseManager.broadcast('task.progress', { taskId, status: 'queued' });
      await writeSystemEvent({
        type: 'task.progress',
        actor: input.actor,
        payload: {
          taskId,
          status: 'queued',
          retryCount: runningTask.retryCount + 1,
          reason: input.reason,
          ...(includeWorkerIdInPayload ? { workerId: input.workerId } : {}),
        },
      });
      continue;
    }

    const completedAt = new Date().toISOString();
    const failedRows = await db
      .update(tasks)
      .set({
        status: 'failed',
        assignedWorkerId: null,
        completedAt,
      })
      .where(and(
        eq(tasks.id, taskId),
        eq(tasks.status, 'running'),
        eq(tasks.assignedWorkerId, input.workerId),
      ))
      .returning({ id: tasks.id });

    if (failedRows.length === 0) {
      continue;
    }

    failed += 1;
    sseManager.broadcast('task.progress', { taskId, status: 'failed' });
    await writeSystemEvent({
      type: 'task.progress',
      actor: input.actor,
      payload: {
        taskId,
        status: 'failed',
        reason: input.reason,
        ...(includeWorkerIdInPayload ? { workerId: input.workerId } : {}),
      },
    });
  }

  return { retried, failed };
}
