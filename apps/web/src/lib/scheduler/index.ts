// ============================================================
// 调度器核心逻辑
// 从任务队列取出待执行任务，分配给 Worker 容器执行
// ============================================================

import { db } from '@/lib/db';
import { agentDefinitions, tasks, workers, systemEvents } from '@/lib/db/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import Dockerode from 'dockerode';
import fs from 'fs';
import { resolveEnvVarValue } from '@/lib/secrets/resolve';
import {
  areDependenciesSatisfied,
  decideRecoveryAction,
  decideStaleTaskAction,
  isWorkerAliveForTask,
} from './logic';

const dockerSocketPath = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';
const docker = new Dockerode({ socketPath: dockerSocketPath });
const WORKER_STALE_TIMEOUT_MS = Number(process.env.WORKER_STALE_TIMEOUT_MS || 30_000);

// 避免缺少必需环境变量时刷屏：同一任务 60 秒最多提示一次
const UNSCHEDULABLE_LOG_COOLDOWN_MS = 60_000;
const unschedulableLogAt = new Map<string, number>();

function shouldLogUnschedulable(taskId: string, nowMs: number): boolean {
  const last = unschedulableLogAt.get(taskId) || 0;
  if (nowMs - last < UNSCHEDULABLE_LOG_COOLDOWN_MS) return false;
  unschedulableLogAt.set(taskId, nowMs);
  return true;
}

type RecoveryResult = {
  scanned: number;
  recoveredToQueued: number;
  markedFailed: number;
};

/**
 * 启动恢复：处理服务重启后遗留的 running 任务
 * 判定规则：
 * - Worker 心跳新鲜且 currentTaskId 一致 -> 保持 running
 * - 其余情况 -> 按重试策略回收为 queued 或 failed
 */
export async function recoverDanglingRunningTasksOnStartup(): Promise<RecoveryResult> {
  const runningTasks = await db
    .select({
      id: tasks.id,
      retryCount: tasks.retryCount,
      maxRetries: tasks.maxRetries,
      assignedWorkerId: tasks.assignedWorkerId,
    })
    .from(tasks)
    .where(and(eq(tasks.status, 'running'), eq(tasks.source, 'scheduler')))
    .limit(2000);

  if (runningTasks.length === 0) {
    return { scanned: 0, recoveredToQueued: 0, markedFailed: 0 };
  }

  const workerIds = Array.from(new Set(runningTasks.map((t) => t.assignedWorkerId).filter(Boolean) as string[]));
  const workerRows =
    workerIds.length > 0
      ? await db
          .select({
            id: workers.id,
            status: workers.status,
            currentTaskId: workers.currentTaskId,
            lastHeartbeatAt: workers.lastHeartbeatAt,
          })
          .from(workers)
          .where(inArray(workers.id, workerIds))
      : [];

  const workerMap = new Map(workerRows.map((w) => [w.id, w]));
  const staleBefore = Date.now() - WORKER_STALE_TIMEOUT_MS;

  let recoveredToQueued = 0;
  let markedFailed = 0;
  const now = new Date().toISOString();

  for (const task of runningTasks) {
    const worker = task.assignedWorkerId ? workerMap.get(task.assignedWorkerId) : null;
    const workerAlive = isWorkerAliveForTask({
      worker,
      taskId: task.id,
      staleBeforeMs: staleBefore,
    });
    const action = decideRecoveryAction({
      workerAlive,
      retryCount: task.retryCount,
      maxRetries: task.maxRetries,
    });

    if (action === 'keep_running') {
      continue;
    }

    if (action === 'retry') {
      await db
        .update(tasks)
        .set({
          status: 'queued',
          retryCount: task.retryCount + 1,
          assignedWorkerId: null,
          queuedAt: now,
          startedAt: null,
          completedAt: null,
        })
        .where(eq(tasks.id, task.id));
      recoveredToQueued += 1;

      await db.insert(systemEvents).values({
        type: 'task.recovered_after_restart',
        payload: {
          taskId: task.id,
          previousStatus: 'running',
          retryCount: task.retryCount + 1,
          maxRetries: task.maxRetries,
          reason: 'worker_stale_or_missing_after_restart',
        },
      });
      sseManager.broadcast('task.progress', { taskId: task.id, status: 'queued' });
      continue;
    }

    await db
      .update(tasks)
      .set({
        status: 'failed',
        assignedWorkerId: null,
        completedAt: now,
      })
      .where(eq(tasks.id, task.id));
    markedFailed += 1;

    await db.insert(systemEvents).values({
      type: 'task.recovery_failed_after_restart',
      payload: {
        taskId: task.id,
        previousStatus: 'running',
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
        reason: 'max_retries_reached_during_restart_recovery',
      },
    });
    sseManager.broadcast('task.progress', { taskId: task.id, status: 'failed' });
  }

  return {
    scanned: runningTasks.length,
    recoveredToQueued,
    markedFailed,
  };
}

