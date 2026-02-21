// ============================================================
// Agent 任务执行器
// 根据 AgentDefinition 动态渲染命令并执行
// ============================================================

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { cloneRepo, createBranch, commitAndPush } from './git-ops.js';
import { appendTaskLogs, getTask, updateTaskStatus, sendHeartbeat } from './api-client.js';

/** 日志缓冲区：保留最近的输出 */
let logBuffer: string[] = [];
const MAX_LOG_LINES = 500;
const LOG_FLUSH_INTERVAL_MS = 1000;
const LOG_FLUSH_BATCH_SIZE = 100;
const MAX_PENDING_PERSISTED_LINES = 5000;
let logPersistSink: ((line: string) => void) | null = null;

function appendLog(line: string): void {
  logBuffer.push(line);
  if (logPersistSink) {
    logPersistSink(line);
  }
  if (logBuffer.length > MAX_LOG_LINES) {
    logBuffer = logBuffer.slice(-MAX_LOG_LINES);
  }
}

/** 获取最近 N 行日志 */
export function getLogTail(n = 50): string {
  return logBuffer.slice(-n).join('\n');
}

/** 清空日志缓冲 */
export function clearLog(): void {
  logBuffer = [];
}

/** 渲染命令参数模板 */
function renderArgs(args: string[], variables: Record<string, string>): string[] {
  return args.map((arg) => {
    let result = arg;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
  });
}

/** 执行任务 */
export async function executeTask(
  task: Record<string, unknown>,
  agentDef: Record<string, unknown>,
  workerId: string,
  taskEnv?: Record<string, string>
): Promise<void> {
  const taskId = task.id as string;
  const repoUrl = task.repoUrl as string;
  const baseBranch = task.baseBranch as string;
  const workBranch = task.workBranch as string;
  const baseDescription = task.description as string;
  const feedback = (task.feedback as string) || '';
  // 当任务被 reject 重新入队时，将反馈拼接进 prompt，避免重复跑同一输出
  const description = feedback
    ? `${baseDescription}\n\n# Review Feedback\n${feedback}`
    : baseDescription;
  const workDir = (task.workDir as string) || '';

  const command = agentDef.command as string;
  const args = (agentDef.args as string[]) || [];
  const capabilities = (agentDef.capabilities as Record<string, boolean>) || {};
  const resourceLimits = (agentDef.defaultResourceLimits as Record<string, number>) || {};
  const timeoutMinutes = resourceLimits.timeoutMinutes || 120;

  // 工作目录
  const baseDir = `/tmp/cam-tasks/${taskId}`;
  const repoDir = path.join(baseDir, 'repo');
  const agentWorkDir = workDir ? path.join(repoDir, workDir) : repoDir;

  let pendingPersistedLines: string[] = [];
  let droppedPersistedLines = 0;
  let persistFlushInFlight = false;

  const flushPersistedLogs = async (force = false): Promise<void> => {
    if (persistFlushInFlight) return;
    if (pendingPersistedLines.length === 0) return;

    persistFlushInFlight = true;
    try {
      while (pendingPersistedLines.length > 0) {
        const batchSize = Math.min(LOG_FLUSH_BATCH_SIZE, pendingPersistedLines.length);
        const batch = pendingPersistedLines.slice(0, batchSize);
        await appendTaskLogs(taskId, batch);
        pendingPersistedLines = pendingPersistedLines.slice(batchSize);
        if (!force) break;
      }
      if (droppedPersistedLines > 0) {
        const droppedCount = droppedPersistedLines;
        droppedPersistedLines = 0;
        console.warn(`[Executor] 警告: 持久化日志队列达到上限，已丢弃 ${droppedCount} 行旧日志`);
      }
    } catch (err) {
      console.error(`[Executor] 写入持久化日志失败: ${(err as Error).message}`);
    } finally {
      persistFlushInFlight = false;
    }
  };

  logPersistSink = (line: string) => {
    pendingPersistedLines.push(line);
    if (pendingPersistedLines.length > MAX_PENDING_PERSISTED_LINES) {
      const overflow = pendingPersistedLines.length - MAX_PENDING_PERSISTED_LINES;
      pendingPersistedLines.splice(0, overflow);
      droppedPersistedLines += overflow;
    }
  };

  clearLog();
  appendLog(`[Executor] 开始执行任务: ${taskId}`);
  appendLog(`[Executor] Agent: ${agentDef.displayName}, Command: ${command}`);

  const abortController = new AbortController();
  let cancellationCheckInFlight = false;

  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let logFlushInterval: ReturnType<typeof setInterval> | null = null;
  try {
    // 周期性刷盘：将 Worker 内存日志批量写入服务端持久化
    logFlushInterval = setInterval(() => {
      void flushPersistedLogs();
    }, LOG_FLUSH_INTERVAL_MS);

    // 持续心跳：覆盖 clone/branch/agent 执行全过程，避免长耗时步骤被误判离线
    heartbeatInterval = setInterval(async () => {
      try {
        const mem = process.memoryUsage();
        await sendHeartbeat(workerId, {
          status: 'busy',
          currentTaskId: taskId,
          memoryUsageMb: Math.round(mem.rss / 1024 / 1024),
          logTail: getLogTail(20),
        });
      } catch {
        // 心跳失败不影响任务执行
      }

      // 轮询检查是否被取消（外部常驻 worker 场景无法由容器 stop 直接中断）
      if (abortController.signal.aborted || cancellationCheckInFlight) return;
      cancellationCheckInFlight = true;
      try {
        const latest = await getTask(taskId);
        const status = latest.status as string | undefined;
        if (status === 'cancelled') {
          appendLog('[Executor] 检测到任务已取消，准备中止执行');
          abortController.abort();
        }
      } catch {
        // 取消检查失败不阻塞执行
      } finally {
        cancellationCheckInFlight = false;
      }
    }, 10_000);

    // 立即发送一次心跳，尽快将 Worker 标记为 busy（避免等待 10 秒）
    try {
      const mem = process.memoryUsage();
      await sendHeartbeat(workerId, {
        status: 'busy',
        currentTaskId: taskId,
        memoryUsageMb: Math.round(mem.rss / 1024 / 1024),
        logTail: getLogTail(20),
      });
    } catch {
      // ignore
    }

    // 1. 克隆仓库
    appendLog('[Executor] Step 1: 克隆仓库...');
    await cloneRepo(repoUrl, repoDir, baseBranch, taskEnv);
    if (abortController.signal.aborted) return;

    // 2. 创建工作分支
    appendLog(`[Executor] Step 2: 创建分支 ${workBranch}...`);
    await createBranch(repoDir, workBranch);
    if (abortController.signal.aborted) return;

    // 3. 渲染命令模板
    const renderedArgs = renderArgs(args, {
      prompt: description,
      workDir: agentWorkDir,
      baseBranch,
    });

    appendLog(`[Executor] Step 3: 执行命令: ${command} ${renderedArgs.join(' ')}`);

    // 4. 执行 Agent CLI
    const exitCode = await runAgentProcess(
      command,
      renderedArgs,
      agentWorkDir,
      timeoutMinutes,
      abortController.signal,
      taskEnv
    );
    if (abortController.signal.aborted) return;

    if (exitCode !== 0) {
      appendLog(`[Executor] Agent 进程退出码: ${exitCode}，标记为失败`);
      await updateTaskStatus(taskId, 'failed', { summary: `Agent exited with code ${exitCode}` });
      return;
    }

    // 5. Git 操作
    appendLog('[Executor] Step 4: 处理 Git 提交...');
    if (abortController.signal.aborted) return;
    if (!capabilities.autoGitCommit) {
      // Agent 不自动提交，我们来提交
      await commitAndPush(repoDir, workBranch, `[CAM] Task ${taskId}: ${task.title}`, taskEnv);
    } else {
      // Agent 自动提交了，我们只需要 push
      const { default: simpleGit } = await import('simple-git');
      const git = simpleGit(repoDir);
      try {
        await git.push('origin', workBranch, ['--set-upstream']);
        appendLog('[Executor] 代码已推送');
      } catch {
        appendLog('[Executor] 推送失败或无新提交');
      }
    }

    // 6. 更新状态为待审批
    appendLog('[Executor] 任务执行完成，等待审批');
    await updateTaskStatus(taskId, 'awaiting_review', {
      summary: `Agent completed successfully. Branch: ${workBranch}`,
    });
  } catch (err) {
    appendLog(`[Executor] 任务执行异常: ${(err as Error).message}`);
    // 若任务已被取消，避免覆盖状态为 failed
    if (abortController.signal.aborted) return;
    await updateTaskStatus(taskId, 'failed', {
      summary: `Execution error: ${(err as Error).message}`,
    });
  } finally {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    if (logFlushInterval) {
      clearInterval(logFlushInterval);
    }
    await flushPersistedLogs(true);
    logPersistSink = null;
  }
}

