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

let isRunning = true;
let currentTaskId: string | null = null;

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

  // 1. 注册 Worker
  try {
    await registerWorker({
      id: WORKER_ID,
      name: WORKER_ID,
      supportedAgentIds: SUPPORTED_AGENTS,
      mode,
      reportedEnvVars,
    });
  } catch (err) {
    console.error(`[Worker] 注册失败: ${(err as Error).message}`);
    console.log('[Worker] 5 秒后重试...');
    await sleep(5000);
    return main(); // 重试
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
  startIdleHeartbeat();

  // 4. 任务轮询循环
  while (isRunning) {
    try {
      const result = await fetchNextTask(WORKER_ID);

      if (result && result.task && result.agentDefinition) {
        currentTaskId = result.task.id as string;
        console.log(`[Worker] 获取到任务: ${currentTaskId} - ${result.task.title}`);

        // 执行任务
        clearLog();
        await executeTask(result.task, result.agentDefinition, WORKER_ID, result.env || undefined);

        currentTaskId = null;
        console.log('[Worker] 任务执行完毕，继续等待...');

        // 执行完后更新状态为 idle
        await sendHeartbeat(WORKER_ID, { status: 'idle', currentTaskId: null });
      }
    } catch (err) {
      console.error(`[Worker] 轮询异常: ${(err as Error).message}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  console.log('[Worker] 已停止');
}

/** 空闲时定期发送心跳 */
function startIdleHeartbeat(): void {
  setInterval(async () => {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 优雅退出
process.on('SIGTERM', () => {
  console.log('[Worker] 收到 SIGTERM，准备退出...');
  isRunning = false;
});
process.on('SIGINT', () => {
  console.log('[Worker] 收到 SIGINT，准备退出...');
  isRunning = false;
});

// 启动
main().catch((err) => {
  console.error('[Worker] 致命错误:', err);
  process.exit(1);
});
