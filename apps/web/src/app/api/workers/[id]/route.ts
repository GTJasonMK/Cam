// ============================================================
// API: 单个 Worker 管理
// GET   /api/workers/[id]   - 获取 Worker 详情
// PATCH /api/workers/[id]   - Worker 操作（drain/offline/activate）
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workers, systemEvents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import { API_COMMON_MESSAGES, WORKER_MESSAGES } from '@/lib/i18n/messages';
import { resolveAuditActor } from '@/lib/audit/actor';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';

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
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: WORKER_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(`[API] 获取 Worker ${id} 失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.queryFailed } },
      { status: 500 }
    );
  }
}

async function handlePatch(request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const actor = resolveAuditActor(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = parseAction(body.action);
    if (!action) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: WORKER_MESSAGES.invalidAction } },
        { status: 400 }
      );
    }

    const existing = await db.select().from(workers).where(eq(workers.id, id)).limit(1);
    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: WORKER_MESSAGES.notFound(id) } },
        { status: 404 }
      );
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

    await db.insert(systemEvents).values({
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

    return NextResponse.json({ success: true, data: result[0] });
  } catch (err) {
    console.error(`[API] 更新 Worker ${id} 失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.updateFailed } },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handleGet, 'worker:read');
export const PATCH = withAuth(handlePatch, 'worker:manage');
