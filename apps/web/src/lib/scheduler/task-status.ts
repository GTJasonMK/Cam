import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { emitTaskProgress } from '@/lib/tasks/task-events';
import { isTaskTerminalStatus } from '@/lib/tasks/status';

export async function updateSchedulerTaskStatus(
  taskId: string,
  status: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const existing = await db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (existing.length === 0) return;

  // 终态收敛后不再被调度器内部迟到回写覆盖。
  if (isTaskTerminalStatus(existing[0].status) && existing[0].status !== status) {
    return;
  }

  const updateData: Record<string, unknown> = { status };
  if (extra) Object.assign(updateData, extra);

  if (status === 'running') {
    updateData.startedAt = new Date().toISOString();
  } else if (status === 'completed' || status === 'failed') {
    updateData.completedAt = new Date().toISOString();
  }

  const updated = await db
    .update(tasks)
    .set(updateData)
    .where(and(eq(tasks.id, taskId), eq(tasks.status, existing[0].status)))
    .returning({ id: tasks.id });
  if (updated.length === 0) return;

  await emitTaskProgress({
    taskId,
    status,
    eventPayload: extra,
  });
}
