import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tasks, workers } from '@/lib/db/schema';
import { sseManager } from '@/lib/sse/manager';
import { recoverRunningSchedulerTasksForWorker } from '@/lib/workers/recover-running-tasks';

export async function checkWorkerHeartbeatsForScheduler(input: {
  staleTimeoutMs: number;
}): Promise<void> {
  const timeout = new Date(Date.now() - input.staleTimeoutMs).toISOString();

  const staleWorkers = await db
    .select()
    .from(workers)
    .where(
      and(
        eq(workers.status, 'busy'),
        sql`${workers.lastHeartbeatAt} < ${timeout}`
      )
    );

  for (const worker of staleWorkers) {
    console.warn(`[Scheduler] Worker ${worker.id} 心跳超时，标记为 offline`);

    const markedOffline = await db
      .update(workers)
      .set({ status: 'offline', currentTaskId: null })
      .where(
        and(
          eq(workers.id, worker.id),
          eq(workers.status, 'busy'),
          sql`${workers.lastHeartbeatAt} < ${timeout}`,
        ),
      )
      .returning({ id: workers.id });
    if (markedOffline.length === 0) {
      // 并发下该 Worker 可能已恢复心跳或状态已改变，跳过离线回收。
      continue;
    }

    // 基于 assignedWorkerId 回收该 worker 挂住的所有 running 任务，
    // 避免 currentTaskId 丢失时出现“任务永久 running”。
    const runningTasks = await db
      .select({
        id: tasks.id,
        retryCount: tasks.retryCount,
        maxRetries: tasks.maxRetries,
      })
      .from(tasks)
      .where(and(
        eq(tasks.assignedWorkerId, worker.id),
        eq(tasks.status, 'running'),
        eq(tasks.source, 'scheduler'),
      ));

    await recoverRunningSchedulerTasksForWorker({
      workerId: worker.id,
      runningTasks: runningTasks.map((task) => ({
        id: task.id,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
      })),
      reason: 'worker_heartbeat_timeout',
      includeWorkerIdInPayload: false,
    });

    sseManager.broadcast('worker.offline', { workerId: worker.id });
    sseManager.broadcast('alert.triggered', {
      message: `Worker ${worker.name} 心跳超时，已标记为离线`,
      severity: 'warning',
    });
  }
}
