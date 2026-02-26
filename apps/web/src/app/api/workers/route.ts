// ============================================================
// API: Worker 管理
// GET   /api/workers             - 获取所有 Worker
// POST  /api/workers/register    - Worker 注册
// DELETE /api/workers?status=offline - 清理离线 Worker 记录
// ============================================================

import { db } from '@/lib/db';
import { workers, tasks } from '@/lib/db/schema';
import { sseManager } from '@/lib/sse/manager';
import { and, eq, inArray } from 'drizzle-orm';
import { API_COMMON_MESSAGES, WORKER_MESSAGES } from '@/lib/i18n/messages';
import { writeSystemEvent } from '@/lib/audit/system-event';
import { recoverRunningSchedulerTasksForWorker } from '@/lib/workers/recover-running-tasks';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import {
  parseClaudeAuthStatus,
  parseReportedEnvVars,
  parseWorkerMode,
} from '@/lib/workers/payload';
import { apiBadRequest, apiCreated, apiInternalError, apiSuccess } from '@/lib/http/api-response';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';

async function handleGet() {
  try {
    const result = await db.select().from(workers).orderBy(workers.createdAt);
    return apiSuccess(result);
  } catch (err) {
    console.error('[API] 获取 Worker 列表失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.queryFailed);
  }
}

async function handlePost(request: AuthenticatedRequest) {
  try {
    const body = await readJsonBodyAsRecord(request);
    const payload = body as Partial<typeof workers.$inferInsert> & {
      id?: string;
      name?: string;
      mode?: unknown;
      reportedEnvVars?: unknown;
      claudeAuthStatus?: unknown;
    };

    if (!payload.id || !payload.name) {
      return apiBadRequest(WORKER_MESSAGES.missingRequiredFields);
    }

    const now = new Date().toISOString();
    const mode = parseWorkerMode(payload.mode);
    const reportedEnvVars = parseReportedEnvVars(payload.reportedEnvVars);
    const claudeAuthStatus = parseClaudeAuthStatus(payload.claudeAuthStatus);

    const insertValues: typeof workers.$inferInsert = {
      id: payload.id,
      name: payload.name,
      supportedAgentIds: payload.supportedAgentIds || [],
      maxConcurrent: payload.maxConcurrent || 1,
      mode,
      // 旧 Worker 可能不携带该字段：插入时用默认值，更新时仅在上报时覆盖
      reportedEnvVars: reportedEnvVars ?? [],
      reportedClaudeAuth: claudeAuthStatus ?? null,
      status: 'idle',
      lastHeartbeatAt: now,
      uptimeSince: now,
    };

    const onConflictSet: Partial<typeof workers.$inferInsert> = {
      name: payload.name,
      status: 'idle',
      currentTaskId: null,
      lastHeartbeatAt: now,
      uptimeSince: now,
      supportedAgentIds: payload.supportedAgentIds || [],
    };
    if (payload.mode !== undefined) onConflictSet.mode = mode;
    if (reportedEnvVars !== null) onConflictSet.reportedEnvVars = reportedEnvVars;
    if (claudeAuthStatus !== undefined) onConflictSet.reportedClaudeAuth = claudeAuthStatus;

    const result = await db
      .insert(workers)
      .values(insertValues)
      .onConflictDoUpdate({
        target: workers.id,
        set: onConflictSet,
      })
      .returning();

    await writeSystemEvent({
      type: 'worker.online',
      payload: { workerId: payload.id, name: payload.name },
    });
    sseManager.broadcast('worker.online', { workerId: payload.id, name: payload.name });

    return apiCreated(result[0]);
  } catch (err) {
    console.error('[API] Worker 注册失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.registerFailed);
  }
}

async function handleDelete(request: AuthenticatedRequest) {
  try {
    const status = request.nextUrl.searchParams.get('status');
    if (status !== 'offline') {
      return apiBadRequest(WORKER_MESSAGES.unsupportedCleanupStatus);
    }

    const offlineWorkers = await db
      .select({ id: workers.id, name: workers.name })
      .from(workers)
      .where(eq(workers.status, 'offline'));

    if (offlineWorkers.length === 0) {
      return apiSuccess({ removed: 0, workerIds: [] });
    }

    const workerIds = offlineWorkers.map((item) => item.id);
    const effectiveOfflineWorkers = await db
      .select({ id: workers.id, name: workers.name })
      .from(workers)
      .where(and(inArray(workers.id, workerIds), eq(workers.status, 'offline')));
    const effectiveOfflineWorkerIds = effectiveOfflineWorkers.map((item) => item.id);

    if (effectiveOfflineWorkerIds.length === 0) {
      return apiSuccess({ removed: 0, workerIds: [] });
    }

    // 删除前先回收这些离线 worker 仍挂住的调度任务，避免任务长期卡在 running
    const strandedTasks = await db
      .select({
        id: tasks.id,
        retryCount: tasks.retryCount,
        maxRetries: tasks.maxRetries,
        assignedWorkerId: tasks.assignedWorkerId,
      })
      .from(tasks)
      .where(and(
        inArray(tasks.assignedWorkerId, effectiveOfflineWorkerIds),
        eq(tasks.status, 'running'),
        eq(tasks.source, 'scheduler'),
      ));

    const strandedTasksByWorkerId = new Map<string, Array<{ id: string; retryCount: number; maxRetries: number }>>();
    for (const task of strandedTasks) {
      const workerId = task.assignedWorkerId;
      if (!workerId) continue;
      const current = strandedTasksByWorkerId.get(workerId) || [];
      current.push({
        id: task.id,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
      });
      strandedTasksByWorkerId.set(workerId, current);
    }
    for (const [workerId, runningTasks] of strandedTasksByWorkerId) {
      await recoverRunningSchedulerTasksForWorker({
        workerId,
        runningTasks,
        reason: 'worker_pruned_offline',
      });
    }

    const removedWorkerIds: string[] = [];
    for (let i = 0; i < effectiveOfflineWorkerIds.length; i += 200) {
      const chunk = effectiveOfflineWorkerIds.slice(i, i + 200);
      const deleted = await db
        .delete(workers)
        .where(and(inArray(workers.id, chunk), eq(workers.status, 'offline')))
        .returning({ id: workers.id });
      removedWorkerIds.push(...deleted.map((row) => row.id));
    }

    if (removedWorkerIds.length === 0) {
      return apiSuccess({ removed: 0, workerIds: [] });
    }

    await writeSystemEvent({
      type: 'worker.pruned',
      payload: {
        scope: 'offline',
        removed: removedWorkerIds.length,
        workerIds: removedWorkerIds,
      },
    });

    const workerNameMap = new Map(effectiveOfflineWorkers.map((item) => [item.id, item.name]));
    for (const workerId of removedWorkerIds) {
      sseManager.broadcast('worker.removed', {
        workerId,
        name: workerNameMap.get(workerId) || workerId,
        status: 'offline',
      });
    }
    sseManager.broadcast('worker.pruned', { scope: 'offline', removed: removedWorkerIds.length, workerIds: removedWorkerIds });

    return apiSuccess({ removed: removedWorkerIds.length, workerIds: removedWorkerIds });
  } catch (err) {
    console.error('[API] 清理离线 Worker 失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.cleanupFailed);
  }
}

export const GET = withAuth(handleGet, 'worker:read');
export const POST = withAuth(handlePost, 'worker:manage');
export const DELETE = withAuth(handleDelete, 'worker:prune');
