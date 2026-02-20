// ============================================================
// API: Task Group 批量重跑（失败/取消）
// POST /api/task-groups/rerun-failed  - 将 groupId 下 failed/cancelled 的任务重新入队
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, systemEvents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';
import { API_COMMON_MESSAGES, TASK_GROUP_MESSAGES } from '@/lib/i18n/messages';
import { resolveAuditActor } from '@/lib/audit/actor';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

async function handler(request: AuthenticatedRequest) {
  try {
    ensureSchedulerStarted();
    const actor = resolveAuditActor(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const groupId = normalizeString(body.groupId);
    const feedbackInput = normalizeString(body.feedback);

    if (!groupId) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: TASK_GROUP_MESSAGES.groupIdRequired } },
        { status: 400 }
      );
    }

    const rows = await db.select().from(tasks).where(eq(tasks.groupId, groupId)).orderBy(tasks.createdAt).limit(2000);
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: TASK_GROUP_MESSAGES.groupNotFound(groupId) } },
        { status: 404 }
      );
    }

    const targets = rows.filter((t) => t.status === 'failed' || t.status === 'cancelled');
    if (targets.length === 0) {
      return NextResponse.json({ success: true, data: { groupId, requeued: 0 } });
    }

    const now = new Date().toISOString();
    const updatedIds: string[] = [];

    for (const t of targets) {
      const nextRetryCount = t.retryCount + 1;
      const nextMaxRetries = Math.max(t.maxRetries, nextRetryCount);

      await db
        .update(tasks)
        .set({
          status: 'queued',
          feedback: feedbackInput ?? t.feedback ?? null,
          retryCount: nextRetryCount,
          maxRetries: nextMaxRetries,
          assignedWorkerId: null,
          queuedAt: now,
          startedAt: null,
          completedAt: null,
          reviewedAt: null,
          reviewComment: null,
          summary: null,
          logFileUrl: null,
        })
        .where(eq(tasks.id, t.id));

      updatedIds.push(t.id);

      await db.insert(systemEvents).values({
        type: 'task.rerun_requested',
        actor,
        payload: {
          taskId: t.id,
          groupId,
          previousStatus: t.status,
          retryCount: nextRetryCount,
          maxRetries: nextMaxRetries,
          feedback: feedbackInput || undefined,
        },
      });

      sseManager.broadcast('task.rerun_requested', { taskId: t.id, groupId });
      sseManager.broadcast('task.progress', { taskId: t.id, status: 'queued' });
    }

    await db.insert(systemEvents).values({
      type: 'task_group.rerun_failed',
      actor,
      payload: { groupId, taskIds: updatedIds, feedback: feedbackInput || undefined },
    });
    sseManager.broadcast('task_group.rerun_failed', { groupId, taskIds: updatedIds });

    return NextResponse.json({ success: true, data: { groupId, requeued: updatedIds.length, taskIds: updatedIds } });
  } catch (err) {
    console.error('[API] Task Group 重跑失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.rerunFailed } },
      { status: 500 }
    );
  }
}

export const POST = withAuth(handler, 'task:update');
