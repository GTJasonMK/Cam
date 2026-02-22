// ============================================================
// API: Task CRUD + 状态管理
// GET    /api/tasks         - 获取任务列表（支持 ?status=、?source= 筛选）
// POST   /api/tasks         - 创建任务
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, systemEvents, agentDefinitions, repositories, workers } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { sseManager } from '@/lib/sse/manager';
import { hasUsableSecretValue } from '@/lib/secrets/resolve';
import { collectWorkerEnvVarsForAgent, type WorkerCapabilitySnapshot } from '@/lib/workers/capabilities';
import { parseCreateTaskPayload } from '@/lib/validation/task-input';

import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';
import { AGENT_MESSAGES, API_COMMON_MESSAGES, REPO_MESSAGES, TASK_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';

function isPresent(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

async function handleGet(request: AuthenticatedRequest) {
  ensureSchedulerStarted();
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const source = searchParams.get('source');
    const sourceFilter = source === 'scheduler' || source === 'terminal'
      ? source
      : source === 'all' || source === null
        ? null
        : 'invalid';

    if (sourceFilter === 'invalid') {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'source 仅支持 scheduler、terminal、all' } },
        { status: 400 },
      );
    }

    const filters: Array<ReturnType<typeof eq>> = [];
    if (status) {
      filters.push(eq(tasks.status, status));
    }
    if (sourceFilter) {
      filters.push(eq(tasks.source, sourceFilter));
    }

    const result = filters.length === 0
      ? await db.select().from(tasks).orderBy(tasks.createdAt)
      : filters.length === 1
        ? await db.select().from(tasks).where(filters[0]).orderBy(tasks.createdAt)
        : await db.select().from(tasks).where(and(...filters)).orderBy(tasks.createdAt);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[API] 获取任务列表失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.queryFailed } },
      { status: 500 }
    );
  }
}

async function handlePost(request: AuthenticatedRequest) {
  ensureSchedulerStarted();
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = parseCreateTaskPayload(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: parsed.errorMessage } },
        { status: 400 }
      );
    }
    const payload = parsed.data;

    const repositoryId = payload.repositoryId;

    if (repositoryId) {
      const repo = await db
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.id, repositoryId))
        .limit(1);
      if (repo.length === 0) {
        return NextResponse.json(
          { success: false, error: { code: 'NOT_FOUND', message: REPO_MESSAGES.notFound(repositoryId) } },
          { status: 404 }
        );
      }
    }

    // Agent 必需环境变量前置校验：缺失时直接阻止入队，避免跑到一半才失败
    const agent = await db
      .select({
        id: agentDefinitions.id,
        displayName: agentDefinitions.displayName,
        requiredEnvVars: agentDefinitions.requiredEnvVars,
      })
      .from(agentDefinitions)
      .where(eq(agentDefinitions.id, payload.agentDefinitionId))
      .limit(1);

    if (agent.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: AGENT_MESSAGES.notFoundDefinition(payload.agentDefinitionId) } },
        { status: 404 }
      );
    }

    const requiredEnvVars =
      (agent[0].requiredEnvVars as Array<{ name: string; description?: string; required?: boolean }>) || [];

    const missingEnvVars: string[] = [];
    for (const ev of requiredEnvVars.filter((r) => Boolean(r.required))) {
      if (isPresent(ev.name)) continue;
      const ok = await hasUsableSecretValue(ev.name, {
        agentDefinitionId: payload.agentDefinitionId,
        repositoryId,
        repoUrl: payload.repoUrl,
      });
      if (!ok) missingEnvVars.push(ev.name);
    }

    // 如果服务端未配置，但某个在线 daemon Worker 已上报该变量存在，则允许创建任务
    let finalMissingEnvVars = missingEnvVars;
    if (missingEnvVars.length > 0) {
      const nowMs = Date.now();
      const staleTimeoutMs = Number(process.env.WORKER_STALE_TIMEOUT_MS || 30_000);
      const workerRows = await db
        .select({
          id: workers.id,
          status: workers.status,
          mode: workers.mode,
          lastHeartbeatAt: workers.lastHeartbeatAt,
          supportedAgentIds: workers.supportedAgentIds,
          reportedEnvVars: workers.reportedEnvVars,
        })
        .from(workers);

      const snapshots: WorkerCapabilitySnapshot[] = workerRows.map((w) => ({
        id: w.id,
        status: w.status,
        mode: w.mode,
        lastHeartbeatAt: w.lastHeartbeatAt,
        supportedAgentIds: (w.supportedAgentIds as string[]) || [],
        reportedEnvVars: (w.reportedEnvVars as string[]) || [],
      }));

      const availableOnWorkers = collectWorkerEnvVarsForAgent(snapshots, {
        agentDefinitionId: payload.agentDefinitionId,
        nowMs,
        staleTimeoutMs,
      });

      finalMissingEnvVars = missingEnvVars.filter((name) => !availableOnWorkers.has(name));
    }

    if (finalMissingEnvVars.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'MISSING_ENV_VARS',
            message: TASK_MESSAGES.missingAgentEnvVars(agent[0].displayName, finalMissingEnvVars),
            missingEnvVars: finalMissingEnvVars,
          },
        },
        { status: 400 }
      );
    }

    const taskId = uuidv4();
    // 自动生成工作分支名
    const workBranch = `cam/task-${taskId.slice(0, 8)}`;
    const dependsOn = payload.dependsOn;
    const initialStatus = dependsOn.length > 0 ? 'waiting' : 'queued';

    const result = await db
      .insert(tasks)
      .values({
        id: taskId,
        title: payload.title,
        description: payload.description,
        agentDefinitionId: payload.agentDefinitionId,
        repositoryId,
        repoUrl: payload.repoUrl,
        baseBranch: payload.baseBranch,
        workBranch,
        workDir: payload.workDir,
        status: initialStatus,
        maxRetries: payload.maxRetries,
        dependsOn,
        groupId: payload.groupId,
        queuedAt: new Date().toISOString(),
      })
      .returning();

    // 记录事件
    await db.insert(systemEvents).values({
      type: 'task.created',
      payload: { taskId, title: payload.title, agentDefinitionId: payload.agentDefinitionId },
    });

    // 有依赖的任务先进入 waiting，依赖满足后再进入 queued
    sseManager.broadcast(initialStatus === 'queued' ? 'task.queued' : 'task.waiting', { taskId, title: payload.title });
    sseManager.broadcast('task.progress', { taskId, status: initialStatus });

    return NextResponse.json({ success: true, data: result[0] }, { status: 201 });
  } catch (err) {
    console.error('[API] 创建任务失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.createFailed } },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handleGet, 'task:read');
export const POST = withAuth(handlePost, 'task:create');
