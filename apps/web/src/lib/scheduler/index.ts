// ============================================================
// 调度器核心逻辑
// 从任务队列取出待执行任务，分配给 Worker 容器执行
// ============================================================

import { db } from '@/lib/db';
import { agentDefinitions, tasks } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { resolveEnvVarValue } from '@/lib/secrets/resolve';
import { getWorkerStaleTimeoutMs } from '@/lib/workers/stale-timeout';
import { checkWorkerHeartbeatsForScheduler } from './heartbeat-recovery';
import { handleQueuedTaskDependencyGate, handleWaitingTaskDependencyGate } from './dependency-gate';
import { updateSchedulerTaskStatus } from './task-status';
import { isDockerSchedulerAvailable, startWorkerContainerForTask } from './worker-launch';
import {
  recoverDanglingRunningTasksOnStartup as recoverDanglingRunningTasksOnStartupInternal,
  type RecoveryResult,
} from './startup-recovery';

const WORKER_STALE_TIMEOUT_MS = getWorkerStaleTimeoutMs();

// 避免缺少必需环境变量时刷屏：同一任务 60 秒最多提示一次
const UNSCHEDULABLE_LOG_COOLDOWN_MS = 60_000;
const unschedulableLogAt = new Map<string, number>();

function shouldLogUnschedulable(taskId: string, nowMs: number): boolean {
  const last = unschedulableLogAt.get(taskId) || 0;
  if (nowMs - last < UNSCHEDULABLE_LOG_COOLDOWN_MS) return false;
  unschedulableLogAt.set(taskId, nowMs);
  return true;
}

/**
 * 启动恢复：处理服务重启后遗留的 running 任务
 * 判定规则：
 * - Worker 心跳新鲜且 currentTaskId 一致 -> 保持 running
 * - 其余情况 -> 按重试策略回收为 queued 或 failed
 */
export async function recoverDanglingRunningTasksOnStartup(): Promise<RecoveryResult> {
  return recoverDanglingRunningTasksOnStartupInternal({
    staleTimeoutMs: WORKER_STALE_TIMEOUT_MS,
  });
}

/** 调度器主循环：查找可执行的任务并启动 Worker 容器 */
export async function runSchedulerTick(): Promise<void> {
  try {
    // 开发模式下可能没有 Docker：不做容器调度，避免把任务错误标记为 failed
    const dockerAvailable = isDockerSchedulerAvailable();

    // 0) 处理 waiting -> queued：当依赖都完成后，进入 queued 才能被调度/Worker 领取
    const waitingTasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.status, 'waiting'), eq(tasks.source, 'scheduler')))
      .orderBy(tasks.createdAt)
      .limit(50);

    for (const task of waitingTasks) {
      const deps = (task.dependsOn as string[]) || [];
      const gateResult = await handleWaitingTaskDependencyGate({
        taskId: task.id,
        dependsOn: deps,
      });
      if (gateResult !== 'promoted') continue;
    }

    // 1. 查找所有 queued 状态的任务（无依赖或依赖已完成）
    const queuedTasks = await db.select().from(tasks).where(and(eq(tasks.status, 'queued'), eq(tasks.source, 'scheduler'))).orderBy(tasks.queuedAt).limit(20);

    for (const task of queuedTasks) {
      // 检查依赖是否都已完成
      const deps = (task.dependsOn as string[]) || [];
      const gateResult = await handleQueuedTaskDependencyGate({
        taskId: task.id,
        dependsOn: deps,
      });
      if (gateResult !== 'ready') continue;

      // Docker 不可用：不启动容器调度，但仍保留 waiting/queued 状态管理
      if (!dockerAvailable) continue;

      // 2. 查找对应的 AgentDefinition
      const agentDef = await db
        .select()
        .from(agentDefinitions)
        .where(eq(agentDefinitions.id, task.agentDefinitionId))
        .limit(1);

      if (agentDef.length === 0) {
        console.error(`[Scheduler] Agent 定义不存在: ${task.agentDefinitionId}`);
        await updateSchedulerTaskStatus(task.id, 'failed', {
          summary: `Agent definition not found: ${task.agentDefinitionId}`,
        });
        continue;
      }

      // 2b. 缺少 Agent 必需环境变量：跳过容器调度（留给外部常驻 Worker 使用本机环境执行）
      const requiredEnvVars =
        (agentDef[0].requiredEnvVars as Array<{ name: string; required?: boolean }>) || [];
      const requiredNames = requiredEnvVars.filter((ev) => Boolean(ev.required)).map((ev) => (ev.name || '').trim()).filter(Boolean);
      if (requiredNames.length > 0) {
        const scope = {
          repositoryId: (task as typeof task & { repositoryId?: string | null }).repositoryId || null,
          repoUrl: task.repoUrl,
          agentDefinitionId: agentDef[0].id,
        };

        const missing: string[] = [];
        for (const name of requiredNames) {
          const val = await resolveEnvVarValue(name, scope);
          if (!val) missing.push(name);
        }

        if (missing.length > 0) {
          const nowMs = Date.now();
          if (shouldLogUnschedulable(task.id, nowMs)) {
            console.warn(
              `[Scheduler] 跳过容器调度: task=${task.id.slice(0, 8)} 缺少必需环境变量 ${missing.join(', ')}`
            );
          }
          continue;
        }
      }

      // 3. 领取任务（原子更新，避免重复调度）
      const workerId = `worker-${task.id.slice(0, 8)}`;
      const claimed = await db
        .update(tasks)
        .set({
          status: 'running',
          assignedWorkerId: workerId,
          startedAt: new Date().toISOString(),
        })
        .where(and(eq(tasks.id, task.id), eq(tasks.status, 'queued')))
        .returning();

      // 若未领取成功，说明已被其他调度器/Worker 抢走
      if (claimed.length === 0) continue;

      // 4. 启动 Worker 容器执行任务
      try {
        await startWorkerContainerForTask(claimed[0], agentDef[0], workerId);
      } catch (err) {
        console.error(`[Scheduler] 启动容器失败: ${(err as Error).message}`);
        await updateSchedulerTaskStatus(task.id, 'failed', {
          summary: `Failed to start container: ${(err as Error).message}`,
          assignedWorkerId: null,
        });
      }
    }

    // 5. 检查心跳超时的 Worker（30 秒未心跳）
    await checkWorkerHeartbeatsForScheduler({
      staleTimeoutMs: WORKER_STALE_TIMEOUT_MS,
    });
  } catch (err) {
    console.error(`[Scheduler] 调度循环异常: ${(err as Error).message}`);
  }
}
