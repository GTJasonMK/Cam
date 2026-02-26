// ============================================================
// API: 单个 Worker 管理
// GET   /api/workers/[id]   - 获取 Worker 详情
// PATCH /api/workers/[id]   - Worker 操作（drain/offline/activate）
// ============================================================

import { db } from '@/lib/db';
import { workers, tasks } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import { API_COMMON_MESSAGES, WORKER_MESSAGES } from '@/lib/i18n/messages';
import { resolveAuditActor } from '@/lib/audit/actor';
import { writeSystemEvent } from '@/lib/audit/system-event';
import { recoverRunningSchedulerTasksForWorker } from '@/lib/workers/recover-running-tasks';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { apiBadRequest, apiInternalError, apiNotFound, apiSuccess } from '@/lib/http/api-response';

type WorkerAction = 'drain' | 'offline' | 'activate';

function parseAction(input: unknown): WorkerAction | null {
  if (input === 'drain' || input === 'offline' || input === 'activate') return input;
  return null;
}

async function handleGet(_request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const rows = await db.select().from(workers).where(eq(workers.id, id)).limit(1);
    if (rows.length === 0) {
      return apiNotFound(WORKER_MESSAGES.notFound(id));
    }

    return apiSuccess(rows[0]);
  } catch (err) {
    console.error(`[API] 获取 Worker ${id} 失败:`, err);
    return apiInternalError(API_COMMON_MESSAGES.queryFailed);
  }
}

async function handlePatch(request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const actor = resolveAuditActor(request);
    const body = await readJsonBodyAsRecord(request);
    const action = parseAction(body.action);
    if (!action) {
      return apiBadRequest(WORKER_MESSAGES.invalidAction);
    }

    const existing = await db.select().from(workers).where(eq(workers.id, id)).limit(1);
    if (existing.length === 0) {
      return apiNotFound(WORKER_MESSAGES.notFound(id));
    }

    let nextStatus = existing[0].status;
    let nextCurrentTaskId = existing[0].currentTaskId;

    if (action === 'drain') {
      nextStatus = 'draining';
    } else if (action === 'offline') {
      nextStatus = 'offline';
      nextCurrentTaskId = null;
    } else if (action === 'activate') {
      nextStatus = 'idle';
      nextCurrentTaskId = null;
    }

    const result = await db
      .update(workers)
      .set({
        status: nextStatus,
        currentTaskId: nextCurrentTaskId,
      })
      .where(eq(workers.id, id))
      .returning();
    if (result.length === 0) {
      return apiNotFound(WORKER_MESSAGES.notFound(id));
    }

    // 手动下线时，立即回收该 worker 挂住的所有调度任务，避免任务长期卡在 running
    if (action === 'offline') {
      const runningTasks = await db
        .select({
          id: tasks.id,
          retryCount: tasks.retryCount,
          maxRetries: tasks.maxRetries,
        })
        .from(tasks)
        .where(and(
          eq(tasks.assignedWorkerId, id),
          eq(tasks.status, 'running'),
          eq(tasks.source, 'scheduler'),
        ));

      await recoverRunningSchedulerTasksForWorker({
        workerId: id,
        runningTasks,
        reason: 'worker_offline_manual',
        actor,
      });
    }

    await writeSystemEvent({
      type: 'worker.status_changed',
      actor,
      payload: {
        workerId: id,
        workerName: existing[0].name,
        action,
        fromStatus: existing[0].status,
        toStatus: nextStatus,
      },
    });

    sseManager.broadcast('worker.status_changed', {
      workerId: id,
      name: existing[0].name,
      action,
      fromStatus: existing[0].status,
      status: nextStatus,
      currentTaskId: nextCurrentTaskId,
    });

    return apiSuccess(result[0]);
  } catch (err) {
    console.error(`[API] 更新 Worker ${id} 失败:`, err);
    return apiInternalError(API_COMMON_MESSAGES.updateFailed);
  }
}

export const GET = withAuth(handleGet, 'worker:read');
export const PATCH = withAuth(handlePatch, 'worker:manage');
