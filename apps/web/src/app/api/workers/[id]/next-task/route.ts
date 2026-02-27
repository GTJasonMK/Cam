// ============================================================
// API: Worker 获取下一个任务
// GET /api/workers/[id]/next-task  - Worker 拉取待执行任务
// ============================================================

import { db } from '@/lib/db';
import { tasks, agentDefinitions, workers } from '@/lib/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { resolveEnvVarValue } from '@/lib/secrets/resolve';
import { API_COMMON_MESSAGES, WORKER_MESSAGES } from '@/lib/i18n/messages';
import { writeSystemEvent } from '@/lib/audit/system-event';
import { broadcastTaskProgress, emitTaskStarted } from '@/lib/tasks/task-events';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { loadTaskDependencyState } from '@/lib/tasks/dependency-state';
import { demoteQueuedTaskToWaiting, markTaskDependencyBlocked } from '@/lib/tasks/dependency-transitions';
import { SCHEDULER_CLAIMABLE_TASK_STATUSES } from '@/lib/tasks/status';
import { apiInternalError, apiNotFound, apiSuccess } from '@/lib/http/api-response';
import { normalizeAgentDefinitionForExecution } from '@/lib/agents/normalize-agent-definition';

async function rollbackClaimedTaskToQueued(taskId: string, workerId: string): Promise<boolean> {
  const queuedAt = new Date().toISOString();
  const released = await db
    .update(tasks)
    .set({
      status: 'queued',
      assignedWorkerId: null,
      queuedAt,
      startedAt: null,
      completedAt: null,
    })
    .where(and(
      eq(tasks.id, taskId),
      eq(tasks.status, 'running'),
      eq(tasks.assignedWorkerId, workerId),
    ))
    .returning({ id: tasks.id });
  return released.length > 0;
}

