// ============================================================
// API: Worker 心跳
// POST /api/workers/[id]/heartbeat  - Worker 心跳上报
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import { API_COMMON_MESSAGES, WORKER_MESSAGES } from '@/lib/i18n/messages';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const existing = await db.select({ status: workers.status }).from(workers).where(eq(workers.id, id)).limit(1);

    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: WORKER_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    const reportedStatus =
      typeof body.status === 'string' && body.status.trim().length > 0
        ? body.status.trim()
        : 'busy';
    const shouldKeepDraining =
      existing[0].status === 'draining' &&
      (reportedStatus === 'idle' || reportedStatus === 'busy');
    const nextStatus = shouldKeepDraining ? 'draining' : reportedStatus;

    const updateData: Record<string, unknown> = {
      status: nextStatus,
      currentTaskId: body.currentTaskId ?? null,
      cpuUsage: body.cpuUsage ?? null,
      memoryUsageMb: body.memoryUsageMb ?? null,
      diskUsageMb: body.diskUsageMb ?? null,
      lastHeartbeatAt: new Date().toISOString(),
    };
    // 仅在上报时更新，避免空心跳覆盖已有日志
    if (body.logTail !== undefined) {
      updateData.logTail = body.logTail ?? null;
    }

    await db
      .update(workers)
      .set(updateData)
      .where(eq(workers.id, id));

    // 广播心跳事件给前端
    sseManager.broadcast('worker.heartbeat', {
      workerId: id,
      status: nextStatus,
      cpuUsage: body.cpuUsage,
      memoryUsageMb: body.memoryUsageMb,
      currentTaskId: body.currentTaskId,
      logTail: body.logTail,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`[API] Worker ${id} 心跳失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.heartbeatUpdateFailed } },
      { status: 500 }
    );
  }
}
