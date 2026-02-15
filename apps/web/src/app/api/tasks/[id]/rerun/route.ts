// ============================================================
// API: Task 重跑
// POST /api/tasks/[id]/rerun  - 将任务重新入队（failed/cancelled/completed 等）
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, systemEvents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import { parseRerunPayload } from '@/lib/validation/task-input';
import { API_COMMON_MESSAGES, TASK_MESSAGES } from '@/lib/i18n/messages';
import { resolveAuditActor } from '@/lib/audit/actor';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const actor = resolveAuditActor(request);
    const body = await request.json().catch(() => ({}));
    const parsed = parseRerunPayload(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: parsed.errorMessage } },
        { status: 400 }
      );
    }
    const { feedback } = parsed.data;

    const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: TASK_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    // 对 queued/running 任务：避免重复入队
    if (existing[0].status === 'queued' || existing[0].status === 'running') {
      return NextResponse.json(
        { success: false, error: { code: 'STATE_CONFLICT', message: TASK_MESSAGES.rerunStateConflict(existing[0].status) } },
        { status: 409 }
      );
    }

    // 对 awaiting_review：鼓励走 Reject&Re-run（带强制反馈）
    if (existing[0].status === 'awaiting_review') {
      return NextResponse.json(
        { success: false, error: { code: 'STATE_CONFLICT', message: TASK_MESSAGES.invalidAwaitingReviewRerun } },
        { status: 409 }
      );
    }

    const previousStatus = existing[0].status;
    const nextRetryCount = existing[0].retryCount + 1;
    const nextMaxRetries = Math.max(existing[0].maxRetries, nextRetryCount);

    const result = await db
      .update(tasks)
      .set({
        status: 'queued',
        // 允许用户可选追加反馈；空值则保留旧反馈
        feedback: feedback ?? existing[0].feedback ?? null,
        retryCount: nextRetryCount,
        maxRetries: nextMaxRetries,
        assignedWorkerId: null,
        queuedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        reviewedAt: null,
        reviewComment: null,
        summary: null,
        logFileUrl: null,
      })
      .where(eq(tasks.id, id))
      .returning();

    // 系统事件 + SSE
    await db.insert(systemEvents).values({
      type: 'task.rerun_requested',
      actor,
      payload: {
        taskId: id,
        previousStatus,
        retryCount: nextRetryCount,
        maxRetries: nextMaxRetries,
        feedback: feedback || undefined,
      },
    });
    sseManager.broadcast('task.rerun_requested', { taskId: id });
    sseManager.broadcast('task.progress', { taskId: id, status: 'queued' });

    return NextResponse.json({ success: true, data: result[0] });
  } catch (err) {
    console.error(`[API] 重跑任务 ${id} 失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.rerunFailed } },
      { status: 500 }
    );
  }
}