/** 调度器主循环：查找可执行的任务并启动 Worker 容器 */
export async function runSchedulerTick(): Promise<void> {
  try {
    // 开发模式下可能没有 Docker：不做容器调度，避免把任务错误标记为 failed
    const dockerAvailable = fs.existsSync(dockerSocketPath);

    // 0) 处理 waiting -> queued：当依赖都完成后，进入 queued 才能被调度/Worker 领取
    const waitingTasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.status, 'waiting'), eq(tasks.source, 'scheduler')))
      .orderBy(tasks.createdAt)
      .limit(50);

    for (const task of waitingTasks) {
      const deps = (task.dependsOn as string[]) || [];
      if (deps.length === 0) {
        await db
          .update(tasks)
          .set({ status: 'queued', queuedAt: new Date().toISOString() })
          .where(and(eq(tasks.id, task.id), eq(tasks.status, 'waiting')));
        sseManager.broadcast('task.progress', { taskId: task.id, status: 'queued' });
        await db.insert(systemEvents).values({
          type: 'task.dependencies_satisfied',
          payload: { taskId: task.id, dependsOn: [] },
        });
        continue;
      }

      const depTasks = await db
        .select({ id: tasks.id, status: tasks.status })
        .from(tasks)
        .where(inArray(tasks.id, deps));

      const allCompleted = areDependenciesSatisfied(deps, depTasks);
      if (!allCompleted) continue;

      const promoted = await db
        .update(tasks)
        .set({ status: 'queued', queuedAt: new Date().toISOString() })
        .where(and(eq(tasks.id, task.id), eq(tasks.status, 'waiting')))
        .returning();

      if (promoted.length === 0) continue;

      sseManager.broadcast('task.progress', { taskId: task.id, status: 'queued' });
      await db.insert(systemEvents).values({
        type: 'task.dependencies_satisfied',
        payload: { taskId: task.id, dependsOn: deps },
      });
    }

    // 1. 查找所有 queued 状态的任务（无依赖或依赖已完成）
    const queuedTasks = await db.select().from(tasks).where(and(eq(tasks.status, 'queued'), eq(tasks.source, 'scheduler'))).orderBy(tasks.queuedAt).limit(20);

    for (const task of queuedTasks) {
      // 检查依赖是否都已完成
      const deps = (task.dependsOn as string[]) || [];
      if (deps.length > 0) {
        const depTasks = await db
          .select({ id: tasks.id, status: tasks.status })
          .from(tasks)
          .where(inArray(tasks.id, deps));

        const allCompleted = areDependenciesSatisfied(deps, depTasks);
        if (!allCompleted) {
          // 依赖未完成：将 queued 降级为 waiting，避免用户误以为已进入可执行队列
          const demoted = await db
            .update(tasks)
            .set({ status: 'waiting' })
            .where(and(eq(tasks.id, task.id), eq(tasks.status, 'queued')))
            .returning();
          if (demoted.length > 0) {
            sseManager.broadcast('task.progress', { taskId: task.id, status: 'waiting' });
            await db.insert(systemEvents).values({
              type: 'task.waiting',
              payload: { taskId: task.id, dependsOn: deps },
            });
          }
          continue;
        }
      }

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
        await updateTaskStatus(task.id, 'failed', { summary: `Agent definition not found: ${task.agentDefinitionId}` });
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
        await startWorkerContainer(claimed[0], agentDef[0], workerId);
      } catch (err) {
        console.error(`[Scheduler] 启动容器失败: ${(err as Error).message}`);
        await updateTaskStatus(task.id, 'failed', { summary: `Failed to start container: ${(err as Error).message}` });
      }
    }

    // 5. 检查心跳超时的 Worker（30 秒未心跳）
    await checkWorkerHeartbeats();
  } catch (err) {
    console.error(`[Scheduler] 调度循环异常: ${(err as Error).message}`);
  }
}