/** 运行 Agent 进程，返回退出码 */
function runAgentProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMinutes: number,
  signal?: AbortSignal,
  env?: Record<string, string>
): Promise<number> {
  return new Promise((resolve) => {
    const proc: ChildProcess = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(env || {}) },
    });

    let abortHandler: (() => void) | null = null;
    if (signal) {
      abortHandler = () => {
        appendLog('[Executor] 收到取消信号，终止 Agent 进程');
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 5000);
      };

      if (signal.aborted) {
        abortHandler();
      } else {
        signal.addEventListener('abort', abortHandler, { once: true });
      }
    }

    // 超时定时器
    const timeout = setTimeout(() => {
      appendLog(`[Executor] 任务超时 (${timeoutMinutes} min)，强制终止`);
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000);
    }, timeoutMinutes * 60 * 1000);

    proc.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach((line) => {
        appendLog(`[Agent] ${line}`);
        process.stdout.write(`[Agent] ${line}\n`);
      });
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach((line) => {
        appendLog(`[Agent:err] ${line}`);
        process.stderr.write(`[Agent:err] ${line}\n`);
      });
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (signal && abortHandler) {
        try {
          signal.removeEventListener('abort', abortHandler);
        } catch {
          // ignore
        }
      }
      appendLog(`[Executor] 进程退出，code=${code}`);
      resolve(code ?? 1);
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      if (signal && abortHandler) {
        try {
          signal.removeEventListener('abort', abortHandler);
        } catch {
          // ignore
        }
      }
      appendLog(`[Executor] 进程启动失败: ${err.message}`);
      resolve(1);
    });
  });
}
