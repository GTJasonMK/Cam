// ============================================================
// API: Task 取消/停止
// POST /api/tasks/[id]/cancel  - 取消 queued 任务或停止 running 任务
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, systemEvents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import Dockerode from 'dockerode';
import fs from 'fs';
import { API_COMMON_MESSAGES, TASK_MESSAGES } from '@/lib/i18n/messages';
import { resolveAuditActor } from '@/lib/audit/actor';

const dockerSocketPath = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';
const docker = new Dockerode({ socketPath: dockerSocketPath });

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
      // 已停止/不存在都忽略
    }
  }

  return stopped;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const actor = resolveAuditActor(request);
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const reason = typeof body.reason === 'string' ? body.reason : null;

    const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: TASK_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    // 终态任务：直接返回成功（幂等）
    if (['cancelled', 'completed', 'failed'].includes(existing[0].status)) {
      return NextResponse.json({ success: true, data: existing[0] });
    }

    const previousStatus = existing[0].status;

    const result = await db
      .update(tasks)
      .set({
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      })
      .where(eq(tasks.id, id))
      .returning();

    // 记录系统事件 + SSE
    await db.insert(systemEvents).values({
      type: 'task.cancelled',
      actor,
      payload: { taskId: id, previousStatus, reason },
    });
    sseManager.broadcast('task.progress', { taskId: id, status: 'cancelled' });
    sseManager.broadcast('task.cancelled', { taskId: id });

    // best-effort：尝试停止与该任务相关的容器（容器模式下会立刻中止执行）
    try {
      const stopped = await stopTaskContainers(id);
      if (stopped > 0) {
        await db.insert(systemEvents).values({
          type: 'task.stop_requested',
          actor,
          payload: { taskId: id, stoppedContainers: stopped },
        });
      }
    } catch (err) {
      await db.insert(systemEvents).values({
        type: 'task.stop_failed',
        actor,
        payload: { taskId: id, error: (err as Error).message },
      });
    }

    return NextResponse.json({ success: true, data: result[0] });
  } catch (err) {
    console.error(`[API] 取消任务 ${id} 失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.cancelFailed } },
      { status: 500 }
    );
  }
}
