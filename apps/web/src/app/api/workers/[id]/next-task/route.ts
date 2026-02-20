// ============================================================
// API: Worker 获取下一个任务
// GET /api/workers/[id]/next-task  - Worker 拉取待执行任务
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, agentDefinitions, workers, systemEvents } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import { resolveEnvVarValue } from '@/lib/secrets/resolve';
import { areDependenciesSatisfied } from '@/lib/scheduler/logic';
import { API_COMMON_MESSAGES, WORKER_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';

async function handler(_request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    // 获取 Worker 支持的 Agent 类型
    const worker = await db.select().from(workers).where(eq(workers.id, id)).limit(1);
    if (worker.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: WORKER_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    // 仅 idle 状态允许拉取新任务（offline/draining/busy 都拒绝）
    if (worker[0].status !== 'idle') {
      return NextResponse.json({ success: true, data: null });
    }

    const supportedIds = (worker[0].supportedAgentIds as string[]) || [];

    // 查找 queued / waiting 状态任务（waiting 表示依赖未满足）
    const statusCond = inArray(tasks.status, ['queued', 'waiting']);
    const whereCond =
      supportedIds.length > 0
        ? and(statusCond, inArray(tasks.agentDefinitionId, supportedIds))
        : statusCond;

    const candidateTasks = await db
      .select()
      .from(tasks)
      .where(whereCond)
      .orderBy(tasks.queuedAt)
      .limit(20);

    for (const candidateTask of candidateTasks) {
      // 依赖检查：所有 dependsOn 都必须存在且 completed
      const deps = (candidateTask.dependsOn as string[]) || [];
      if (deps.length > 0) {
        const depTasks = await db
          .select({ id: tasks.id, status: tasks.status })
          .from(tasks)
          .where(inArray(tasks.id, deps));

        const allCompleted = areDependenciesSatisfied(deps, depTasks);
        if (!allCompleted) {
          // queued 但依赖未完成：降级为 waiting，避免误导用户
          if (candidateTask.status === 'queued') {
            const demoted = await db
              .update(tasks)
              .set({ status: 'waiting' })
              .where(and(eq(tasks.id, candidateTask.id), eq(tasks.status, 'queued')))
              .returning();

            if (demoted.length > 0) {
              sseManager.broadcast('task.progress', { taskId: candidateTask.id, status: 'waiting' });
              await db.insert(systemEvents).values({
                type: 'task.waiting',
                payload: { taskId: candidateTask.id, dependsOn: deps },
              });
            }
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
        .where(and(eq(tasks.id, candidateTask.id), inArray(tasks.status, ['queued', 'waiting'])))
        .returning();

      if (claimed.length === 0) continue;

      // 更新 Worker 状态
      await db
        .update(workers)
        .set({ status: 'busy', currentTaskId: claimed[0].id })
        .where(eq(workers.id, id));

      // 获取 Agent 定义
      const agentDef = await db
        .select()
        .from(agentDefinitions)
        .where(eq(agentDefinitions.id, claimed[0].agentDefinitionId))
        .limit(1);

      if (agentDef.length === 0) {
        // 避免任务卡死在 running：Agent 不存在直接失败收敛，并让 worker 回到 idle
        await db
          .update(tasks)
          .set({ status: 'failed', completedAt: new Date().toISOString() })
          .where(eq(tasks.id, claimed[0].id));
        await db
          .update(workers)
          .set({ status: 'idle', currentTaskId: null })
          .where(eq(workers.id, id));
        await db.insert(systemEvents).values({
          type: 'task.failed',
          payload: { taskId: claimed[0].id, reason: 'agent_definition_not_found', agentDefinitionId: claimed[0].agentDefinitionId },
        });
        sseManager.broadcast('task.progress', { taskId: claimed[0].id, status: 'failed' });
        continue;
      }

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
      sseManager.broadcast('task.started', {
        taskId: claimed[0].id,
        workerId: id,
        agentDefinitionId: claimed[0].agentDefinitionId,
      });
      await db.insert(systemEvents).values({
        type: 'task.started',
        payload: { taskId: claimed[0].id, workerId: id, agentDefinitionId: claimed[0].agentDefinitionId },
      });

      return NextResponse.json({
        success: true,
        data: {
          task: claimed[0],
          agentDefinition: agentDef[0] || null,
          env,
        },
      });
    }

    return NextResponse.json({ success: true, data: null });
  } catch (err) {
    console.error(`[API] Worker ${id} 获取任务失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.fetchTaskFailed } },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler, 'worker:manage');
