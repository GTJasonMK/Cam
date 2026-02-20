// ============================================================
// API: Worker 管理
// GET   /api/workers             - 获取所有 Worker
// POST  /api/workers/register    - Worker 注册
// DELETE /api/workers?status=offline - 清理离线 Worker 记录
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workers, systemEvents } from '@/lib/db/schema';
import { sseManager } from '@/lib/sse/manager';
import { eq, inArray } from 'drizzle-orm';
import { API_COMMON_MESSAGES, WORKER_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';

type ClaudeAuthStatus = { loggedIn: boolean; authMethod: string; apiProvider: string };

function parseWorkerMode(value: unknown): 'daemon' | 'task' | 'unknown' {
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
    // 仅允许常见 env var 命名，避免注入奇怪字符导致 UI/日志混乱
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

async function handleGet() {
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

async function handlePost(request: AuthenticatedRequest) {
  try {
    const body = await request.json();

    if (!body.id || !body.name) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: WORKER_MESSAGES.missingRequiredFields } },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const mode = parseWorkerMode(body.mode);
    const reportedEnvVars = parseReportedEnvVars(body.reportedEnvVars);
    const claudeAuthStatus = parseClaudeAuthStatus(body.claudeAuthStatus);

    const insertValues: typeof workers.$inferInsert = {
      id: body.id,
      name: body.name,
      supportedAgentIds: body.supportedAgentIds || [],
      maxConcurrent: body.maxConcurrent || 1,
      mode,
      // 旧 Worker 可能不携带该字段：插入时用默认值，更新时仅在上报时覆盖
      reportedEnvVars: reportedEnvVars ?? [],
      reportedClaudeAuth: claudeAuthStatus ?? null,
      status: 'idle',
      lastHeartbeatAt: now,
      uptimeSince: now,
    };

    const onConflictSet: Partial<typeof workers.$inferInsert> = {
      name: body.name,
      lastHeartbeatAt: now,
      supportedAgentIds: body.supportedAgentIds || [],
    };
    if (body.mode !== undefined) onConflictSet.mode = mode;
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

async function handleDelete(request: AuthenticatedRequest) {
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

export const GET = withAuth(handleGet, 'worker:read');
export const POST = withAuth(handlePost, 'worker:manage');
export const DELETE = withAuth(handleDelete, 'worker:prune');
