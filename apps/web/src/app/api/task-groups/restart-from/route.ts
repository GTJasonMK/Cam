// ============================================================
// API: Task Group 从某一步开始重启（重置下游为 waiting）
// POST /api/task-groups/restart-from  - fromTaskId + dependents(closure) 重新入队
// ============================================================

import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';
import { API_COMMON_MESSAGES, TASK_GROUP_MESSAGES } from '@/lib/i18n/messages';
import { resolveAuditActor } from '@/lib/audit/actor';
import { writeSystemEvent } from '@/lib/audit/system-event';
import { buildTaskReplayResetFields } from '@/lib/tasks/reset-fields';
import { computeRetryWindow } from '@/lib/tasks/retry-window';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { normalizeOptionalString } from '@/lib/validation/strings';
import { buildDependentsMap, computeDependencyClosure } from '@/lib/tasks/dependency-graph';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { apiBadRequest, apiConflict, apiInternalError, apiNotFound, apiSuccess } from '@/lib/http/api-response';

type TaskRow = {
  id: string;
  status: string;
  dependsOn: string[];
  retryCount: number;
  maxRetries: number;
  feedback: string | null;
};

async function handler(request: AuthenticatedRequest) {
  try {
    ensureSchedulerStarted();
    const actor = resolveAuditActor(request);
    const body = await readJsonBodyAsRecord(request);
    const groupId = normalizeOptionalString(body.groupId);
    const fromTaskId = normalizeOptionalString(body.fromTaskId);
    const feedbackInput = normalizeOptionalString(body.feedback);

    if (!groupId || !fromTaskId) {
      return apiBadRequest(TASK_GROUP_MESSAGES.groupIdAndFromTaskIdRequired);
    }

    const groupRows = (await db
      .select({
        id: tasks.id,
        status: tasks.status,
        dependsOn: tasks.dependsOn,
        retryCount: tasks.retryCount,
        maxRetries: tasks.maxRetries,
        feedback: tasks.feedback,
      })
      .from(tasks)
      .where(and(eq(tasks.groupId, groupId), eq(tasks.source, 'scheduler')))) as unknown as TaskRow[];

    if (groupRows.length === 0) {
      return apiNotFound(TASK_GROUP_MESSAGES.groupNotFound(groupId));
    }

    const byId = new Map(groupRows.map((t) => [t.id, t]));
    const from = byId.get(fromTaskId);
    if (!from) {
      return apiNotFound(TASK_GROUP_MESSAGES.fromTaskNotInGroup(fromTaskId));
    }

    const dependentsMap = buildDependentsMap(groupRows);
    const closure = computeDependencyClosure(fromTaskId, dependentsMap);
    const closureIds = Array.from(closure);

    const runningInClosure = groupRows.filter((t) => closure.has(t.id) && t.status === 'running').map((t) => t.id);
    if (runningInClosure.length > 0) {
      return apiConflict(TASK_GROUP_MESSAGES.closureRunningConflict(runningInClosure), {
        extra: { runningTaskIds: runningInClosure },
      });
    }

    // fromTask 的依赖必须完成才可 queued，否则保持 waiting（避免错误抢跑）
    const deps = (from.dependsOn as string[]) || [];
    let depsCompleted = true;
    if (deps.length > 0) {
      const depRows = await db.select({ id: tasks.id, status: tasks.status }).from(tasks).where(inArray(tasks.id, deps));
      depsCompleted = depRows.length === deps.length && depRows.every((d) => d.status === 'completed');
    }

    const now = new Date().toISOString();
    const updated: Array<{ id: string; status: string; previousStatus: string }> = [];

    for (const id of closureIds) {
      const t = byId.get(id);
      if (!t) continue;

      const previousStatus = t.status;
      const shouldBumpRetry = ['completed', 'failed', 'cancelled', 'awaiting_review'].includes(previousStatus);
      const { nextRetryCount, nextMaxRetries } = computeRetryWindow({
        retryCount: t.retryCount,
        maxRetries: t.maxRetries,
        shouldIncrement: shouldBumpRetry,
      });

      const nextStatus = id === fromTaskId ? (depsCompleted ? 'queued' : 'waiting') : 'waiting';
      const nextFeedback = id === fromTaskId ? (feedbackInput ?? t.feedback ?? null) : t.feedback ?? null;

      const updatedRows = await db
        .update(tasks)
        .set(buildTaskReplayResetFields({
          status: nextStatus,
          feedback: nextFeedback,
          retryCount: nextRetryCount,
          maxRetries: nextMaxRetries,
          queuedAt: id === fromTaskId && nextStatus === 'queued' ? now : null,
        }))
        .where(and(eq(tasks.id, id), eq(tasks.status, previousStatus)))
        .returning({ id: tasks.id });
      if (updatedRows.length === 0) {
        continue;
      }

      updated.push({ id, status: nextStatus, previousStatus });

      await writeSystemEvent({
        type: 'task.restart_from',
        actor,
        payload: {
          taskId: id,
          groupId,
          fromTaskId,
          previousStatus,
          nextStatus,
          retryCount: nextRetryCount,
          maxRetries: nextMaxRetries,
        },
      });

      sseManager.broadcast('task.progress', { taskId: id, status: nextStatus });
    }

    const updatedIds = updated.map((item) => item.id);

    await writeSystemEvent({
      type: 'task_group.restart_from',
      actor,
      payload: { groupId, fromTaskId, taskIds: updatedIds, feedback: feedbackInput || undefined },
    });
    sseManager.broadcast('task_group.restart_from', { groupId, fromTaskId, taskIds: updatedIds });

    return apiSuccess({
      groupId,
      fromTaskId,
      resetTasks: updated.length,
      taskIds: updatedIds,
      queuedTaskId: depsCompleted && updatedIds.includes(fromTaskId) ? fromTaskId : null,
      waitingBecauseDeps: depsCompleted ? [] : deps,
    });
  } catch (err) {
    console.error('[API] Task Group restart-from 失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.restartFailed);
  }
}

export const POST = withAuth(handler, 'task:update');
