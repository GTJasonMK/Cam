import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { writeSystemEvent } from '@/lib/audit/system-event';
import { db } from '@/lib/db';
import { tasks, workers } from '@/lib/db/schema';
import { broadcastTaskProgress } from '@/lib/tasks/task-events';
import { decideRecoveryAction, isWorkerAliveForTask } from './logic';

export type RecoveryResult = {
  scanned: number;
  recoveredToQueued: number;
  markedFailed: number;
};

export async function recoverDanglingRunningTasksOnStartup(input: {
  staleTimeoutMs: number;
}): Promise<RecoveryResult> {
  const BATCH_SIZE = 500;
  const staleBefore = Date.now() - input.staleTimeoutMs;
  const now = new Date().toISOString();

  let scanned = 0;
  let recoveredToQueued = 0;
  let markedFailed = 0;
  let lastId: string | null = null;

  while (true) {
    const runningTasks = await db
      .select({
        id: tasks.id,
        retryCount: tasks.retryCount,
        maxRetries: tasks.maxRetries,
        assignedWorkerId: tasks.assignedWorkerId,
      })
      .from(tasks)
      .where(
        lastId
          ? and(eq(tasks.status, 'running'), eq(tasks.source, 'scheduler'), gt(tasks.id, lastId))
          : and(eq(tasks.status, 'running'), eq(tasks.source, 'scheduler'))
      )
      .orderBy(tasks.id)
      .limit(BATCH_SIZE);

    if (runningTasks.length === 0) {
      break;
    }

    scanned += runningTasks.length;
    lastId = runningTasks[runningTasks.length - 1].id;

    const workerIds = Array.from(new Set(runningTasks.map((t) => t.assignedWorkerId).filter(Boolean) as string[]));
    const workerRows =
      workerIds.length > 0
        ? await db
            .select({
              id: workers.id,
              status: workers.status,
              currentTaskId: workers.currentTaskId,
              lastHeartbeatAt: workers.lastHeartbeatAt,
            })
            .from(workers)
            .where(inArray(workers.id, workerIds))
        : [];

    const workerMap = new Map(workerRows.map((w) => [w.id, w]));

    for (const task of runningTasks) {
      const worker = task.assignedWorkerId ? workerMap.get(task.assignedWorkerId) : null;
      const workerAlive = isWorkerAliveForTask({
        worker,
        taskId: task.id,
        staleBeforeMs: staleBefore,
      });
      const action = decideRecoveryAction({
        workerAlive,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
      });

      if (action === 'keep_running') {
        continue;
      }

      const assignedWorkerGuard = task.assignedWorkerId
        ? eq(tasks.assignedWorkerId, task.assignedWorkerId)
        : isNull(tasks.assignedWorkerId);

      if (action === 'retry') {
        const retried = await db
          .update(tasks)
          .set({
            status: 'queued',
            retryCount: task.retryCount + 1,
            assignedWorkerId: null,
            queuedAt: now,
            startedAt: null,
            completedAt: null,
          })
          .where(and(
            eq(tasks.id, task.id),
            eq(tasks.source, 'scheduler'),
            eq(tasks.status, 'running'),
            assignedWorkerGuard,
          ))
          .returning({ id: tasks.id });
        if (retried.length === 0) {
          continue;
        }
        recoveredToQueued += 1;

        await writeSystemEvent({
          type: 'task.recovered_after_restart',
          payload: {
            taskId: task.id,
            previousStatus: 'running',
            retryCount: task.retryCount + 1,
            maxRetries: task.maxRetries,
            reason: 'worker_stale_or_missing_after_restart',
          },
        });
        broadcastTaskProgress(task.id, 'queued');
        continue;
      }

      const failed = await db
        .update(tasks)
        .set({
          status: 'failed',
          assignedWorkerId: null,
          completedAt: now,
        })
        .where(and(
          eq(tasks.id, task.id),
          eq(tasks.source, 'scheduler'),
          eq(tasks.status, 'running'),
          assignedWorkerGuard,
        ))
        .returning({ id: tasks.id });
      if (failed.length === 0) {
        continue;
      }
      markedFailed += 1;

      await writeSystemEvent({
        type: 'task.recovery_failed_after_restart',
        payload: {
          taskId: task.id,
          previousStatus: 'running',
          retryCount: task.retryCount,
          maxRetries: task.maxRetries,
          reason: 'max_retries_reached_during_restart_recovery',
        },
      });
      broadcastTaskProgress(task.id, 'failed');
    }
  }

  return { scanned, recoveredToQueued, markedFailed };
}
