// ============================================================
// API: Agent 会话关联任务
// POST /api/agent-sessions/{id}/link-task
// 将终端 Agent 会话的结果关联到已有任务或创建新任务记录
// ============================================================

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { agentSessionManager } from '@/lib/terminal/agent-session-manager';
import { sseManager } from '@/lib/sse/manager';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';

type RouteContext = { params: Promise<{ id: string }> };

async function handlePost(request: AuthenticatedRequest, context: RouteContext) {
  const { id: sessionId } = await context.params;

  // 验证会话存在
  const meta = agentSessionManager.getMeta(sessionId);
  if (!meta) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Agent 会话不存在' } },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_REQUEST', message: '请求体无效' } },
      { status: 400 },
    );
  }

  const { taskId, createTask, title } = body as {
    taskId?: string;
    createTask?: boolean;
    title?: string;
  };

  // 模式 1：关联到已有任务
  if (taskId) {
    const [existing] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: '任务不存在' } },
        { status: 404 },
      );
    }

    const summaryText = `[终端调试] Agent: ${meta.agentDisplayName}, 会话: ${sessionId.slice(0, 8)}, 状态: ${meta.status}`;
    await db
      .update(tasks)
      .set({ summary: summaryText })
      .where(eq(tasks.id, taskId));

    sseManager.broadcast('task.progress', { taskId, status: existing.status });

    return NextResponse.json({
      success: true,
      data: { taskId, linked: true },
    });
  }

  // 模式 2：创建新任务记录
  if (createTask) {
    const now = new Date().toISOString();
    const newTaskId = crypto.randomUUID();
    const taskTitle = title || `终端调试: ${meta.agentDisplayName} (${sessionId.slice(0, 8)})`;
    const taskStatus = meta.status === 'completed' ? 'completed' : meta.status === 'failed' ? 'failed' : 'cancelled';

    await db.insert(tasks).values({
      id: newTaskId,
      title: taskTitle,
      description: `来源: 终端 Agent 会话 ${sessionId}\n提示词: ${meta.prompt || '(无)'}`,
      agentDefinitionId: meta.agentDefinitionId,
      repoUrl: meta.repoUrl || '',
      baseBranch: '',
      workBranch: meta.workBranch || '',
      status: taskStatus,
      createdAt: now,
      queuedAt: now,
      startedAt: new Date(meta.startedAt).toISOString(),
      completedAt: now,
    });

    sseManager.broadcast('task.progress', { taskId: newTaskId, status: taskStatus });

    return NextResponse.json({
      success: true,
      data: { taskId: newTaskId, created: true },
    });
  }

  return NextResponse.json(
    { success: false, error: { code: 'BAD_REQUEST', message: '需要指定 taskId 或 createTask' } },
    { status: 400 },
  );
}

export const POST = withAuth(handlePost, 'task:update');
