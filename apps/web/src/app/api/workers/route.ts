// ============================================================
// API: Worker 管理
// GET   /api/workers             - 获取所有 Worker
// POST  /api/workers/register    - Worker 注册
// DELETE /api/workers?status=offline - 清理离线 Worker 记录
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workers, systemEvents } from '@/lib/db/schema';
import { sseManager } from '@/lib/sse/manager';
import { eq, inArray } from 'drizzle-orm';
import { API_COMMON_MESSAGES, WORKER_MESSAGES } from '@/lib/i18n/messages';

export async function GET() {
  try {
    const result = await db.select().from(workers).orderBy(workers.createdAt);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[API] 获取 Worker 列表失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.queryFailed } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.id || !body.name) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: WORKER_MESSAGES.missingRequiredFields } },
        { status: 400 }
      );
    }

    const result = await db
      .insert(workers)
      .values({
        id: body.id,
        name: body.name,
        supportedAgentIds: body.supportedAgentIds || [],
        maxConcurrent: body.maxConcurrent || 1,
        status: 'idle',
        lastHeartbeatAt: new Date().toISOString(),
        uptimeSince: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: workers.id,
        set: {
          name: body.name,
          lastHeartbeatAt: new Date().toISOString(),
          supportedAgentIds: body.supportedAgentIds || [],
        },
      })
      .returning();

    await db.insert(systemEvents).values({
      type: 'worker.online',
      payload: { workerId: body.id, name: body.name },
    });
    sseManager.broadcast('worker.online', { workerId: body.id, name: body.name });

    return NextResponse.json({ success: true, data: result[0] }, { status: 201 });
  } catch (err) {
    console.error('[API] Worker 注册失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.registerFailed } },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get('status');
    if (status !== 'offline') {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: WORKER_MESSAGES.unsupportedCleanupStatus } },
        { status: 400 }
      );
    }

    const offlineWorkers = await db
      .select({ id: workers.id, name: workers.name })
      .from(workers)
      .where(eq(workers.status, 'offline'));

    if (offlineWorkers.length === 0) {
      return NextResponse.json({
        success: true,
        data: { removed: 0, workerIds: [] },
      });
    }

    const workerIds = offlineWorkers.map((item) => item.id);
    for (let i = 0; i < workerIds.length; i += 200) {
      const chunk = workerIds.slice(i, i + 200);
      await db.delete(workers).where(inArray(workers.id, chunk));
    }

    await db.insert(systemEvents).values({
      type: 'worker.pruned',
      payload: {
        scope: 'offline',
        removed: workerIds.length,
        workerIds,
      },
    });

    for (const worker of offlineWorkers) {
      sseManager.broadcast('worker.removed', {
        workerId: worker.id,
        name: worker.name,
        status: 'offline',
      });
    }
    sseManager.broadcast('worker.pruned', { scope: 'offline', removed: workerIds.length, workerIds });

    return NextResponse.json({
      success: true,
      data: { removed: workerIds.length, workerIds },
    });
  } catch (err) {
    console.error('[API] 清理离线 Worker 失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.cleanupFailed } },
      { status: 500 }
    );
  }
}
