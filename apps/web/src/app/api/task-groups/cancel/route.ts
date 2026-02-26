// ============================================================
// API: Task Group 取消/停止
// POST /api/task-groups/cancel  - 取消一个 groupId 下的所有非终态任务
// ============================================================

import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';
import { API_COMMON_MESSAGES, TASK_GROUP_MESSAGES } from '@/lib/i18n/messages';
import { resolveAuditActor } from '@/lib/audit/actor';
import { writeSystemEvent } from '@/lib/audit/system-event';
import { emitTaskCancelled } from '@/lib/tasks/task-events';
import { cancelTasksByIds, DEFAULT_CANCELLABLE_TASK_STATUSES, isTaskTerminalStatus } from '@/lib/tasks/lifecycle';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { normalizeOptionalString } from '@/lib/validation/strings';
import { stopManyTaskContainers } from '@/lib/docker/task-containers';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { apiBadRequest, apiInternalError, apiNotFound, apiSuccess } from '@/lib/http/api-response';

async function handler(request: AuthenticatedRequest) {
  try {
    ensureSchedulerStarted();
    const actor = resolveAuditActor(request);
    const body = await readJsonBodyAsRecord(request);
    const groupId = normalizeOptionalString(body.groupId);
    const reason = normalizeOptionalString(body.reason);

    if (!groupId) {
      return apiBadRequest(TASK_GROUP_MESSAGES.groupIdRequired);
    }

    const rows = await db
      .select({ id: tasks.id, status: tasks.status })
      .from(tasks)
      .where(and(eq(tasks.groupId, groupId), eq(tasks.source, 'scheduler')));

    if (rows.length === 0) {
      return apiNotFound(TASK_GROUP_MESSAGES.groupNotFound(groupId));
    }

    const cancellable = rows.filter((t) => !isTaskTerminalStatus(t.status));
    if (cancellable.length === 0) {
      return apiSuccess({ groupId, cancelled: 0, stoppedContainers: 0 });
    }

    const now = new Date().toISOString();
    const ids = cancellable.map((t) => t.id);

    const cancelledTaskIds = await cancelTasksByIds({
      taskIds: ids,
      cancellableStatuses: [...DEFAULT_CANCELLABLE_TASK_STATUSES],
      cancelledAt: now,
    });
    const cancelledTaskIdSet = new Set(cancelledTaskIds);
    if (cancelledTaskIds.length === 0) {
      return apiSuccess({ groupId, cancelled: 0, stoppedContainers: 0 });
    }

    // 系统事件 + SSE：逐任务记录，方便在 Dashboard/Events 追踪
    for (const t of cancellable) {
      if (!cancelledTaskIdSet.has(t.id)) continue;
      await emitTaskCancelled({
        taskId: t.id,
        actor,
        eventPayload: {
          groupId,
          previousStatus: t.status,
          reason: reason || undefined,
        },
        cancelledBroadcastPayload: {
          groupId,
        },
      });
    }

    // best-effort：停止容器（只对 running 任务有意义，其他状态也不会报错）
    const runningCancelledTaskIds = cancellable
      .filter((x) => x.status === 'running' && cancelledTaskIdSet.has(x.id))
      .map((x) => x.id);
    const stoppedContainers = await stopManyTaskContainers(runningCancelledTaskIds);

    await writeSystemEvent({
      type: 'task_group.cancelled',
      actor,
      payload: {
        groupId,
        taskIds: cancelledTaskIds,
        reason: reason || undefined,
        stoppedContainers,
      },
    });
    sseManager.broadcast('task_group.cancelled', { groupId, taskIds: cancelledTaskIds });

    return apiSuccess({
      groupId,
      cancelled: cancelledTaskIds.length,
      stoppedContainers,
    });
  } catch (err) {
    console.error('[API] 取消 Task Group 失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.cancelFailed);
  }
}

export const POST = withAuth(handler, 'task:update');