/** 启动 Worker 容器执行任务 */
async function startWorkerContainer(
  task: typeof tasks.$inferSelect,
  agentDef: typeof agentDefinitions.$inferSelect,
  workerId: string
): Promise<void> {
  const apiServerUrl = process.env.API_SERVER_URL || 'http://localhost:3000';

  console.log(`[Scheduler] 为任务 ${task.id} 启动容器, 镜像: ${agentDef.dockerImage}`);

  // 构建环境变量
  const envVars = [
    `WORKER_ID=${workerId}`,
    `API_SERVER_URL=${apiServerUrl}`,
    `TASK_ID=${task.id}`,
    `AGENT_DEF_ID=${agentDef.id}`,
    `REPO_URL=${task.repoUrl}`,
    `BASE_BRANCH=${task.baseBranch}`,
    `WORK_BRANCH=${task.workBranch}`,
    `TASK_DESCRIPTION=${task.description}`,
  ];

  const apiAuthToken = (process.env.CAM_AUTH_TOKEN || '').trim();
  if (apiAuthToken) {
    envVars.push(`API_AUTH_TOKEN=${apiAuthToken}`);
  }

  if (task.workDir) {
    envVars.push(`WORK_DIR=${task.workDir}`);
  }

  // Secrets / Env 注入：按 repo/agent 维度解析最终值
  const scope = {
    repositoryId: (task as typeof task & { repositoryId?: string | null }).repositoryId || null,
    repoUrl: task.repoUrl,
    agentDefinitionId: agentDef.id,
  };

  const injected = new Set<string>();

  // GitHub Token：用于私有仓库 clone/push（如配置）
  const githubToken =
    (await resolveEnvVarValue('GITHUB_TOKEN', scope)) ||
    process.env.GITHUB_PAT ||
    process.env.GITHUB_API_TOKEN ||
    process.env.GIT_HTTP_TOKEN ||
    process.env.CAM_GIT_HTTP_TOKEN ||
    '';
  if (githubToken) {
    envVars.push(`GITHUB_TOKEN=${githubToken}`);
    injected.add('GITHUB_TOKEN');
  }

  // 注入 Agent 所需的 API Key 等环境变量
  const requiredEnvVars = (agentDef.requiredEnvVars as Array<{ name: string }>) || [];
  for (const envSpec of requiredEnvVars) {
    if (injected.has(envSpec.name)) continue;
    const val = await resolveEnvVarValue(envSpec.name, scope);
    if (val) {
      envVars.push(`${envSpec.name}=${val}`);
      injected.add(envSpec.name);
    }
  }

  // 创建并启动容器
  const container = await docker.createContainer({
    Image: agentDef.dockerImage,
    Env: envVars,
    HostConfig: {
      AutoRemove: true,
      Memory: (agentDef.defaultResourceLimits as { memoryLimitMb?: number })?.memoryLimitMb
        ? ((agentDef.defaultResourceLimits as { memoryLimitMb: number }).memoryLimitMb * 1024 * 1024)
        : undefined,
      NetworkMode: 'host',
    },
    Labels: {
      'cam.task-id': task.id,
      'cam.agent-def-id': agentDef.id,
      'cam.worker-id': workerId,
    },
  });

  await container.start();

  // 注册 Worker
  await db.insert(workers).values({
    id: workerId,
    name: workerId,
    supportedAgentIds: [agentDef.id],
    status: 'busy',
    currentTaskId: task.id,
    lastHeartbeatAt: new Date().toISOString(),
    uptimeSince: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: workers.id,
    set: {
      status: 'busy',
      currentTaskId: task.id,
      lastHeartbeatAt: new Date().toISOString(),
    },
  });

  // 广播事件
  sseManager.broadcast('task.started', {
    taskId: task.id,
    workerId,
    agentDefinitionId: agentDef.id,
  });

  // 记录系统事件
  await db.insert(systemEvents).values({
    type: 'task.started',
    payload: { taskId: task.id, workerId, agentDefinitionId: agentDef.id },
  });
}

/** 更新任务状态 */
async function updateTaskStatus(
  taskId: string,
  status: string,
  extra?: Record<string, unknown>
): Promise<void> {
  const updateData: Record<string, unknown> = { status };
  if (extra) Object.assign(updateData, extra);

  if (status === 'running') {
    updateData.startedAt = new Date().toISOString();
  } else if (status === 'completed' || status === 'failed') {
    updateData.completedAt = new Date().toISOString();
  }

  await db.update(tasks).set(updateData).where(eq(tasks.id, taskId));

  sseManager.broadcast('task.progress', { taskId, status });

  await db.insert(systemEvents).values({
    type: 'task.progress',
    payload: { taskId, status, ...(extra || {}) },
  });
}

/** 检查 Worker 心跳超时 */
async function checkWorkerHeartbeats(): Promise<void> {
  const timeout = new Date(Date.now() - WORKER_STALE_TIMEOUT_MS).toISOString();

  const staleWorkers = await db
    .select()
    .from(workers)
    .where(
      and(
        eq(workers.status, 'busy'),
        sql`${workers.lastHeartbeatAt} < ${timeout}`
      )
    );

  for (const worker of staleWorkers) {
    console.warn(`[Scheduler] Worker ${worker.id} 心跳超时，标记为 offline`);

    await db
      .update(workers)
      .set({ status: 'offline', currentTaskId: null })
      .where(eq(workers.id, worker.id));

    // 将该 Worker 正在执行的任务标记为失败
      if (worker.currentTaskId) {
        const task = await db
          .select({
            id: tasks.id,
            status: tasks.status,
            retryCount: tasks.retryCount,
            maxRetries: tasks.maxRetries,
          })
          .from(tasks)
          .where(eq(tasks.id, worker.currentTaskId))
          .limit(1);

        const staleAction = decideStaleTaskAction(task[0] || null);
        if (staleAction === 'retry') {
          // 还有重试次数，重新入队
          await db
            .update(tasks)
            .set({
              status: 'queued',
              retryCount: task[0].retryCount + 1,
              assignedWorkerId: null,
              queuedAt: new Date().toISOString(),
            })
            .where(eq(tasks.id, worker.currentTaskId));
        } else if (staleAction === 'fail') {
          // 超过重试次数，标记失败
          await updateTaskStatus(worker.currentTaskId, 'failed');
        }
      }

    sseManager.broadcast('worker.offline', { workerId: worker.id });
    sseManager.broadcast('alert.triggered', {
      message: `Worker ${worker.name} 心跳超时，已标记为离线`,
      severity: 'warning',
    });
  }
}
