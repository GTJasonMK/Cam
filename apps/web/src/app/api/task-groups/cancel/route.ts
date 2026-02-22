// ============================================================
// API: Task Group 取消/停止
// POST /api/task-groups/cancel  - 取消一个 groupId 下的所有非终态任务
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, systemEvents } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import Dockerode from 'dockerode';
import fs from 'fs';
import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';
import { API_COMMON_MESSAGES, TASK_GROUP_MESSAGES } from '@/lib/i18n/messages';
import { resolveAuditActor } from '@/lib/audit/actor';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { agentSessionManager } from '@/lib/terminal/agent-session-manager';

const dockerSocketPath = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';
const docker = new Dockerode({ socketPath: dockerSocketPath });

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

async function stopTaskContainers(taskId: string): Promise<number> {
  if (!fs.existsSync(dockerSocketPath)) return 0;

  const containers = await docker.listContainers({
    all: true,
    filters: {
      label: [`cam.task-id=${taskId}`],
    },
  });

  let stopped = 0;
  for (const c of containers) {
    try {
      await docker.getContainer(c.Id).stop({ t: 10 });
      stopped += 1;
    } catch {
      // ignore
    }
  }

  return stopped;
}

async function handler(request: AuthenticatedRequest) {
  try {
    ensureSchedulerStarted();
    const actor = resolveAuditActor(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const groupId = normalizeString(body.groupId);
    const reason = normalizeString(body.reason);

    if (!groupId) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: TASK_GROUP_MESSAGES.groupIdRequired } },
        { status: 400 }
      );
    }

    const rows = await db
      .select({ id: tasks.id, status: tasks.status, source: tasks.source, groupId: tasks.groupId })
      .from(tasks)
      .where(eq(tasks.groupId, groupId))
      .limit(2000);

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: TASK_GROUP_MESSAGES.groupNotFound(groupId) } },
        { status: 404 }
      );
    }

    const cancellable = rows.filter((t) => !['cancelled', 'completed', 'failed'].includes(t.status));
    if (cancellable.length === 0) {
      return NextResponse.json({ success: true, data: { groupId, cancelled: 0, stoppedContainers: 0 } });
    }

    const now = new Date().toISOString();
    const ids = cancellable.map((t) => t.id);

    await db
      .update(tasks)
      .set({
        status: 'cancelled',
        completedAt: now,
      })
      .where(inArray(tasks.id, ids));

    // 系统事件 + SSE：逐任务记录，方便在 Dashboard/Events 追踪
    for (const t of cancellable) {
      await db.insert(systemEvents).values({
        type: 'task.cancelled',
        actor,
        payload: { taskId: t.id, groupId, previousStatus: t.status, reason: reason || undefined },
      });
      sseManager.broadcast('task.progress', { taskId: t.id, status: 'cancelled' });
      sseManager.broadcast('task.cancelled', { taskId: t.id, groupId });
    }

    // best-effort：停止容器（只对 running 任务有意义，其他状态也不会报错）
    let stoppedContainers = 0;
    for (const t of cancellable.filter((x) => x.status === 'running')) {
      try {
        stoppedContainers += await stopTaskContainers(t.id);
      } catch {
        // ignore
      }
    }

    // best-effort：停止 terminal 会话/流水线（避免只改 DB 状态导致会话继续执行）
    let cancelledRuntimePipelines = 0;
    let cancelledRuntimeSessions = 0;
    const cancelledPipelineIds = new Set<string>();
    const terminalTasks = cancellable.filter((t) => t.source === 'terminal');
    for (const t of terminalTasks) {
      const pipelineId = t.groupId;
      if (typeof pipelineId === 'string' && pipelineId.startsWith('pipeline/')) {
        const pipeline = agentSessionManager.getPipeline(pipelineId);
        if (pipeline && (pipeline.status === 'running' || pipeline.status === 'paused')) {
          if (!cancelledPipelineIds.has(pipelineId)) {
            agentSessionManager.cancelPipeline(pipelineId);
            cancelledPipelineIds.add(pipelineId);
            cancelledRuntimePipelines += 1;
          }
          continue;
        }
      }
      if (agentSessionManager.cancelAgentSessionByTaskId(t.id)) {
        cancelledRuntimeSessions += 1;
      }
    }

    await db.insert(systemEvents).values({
      type: 'task_group.cancelled',
      actor,
      payload: {
        groupId,
        taskIds: ids,
        reason: reason || undefined,
        stoppedContainers,
        cancelledRuntimePipelines,
        cancelledRuntimeSessions,
      },
    });
    sseManager.broadcast('task_group.cancelled', { groupId, taskIds: ids });

    return NextResponse.json({
      success: true,
      data: {
        groupId,
        cancelled: ids.length,
        stoppedContainers,
        cancelledRuntimePipelines,
        cancelledRuntimeSessions,
      },
    });
  } catch (err) {
    console.error('[API] 取消 Task Group 失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.cancelFailed } },
      { status: 500 }
    );
  }
}

export const POST = withAuth(handler, 'task:update');
