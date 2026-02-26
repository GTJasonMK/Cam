// ============================================================
// API: Task CRUD + 状态管理
// GET    /api/tasks         - 获取任务列表（支持 ?status=、?source= 筛选）
// POST   /api/tasks         - 创建任务
// ============================================================

import { db } from '@/lib/db';
import { tasks, repositories } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { sseManager } from '@/lib/sse/manager';
import { writeSystemEvent } from '@/lib/audit/system-event';
import { loadAgentRequirements, validateAgentRequiredEnvVars } from '@/lib/tasks/agent-env-validation';
import { parseCreateTaskPayload } from '@/lib/validation/task-input';

import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';
import { AGENT_MESSAGES, API_COMMON_MESSAGES, REPO_MESSAGES, TASK_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { apiBadRequest, apiCreated, apiError, apiInternalError, apiNotFound, apiSuccess } from '@/lib/http/api-response';

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
      return apiBadRequest('source 仅支持 scheduler、terminal、all');
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
    return apiSuccess(result);
  } catch (err) {
    console.error('[API] 获取任务列表失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.queryFailed);
  }
}

async function handlePost(request: AuthenticatedRequest) {
  ensureSchedulerStarted();
  try {
    const body = await readJsonBodyAsRecord(request);
    const parsed = parseCreateTaskPayload(body);
    if (!parsed.success) {
      return apiBadRequest(parsed.errorMessage);
    }
    const payload = parsed.data;

    const repositoryId = payload.repositoryId;
    const dependsOn = payload.dependsOn;

    if (repositoryId) {
      const repo = await db
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.id, repositoryId))
        .limit(1);
      if (repo.length === 0) {
        return apiNotFound(REPO_MESSAGES.notFound(repositoryId));
      }
    }

    // 依赖校验：必须都存在，且只能依赖调度任务（避免依赖 terminal 任务导致永久 waiting）
    if (dependsOn.length > 0) {
      const dependencyRows = await db
        .select({
          id: tasks.id,
          source: tasks.source,
        })
        .from(tasks)
        .where(inArray(tasks.id, dependsOn));

      if (dependencyRows.length !== dependsOn.length) {
        const existingIds = new Set(dependencyRows.map((item) => item.id));
        const missingIds = dependsOn.filter((item) => !existingIds.has(item));
        return apiError('INVALID_DEPENDENCIES', `dependsOn 包含不存在的任务: ${missingIds.join(', ')}`, { status: 400 });
      }

      const nonSchedulerDeps = dependencyRows.filter((item) => item.source !== 'scheduler').map((item) => item.id);
      if (nonSchedulerDeps.length > 0) {
        return apiError(
          'INVALID_DEPENDENCIES',
          `dependsOn 仅支持调度任务，以下依赖来源非法: ${nonSchedulerDeps.join(', ')}`,
          { status: 400 },
        );
      }
    }

    // Agent 存在性 + 必需环境变量前置校验：缺失时直接阻止入队，避免跑到一半才失败
    const { orderedAgentRequirements, missingAgentIds } = await loadAgentRequirements([payload.agentDefinitionId]);
    if (missingAgentIds.length > 0 || orderedAgentRequirements.length === 0) {
      return apiNotFound(AGENT_MESSAGES.notFoundDefinition(payload.agentDefinitionId));
    }
    const agentRequirement = orderedAgentRequirements[0];
    const envValidation = await validateAgentRequiredEnvVars({
      agentRequirements: [agentRequirement],
      repositoryId,
      repoUrl: payload.repoUrl,
    });
    if (envValidation.missingEnvVars.length > 0) {
      return apiError(
        'MISSING_ENV_VARS',
        TASK_MESSAGES.missingAgentEnvVars(
          envValidation.firstMissingAgentDisplayName || agentRequirement.displayName,
          envValidation.missingEnvVars,
        ),
        {
          status: 400,
          extra: { missingEnvVars: envValidation.missingEnvVars },
        },
      );
    }

    const taskId = uuidv4();
    // 自动生成工作分支名
    const workBranch = `cam/task-${taskId.slice(0, 8)}`;
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
    await writeSystemEvent({
      type: 'task.created',
      payload: { taskId, title: payload.title, agentDefinitionId: payload.agentDefinitionId },
    });

    // 有依赖的任务先进入 waiting，依赖满足后再进入 queued
    sseManager.broadcast(initialStatus === 'queued' ? 'task.queued' : 'task.waiting', { taskId, title: payload.title });
    sseManager.broadcast('task.progress', { taskId, status: initialStatus });

    return apiCreated(result[0]);
  } catch (err) {
    console.error('[API] 创建任务失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.createFailed);
  }
}

export const GET = withAuth(handleGet, 'task:read');
export const POST = withAuth(handlePost, 'task:create');
