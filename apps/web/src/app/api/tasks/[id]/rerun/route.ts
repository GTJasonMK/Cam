// ============================================================
// API: Task 重跑
// POST /api/tasks/[id]/rerun  - 将任务重新入队（failed/cancelled/completed 等）
// ============================================================

import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { parseRerunPayload } from '@/lib/validation/task-input';
import { API_COMMON_MESSAGES, TASK_MESSAGES } from '@/lib/i18n/messages';
import { resolveAuditActor } from '@/lib/audit/actor';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { apiBadRequest, apiConflict, apiInternalError, apiNotFound, apiSuccess } from '@/lib/http/api-response';
import { rerunTaskFromSnapshot } from '@/lib/tasks/lifecycle';

async function handler(request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const actor = resolveAuditActor(request);
    const body = await readJsonBodyAsRecord(request);
    const parsed = parseRerunPayload(body);
    if (!parsed.success) {
      return apiBadRequest(parsed.errorMessage);
    }
    const { feedback } = parsed.data;

    const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (existing.length === 0) {
      return apiNotFound(TASK_MESSAGES.notFound(id));
    }

    // 仅支持调度任务重跑。terminal 任务不走调度器，重跑会导致“queued 但永不执行”。
    if (existing[0].source !== 'scheduler') {
      return apiConflict('仅调度任务支持重跑；终端任务请在终端页面重新发起执行');
    }

    // 对 queued/running 任务：避免重复入队
    if (existing[0].status === 'queued' || existing[0].status === 'running') {
      return apiConflict(TASK_MESSAGES.rerunStateConflict(existing[0].status));
    }

    // 对 awaiting_review：鼓励走 Reject&Re-run（带强制反馈）
    if (existing[0].status === 'awaiting_review') {
      return apiConflict(TASK_MESSAGES.invalidAwaitingReviewRerun);
    }

    const previousStatus = existing[0].status;
    const rerunResult = await rerunTaskFromSnapshot({
      snapshot: {
        id,
        status: previousStatus,
        retryCount: existing[0].retryCount,
        maxRetries: existing[0].maxRetries,
        feedback: existing[0].feedback,
      },
      actor,
      // 允许用户可选追加反馈；空值则保留旧反馈
      feedbackInput: feedback,
      eventPayload: {
        feedback: feedback || undefined,
      },
    });
    if (!rerunResult.updated) {
      return apiConflict('任务状态已变化，请刷新后重试');
    }

    return apiSuccess(rerunResult.updatedTask);
  } catch (err) {
    console.error(`[API] 重跑任务 ${id} 失败:`, err);
    return apiInternalError(API_COMMON_MESSAGES.rerunFailed);
  }
}

export const POST = withAuth(handler, 'task:update');