async function handler(_request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    // 获取 Worker 支持的 Agent 类型
    const worker = await db.select().from(workers).where(eq(workers.id, id)).limit(1);
    if (worker.length === 0) {
      return apiNotFound(WORKER_MESSAGES.notFound(id));
    }

    // 仅 idle 状态允许拉取新任务（offline/draining/busy 都拒绝）
    if (worker[0].status !== 'idle') {
      return apiSuccess(null);
    }

    const supportedIds = (worker[0].supportedAgentIds as string[]) || [];

    // 仅拉取调度任务（scheduler），避免误领取 terminal 来源任务
    const statusCond = inArray(tasks.status, [...SCHEDULER_CLAIMABLE_TASK_STATUSES]);
    const sourceCond = eq(tasks.source, 'scheduler');
    const whereCond =
      supportedIds.length > 0
        ? and(sourceCond, statusCond, inArray(tasks.agentDefinitionId, supportedIds))
        : and(sourceCond, statusCond);

    const candidateTasks = await db
      .select()
      .from(tasks)
      .where(whereCond)
      // 优先消费 queued，避免 waiting（依赖未满足）占满窗口导致可执行任务饥饿
      .orderBy(
        sql`case when ${tasks.status} = 'queued' then 0 else 1 end`,
        tasks.queuedAt,
        tasks.createdAt,
      )
      .limit(20);

    for (const candidateTask of candidateTasks) {
      // 依赖检查：所有 dependsOn 都必须存在且 completed
      const deps = (candidateTask.dependsOn as string[]) || [];
      if (deps.length > 0) {
        const { depState, readiness } = await loadTaskDependencyState(deps);
        if (readiness === 'blocked') {
          await markTaskDependencyBlocked({
            taskId: candidateTask.id,
            dependsOn: deps,
            depState,
            allowedCurrentStatuses: [...SCHEDULER_CLAIMABLE_TASK_STATUSES],
            enforceSchedulerSource: true,
          });
          continue;
        }

        if (readiness === 'pending') {
          // queued 但依赖未完成：降级为 waiting，避免误导用户
          if (candidateTask.status === 'queued') {
            await demoteQueuedTaskToWaiting({
              taskId: candidateTask.id,
              dependsOn: deps,
              enforceSchedulerSource: true,
            });
          }
          continue;
        }
      }

      // 原子领取：避免多 Worker 竞争重复执行
      const claimed = await db
        .update(tasks)
        .set({
          status: 'running',
          assignedWorkerId: id,
          startedAt: new Date().toISOString(),
        })
        .where(and(
          eq(tasks.id, candidateTask.id),
          eq(tasks.source, 'scheduler'),
          inArray(tasks.status, [...SCHEDULER_CLAIMABLE_TASK_STATUSES]),
        ))
        .returning();

      if (claimed.length === 0) continue;

      try {
        // CAS 更新 Worker 状态：仅当仍为 idle 才能绑定任务，避免并发拉取导致一机多任务
        const workerBound = await db
          .update(workers)
          .set({ status: 'busy', currentTaskId: claimed[0].id })
          .where(and(eq(workers.id, id), eq(workers.status, 'idle')))
          .returning({ id: workers.id });
        if (workerBound.length === 0) {
          const released = await rollbackClaimedTaskToQueued(claimed[0].id, id);
          if (released) {
            await writeSystemEvent({
              type: 'task.claim_released_worker_busy',
              payload: { taskId: claimed[0].id, workerId: id },
            });
            broadcastTaskProgress(claimed[0].id, 'queued');
          }
          continue;
        }

        // 获取 Agent 定义
        const agentDef = await db
          .select()
          .from(agentDefinitions)
          .where(eq(agentDefinitions.id, claimed[0].agentDefinitionId))
          .limit(1);

        if (agentDef.length === 0) {
          // 避免任务卡死在 running：Agent 不存在直接失败收敛，并让 worker 回到 idle
          const failedRows = await db
            .update(tasks)
            .set({ status: 'failed', assignedWorkerId: null, completedAt: new Date().toISOString() })
            .where(and(
              eq(tasks.id, claimed[0].id),
              eq(tasks.status, 'running'),
              eq(tasks.assignedWorkerId, id),
            ))
            .returning({ id: tasks.id });
          await db
            .update(workers)
            .set({ status: 'idle', currentTaskId: null })
            .where(and(eq(workers.id, id), eq(workers.currentTaskId, claimed[0].id)));
          if (failedRows.length > 0) {
            await writeSystemEvent({
              type: 'task.failed',
              payload: { taskId: claimed[0].id, reason: 'agent_definition_not_found', agentDefinitionId: claimed[0].agentDefinitionId },
            });
            broadcastTaskProgress(claimed[0].id, 'failed');
          }
          continue;
        }

        const normalizedAgentDefinition = normalizeAgentDefinitionForExecution(agentDef[0]);

        // 下发给外部常驻 Worker 的 env（用于无 Docker 调度场景）
        const scope = {
          repositoryId: (claimed[0] as typeof claimed[0] & { repositoryId?: string | null }).repositoryId || null,
          repoUrl: claimed[0].repoUrl,
          agentDefinitionId: claimed[0].agentDefinitionId,
        };

        const env: Record<string, string> = {};
        const githubToken =
          (await resolveEnvVarValue('GITHUB_TOKEN', scope)) ||
          process.env.GITHUB_PAT ||
          process.env.GITHUB_API_TOKEN ||
          process.env.GIT_HTTP_TOKEN ||
          process.env.CAM_GIT_HTTP_TOKEN ||
          '';
        if (githubToken) {
          env.GITHUB_TOKEN = githubToken;
        }

        const requiredEnvVars = (agentDef[0].requiredEnvVars as Array<{ name: string }>) || [];
        for (const spec of requiredEnvVars) {
          if (env[spec.name]) continue;
          const val = await resolveEnvVarValue(spec.name, scope);
          if (val) env[spec.name] = val;
        }

        // 广播事件 + 记录系统事件（日志页可见）
        await emitTaskStarted({
          taskId: claimed[0].id,
          workerId: id,
          agentDefinitionId: claimed[0].agentDefinitionId,
        });

        return apiSuccess({
          task: claimed[0],
          agentDefinition: normalizedAgentDefinition,
          env,
        });
      } catch (dispatchErr) {
        // 领取后准备阶段失败：回滚为 queued，避免任务和 worker 卡死
        const rolledBack = await rollbackClaimedTaskToQueued(claimed[0].id, id);
        await db
          .update(workers)
          .set({ status: 'idle', currentTaskId: null })
          .where(and(eq(workers.id, id), eq(workers.currentTaskId, claimed[0].id)));
        await writeSystemEvent({
          type: 'task.dispatch_prepare_failed',
          payload: {
            taskId: claimed[0].id,
            workerId: id,
            reason: (dispatchErr as Error).message,
          },
        });
        if (rolledBack) {
          broadcastTaskProgress(claimed[0].id, 'queued');
        }
        console.warn(`[API] Worker ${id} 任务准备失败，已回滚: task=${claimed[0].id}, error=${(dispatchErr as Error).message}`);
        continue;
      }
    }

    return apiSuccess(null);
  } catch (err) {
    console.error(`[API] Worker ${id} 获取任务失败:`, err);
    return apiInternalError(API_COMMON_MESSAGES.fetchTaskFailed);
  }
}

export const GET = withAuth(handler, 'worker:manage');
