// ============================================================
// API: Worker 心跳
// POST /api/workers/[id]/heartbeat  - Worker 心跳上报
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import { API_COMMON_MESSAGES, WORKER_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { parseWorkerStatus } from '@/lib/workers/status';

type ClaudeAuthStatus = { loggedIn: boolean; authMethod: string; apiProvider: string };

function parseWorkerMode(value: unknown): 'daemon' | 'task' | 'unknown' | null {
  if (value === undefined) return null;
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'daemon') return 'daemon';
  if (raw === 'task') return 'task';
  return 'unknown';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseReportedEnvVars(value: unknown): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return [];

  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (!name) continue;
    if (!/^[A-Z0-9_]{2,100}$/.test(name)) continue;
    out.push(name);
    if (out.length >= 200) break;
  }
  return Array.from(new Set(out)).sort();
}

function parseClaudeAuthStatus(value: unknown): ClaudeAuthStatus | null | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return null;

  const loggedIn = value.loggedIn;
  if (typeof loggedIn !== 'boolean') return null;

  const authMethod = typeof value.authMethod === 'string' ? value.authMethod.trim() : '';
  const apiProvider = typeof value.apiProvider === 'string' ? value.apiProvider.trim() : '';

  return {
    loggedIn,
    authMethod: authMethod.slice(0, 50),
    apiProvider: apiProvider.slice(0, 50),
  };
}

async function handler(request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const bodyRaw = await request.json().catch(() => null);
    if (!isPlainObject(bodyRaw)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: '请求体必须是 JSON object' } },
        { status: 400 }
      );
    }
    const body = bodyRaw;
    const existing = await db.select({ status: workers.status }).from(workers).where(eq(workers.id, id)).limit(1);

    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: WORKER_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    const reportedStatus = body.status === undefined ? 'busy' : parseWorkerStatus(body.status);
    if (reportedStatus === null) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'status 仅支持 idle/busy/offline/draining' } },
        { status: 400 }
      );
    }
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

    const mode = parseWorkerMode(body.mode);
    if (mode !== null) {
      updateData.mode = mode;
    }

    const reportedEnvVars = parseReportedEnvVars(body.reportedEnvVars);
    if (reportedEnvVars !== null) {
      updateData.reportedEnvVars = reportedEnvVars;
    }

    const claudeAuthStatus = parseClaudeAuthStatus(body.claudeAuthStatus);
    if (claudeAuthStatus !== undefined) {
      updateData.reportedClaudeAuth = claudeAuthStatus;
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

export const POST = withAuth(handler, 'worker:manage');
