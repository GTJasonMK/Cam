import { and, eq } from 'drizzle-orm';
import { writeSystemEvent } from '@/lib/audit/system-event';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { loadTaskDependencyState } from '@/lib/tasks/dependency-state';
import { demoteQueuedTaskToWaiting, markTaskDependencyBlocked } from '@/lib/tasks/dependency-transitions';
import { broadcastTaskProgress } from '@/lib/tasks/task-events';

async function promoteWaitingTaskToQueued(taskId: string, dependsOn: string[]): Promise<boolean> {
  const promoted = await db
    .update(tasks)
    .set({ status: 'queued', queuedAt: new Date().toISOString() })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, 'waiting')))
    .returning({ id: tasks.id });

  if (promoted.length === 0) {
    return false;
  }

  broadcastTaskProgress(taskId, 'queued');
  await writeSystemEvent({
    type: 'task.dependencies_satisfied',
    payload: { taskId, dependsOn },
  });
  return true;
}

export async function handleWaitingTaskDependencyGate(input: {
  taskId: string;
  dependsOn: string[];
}): Promise<'promoted' | 'blocked' | 'pending'> {
  if (input.dependsOn.length === 0) {
    await promoteWaitingTaskToQueued(input.taskId, []);
    return 'promoted';
  }

  const { depState, readiness } = await loadTaskDependencyState(input.dependsOn);
  if (readiness === 'blocked') {
    await markTaskDependencyBlocked({
      taskId: input.taskId,
      dependsOn: input.dependsOn,
      depState,
      allowedCurrentStatuses: ['waiting'],
    });
    return 'blocked';
  }

  if (readiness === 'pending') {
    return 'pending';
  }

  await promoteWaitingTaskToQueued(input.taskId, input.dependsOn);
  return 'promoted';
}

export async function handleQueuedTaskDependencyGate(input: {
  taskId: string;
  dependsOn: string[];
}): Promise<'ready' | 'blocked' | 'waiting'> {
  if (input.dependsOn.length === 0) {
    return 'ready';
  }

  const { depState, readiness } = await loadTaskDependencyState(input.dependsOn);
  if (readiness === 'blocked') {
    await markTaskDependencyBlocked({
      taskId: input.taskId,
      dependsOn: input.dependsOn,
      depState,
      allowedCurrentStatuses: ['queued'],
    });
    return 'blocked';
  }

  if (readiness === 'pending') {
    await demoteQueuedTaskToWaiting({
      taskId: input.taskId,
      dependsOn: input.dependsOn,
    });
    return 'waiting';
  }

  return 'ready';
}
