// ============================================================
// Worker 入口
// 启动后注册自己，然后循环拉取任务执行
// ============================================================

import { registerWorker, fetchNextTask, sendHeartbeat, getTask, getAgentDefinition, updateTaskStatus } from './api-client.js';
import { executeTask, getLogTail, clearLog } from './executor.js';

// 从环境变量读取配置
const WORKER_ID = process.env.WORKER_ID || `worker-${Date.now()}`;
const SUPPORTED_AGENTS = (process.env.SUPPORTED_AGENTS || '').split(',').filter(Boolean);
const TASK_ID = process.env.TASK_ID || null; // 单任务模式：调度器注入
const POLL_INTERVAL_MS = 5_000; // 5 秒轮询一次任务
const HEARTBEAT_INTERVAL_MS = 10_000; // 10 秒心跳
const REGISTER_RETRY_BASE_MS = 5_000;
const REGISTER_RETRY_MAX_MS = 60_000;

let isRunning = true;
let currentTaskId: string | null = null;
let idleHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

function parseReportedEnvVarAllowlist(): string[] {
  const raw = (process.env.CAM_WORKER_REPORTED_ENV_VARS || '').trim();
  const defaults = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY', 'GITHUB_TOKEN', 'GITLAB_TOKEN', 'GITEA_TOKEN'];
  if (!raw) return defaults;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectReportedEnvVars(): string[] {
  const allowlist = parseReportedEnvVarAllowlist();
  const found: string[] = [];
  for (const name of allowlist) {
    const val = process.env[name];
    if (typeof val === 'string' && val.trim().length > 0) {
      found.push(name);
    }
  }
  return Array.from(new Set(found)).sort();
}

function computeRegisterRetryDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, attempt);
  const exp = Math.min(10, safeAttempt - 1);
  const delay = REGISTER_RETRY_BASE_MS * (2 ** exp);
  return Math.min(REGISTER_RETRY_MAX_MS, delay);
}

async function registerWorkerWithRetry(input: {
  id: string;
  name: string;
  supportedAgentIds: string[];
  mode: 'daemon' | 'task';
  reportedEnvVars: string[];
}): Promise<boolean> {
  let attempt = 0;
  while (isRunning) {
    attempt += 1;
    try {
      await registerWorker(input);
      return true;
    } catch (err) {
      const delayMs = computeRegisterRetryDelayMs(attempt);
      console.error(`[Worker] 注册失败(第 ${attempt} 次): ${(err as Error).message}`);
      if (!isRunning) {
        break;
      }
      console.log(`[Worker] ${Math.round(delayMs / 1000)} 秒后重试...`);
      await sleep(delayMs);
    }
  }
  return false;
}

