// ============================================================
// API: Worker 心跳
// POST /api/workers/[id]/heartbeat  - Worker 心跳上报
// ============================================================

import { db } from '@/lib/db';
import { workers } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import { API_COMMON_MESSAGES, WORKER_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { parseWorkerStatus } from '@/lib/workers/status';
import { isPlainObject } from '@/lib/validation/objects';
import { readJsonBodyOrDefault } from '@/lib/http/read-json';
import {
  apiBadRequest,
  apiConflict,
  apiInternalError,
  apiNotFound,
  apiSuccess,
} from '@/lib/http/api-response';
import {
  parseClaudeAuthStatus,
  parseReportedEnvVars,
  parseWorkerMode,
} from '@/lib/workers/payload';

async function handler(request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const bodyRaw = await readJsonBodyOrDefault<Record<string, unknown> | null>(request, null);
    if (!isPlainObject(bodyRaw)) {
      return apiBadRequest('请求体必须是 JSON object');
    }
    const body = bodyRaw;
    const reportedStatus = body.status === undefined ? 'busy' : parseWorkerStatus(body.status);
    if (reportedStatus === null) {
      return apiBadRequest('status 仅支持 idle/busy/offline/draining');
    }

    const parsedCurrentTaskId =
      typeof body.currentTaskId === 'string'
        ? body.currentTaskId
        : body.currentTaskId === null || body.currentTaskId === undefined
          ? null
          : null;
    const mode = parseWorkerMode(body.mode, { allowUndefinedAsNull: true });
    const reportedEnvVars = parseReportedEnvVars(body.reportedEnvVars);
    const claudeAuthStatus = parseClaudeAuthStatus(body.claudeAuthStatus);

    // CAS + 重试：避免并发下覆盖管理端状态（尤其 offline 粘性）
    // 典型竞态：读取到 busy 后，管理员将其 offline；旧心跳若无条件更新会把状态“拉回在线”。
    let nextStatus: 'idle' | 'busy' | 'offline' | 'draining' = reportedStatus;
    let nextCurrentTaskId: string | null = parsedCurrentTaskId;
    let updated = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await db.select({ status: workers.status }).from(workers).where(eq(workers.id, id)).limit(1);
      if (existing.length === 0) {
        return apiNotFound(WORKER_MESSAGES.notFound(id));
      }

      const shouldKeepDraining =
        existing[0].status === 'draining' &&
        (reportedStatus === 'idle' || reportedStatus === 'busy');
      // 管理员手动 offline 后，心跳不应把 Worker 自动“拉回在线”。
      // 只有显式 activate（走管理接口）才允许恢复到 idle/busy。
      const shouldKeepOffline =
        existing[0].status === 'offline' &&
        reportedStatus !== 'offline';
      nextStatus = shouldKeepOffline
        ? 'offline'
        : shouldKeepDraining
          ? 'draining'
          : reportedStatus;
      nextCurrentTaskId =
        nextStatus === 'offline' || nextStatus === 'idle'
          ? null
          : parsedCurrentTaskId;

      const updateData: Record<string, unknown> = {
        status: nextStatus,
        currentTaskId: nextCurrentTaskId,
        cpuUsage: body.cpuUsage ?? null,
        memoryUsageMb: body.memoryUsageMb ?? null,
        diskUsageMb: body.diskUsageMb ?? null,
        lastHeartbeatAt: new Date().toISOString(),
      };
      // 仅在上报时更新，避免空心跳覆盖已有日志
      if (body.logTail !== undefined) {
        updateData.logTail = body.logTail ?? null;
      }
      if (mode !== null) {
        updateData.mode = mode;
      }
      if (reportedEnvVars !== null) {
        updateData.reportedEnvVars = reportedEnvVars;
      }
      if (claudeAuthStatus !== undefined) {
        updateData.reportedClaudeAuth = claudeAuthStatus;
      }

      const casUpdated = await db
        .update(workers)
        .set(updateData)
        .where(and(eq(workers.id, id), eq(workers.status, existing[0].status)))
        .returning({ id: workers.id });
      if (casUpdated.length > 0) {
        updated = true;
        break;
      }
    }

    if (!updated) {
      return apiConflict('Worker 状态并发变更，请重试');
    }

    // 广播心跳事件给前端
    sseManager.broadcast('worker.heartbeat', {
      workerId: id,
      status: nextStatus,
      cpuUsage: body.cpuUsage,
      memoryUsageMb: body.memoryUsageMb,
      currentTaskId: nextCurrentTaskId,
      logTail: body.logTail,
    });

    return apiSuccess(null);
  } catch (err) {
    console.error(`[API] Worker ${id} 心跳失败:`, err);
    return apiInternalError(API_COMMON_MESSAGES.heartbeatUpdateFailed);
  }
}

export const POST = withAuth(handler, 'worker:manage');
