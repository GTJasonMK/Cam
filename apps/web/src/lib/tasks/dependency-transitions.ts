import { writeSystemEvent } from '@/lib/audit/system-event';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { broadcastTaskProgress } from './task-events';
import { buildDependencyBlockedSummary, type DependencyInspectionResult } from './dependency-inspection';

type PendingTaskStatus = 'queued' | 'waiting';

export async function markTaskDependencyBlocked(input: {
  taskId: string;
  dependsOn: string[];
  depState: DependencyInspectionResult;
  allowedCurrentStatuses: PendingTaskStatus[];
  enforceSchedulerSource?: boolean;
}): Promise<boolean> {
  const statusCondition = input.allowedCurrentStatuses.length === 1
    ? eq(tasks.status, input.allowedCurrentStatuses[0])
    : inArray(tasks.status, input.allowedCurrentStatuses);
  const whereCondition = input.enforceSchedulerSource
    ? and(eq(tasks.id, input.taskId), statusCondition, eq(tasks.source, 'scheduler'))
    : and(eq(tasks.id, input.taskId), statusCondition);

  const blocked = await db
    .update(tasks)
    .set({
      status: 'failed',
      assignedWorkerId: null,
      completedAt: new Date().toISOString(),
      summary: buildDependencyBlockedSummary(input.depState),
    })
    .where(whereCondition)
    .returning({ id: tasks.id });

  if (blocked.length === 0) {
    return false;
  }

  broadcastTaskProgress(input.taskId, 'failed');
  await writeSystemEvent({
    type: 'task.dependency_blocked',
    payload: {
      taskId: input.taskId,
      dependsOn: input.dependsOn,
      missingDepIds: input.depState.missingDepIds,
      terminalDeps: input.depState.terminalDeps,
    },
  });
  return true;
}

export async function demoteQueuedTaskToWaiting(input: {
  taskId: string;
  dependsOn: string[];
  enforceSchedulerSource?: boolean;
}): Promise<boolean> {
  const whereCondition = input.enforceSchedulerSource
    ? and(eq(tasks.id, input.taskId), eq(tasks.status, 'queued'), eq(tasks.source, 'scheduler'))
    : and(eq(tasks.id, input.taskId), eq(tasks.status, 'queued'));

  const demoted = await db
    .update(tasks)
    .set({ status: 'waiting' })
    .where(whereCondition)
    .returning({ id: tasks.id });

  if (demoted.length === 0) {
    return false;
  }

  broadcastTaskProgress(input.taskId, 'waiting');
  await writeSystemEvent({
    type: 'task.waiting',
    payload: { taskId: input.taskId, dependsOn: input.dependsOn },
  });
  return true;
}
