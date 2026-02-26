// ============================================================
// API: Agent 会话关联任务
// POST /api/agent-sessions/{id}/link-task
// 将终端 Agent 会话的结果关联到已有任务或创建新任务记录
// ============================================================

import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { agentSessionManager } from '@/lib/terminal/agent-session-manager';
import { sseManager } from '@/lib/sse/manager';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { readJsonBodyOrDefault } from '@/lib/http/read-json';
import { apiError, apiNotFound, apiSuccess } from '@/lib/http/api-response';

type RouteContext = { params: Promise<{ id: string }> };

async function handlePost(request: AuthenticatedRequest, context: RouteContext) {
  const { id: sessionId } = await context.params;

  // 验证会话存在
  const meta = agentSessionManager.getMeta(sessionId);
  if (!meta) {
    return apiNotFound('Agent 会话不存在');
  }
  if (meta.userId !== request.user.id) {
    return apiError('FORBIDDEN', '无权访问该 Agent 会话', { status: 403 });
  }

  const body = await readJsonBodyOrDefault<Record<string, unknown> | null>(request, null);
  if (!body || typeof body !== 'object') {
    return apiError('BAD_REQUEST', '请求体无效', { status: 400 });
  }

  const { taskId, createTask, title } = body as {
    taskId?: string;
    createTask?: boolean;
    title?: string;
  };

  // 模式 1：关联到已有任务
  if (taskId) {
    const summaryText = `[终端调试] Agent: ${meta.agentDisplayName}, 会话: ${sessionId.slice(0, 8)}, 状态: ${meta.status}`;
    const linkedRows = await db
      .update(tasks)
      .set({ summary: summaryText })
      .where(eq(tasks.id, taskId))
      .returning({ id: tasks.id, status: tasks.status });

    if (linkedRows.length === 0) {
      return apiNotFound('任务不存在');
    }

    sseManager.broadcast('task.progress', { taskId, status: linkedRows[0].status });

    return apiSuccess({ taskId, linked: true });
  }

  // 模式 2：创建新任务记录
  if (createTask) {
    const now = new Date().toISOString();
    const newTaskId = randomUUID();
    const taskTitle = title || `终端调试: ${meta.agentDisplayName} (${sessionId.slice(0, 8)})`;
    const taskStatus =
      meta.status === 'completed'
        ? 'completed'
        : meta.status === 'failed'
          ? 'failed'
          : meta.status === 'cancelled'
            ? 'cancelled'
            : 'running';
    const isFinished = taskStatus === 'completed' || taskStatus === 'failed' || taskStatus === 'cancelled';

    await db.insert(tasks).values({
      id: newTaskId,
      title: taskTitle,
      description: `来源: 终端 Agent 会话 ${sessionId}\n提示词: ${meta.prompt || '(无)'}`,
      agentDefinitionId: meta.agentDefinitionId,
      repoUrl: meta.repoUrl || '',
      baseBranch: '',
      workBranch: meta.workBranch || '',
      status: taskStatus,
      source: 'terminal',
      createdAt: now,
      queuedAt: null,
      startedAt: new Date(meta.startedAt).toISOString(),
      completedAt: isFinished ? now : null,
    });

    sseManager.broadcast('task.progress', { taskId: newTaskId, status: taskStatus });

    return apiSuccess({ taskId: newTaskId, created: true });
  }

  return apiError('BAD_REQUEST', '需要指定 taskId 或 createTask', { status: 400 });
}

export const POST = withAuth(handlePost, 'task:update');
