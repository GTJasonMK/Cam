// ============================================================
// API: Task Group 批量重跑（失败/取消）
// POST /api/task-groups/rerun-failed  - 将 groupId 下 failed/cancelled 的任务重新入队
// ============================================================

import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';
import { API_COMMON_MESSAGES, TASK_GROUP_MESSAGES } from '@/lib/i18n/messages';
import { resolveAuditActor } from '@/lib/audit/actor';
import { writeSystemEvent } from '@/lib/audit/system-event';
import { rerunTaskFromSnapshot } from '@/lib/tasks/lifecycle';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { normalizeOptionalString } from '@/lib/validation/strings';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { apiBadRequest, apiInternalError, apiNotFound, apiSuccess } from '@/lib/http/api-response';

async function handler(request: AuthenticatedRequest) {
  try {
    ensureSchedulerStarted();
    const actor = resolveAuditActor(request);
    const body = await readJsonBodyAsRecord(request);
    const groupId = normalizeOptionalString(body.groupId);
    const feedbackInput = normalizeOptionalString(body.feedback);

    if (!groupId) {
      return apiBadRequest(TASK_GROUP_MESSAGES.groupIdRequired);
    }

    const rows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.groupId, groupId), eq(tasks.source, 'scheduler')))
      .orderBy(tasks.createdAt);
    if (rows.length === 0) {
      return apiNotFound(TASK_GROUP_MESSAGES.groupNotFound(groupId));
    }

    const targets = rows.filter((t) => t.status === 'failed' || t.status === 'cancelled');
    if (targets.length === 0) {
      return apiSuccess({ groupId, requeued: 0 });
    }

    const now = new Date().toISOString();
    const updatedIds: string[] = [];

    for (const t of targets) {
      const rerunResult = await rerunTaskFromSnapshot({
        snapshot: {
          id: t.id,
          status: t.status,
          retryCount: t.retryCount,
          maxRetries: t.maxRetries,
          feedback: t.feedback,
        },
        actor,
        feedbackInput,
        queuedAt: now,
        eventPayload: {
          groupId,
          feedback: feedbackInput || undefined,
        },
        rerunBroadcastPayload: {
          groupId,
        },
      });
      if (!rerunResult.updated) {
        continue;
      }
      updatedIds.push(t.id);
    }

    await writeSystemEvent({
      type: 'task_group.rerun_failed',
      actor,
      payload: { groupId, taskIds: updatedIds, feedback: feedbackInput || undefined },
    });
    sseManager.broadcast('task_group.rerun_failed', { groupId, taskIds: updatedIds });

    return apiSuccess({ groupId, requeued: updatedIds.length, taskIds: updatedIds });
  } catch (err) {
    console.error('[API] Task Group 重跑失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.rerunFailed);
  }
}

export const POST = withAuth(handler, 'task:update');