async function main(): Promise<void> {
  console.log(`[Worker] 启动: ${WORKER_ID}`);
  console.log(`[Worker] 支持的 Agent: ${SUPPORTED_AGENTS.length > 0 ? SUPPORTED_AGENTS.join(', ') : '全部'}`);
  if (TASK_ID) {
    console.log(`[Worker] 单任务模式: TASK_ID=${TASK_ID}`);
  }

  const mode = TASK_ID ? 'task' : 'daemon';
  const reportedEnvVars = collectReportedEnvVars();
  if (reportedEnvVars.length > 0) {
    console.log(`[Worker] 已检测到环境变量: ${reportedEnvVars.join(', ')}`);
  }

  // 1. 注册 Worker（循环重试，避免递归调用）
  const registered = await registerWorkerWithRetry({
    id: WORKER_ID,
    name: WORKER_ID,
    supportedAgentIds: SUPPORTED_AGENTS,
    mode,
    reportedEnvVars,
  });
  if (!registered) {
    console.warn('[Worker] 已停止或注册未完成，退出');
    return;
  }

  // 2. 单任务模式：执行指定任务并退出（容器会 AutoRemove）
  if (TASK_ID) {
    currentTaskId = TASK_ID;
    try {
      // 取任务与 AgentDefinition
      const task = await getTask(TASK_ID);
      const agentDefinitionId = task.agentDefinitionId as string | undefined;
      if (!agentDefinitionId) {
        throw new Error('任务缺少 agentDefinitionId');
      }
      const agentDef = await getAgentDefinition(agentDefinitionId);

      clearLog();
      await executeTask(task, agentDef, WORKER_ID);
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[Worker] 单任务执行失败: ${message}`);
      try {
        await updateTaskStatus(TASK_ID, 'failed', { summary: `Worker error: ${message}` });
      } catch {
        // 忽略更新失败
      }
    } finally {
      currentTaskId = null;
      // 结束前标记为离线，避免数据库留下长期 idle Worker
      try {
        await sendHeartbeat(WORKER_ID, { status: 'offline', currentTaskId: null, logTail: getLogTail(20) });
      } catch {
        // ignore
      }
    }

    process.exit(0);
  }

  // 3. 启动空闲心跳（轮询模式）
  idleHeartbeatTimer = startIdleHeartbeat();

  // 4. 任务轮询循环
  while (isRunning) {
    try {
      const result = await fetchNextTask(WORKER_ID);

      if (result && result.task && result.agentDefinition) {
        currentTaskId = result.task.id as string;
        console.log(`[Worker] 获取到任务: ${currentTaskId} - ${result.task.title}`);

        let executionFailed = false;
        let executionErrorMessage = '';
        try {
          // 执行任务
          clearLog();
          await executeTask(result.task, result.agentDefinition, WORKER_ID, result.env || undefined);
        } catch (err) {
          executionFailed = true;
          executionErrorMessage = (err as Error).message;
          console.error(`[Worker] 任务执行异常: ${executionErrorMessage}`);
        } finally {
          // 无论执行成功/失败，都必须释放当前任务占用并回报 idle
          // 否则会出现 Worker 长时间卡 busy，后续无法领取新任务
          currentTaskId = null;
          try {
            await sendHeartbeat(WORKER_ID, {
              status: 'idle',
              currentTaskId: null,
              logTail: getLogTail(20),
            });
          } catch {
            // ignore
          }
        }

        if (executionFailed) {
          console.warn('[Worker] 任务执行失败，已释放占用并继续轮询');
          continue;
        }

        console.log('[Worker] 任务执行完毕，继续等待...');
      }
    } catch (err) {
      console.error(`[Worker] 轮询异常: ${(err as Error).message}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  stopIdleHeartbeat();
  // daemon 退出前补一条 offline 心跳，避免 UI 长时间显示 idle
  try {
    await sendHeartbeat(WORKER_ID, { status: 'offline', currentTaskId: null, logTail: getLogTail(20) });
  } catch {
    // ignore
  }

  console.log('[Worker] 已停止');
}

/** 空闲时定期发送心跳 */
function startIdleHeartbeat(): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    if (currentTaskId) return; // 执行任务时由 executor 负责心跳

    try {
      const mem = process.memoryUsage();
      await sendHeartbeat(WORKER_ID, {
        status: 'idle',
        currentTaskId: null,
        memoryUsageMb: Math.round(mem.rss / 1024 / 1024),
      });
    } catch {
      // 忽略心跳失败
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopIdleHeartbeat(): void {
  if (!idleHeartbeatTimer) return;
  clearInterval(idleHeartbeatTimer);
  idleHeartbeatTimer = null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 优雅退出
process.on('SIGTERM', () => {
  console.log('[Worker] 收到 SIGTERM，准备退出...');
  isRunning = false;
  stopIdleHeartbeat();
});
process.on('SIGINT', () => {
  console.log('[Worker] 收到 SIGINT，准备退出...');
  isRunning = false;
  stopIdleHeartbeat();
});

// 启动
main().catch((err) => {
  console.error('[Worker] 致命错误:', err);
  process.exit(1);
});
