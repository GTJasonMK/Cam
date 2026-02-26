// ============================================================
// Agent 会话管理器（核心编排）
// 职责：查 Agent 定义 → 解密密钥 → 构造命令 → 创建 PTY → 状态跟踪
// 支持 Hook 驱动的流水线步骤完成检测（Claude Code Stop hook）
// ============================================================

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentDefinitions, repositories, taskLogs, tasks, terminalSessionPool } from '@/lib/db/schema';
import { resolveEnvVarValue, type SecretScope } from '@/lib/secrets/resolve';
import { sseManager } from '@/lib/sse/manager';
import { sleep } from '@/lib/async/sleep';
import { isSqliteForeignKeyConstraintError } from '@/lib/db/sqlite-errors';
import { toSafeTimestamp } from '@/lib/time/format';
import { normalizeOptionalString } from '@/lib/validation/strings';
import {
  TERMINAL_PIPELINE_PENDING_TASK_STATUSES,
  TERMINAL_SESSION_ACTIVE_TASK_STATUSES,
} from '@/lib/tasks/status';
import {
  updateTerminalTaskStatusByAllowed,
  updateTerminalTaskStatusByExpected,
} from './task-status-sync';
import {
  initializePipelineStepWorkspace,
  resolvePipelineStepWorkspaceDirs,
  writePipelineNodeTaskPromptFile,
} from './pipeline-workspace';
import { appendTerminalLogLine, splitTerminalLogChunk } from './log-buffer';
import {
  buildPipelineHookCleanupKey,
  cleanupPipelineCallbackTokensById,
  cleanupPipelineHookByKey,
  cleanupPipelineHooksById,
  consumePipelineCallbackToken,
} from './pipeline-hook-state';
import { locatePipelineNodeBySessionId, locatePipelineNodeByTaskId } from './pipeline-node-locator';
import { buildPipelineNodePromptText } from './pipeline-prompt';
import {
  cancelActiveNodesFromSteps,
  cancelDraftNodesFromSteps,
  cancelRunningNodesInStep,
} from './pipeline-step-state';
import {
  linkTaskSessionIndex,
  resolveSessionMetaByTaskId,
  unlinkTaskSessionIndexIfMatched,
} from './session-index';
import {
  collectExpiredPipelineActions,
  collectExpiredSessionActions,
  collectFinishedSessionIds,
} from './session-gc';
import { transitionSessionToFinalStatus } from './session-lifecycle';
import { normalizeHostPathInput } from './path-normalize';
import { MAX_SESSIONS_PER_USER, ptyManager } from './pty-manager';
import { resolveAgentCommand, generateWorkBranch } from './agent-command';
import { injectCompletionHook } from './hook-injector';
import type {
  AgentSessionInfo,
  AgentSessionStatus,
  PipelinePreparedSessionInput,
  PipelineSessionPolicy,
} from './protocol';

const execFileAsync = promisify(execFile);

// Agent 会话空闲超时：4 小时
const AGENT_IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000;
// 取消等待超时：3 秒
const CANCEL_TIMEOUT_MS = 3000;
// terminal 任务日志持久化：1s 刷盘，单批 100 行
const TERMINAL_LOG_FLUSH_INTERVAL_MS = 1000;
const TERMINAL_LOG_BATCH_SIZE = 100;
const TERMINAL_LOG_MAX_PENDING_LINES = 5000;
const TERMINAL_LOG_MAX_LINE_LENGTH = 8000;
const STATE_PRUNE_INTERVAL_MS = 60 * 1000;
const FINISHED_SESSION_TTL_MS = 10 * 60 * 1000;
const FINISHED_PIPELINE_TTL_MS = 30 * 60 * 1000;
const TERMINAL_PENDING_TASK_ALLOWED_STATUSES = [...TERMINAL_PIPELINE_PENDING_TASK_STATUSES];
const TERMINAL_ACTIVE_TASK_ALLOWED_STATUSES = [...TERMINAL_SESSION_ACTIVE_TASK_STATUSES];

/** Agent 会话元数据（内存中跟踪） */
interface AgentSessionMeta {
  sessionId: string;
  userId: string;
  agentDefinitionId: string;
  agentDisplayName: string;
  prompt: string;
  repoUrl?: string;
  /** 项目绝对路径 */
  repoPath: string;
  workBranch: string;
  status: AgentSessionStatus;
  exitCode?: number;
  finishedAt?: number;
  startedAt: number;
  /** 会话模式 */
  mode: 'create' | 'resume' | 'continue';
  /** 恢复的 Claude Code 会话 ID（resume/continue 模式） */
  claudeSessionId?: string;
  /** 自动关联的 tasks 表记录 ID */
  taskId?: string;
  /** 所属流水线 ID（如有） */
  pipelineId?: string;
}

export interface CreateAgentSessionOpts {
  agentDefinitionId: string;
  prompt: string;
  repoUrl?: string;
  baseBranch?: string;
  workDir?: string;
  cols: number;
  rows: number;
  /** 会话模式：新建 / 恢复 / 继续 */
  mode?: 'create' | 'resume' | 'continue';
  /** mode='resume' 时：要恢复的 Claude Code 会话 ID */
  resumeSessionId?: string;
  /** 流水线步骤：使用非交互模式，执行完自动退出 */
  autoExit?: boolean;
  /** 内部：流水线步骤已预创建任务，跳过自动创建 */
  _pipelineTaskId?: string;
  /** 内部：所属流水线 ID */
  _pipelineId?: string;
}

/** 流水线步骤 */
interface PipelineStepNode {
  taskId: string;
  /** 节点标题（用于 UI 展示） */
  title: string;
  /** 节点提示词 */
  prompt: string;
  /** 节点 Agent（可选，回退到步骤/流水线默认） */
  agentDefinitionId?: string;
  sessionId?: string;
  /** 本节点会话来源：复用会话池 / 自动新建 */
  sessionSource?: 'reused' | 'created';
  /** 复用会话池时绑定的会话键 */
  preparedSessionKey?: string;
  status: 'draft' | 'running' | 'completed' | 'failed' | 'cancelled';
}

/** 流水线步骤（步骤内允许多个并行节点） */
interface PipelineStep {
  stepId: string;
  title: string;
  prompt: string;
  /** 步骤默认 Agent（可覆盖流水线默认值） */
  agentDefinitionId?: string;
  /** 从上一步读取的输入文件（相对 .conversations/stepN） */
  inputFiles?: string[];
  /** 输入条件描述 */
  inputCondition?: string;
  /** 步骤内并行节点 */
  nodes: PipelineStepNode[];
  status: 'draft' | 'running' | 'completed' | 'failed' | 'cancelled';
}

/** 流水线会话池条目（由 pipeline-create 的 preparedSessions 初始化） */
interface PipelinePreparedSession {
  sessionKey: string;
  agentDefinitionId: string;
  mode: 'resume' | 'continue';
  resumeSessionId?: string;
  source: 'external' | 'managed';
  title?: string;
  status: 'available' | 'leased';
  usageCount: number;
  leasedByTaskId?: string;
  leasedByStepIndex?: number;
  leasedByRuntimeSessionId?: string;
}

/** 项目托管会话池（用户级） */
interface ManagedPipelineSession {
  sessionKey: string;
  userId: string;
  repoPath: string;
  agentDefinitionId: string;
  mode: 'resume' | 'continue';
  resumeSessionId?: string;
  source: 'external' | 'managed';
  title?: string;
  createdAt: string;
  updatedAt: string;
}

type TerminalSessionPoolRow = typeof terminalSessionPool.$inferSelect;

/** 终端流水线 */
interface TerminalPipeline {
  pipelineId: string;
  userId: string;
  agentDefinitionId: string;
  agentDisplayName: string;
  repoUrl?: string;
  repoPath: string;
  workDir?: string;
  baseBranch?: string;
  cols: number;
  rows: number;
  steps: PipelineStep[];
  currentStepIndex: number;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  /** 会话治理策略 */
  sessionPolicy: PipelineSessionPolicy;
  /** 允许自动新建会话的步骤（0-based） */
  allowCreateStepIndexes: Set<number>;
  /** 预先准备的会话池（仅治理 Claude/Codex） */
  preparedSessions: PipelinePreparedSession[];
}

/** 步骤完成事件载荷 */
export interface PipelineStepCompletedEvent {
  pipelineId: string;
  taskId: string;
  userId: string;
  sessionId?: string;
}

interface TerminalLogPersistState {
  taskId: string;
  tapId: string;
  timer: ReturnType<typeof setInterval>;
  pendingLines: string[];
  partialLine: string;
  droppedLines: number;
  flushInFlight: boolean;
}

class AgentSessionManager {
  /** sessionId → AgentSessionMeta */
  private sessions: Map<string, AgentSessionMeta> = new Map();

  /** 事件总线：跨上下文通信（HTTP 回调 → WebSocket 推送） */
  readonly events = new EventEmitter();

  /** callbackToken → { pipelineId, taskId }（一次性令牌，用于 hook 回调鉴权） */
  private callbackTokens: Map<string, { pipelineId: string; taskId: string }> = new Map();

  /** pipelineId:stepIndex → cleanup 函数（hook 注入的清理回调） */
  private hookCleanups: Map<string, () => Promise<void>> = new Map();

  /** taskId → sessionId（terminal 任务取消/删除快速定位） */
  private taskSessionIndex: Map<string, string> = new Map();

  /** sessionId → terminal 任务日志持久化状态 */
  private terminalLogPersisters: Map<string, TerminalLogPersistState> = new Map();
  /** sessionId → terminal 日志收尾 Promise（用于删除任务前等待刷盘完成） */
  private terminalLogDrainPromises: Map<string, Promise<void>> = new Map();
  /** sessionId → 进入终态的时间戳（用于 TTL 清理） */
  private sessionFinishedAt: Map<string, number> = new Map();
  /** pipelineId → 进入终态的时间戳（用于 TTL 清理） */
  private pipelineFinishedAt: Map<string, number> = new Map();
  /** 最近一次状态清理时间戳 */
  private lastStatePruneAtMs = 0;

  /** 创建 Agent 会话 */
  async createAgentSession(
    opts: CreateAgentSessionOpts,
    user: { id: string; username: string },
  ): Promise<AgentSessionMeta & { shell: string }> {
    const mode = opts.mode ?? 'create';

    // 1. 查询 Agent 定义
    const [agent] = await db
      .select()
      .from(agentDefinitions)
      .where(eq(agentDefinitions.id, opts.agentDefinitionId))
      .limit(1);

    if (!agent) {
      throw new Error(`Agent 定义不存在: ${opts.agentDefinitionId}`);
    }

    // 2. 解析仓库路径
    const repoPath = await this.resolveRepoPath(opts.repoUrl, opts.workDir);

    // 3. 解密密钥 → 构建环境变量
    const env = await this.resolveAgentEnv(agent, opts.repoUrl);

    // 4. 生成工作分支（仅 create 模式）
    const workBranch = mode === 'create' ? generateWorkBranch(crypto.randomUUID()) : '';

    // 5. create 模式下，先切换到工作分支
    if (mode === 'create' && workBranch) {
      try {
        await execFileAsync('git', ['checkout', '-b', workBranch], { cwd: repoPath });
        console.log(`[AgentSession] 已创建工作分支: ${workBranch}`);
      } catch (err) {
        console.warn(`[AgentSession] git checkout 失败，跳过分支创建: ${(err as Error).message}`);
      }
    }

    // 6. 解析 Agent 启动命令（结构化 → 直接 spawn）
    const spec = resolveAgentCommand({
      agentDefinitionId: opts.agentDefinitionId,
      command: agent.command,
      prompt: opts.prompt,
      mode,
      resumeSessionId: opts.resumeSessionId,
      autoExit: opts.autoExit,
    });

    // 7. 创建 PTY 会话（直接 spawn Agent 命令，不经过 shell）
    const { sessionId, shell } = ptyManager.create({
      cols: opts.cols,
      rows: opts.rows,
      command: spec.file,
      args: spec.args,
      userId: user.id,
      env,
      cwd: repoPath,
      idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
      runtime: (agent.runtime as 'native' | 'wsl') ?? 'native',
    });

    // 8. 记录元数据
    const meta: AgentSessionMeta = {
      sessionId,
      userId: user.id,
      agentDefinitionId: opts.agentDefinitionId,
      agentDisplayName: agent.displayName,
      prompt: opts.prompt,
      repoUrl: opts.repoUrl,
      repoPath,
      workBranch,
      status: 'running',
      startedAt: Date.now(),
      mode,
      claudeSessionId: opts.resumeSessionId,
    };
    this.sessions.set(sessionId, meta);
    this.sessionFinishedAt.delete(sessionId);

    const modeLabel = mode === 'create' ? '新建' : mode === 'resume' ? '恢复' : '继续';
    console.log(`[AgentSession] ${modeLabel}: ${sessionId} (agent=${agent.displayName}, user=${user.username}, mode=${mode}${mode === 'resume' ? `, claude=${opts.resumeSessionId}` : ''}, 命令=${spec.file} ${spec.args.join(' ')})`);

    // SSE 广播会话创建事件（让 Dashboard 实时感知）
    sseManager.broadcast('agent.session.created', {
      sessionId,
      agentDefinitionId: meta.agentDefinitionId,
      agentDisplayName: meta.agentDisplayName,
      status: 'running',
      repoPath: meta.repoPath,
    });

    // 自动持久化到 tasks 表（source='terminal'，调度器忽略）
    // 流水线步骤已预创建任务，直接关联
    if (opts._pipelineTaskId) {
      const now = new Date().toISOString();
      const promoted = await db.update(tasks)
        .set({ status: 'running', startedAt: now })
        .where(and(
          eq(tasks.id, opts._pipelineTaskId),
          inArray(tasks.status, [...TERMINAL_SESSION_ACTIVE_TASK_STATUSES]),
        ))
        .returning({ id: tasks.id });
      if (promoted.length === 0) {
        // 节点任务已被并发改到不可运行状态（如 cancelled/failed），避免继续启动孤儿会话。
        this.sessions.delete(sessionId);
        this.sessionFinishedAt.delete(sessionId);
        try {
          ptyManager.destroy(sessionId);
        } catch {
          // ignore
        }
        throw new Error(`流水线任务状态冲突，无法启动会话: ${opts._pipelineTaskId}`);
      }

      meta.taskId = opts._pipelineTaskId;
      meta.pipelineId = opts._pipelineId;
      linkTaskSessionIndex(this.taskSessionIndex, opts._pipelineTaskId, sessionId);
    } else {
      const taskId = crypto.randomUUID();
      const now = new Date().toISOString();
      try {
        await db.insert(tasks).values({
          id: taskId,
          title: opts.prompt
            ? `终端: ${opts.prompt.slice(0, 60)}${opts.prompt.length > 60 ? '...' : ''}`
            : `终端: ${agent.displayName} 交互会话`,
          description: opts.prompt || '(交互式会话)',
          agentDefinitionId: opts.agentDefinitionId,
          repoUrl: opts.repoUrl || '',
          baseBranch: opts.baseBranch || '',
          workBranch,
          workDir: repoPath,
          status: 'running',
          source: 'terminal',
          createdAt: now,
          startedAt: now,
          maxRetries: 0,
        });
        meta.taskId = taskId;
        linkTaskSessionIndex(this.taskSessionIndex, taskId, sessionId);
        console.log(`[AgentSession] 已创建任务记录: ${taskId.slice(0, 8)}`);
      } catch (err) {
        console.warn(`[AgentSession] 任务记录创建失败，不影响会话运行: ${(err as Error).message}`);
      }
    }

    if (meta.taskId) {
      this.startTerminalTaskLogPersistence(sessionId, meta.taskId);
    }

    return { ...meta, sessionId, shell };
  }

  /** 处理 Agent PTY 退出 */
  handleAgentExit(sessionId: string, exitCode: number): void {
    void this.stopTerminalTaskLogPersistence(sessionId);
    const newStatus: AgentSessionStatus = exitCode === 0 ? 'completed' : 'failed';
    const transitioned = transitionSessionToFinalStatus(
      this.sessions,
      this.sessionFinishedAt,
      sessionId,
      newStatus,
      { exitCode },
    );
    if (!transitioned) return;
    const meta = transitioned.previous;
    const { elapsedMs } = transitioned;

    // 更新 tasks 表状态（异步，不阻塞）
    if (meta.taskId) {
      db.update(tasks)
        .set({ status: newStatus, completedAt: new Date().toISOString() })
        .where(and(eq(tasks.id, meta.taskId), eq(tasks.status, 'running')))
        .catch((err) => console.warn(`[AgentSession] 任务状态更新失败: ${(err as Error).message}`));
    }

    // 更新流水线步骤状态
    if (meta.pipelineId) {
      this.markPipelineStepDone(meta.pipelineId, sessionId, exitCode === 0);
    }

    // 尝试获取当前分支名和最新 commit（异步，不阻塞状态更新）
    this.collectGitInfo(meta.repoPath).then((gitInfo) => {
      console.log(`[AgentSession] ${newStatus}: ${sessionId} (exitCode=${exitCode}, elapsed=${Math.round(elapsedMs / 1000)}s${gitInfo.branch ? `, branch=${gitInfo.branch}` : ''})`);

      // SSE 广播状态变更（含 git 信息）
      sseManager.broadcast(`agent.session.${newStatus}`, {
        sessionId,
        agentDefinitionId: meta.agentDefinitionId,
        status: newStatus,
        exitCode,
        elapsedMs,
        branch: gitInfo.branch,
        lastCommit: gitInfo.lastCommit,
      });
    }).catch(() => {
      // git 信息采集失败，状态已提前更新
      console.log(`[AgentSession] ${newStatus}: ${sessionId} (exitCode=${exitCode}, elapsed=${Math.round(elapsedMs / 1000)}s)`);

      sseManager.broadcast(`agent.session.${newStatus}`, {
        sessionId,
        agentDefinitionId: meta.agentDefinitionId,
        status: newStatus,
        exitCode,
        elapsedMs,
      });
    });
  }

  /** 取消 Agent 会话（发送 SIGINT，超时后强制销毁） */
  cancelAgentSession(sessionId: string): void {
    const meta = this.sessions.get(sessionId);
    if (!meta || meta.status !== 'running') return;

    // 流水线内任一节点取消，统一升级为“取消整条流水线”，避免步骤状态卡住
    if (meta.pipelineId) {
      const pipeline = this.pipelines.get(meta.pipelineId);
      if (pipeline && (pipeline.status === 'running' || pipeline.status === 'paused')) {
        this.cancelPipeline(meta.pipelineId);
        return;
      }
    }

    // 发送 Ctrl+C
    try {
      ptyManager.write(sessionId, '\x03');
    } catch {
      // PTY 可能已退出
    }

    const transitioned = transitionSessionToFinalStatus(
      this.sessions,
      this.sessionFinishedAt,
      sessionId,
      'cancelled',
    );
    if (!transitioned) return;
    const runningMeta = transitioned.previous;

    // 更新 tasks 表状态
    if (runningMeta.taskId) {
      db.update(tasks)
        .set({ status: 'cancelled', completedAt: new Date().toISOString() })
        .where(and(eq(tasks.id, runningMeta.taskId), eq(tasks.status, 'running')))
        .catch((err) => console.warn(`[AgentSession] 任务状态更新失败: ${(err as Error).message}`));
    }

    // 3 秒后如果 PTY 仍在运行则强制销毁
    setTimeout(() => {
      if (ptyManager.has(sessionId)) {
        console.log(`[AgentSession] 强制销毁: ${sessionId}`);
        ptyManager.destroy(sessionId);
      }
    }, CANCEL_TIMEOUT_MS);

    const elapsedMs = transitioned.elapsedMs;
    console.log(`[AgentSession] 已取消: ${sessionId}`);

    sseManager.broadcast('agent.session.cancelled', {
      sessionId,
      agentDefinitionId: runningMeta.agentDefinitionId,
      status: 'cancelled',
      elapsedMs,
    });
  }

  /** 获取指定用户的所有 Agent 会话 */
  listByUser(userId: string): AgentSessionInfo[] {
    this.pruneInactiveState();
    const now = Date.now();
    const result: AgentSessionInfo[] = [];
    const ptySessionsById = new Map(
      ptyManager.listByUser(userId).map((session) => [session.sessionId, session] as const),
    );

    for (const meta of this.sessions.values()) {
      if (meta.userId !== userId) continue;

      // 获取 PTY 会话信息补充 SessionInfo 字段
      const ptySession = ptySessionsById.get(meta.sessionId);

      result.push({
        sessionId: meta.sessionId,
        shell: ptySession?.shell ?? 'unknown',
        createdAt: ptySession?.createdAt ?? new Date(meta.startedAt).toISOString(),
        lastActivityAt: ptySession?.lastActivityAt ?? new Date().toISOString(),
        agentDefinitionId: meta.agentDefinitionId,
        agentDisplayName: meta.agentDisplayName,
        prompt: meta.prompt,
        repoUrl: meta.repoUrl,
        workBranch: meta.workBranch,
        status: meta.status,
        exitCode: meta.exitCode,
        elapsedMs: (meta.finishedAt ?? now) - meta.startedAt,
      });
    }

    return result;
  }

  /** 检查 sessionId 是否为 Agent 会话 */
  isAgentSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** 获取 Agent 会话元数据 */
  getMeta(sessionId: string): AgentSessionMeta | undefined {
    return this.sessions.get(sessionId);
  }

  /** 按 taskId 查找 Agent 会话元数据（terminal 任务取消/删除联动） */
  getMetaByTaskId(taskId: string): AgentSessionMeta | undefined {
    return resolveSessionMetaByTaskId(this.taskSessionIndex, this.sessions, taskId);
  }

  /**
   * 按 taskId 取消正在运行的 Agent 会话。
   * 返回 true 表示已发送取消请求。
   */
  cancelAgentSessionByTaskId(taskId: string): boolean {
    const meta = this.getMetaByTaskId(taskId);
    if (!meta || meta.status !== 'running') {
      return false;
    }
    this.cancelAgentSession(meta.sessionId);
    return true;
  }

  /**
   * 删除任务前的会话收尾：
   * 1) 若会话仍在运行，先取消并等待 PTY 退出
   * 2) 等待 terminal 日志持久化收尾，降低 task_logs FK 竞态
   */
  async stopAndDrainTaskSessionByTaskId(
    taskId: string,
    opts?: { timeoutMs?: number },
  ): Promise<{ sessionId?: string; stopped: boolean; drained: boolean }> {
    const timeoutMs = opts?.timeoutMs ?? CANCEL_TIMEOUT_MS + 1500;
    const meta = this.getMetaByTaskId(taskId);
    const sessionId = meta?.sessionId ?? this.taskSessionIndex.get(taskId);
    if (!sessionId) {
      return { stopped: true, drained: true };
    }

    if (meta?.status === 'running') {
      this.cancelAgentSession(sessionId);
    }

    const stopped = await this.waitForSessionExit(sessionId, timeoutMs);
    const drained = await this.waitForTerminalLogDrain(sessionId, timeoutMs);
    if (drained) {
      unlinkTaskSessionIndexIfMatched(this.taskSessionIndex, taskId, sessionId);
    }
    return { sessionId, stopped, drained };
  }

  /** 清理已结束的会话记录（可定期调用） */
  cleanupFinished(): void {
    const removableSessionIds = collectFinishedSessionIds(this.sessions, (sessionId) => ptyManager.has(sessionId));
    for (const sessionId of removableSessionIds) {
      const meta = this.sessions.get(sessionId);
      if (!meta) continue;

      const drainPromise = this.stopTerminalTaskLogPersistence(sessionId);
      const taskId = meta.taskId;
      if (taskId && this.taskSessionIndex.get(taskId) === sessionId) {
        void drainPromise.finally(() => {
          unlinkTaskSessionIndexIfMatched(this.taskSessionIndex, taskId, sessionId);
        });
      }
      this.sessionFinishedAt.delete(sessionId);
      this.sessions.delete(sessionId);
    }
  }

  /** 获取当前活跃（running）Agent 会话数 */
  getActiveSessionCount(): number {
    this.pruneInactiveState();
    let count = 0;
    for (const meta of this.sessions.values()) {
      if (meta.status === 'running') count++;
    }
    return count;
  }

  /** 获取所有 Agent 会话摘要（Dashboard 用） */
  getSessionSummaries(): Array<{
    sessionId: string;
    agentDisplayName: string;
    status: AgentSessionStatus;
    elapsedMs: number;
    repoPath?: string;
  }> {
    this.pruneInactiveState();
    const now = Date.now();
    const result: Array<{
      sessionId: string;
      agentDisplayName: string;
      status: AgentSessionStatus;
      elapsedMs: number;
      repoPath?: string;
    }> = [];

    for (const meta of this.sessions.values()) {
      result.push({
        sessionId: meta.sessionId,
        agentDisplayName: meta.agentDisplayName,
        status: meta.status,
        elapsedMs: (meta.finishedAt ?? now) - meta.startedAt,
        repoPath: meta.repoPath,
      });
    }

    // 活跃的排前面，按启动时间降序
    result.sort((a, b) => {
      const aRunning = a.status === 'running' ? 0 : 1;
      const bRunning = b.status === 'running' ? 0 : 1;
      if (aRunning !== bRunning) return aRunning - bRunning;
      return b.elapsedMs - a.elapsedMs;
    });

    return result;
  }

  // ---- 流水线管理 ----

  /** pipelineId → TerminalPipeline */
  private pipelines: Map<string, TerminalPipeline> = new Map();

  /** 创建流水线：批量创建任务记录 + 启动第一步 */
  async createPipeline(
    opts: {
      agentDefinitionId: string;
      workDir?: string;
      repoUrl?: string;
      baseBranch?: string;
      cols: number;
      rows: number;
      steps: Array<{
        title: string;
        prompt: string;
        agentDefinitionId?: string;
        inputFiles?: string[];
        inputCondition?: string;
        parallelAgents?: Array<{ title?: string; prompt: string; agentDefinitionId?: string }>;
      }>;
      sessionPolicy?: PipelineSessionPolicy;
      preparedSessions?: PipelinePreparedSessionInput[];
      allowCreateSteps?: number[];
    },
    user: { id: string; username: string },
  ): Promise<{ pipeline: TerminalPipeline; startedSessionMetas: Array<AgentSessionMeta & { shell: string }> }> {
    if (opts.steps.length < 2) {
      throw new Error('流水线至少需要 2 个步骤');
    }

    const normalizedSteps: PipelineStep[] = opts.steps.map((step, stepIndex) => {
      const inputFiles = Array.isArray(step.inputFiles)
        ? Array.from(new Set(step.inputFiles.map((file) => file.trim()).filter(Boolean)))
        : undefined;
      const inputCondition = normalizeOptionalString(step.inputCondition) ?? undefined;
      const parallelNodes = step.parallelAgents && step.parallelAgents.length > 0
        ? step.parallelAgents
        : [{ title: step.title, prompt: step.prompt, agentDefinitionId: step.agentDefinitionId }];

      const nodes: PipelineStepNode[] = parallelNodes.map((node, nodeIndex) => {
        const nodeTitle = node.title?.trim()
          || (parallelNodes.length > 1 ? `${step.title}#${nodeIndex + 1}` : step.title);
        return {
          taskId: crypto.randomUUID(),
          title: nodeTitle,
          prompt: node.prompt,
          agentDefinitionId: node.agentDefinitionId || step.agentDefinitionId || undefined,
          status: stepIndex === 0 ? 'running' : 'draft',
        };
      });

      return {
        stepId: `step-${stepIndex + 1}`,
        title: step.title,
        prompt: step.prompt,
        agentDefinitionId: step.agentDefinitionId || undefined,
        ...(inputFiles && inputFiles.length > 0 ? { inputFiles } : {}),
        ...(inputCondition ? { inputCondition } : {}),
        nodes,
        status: stepIndex === 0 ? 'running' : 'draft',
      };
    });

    // 会话治理配置：默认严格复用已准备会话（禁止隐式新建）
    const sessionPolicy: PipelineSessionPolicy = opts.sessionPolicy ?? 'reuse-only';
    const allowCreateStepIndexes = this.normalizeAllowCreateSteps(opts.allowCreateSteps, normalizedSteps.length);
    const preparedSessions = this.normalizePreparedSessions(opts.preparedSessions);
    this.validatePipelineSessionPlan({
      steps: normalizedSteps,
      pipelineDefaultAgentId: opts.agentDefinitionId,
      sessionPolicy,
      preparedSessions,
      allowCreateStepIndexes,
    });

    // 收集所有涉及的 Agent ID（去重）
    const allAgentIds = new Set<string>();
    for (const step of normalizedSteps) {
      for (const node of step.nodes) {
        allAgentIds.add(node.agentDefinitionId || step.agentDefinitionId || opts.agentDefinitionId);
      }
    }

    // 批量查询所有 Agent 定义并缓存
    const agentCache = new Map<string, { id: string; displayName: string }>();
    for (const agentId of allAgentIds) {
      const [agent] = await db
        .select({ id: agentDefinitions.id, displayName: agentDefinitions.displayName })
        .from(agentDefinitions)
        .where(eq(agentDefinitions.id, agentId))
        .limit(1);

      if (!agent) {
        throw new Error(`Agent 定义不存在: ${agentId}`);
      }
      agentCache.set(agentId, agent);
    }

    const defaultAgent = agentCache.get(opts.agentDefinitionId)!;
    const repoPath = await this.resolveRepoPath(opts.repoUrl, opts.workDir);
    await this.assertPreparedSessionsBackedByManagedPool(user.id, repoPath, preparedSessions);
    const pipelineId = `pipeline/terminal-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    // 容量预检查：创建时至少要能启动第一步的全部并行节点，避免“部分启动”
    const firstStepNodeCount = normalizedSteps[0]?.nodes.length ?? 0;
    this.ensureSessionCapacity(user.id, firstStepNodeCount, '创建流水线');

    // 原子批量 INSERT：避免中途失败时留下“半创建流水线”任务。
    db.transaction((tx) => {
      for (let stepIndex = 0; stepIndex < normalizedSteps.length; stepIndex++) {
        const step = normalizedSteps[stepIndex];
        for (let nodeIndex = 0; nodeIndex < step.nodes.length; nodeIndex++) {
          const node = step.nodes[nodeIndex];
          const nodeAgentId = node.agentDefinitionId || step.agentDefinitionId || opts.agentDefinitionId;
          const nodeTitle = step.nodes.length > 1
            ? `[流水线 ${stepIndex + 1}/${normalizedSteps.length}] ${step.title} · 并行 ${nodeIndex + 1}/${step.nodes.length}`
            : `[流水线 ${stepIndex + 1}/${normalizedSteps.length}] ${step.title}`;
          tx.insert(tasks).values({
            id: node.taskId,
            title: nodeTitle,
            description: node.prompt,
            agentDefinitionId: nodeAgentId,
            repoUrl: opts.repoUrl || '',
            baseBranch: opts.baseBranch || '',
            workBranch: '',
            workDir: repoPath,
            status: stepIndex === 0 ? 'running' : 'draft',
            source: 'terminal',
            groupId: pipelineId,
            createdAt: now,
            startedAt: stepIndex === 0 ? now : null,
            maxRetries: 0,
          }).run();
        }
      }
    });

    // 创建流水线状态
    const pipeline: TerminalPipeline = {
      pipelineId,
      userId: user.id,
      agentDefinitionId: opts.agentDefinitionId,
      agentDisplayName: defaultAgent.displayName,
      repoUrl: opts.repoUrl,
      repoPath,
      workDir: opts.workDir,
      baseBranch: opts.baseBranch,
      cols: opts.cols,
      rows: opts.rows,
      steps: normalizedSteps,
      currentStepIndex: 0,
      status: 'running',
      sessionPolicy,
      allowCreateStepIndexes,
      preparedSessions,
    };
    this.pipelines.set(pipelineId, pipeline);
    this.pipelineFinishedAt.delete(pipelineId);

    // 启动第一步（支持步骤内并行节点）
    let startedSessionMetas: Array<AgentSessionMeta & { shell: string }> = [];
    try {
      startedSessionMetas = await this.startPipelineStepNodes(pipeline, 0, user);
    } catch (err) {
      // 创建阶段失败：清理内存态，任务状态已在 startPipelineStepNodes 内回滚
      this.cleanupPipelineHooks(pipelineId);
      this.cleanupPipelineCallbackTokens(pipelineId);
      this.pipelines.delete(pipelineId);
      this.pipelineFinishedAt.delete(pipelineId);
      throw err;
    }

    const agentNames = [...allAgentIds].map((id) => agentCache.get(id)!.displayName);
    console.log(
      `[Pipeline] 已创建流水线: ${pipelineId} (${normalizedSteps.length} 步, agents=[${agentNames.join(', ')}], sessionPolicy=${sessionPolicy}, preparedSessions=${preparedSessions.length})`
    );

    return { pipeline, startedSessionMetas };
  }

  /**
   * 推进流水线：检查当前步骤是否已完成，启动下一步
   * 返回新会话 meta（若有下一步），否则返回 null
   */
  async advancePipeline(
    pipelineId: string,
    user: { id: string; username: string },
  ): Promise<Array<AgentSessionMeta & { shell: string }> | null> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline || pipeline.status !== 'running') return null;

    const currentStep = pipeline.steps[pipeline.currentStepIndex];
    if (!currentStep || currentStep.status !== 'completed') return null;

    const nextIndex = pipeline.currentStepIndex + 1;

    // 已是最后一步 → 流水线完成
    if (nextIndex >= pipeline.steps.length) {
      pipeline.status = 'completed';
      this.pipelineFinishedAt.set(pipelineId, Date.now());
      console.log(`[Pipeline] 流水线完成: ${pipelineId}`);
      return null;
    }

    // 启动下一步（步骤内并行）
    const startedSessionMetas = await this.startPipelineStepNodes(pipeline, nextIndex, user);

    console.log(`[Pipeline] 推进到步骤 ${nextIndex + 1}/${pipeline.steps.length}: ${pipelineId}`);

    return startedSessionMetas;
  }

  /** 标记流水线当前步骤完成（由 handleAgentExit 或 hook 回调调用） */
  markPipelineStepDone(pipelineId: string, sessionId: string, success: boolean): void {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) return;

    const located = locatePipelineNodeBySessionId(pipeline.steps, sessionId);
    if (!located) return;
    const { stepIndex, nodeIndex, step, node } = located;

    // 幂等防护：防止 hook 回调和 onExit 竞争重复处理
    if (node.status === 'completed' || node.status === 'failed' || node.status === 'cancelled') return;

    // 节点失败：当前步骤失败，流水线失败
    if (!success) {
      node.status = 'failed';
      this.releasePreparedSessionLease(pipeline, node);
      cleanupPipelineHookByKey(
        this.hookCleanups,
        buildPipelineHookCleanupKey(pipelineId, stepIndex, nodeIndex),
      );
      step.status = 'failed';
      pipeline.status = 'failed';
      this.pipelineFinishedAt.set(pipelineId, Date.now());
      const now = new Date().toISOString();

      // 同步骤仍在运行的并行节点全部取消
      const cancelledRunningNodes = cancelRunningNodesInStep(step, { excludeSessionId: sessionId });
      for (const { node: runningNode } of cancelledRunningNodes) {
        this.cancelAgentSession(runningNode.sessionId!);
        this.releasePreparedSessionLease(pipeline, runningNode);
        this.persistNodeCancelledFromRunning(runningNode, now)
          .catch(() => {});
      }

      // 后续 draft 步骤全部取消
      const cancelledDraftNodes = cancelDraftNodesFromSteps(pipeline.steps, stepIndex + 1);
      for (const { node: nextNode } of cancelledDraftNodes) {
        this.releasePreparedSessionLease(pipeline, nextNode);
        this.persistNodeCancelledFromPending(nextNode, now)
          .catch(() => {});
      }

      console.log(`[Pipeline] 节点失败，流水线终止: ${pipelineId} (step=${stepIndex + 1})`);
      return;
    }
    this.completePipelineNode({
      pipeline,
      pipelineId,
      stepIndex,
      nodeIndex,
      step,
      node,
    });
  }

  /** 取消流水线 */
  cancelPipeline(pipelineId: string): void {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline || (pipeline.status !== 'running' && pipeline.status !== 'paused')) return;

    pipeline.status = 'cancelled';
    this.pipelineFinishedAt.set(pipelineId, Date.now());
    const now = new Date().toISOString();

    // 取消当前运行的 Agent 会话
    const currentStep = pipeline.steps[pipeline.currentStepIndex];
    if (currentStep && currentStep.status === 'running') {
      currentStep.status = 'cancelled';
      const cancelledRunningNodes = cancelRunningNodesInStep(currentStep);
      for (const { node } of cancelledRunningNodes) {
        this.cancelAgentSession(node.sessionId!);
        this.releasePreparedSessionLease(pipeline, node);
      }
    }

    // 将所有 draft 步骤/节点标为 cancelled
    const cancelledDraftNodes = cancelDraftNodesFromSteps(pipeline.steps, 0);
    for (const { node } of cancelledDraftNodes) {
      this.releasePreparedSessionLease(pipeline, node);
      this.persistNodeCancelledFromPending(node, now)
        .catch(() => {});
    }

    // 清理所有 hook
    this.cleanupPipelineHooks(pipelineId);

    // 清理所有关联的回调令牌
    this.cleanupPipelineCallbackTokens(pipelineId);

    console.log(`[Pipeline] 已取消流水线: ${pipelineId}`);
  }

  /**
   * 暂停流水线
   * 当前正在运行的步骤会继续执行直到完成，但完成后不会自动推进到下一步。
   */
  pausePipeline(pipelineId: string): boolean {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline || pipeline.status !== 'running') return false;

    pipeline.status = 'paused';
    console.log(`[Pipeline] 已暂停流水线: ${pipelineId} (当前步骤 ${pipeline.currentStepIndex + 1}/${pipeline.steps.length})`);
    return true;
  }

  /**
   * 恢复流水线
   * 如果当前步骤已完成，立即推进到下一步；
   * 如果当前步骤仍在运行，恢复为 running 状态（步骤完成后自动推进）。
   */
  async resumePipeline(
    pipelineId: string,
    user: { id: string; username: string },
  ): Promise<{ advanced: boolean; sessionMetas?: Array<AgentSessionMeta & { shell: string }> }> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline || pipeline.status !== 'paused') {
      return { advanced: false };
    }

    pipeline.status = 'running';
    this.pipelineFinishedAt.delete(pipelineId);

    const currentStep = pipeline.steps[pipeline.currentStepIndex];

    // 当前步骤仍在运行 → 只恢复状态，等步骤完成后自动推进
    if (currentStep && currentStep.status === 'running') {
      console.log(`[Pipeline] 已恢复流水线（当前步骤仍在运行）: ${pipelineId}`);
      return { advanced: false };
    }

    // 当前步骤已完成 → 立即推进到下一步
    if (currentStep && currentStep.status === 'completed') {
      const nextMetas = await this.advancePipeline(pipelineId, user);
      if (nextMetas && nextMetas.length > 0) {
        console.log(`[Pipeline] 已恢复并推进流水线: ${pipelineId}`);
        return { advanced: true, sessionMetas: nextMetas };
      }
      // 没有下一步 → 流水线完成
      console.log(`[Pipeline] 恢复时发现已是最后一步，流水线完成: ${pipelineId}`);
      return { advanced: false };
    }

    // 当前步骤失败 → 流水线仍为失败状态（不应该从 paused 到这里，但做防御性处理）
    console.log(`[Pipeline] 已恢复流水线（无需推进）: ${pipelineId}`);
    return { advanced: false };
  }

  /**
   * Hook 回调通知：流水线步骤已完成
   * 由 /api/terminal/step-done 端点调用，验证令牌后标记步骤完成并发射事件。
   * 返回 true 表示处理成功。
   */
  notifyStepCompleted(token: string, pipelineId: string, taskId: string): boolean {
    if (!consumePipelineCallbackToken(this.callbackTokens, token, { pipelineId, taskId })) {
      return false;
    }

    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) return false;
    if (pipeline.status !== 'running' && pipeline.status !== 'paused') return false;

    // 按 taskId 查找步骤与节点
    const located = locatePipelineNodeByTaskId(pipeline.steps, taskId);
    if (!located) return false;
    const { stepIndex, nodeIndex, step, node } = located;
    if (node.status !== 'running') return false;

    const completion = this.completePipelineNode({
      pipeline,
      pipelineId,
      stepIndex,
      nodeIndex,
      step,
      node,
    });

    // 更新 tasks 表
    db.update(tasks)
      .set({ status: 'completed', completedAt: new Date().toISOString() })
      .where(and(eq(tasks.id, node.taskId), eq(tasks.status, 'running')))
      .catch((err) => console.warn(`[Pipeline] hook 回调更新任务失败: ${(err as Error).message}`));

    // 终止 Agent PTY（交互模式下 Claude 仍在运行）
    if (node.sessionId) {
      this.terminateAgentSession(node.sessionId);
    }

    if (!completion.stepCompleted) {
      return true;
    }
    console.log(`[Pipeline] Hook 回调: 步骤 ${stepIndex + 1} 完成 (pipeline=${pipelineId})`);

    // 发射事件，WS handler 订阅后推进流水线
    const event: PipelineStepCompletedEvent = {
      pipelineId,
      taskId,
      userId: pipeline.userId,
      sessionId: node.sessionId,
    };
    this.events.emit('pipeline-step-completed', event);

    return true;
  }

  /**
   * 终止 Agent 会话（用于 hook 完成后关闭交互式 PTY）
   * 先发送 Ctrl+C，然后延迟销毁。
   */
  private terminateAgentSession(sessionId: string): void {
    const transitioned = transitionSessionToFinalStatus(
      this.sessions,
      this.sessionFinishedAt,
      sessionId,
      'completed',
      { exitCode: 0 },
    );
    if (!transitioned) return;

    // 发送 Ctrl+C 让 Claude 退出交互模式
    try {
      ptyManager.write(sessionId, '\x03');
    } catch {
      // PTY 可能已退出
    }

    // 延迟销毁 PTY
    setTimeout(() => {
      if (ptyManager.has(sessionId)) {
        ptyManager.destroy(sessionId);
      }
    }, CANCEL_TIMEOUT_MS);
  }

  /** 获取流水线状态 */
  getPipeline(pipelineId: string): TerminalPipeline | undefined {
    this.pruneInactiveState();
    return this.pipelines.get(pipelineId);
  }

  /** 获取指定用户的所有流水线 */
  listPipelinesByUser(userId: string): TerminalPipeline[] {
    this.pruneInactiveState();
    const result: TerminalPipeline[] = [];
    for (const p of this.pipelines.values()) {
      if (p.userId === userId) result.push(p);
    }
    return result;
  }

  /** 批量写入/更新用户级托管会话池 */
  async upsertManagedPipelineSessions(
    userId: string,
    sessions: Array<{
      sessionKey: string;
      repoPath: string;
      agentDefinitionId: string;
      mode: 'resume' | 'continue';
      resumeSessionId?: string;
      source?: 'external' | 'managed';
      title?: string;
    }>,
  ): Promise<ManagedPipelineSession[]> {
    const now = new Date().toISOString();
    if (sessions.length === 0) return [];
    const sessionKeys = sessions.map((item) => item.sessionKey.trim()).filter(Boolean);
    if (sessionKeys.length === 0) return [];

    const existingRows = await db
      .select()
      .from(terminalSessionPool)
      .where(
        and(
          eq(terminalSessionPool.userId, userId),
          inArray(terminalSessionPool.sessionKey, sessionKeys),
        )
      );
    const existingMap = new Map(existingRows.map((row) => [row.sessionKey, row]));

    for (const item of sessions) {
      const sessionKey = item.sessionKey.trim();
      const repoPath = item.repoPath.trim();
      const agentDefinitionId = item.agentDefinitionId.trim();
      const mode = item.mode;
      const resumeSessionId = normalizeOptionalString(item.resumeSessionId) ?? undefined;
      const title = normalizeOptionalString(item.title) ?? undefined;
      const source = item.source === 'managed' ? 'managed' : 'external';

      if (!sessionKey) {
        throw new Error('sessionKey 不能为空');
      }
      if (!repoPath) {
        throw new Error(`sessionKey=${sessionKey} 缺少 repoPath`);
      }
      if (!agentDefinitionId) {
        throw new Error(`sessionKey=${sessionKey} 缺少 agentDefinitionId`);
      }
      if (mode !== 'resume' && mode !== 'continue') {
        throw new Error(`sessionKey=${sessionKey} mode 非法`);
      }
      if (mode === 'resume' && !resumeSessionId) {
        throw new Error(`sessionKey=${sessionKey} 在 resume 模式下必须提供 resumeSessionId`);
      }

      const existing = existingMap.get(sessionKey);
      await db
        .insert(terminalSessionPool)
        .values({
          userId,
          sessionKey,
          repoPath,
          agentDefinitionId,
          mode,
          resumeSessionId: resumeSessionId ?? null,
          source,
          title: title ?? null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [terminalSessionPool.userId, terminalSessionPool.sessionKey],
          set: {
            repoPath,
            agentDefinitionId,
            mode,
            resumeSessionId: resumeSessionId ?? null,
            source,
            title: title ?? null,
            updatedAt: now,
          },
        });
    }

    const rows = await db
      .select()
      .from(terminalSessionPool)
      .where(
        and(
          eq(terminalSessionPool.userId, userId),
          inArray(terminalSessionPool.sessionKey, sessionKeys),
        )
      );

    return rows.map((row) => this.mapManagedPipelineSession(row));
  }

  /** 查询用户托管会话池（可按 repo/agent 过滤） */
  async listManagedPipelineSessions(
    userId: string,
    opts?: { repoPath?: string; agentDefinitionId?: string },
  ): Promise<Array<ManagedPipelineSession & { leased: boolean }>> {
    const where = this.buildManagedSessionPoolWhere(userId, opts);
    const rows = await db
      .select()
      .from(terminalSessionPool)
      .where(where);

    const result: Array<ManagedPipelineSession & { leased: boolean }> = [];
    for (const row of rows) {
      const mapped = this.mapManagedPipelineSession(row);
      result.push({
        ...mapped,
        leased: this.isManagedSessionLeased(userId, row.sessionKey),
      });
    }

    result.sort((a, b) => toSafeTimestamp(b.updatedAt) - toSafeTimestamp(a.updatedAt));
    return result;
  }

  /** 删除用户托管会话池中的单条会话 */
  async removeManagedPipelineSession(userId: string, sessionKey: string): Promise<boolean> {
    const normalizedKey = sessionKey.trim();
    if (!normalizedKey) return false;
    if (this.isManagedSessionLeased(userId, normalizedKey)) {
      throw new Error(`托管会话正在被运行中的流水线占用: ${normalizedKey}`);
    }
    const deleted = await db
      .delete(terminalSessionPool)
      .where(
        and(
          eq(terminalSessionPool.userId, userId),
          eq(terminalSessionPool.sessionKey, normalizedKey),
        )
      )
      .returning({ id: terminalSessionPool.id });
    return deleted.length > 0;
  }

  /** 清空用户托管会话池（可按 repo/agent 清理） */
  async clearManagedPipelineSessions(
    userId: string,
    opts?: { repoPath?: string; agentDefinitionId?: string },
  ): Promise<number> {
    const where = this.buildManagedSessionPoolWhere(userId, opts);
    const rows = await db
      .select({ sessionKey: terminalSessionPool.sessionKey })
      .from(terminalSessionPool)
      .where(where);
    const leasedKeys = rows
      .map((row) => row.sessionKey)
      .filter((sessionKey) => this.isManagedSessionLeased(userId, sessionKey));
    if (leasedKeys.length > 0) {
      throw new Error(`存在 ${leasedKeys.length} 个托管会话正在被运行中的流水线占用，无法清空`);
    }

    const deleted = await db
      .delete(terminalSessionPool)
      .where(where)
      .returning({ id: terminalSessionPool.id });
    return deleted.length;
  }

  // ---- 内部方法 ----

  private mapManagedPipelineSession(row: TerminalSessionPoolRow): ManagedPipelineSession {
    return {
      sessionKey: row.sessionKey,
      userId: row.userId,
      repoPath: row.repoPath,
      agentDefinitionId: row.agentDefinitionId,
      mode: row.mode as 'resume' | 'continue',
      resumeSessionId: row.resumeSessionId ?? undefined,
      source: row.source === 'managed' ? 'managed' : 'external',
      title: row.title ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private buildManagedSessionPoolWhere(
    userId: string,
    opts?: { repoPath?: string; agentDefinitionId?: string },
  ) {
    const conditions = [eq(terminalSessionPool.userId, userId)];
    const repoPath = normalizeOptionalString(opts?.repoPath);
    const agentDefinitionId = normalizeOptionalString(opts?.agentDefinitionId);

    if (repoPath) {
      conditions.push(eq(terminalSessionPool.repoPath, repoPath));
    }
    if (agentDefinitionId) {
      conditions.push(eq(terminalSessionPool.agentDefinitionId, agentDefinitionId));
    }
    return conditions.length === 1 ? conditions[0] : and(...conditions);
  }

  private isManagedSessionLeased(userId: string, sessionKey: string): boolean {
    for (const pipeline of this.pipelines.values()) {
      if (pipeline.userId !== userId) continue;
      if (pipeline.status !== 'running' && pipeline.status !== 'paused') continue;
      // 活跃流水线级保留：只要会话键被纳入 preparedSessions，即视为已占用
      const matched = pipeline.preparedSessions.some(
        (session) => session.sessionKey === sessionKey && session.source === 'managed',
      );
      if (matched) return true;
    }
    return false;
  }

  private isSessionGovernedAgent(agentDefinitionId: string): boolean {
    return agentDefinitionId === 'claude-code' || agentDefinitionId === 'codex';
  }

  private normalizeAllowCreateSteps(
    input: number[] | undefined,
    totalSteps: number,
  ): Set<number> {
    const normalized = new Set<number>();
    if (!Array.isArray(input)) return normalized;
    for (const stepIndex of input) {
      if (!Number.isInteger(stepIndex)) continue;
      if (stepIndex < 0 || stepIndex >= totalSteps) continue;
      normalized.add(stepIndex);
    }
    return normalized;
  }

  private normalizePreparedSessions(
    input: PipelinePreparedSessionInput[] | undefined,
  ): PipelinePreparedSession[] {
    if (!Array.isArray(input) || input.length === 0) {
      return [];
    }

    const normalized: PipelinePreparedSession[] = [];
    const seenKeys = new Set<string>();

    for (const item of input) {
      const sessionKey = item.sessionKey?.trim();
      if (!sessionKey) {
        throw new Error('preparedSessions.sessionKey 不能为空');
      }
      if (seenKeys.has(sessionKey)) {
        throw new Error(`preparedSessions.sessionKey 重复: ${sessionKey}`);
      }
      seenKeys.add(sessionKey);

      const agentDefinitionId = item.agentDefinitionId?.trim();
      if (!agentDefinitionId) {
        throw new Error(`preparedSessions[${sessionKey}] 缺少 agentDefinitionId`);
      }

      const mode = item.mode;
      if (mode !== 'resume' && mode !== 'continue') {
        throw new Error(`preparedSessions[${sessionKey}] mode 非法: ${String(mode)}`);
      }

      const resumeSessionId = normalizeOptionalString(item.resumeSessionId) ?? undefined;
      if (mode === 'resume' && !resumeSessionId) {
        throw new Error(`preparedSessions[${sessionKey}] 在 resume 模式下必须提供 resumeSessionId`);
      }
      const title = normalizeOptionalString(item.title) ?? undefined;

      normalized.push({
        sessionKey,
        agentDefinitionId,
        mode,
        ...(resumeSessionId ? { resumeSessionId } : {}),
        source: item.source === 'managed' ? 'managed' : 'external',
        ...(title ? { title } : {}),
        status: 'available',
        usageCount: 0,
      });
    }

    return normalized;
  }

  private async assertPreparedSessionsBackedByManagedPool(
    userId: string,
    repoPath: string,
    preparedSessions: PipelinePreparedSession[],
  ): Promise<void> {
    const managedSessions = preparedSessions.filter((item) => item.source === 'managed');
    if (managedSessions.length === 0) return;

    const managedKeys = managedSessions.map((item) => item.sessionKey);
    const rows = await db
      .select()
      .from(terminalSessionPool)
      .where(
        and(
          eq(terminalSessionPool.userId, userId),
          inArray(terminalSessionPool.sessionKey, managedKeys),
        )
      );
    const rowMap = new Map(rows.map((row) => [row.sessionKey, row]));

    for (const session of managedSessions) {
      const row = rowMap.get(session.sessionKey);
      if (!row) {
        throw new Error(`托管会话不存在或不属于当前用户: ${session.sessionKey}`);
      }
      if (this.isManagedSessionLeased(userId, session.sessionKey)) {
        throw new Error(`托管会话 ${session.sessionKey} 正在被其他流水线占用，请稍后重试或更换会话`);
      }
      if (row.repoPath !== repoPath) {
        throw new Error(
          `托管会话 ${session.sessionKey} 与当前流水线目录不一致（session=${row.repoPath}, pipeline=${repoPath}）`
        );
      }
      if (row.agentDefinitionId !== session.agentDefinitionId) {
        throw new Error(`托管会话 ${session.sessionKey} 的 agent 不匹配`);
      }
      if (row.mode !== session.mode) {
        throw new Error(`托管会话 ${session.sessionKey} 的 mode 不匹配`);
      }
      const rowResumeId = row.resumeSessionId ?? undefined;
      const inputResumeId = session.resumeSessionId ?? undefined;
      if (rowResumeId !== inputResumeId) {
        throw new Error(`托管会话 ${session.sessionKey} 的 resumeSessionId 不匹配`);
      }
    }
  }

  private validatePipelineSessionPlan(input: {
    steps: PipelineStep[];
    pipelineDefaultAgentId: string;
    sessionPolicy: PipelineSessionPolicy;
    preparedSessions: PipelinePreparedSession[];
    allowCreateStepIndexes: Set<number>;
  }): void {
    for (let stepIndex = 0; stepIndex < input.steps.length; stepIndex++) {
      const step = input.steps[stepIndex];
      const requiredByAgent = new Map<string, number>();

      for (const node of step.nodes) {
        const agentId = node.agentDefinitionId || step.agentDefinitionId || input.pipelineDefaultAgentId;
        if (!this.isSessionGovernedAgent(agentId)) continue;
        requiredByAgent.set(agentId, (requiredByAgent.get(agentId) ?? 0) + 1);
      }

      if (requiredByAgent.size === 0) continue;

      const allowCreateForStep = input.sessionPolicy === 'allow-create'
        || input.allowCreateStepIndexes.has(stepIndex);
      if (allowCreateForStep) continue;

      for (const [agentId, requiredCount] of requiredByAgent.entries()) {
        const preparedCount = input.preparedSessions.filter((s) => s.agentDefinitionId === agentId).length;
        if (preparedCount >= requiredCount) continue;

        throw new Error(
          `步骤 ${stepIndex + 1} (${step.title}) 需要 ${requiredCount} 个 ${agentId} 会话，但仅准备 ${preparedCount} 个。请先准备会话，或将该步骤加入允许自动新建列表。`
        );
      }
    }
  }

  private canPipelineAutoCreateSession(
    pipeline: TerminalPipeline,
    stepIndex: number,
    agentDefinitionId: string,
  ): boolean {
    // 仅治理 Claude/Codex；其他 Agent 保持原行为
    if (!this.isSessionGovernedAgent(agentDefinitionId)) {
      return true;
    }
    return pipeline.sessionPolicy === 'allow-create' || pipeline.allowCreateStepIndexes.has(stepIndex);
  }

  private acquirePipelineNodeSessionPlan(input: {
    pipeline: TerminalPipeline;
    stepIndex: number;
    node: PipelineStepNode;
    nodeAgentId: string;
  }): {
    source: 'reused' | 'created';
    mode: 'create' | 'resume' | 'continue';
    resumeSessionId?: string;
    preparedSessionKey?: string;
  } {
    const { pipeline, stepIndex, node, nodeAgentId } = input;

    if (this.isSessionGovernedAgent(nodeAgentId)) {
      const candidates = pipeline.preparedSessions
        .filter((session) => session.agentDefinitionId === nodeAgentId && session.status === 'available')
        .sort((a, b) => {
          if (a.usageCount !== b.usageCount) return a.usageCount - b.usageCount;
          return a.sessionKey.localeCompare(b.sessionKey);
        });

      const selected = candidates[0];
      if (selected) {
        selected.status = 'leased';
        selected.usageCount += 1;
        selected.leasedByTaskId = node.taskId;
        selected.leasedByStepIndex = stepIndex;
        selected.leasedByRuntimeSessionId = undefined;

        return {
          source: 'reused',
          mode: selected.mode,
          resumeSessionId: selected.resumeSessionId,
          preparedSessionKey: selected.sessionKey,
        };
      }
    }

    if (this.canPipelineAutoCreateSession(pipeline, stepIndex, nodeAgentId)) {
      return { source: 'created', mode: 'create' };
    }

    throw new Error(
      `步骤 ${stepIndex + 1} 节点 "${node.title}" 缺少可复用会话（agent=${nodeAgentId}）。请先准备会话，或允许该步骤自动新建。`
    );
  }

  private bindPreparedSessionRuntimeSession(
    pipeline: TerminalPipeline,
    preparedSessionKey: string,
    runtimeSessionId: string,
  ): void {
    const prepared = pipeline.preparedSessions.find((session) => session.sessionKey === preparedSessionKey);
    if (!prepared || prepared.status !== 'leased') return;
    prepared.leasedByRuntimeSessionId = runtimeSessionId;
  }

  private releasePreparedSessionLease(
    pipeline: TerminalPipeline,
    node: Pick<PipelineStepNode, 'taskId' | 'sessionId' | 'preparedSessionKey'>,
  ): void {
    const preparedSessionKey = node.preparedSessionKey;
    if (!preparedSessionKey) return;

    const prepared = pipeline.preparedSessions.find((session) => session.sessionKey === preparedSessionKey);
    if (!prepared) {
      node.preparedSessionKey = undefined;
      return;
    }

    const matchByTask = prepared.leasedByTaskId === node.taskId;
    const matchByRuntimeSession = !node.sessionId || prepared.leasedByRuntimeSessionId === node.sessionId;
    if (prepared.status !== 'leased' || (!matchByTask && !matchByRuntimeSession)) {
      return;
    }

    prepared.status = 'available';
    prepared.leasedByTaskId = undefined;
    prepared.leasedByStepIndex = undefined;
    prepared.leasedByRuntimeSessionId = undefined;
    node.preparedSessionKey = undefined;
  }

  private persistNodeCancelledFromRunning(
    node: Pick<PipelineStepNode, 'taskId'>,
    completedAt: string,
  ): Promise<unknown> {
    return updateTerminalTaskStatusByExpected({
      taskId: node.taskId,
      status: 'cancelled',
      completedAt,
      expectedStatus: 'running',
    });
  }

  private persistNodeCancelledFromPending(
    node: Pick<PipelineStepNode, 'taskId'>,
    completedAt: string,
  ): Promise<unknown> {
    return updateTerminalTaskStatusByAllowed({
      taskId: node.taskId,
      status: 'cancelled',
      completedAt,
      allowedStatuses: TERMINAL_PENDING_TASK_ALLOWED_STATUSES,
    });
  }

  private persistNodeCancelledFromActive(
    node: Pick<PipelineStepNode, 'taskId'>,
    completedAt: string,
  ): Promise<unknown> {
    return updateTerminalTaskStatusByAllowed({
      taskId: node.taskId,
      status: 'cancelled',
      completedAt,
      allowedStatuses: TERMINAL_ACTIVE_TASK_ALLOWED_STATUSES,
    });
  }

  private persistNodeFailedFromActive(
    node: Pick<PipelineStepNode, 'taskId'>,
    completedAt: string,
  ): Promise<unknown> {
    return updateTerminalTaskStatusByAllowed({
      taskId: node.taskId,
      status: 'failed',
      completedAt,
      allowedStatuses: TERMINAL_ACTIVE_TASK_ALLOWED_STATUSES,
    });
  }

  private completePipelineNode(input: {
    pipeline: TerminalPipeline;
    pipelineId: string;
    stepIndex: number;
    nodeIndex: number;
    step: PipelineStep;
    node: PipelineStepNode;
  }): { stepCompleted: boolean } {
    input.node.status = 'completed';
    this.releasePreparedSessionLease(input.pipeline, input.node);
    cleanupPipelineHookByKey(
      this.hookCleanups,
      buildPipelineHookCleanupKey(input.pipelineId, input.stepIndex, input.nodeIndex),
    );

    const stepCompleted = input.step.nodes.every((node) => node.status === 'completed');
    input.step.status = stepCompleted ? 'completed' : 'running';
    return { stepCompleted };
  }

  private pruneInactiveState(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastStatePruneAtMs < STATE_PRUNE_INTERVAL_MS) {
      return;
    }
    this.lastStatePruneAtMs = now;

    // 先做一次即时清理：结束且 PTY 已退出的会话可以立即移除
    this.cleanupFinished();

    const sessionActions = collectExpiredSessionActions({
      sessions: this.sessions,
      sessionFinishedAt: this.sessionFinishedAt,
      now,
      ttlMs: FINISHED_SESSION_TTL_MS,
      hasPtySession: (sessionId) => ptyManager.has(sessionId),
      hasPendingLogFlush: (sessionId) =>
        this.terminalLogPersisters.has(sessionId) || this.terminalLogDrainPromises.has(sessionId),
    });

    for (const sessionId of sessionActions.clearFinishedAtSessionIds) {
      this.sessionFinishedAt.delete(sessionId);
    }
    for (const sessionId of sessionActions.deleteSessionIds) {
      const meta = this.sessions.get(sessionId);
      if (!meta) {
        this.sessionFinishedAt.delete(sessionId);
        continue;
      }
      if (meta.taskId) {
        unlinkTaskSessionIndexIfMatched(this.taskSessionIndex, meta.taskId, sessionId);
      }
      this.sessions.delete(sessionId);
      this.sessionFinishedAt.delete(sessionId);
    }

    const pipelineActions = collectExpiredPipelineActions({
      pipelines: this.pipelines,
      pipelineFinishedAt: this.pipelineFinishedAt,
      now,
      ttlMs: FINISHED_PIPELINE_TTL_MS,
      hasPtySession: (sessionId) => ptyManager.has(sessionId),
    });

    for (const pipelineId of pipelineActions.clearFinishedAtPipelineIds) {
      this.pipelineFinishedAt.delete(pipelineId);
    }
    for (const pipelineId of pipelineActions.deletePipelineIds) {
      this.cleanupPipelineHooks(pipelineId);
      this.cleanupPipelineCallbackTokens(pipelineId);
      this.pipelines.delete(pipelineId);
      this.pipelineFinishedAt.delete(pipelineId);
    }
  }

  private ensureSessionCapacity(userId: string, requestedCount: number, context: string): void {
    if (requestedCount <= 0) return;
    const currentCount = ptyManager.listByUser(userId).length;
    const available = Math.max(0, MAX_SESSIONS_PER_USER - currentCount);
    if (requestedCount > available) {
      throw new Error(
        `${context} 失败：需要 ${requestedCount} 个并行会话，但当前仅剩 ${available} 个可用（单用户上限 ${MAX_SESSIONS_PER_USER}）`
      );
    }
  }

  private async rollbackPipelineStepStartFailure(
    pipeline: TerminalPipeline,
    stepIndex: number,
    startedMetas: Array<AgentSessionMeta & { shell: string }>,
    err: Error,
  ): Promise<void> {
    const step = pipeline.steps[stepIndex];
    if (!step) return;

    const now = new Date().toISOString();
    const startedSessionIds = new Set(startedMetas.map((meta) => meta.sessionId));
    const updatePromises: Array<Promise<unknown>> = [];

    pipeline.status = 'failed';
    this.pipelineFinishedAt.set(pipeline.pipelineId, Date.now());
    step.status = 'failed';

    for (const node of step.nodes) {
      if (node.sessionId && startedSessionIds.has(node.sessionId)) {
        this.cancelAgentSession(node.sessionId);
        node.status = 'cancelled';
        this.releasePreparedSessionLease(pipeline, node);
        updatePromises.push(this.persistNodeCancelledFromRunning(node, now));
        continue;
      }

      if (node.status === 'running' || node.status === 'draft') {
        node.status = 'failed';
        this.releasePreparedSessionLease(pipeline, node);
        updatePromises.push(this.persistNodeFailedFromActive(node, now));
      }
    }

    const cancelledFutureNodes = cancelActiveNodesFromSteps(pipeline.steps, stepIndex + 1);
    for (const { node } of cancelledFutureNodes) {
      this.releasePreparedSessionLease(pipeline, node);
      updatePromises.push(this.persistNodeCancelledFromActive(node, now));
    }

    await Promise.allSettled(updatePromises);
    this.cleanupPipelineHooks(pipeline.pipelineId);
    this.cleanupPipelineCallbackTokens(pipeline.pipelineId);
    console.warn(
      `[Pipeline] 步骤启动失败，已回滚: ${pipeline.pipelineId} (step=${stepIndex + 1}, error=${err.message})`
    );
  }

  /** 启动指定步骤的所有并行节点 */
  private async startPipelineStepNodes(
    pipeline: TerminalPipeline,
    stepIndex: number,
    user: { id: string; username: string },
  ): Promise<Array<AgentSessionMeta & { shell: string }>> {
    const step = pipeline.steps[stepIndex];
    if (!step) return [];

    pipeline.currentStepIndex = stepIndex;
    step.status = 'running';

    const { stepDir, previousStepDir: prevStepDir } = resolvePipelineStepWorkspaceDirs({
      repoPath: pipeline.repoPath,
      stepIndex,
    });

    try {
      await initializePipelineStepWorkspace({
        repoPath: pipeline.repoPath,
        pipelineId: pipeline.pipelineId,
        stepIndex,
        stepTitle: step.title,
        stepPrompt: step.prompt,
        inputFiles: step.inputFiles ?? [],
        inputCondition: step.inputCondition ?? null,
        stepDir,
        previousStepDir: prevStepDir,
      });
    } catch (err) {
      console.warn(`[Pipeline] 初始化步骤目录失败(step=${stepIndex + 1}): ${(err as Error).message}`);
    }

    const started: Array<AgentSessionMeta & { shell: string }> = [];
    try {
      // 启动前容量检查：步骤内并行节点必须可一次性启动
      this.ensureSessionCapacity(user.id, step.nodes.length, `启动流水线步骤 ${stepIndex + 1}`);

      for (let nodeIndex = 0; nodeIndex < step.nodes.length; nodeIndex++) {
        const node = step.nodes[nodeIndex];
        const nodeAgentId = node.agentDefinitionId || step.agentDefinitionId || pipeline.agentDefinitionId;
        const sessionPlan = this.acquirePipelineNodeSessionPlan({
          pipeline,
          stepIndex,
          node,
          nodeAgentId,
        });
        node.sessionSource = sessionPlan.source;
        node.preparedSessionKey = sessionPlan.preparedSessionKey;

        const renderedPrompt = buildPipelineNodePromptText({
          nodePrompt: node.prompt,
          pipelineId: pipeline.pipelineId,
          stepIndex,
          stepCount: pipeline.steps.length,
          stepTitle: step.title,
          stepPrompt: step.prompt,
          stepInputCondition: step.inputCondition ?? null,
          stepInputFiles: step.inputFiles ?? [],
          nodeIndex,
          nodeCount: step.nodes.length,
          nodeTitle: node.title,
          repoPath: pipeline.repoPath,
          stepDir,
          previousStepDir: prevStepDir,
        });

        // Claude Code：注入 Stop hook，使用交互模式；其他 Agent：使用 autoExit
        const nodeHooked = await this.injectStepHook(
          nodeAgentId,
          pipeline.repoPath,
          pipeline.pipelineId,
          node.taskId,
          stepIndex,
          nodeIndex,
        );

        const sessionMeta = await this.createAgentSession(
          {
            agentDefinitionId: nodeAgentId,
            prompt: renderedPrompt,
            repoUrl: pipeline.repoUrl,
            baseBranch: pipeline.baseBranch,
            workDir: pipeline.workDir || pipeline.repoPath,
            cols: pipeline.cols,
            rows: pipeline.rows,
            autoExit: !nodeHooked,
            mode: sessionPlan.mode,
            resumeSessionId: sessionPlan.resumeSessionId,
            _pipelineTaskId: node.taskId,
            _pipelineId: pipeline.pipelineId,
          },
          user,
        );

        node.sessionId = sessionMeta.sessionId;
        node.status = 'running';
        if (sessionPlan.preparedSessionKey) {
          this.bindPreparedSessionRuntimeSession(
            pipeline,
            sessionPlan.preparedSessionKey,
            sessionMeta.sessionId,
          );
        }
        started.push(sessionMeta);

        try {
          await writePipelineNodeTaskPromptFile({
            stepDir,
            nodeIndex,
            prompt: renderedPrompt,
          });
        } catch (err) {
          console.warn(`[Pipeline] 写入并行节点任务文件失败(step=${stepIndex + 1}, node=${nodeIndex + 1}): ${(err as Error).message}`);
        }
      }
    } catch (err) {
      await this.rollbackPipelineStepStartFailure(pipeline, stepIndex, started, err as Error);
      throw err;
    }

    return started;
  }

  /**
   * 启动 terminal 任务日志持久化：
   * - 使用 pty data tap 捕获输出（与 WebSocket attach/detach 解耦）
   * - 按行缓冲并定时批量落库，避免逐字符写 DB
   */
  private startTerminalTaskLogPersistence(sessionId: string, taskId: string): void {
    // 幂等防护：重复启动时先清理旧状态
    void this.stopTerminalTaskLogPersistence(sessionId);
    this.terminalLogDrainPromises.delete(sessionId);

    const timer = setInterval(() => {
      void this.flushTerminalTaskLogs(sessionId);
    }, TERMINAL_LOG_FLUSH_INTERVAL_MS);

    const state: TerminalLogPersistState = {
      taskId,
      tapId: '',
      timer,
      pendingLines: [],
      partialLine: '',
      droppedLines: 0,
      flushInFlight: false,
    };
    this.terminalLogPersisters.set(sessionId, state);

    const tapId = ptyManager.addDataTap(sessionId, (chunk) => {
      this.enqueueTerminalTaskLogChunk(sessionId, chunk);
    });

    if (!tapId) {
      clearInterval(timer);
      this.terminalLogPersisters.delete(sessionId);
      console.warn(`[AgentSession] 无法为会话绑定日志持久化: ${sessionId}`);
      return;
    }

    state.tapId = tapId;
  }

  /** 写入 PTY chunk 到行缓冲，处理分片行与 CRLF */
  private enqueueTerminalTaskLogChunk(sessionId: string, chunk: string): void {
    const state = this.terminalLogPersisters.get(sessionId);
    if (!state) return;

    const splitResult = splitTerminalLogChunk(state.partialLine, chunk);
    state.partialLine = splitResult.nextPartialLine;

    for (const line of splitResult.lines) {
      this.enqueueTerminalTaskLogLine(state, line);
    }
  }

  /** 停止并清理 terminal 日志持久化，退出时强制 flush 一次 */
  private stopTerminalTaskLogPersistence(sessionId: string): Promise<void> {
    const existingDrainPromise = this.terminalLogDrainPromises.get(sessionId);
    const state = this.terminalLogPersisters.get(sessionId);
    if (!state) {
      return existingDrainPromise ?? Promise.resolve();
    }

    clearInterval(state.timer);
    ptyManager.removeDataTap(sessionId, state.tapId);
    this.terminalLogPersisters.delete(sessionId);

    const drainPromise = (async () => {
      while (state.flushInFlight) {
        await sleep(50);
      }
      await this.flushTerminalTaskLogsForState(state, true);
    })().finally(() => {
      if (this.terminalLogDrainPromises.get(sessionId) === drainPromise) {
        this.terminalLogDrainPromises.delete(sessionId);
      }
    });

    this.terminalLogDrainPromises.set(sessionId, drainPromise);
    return drainPromise;
  }

  /** 等待指定会话的 terminal 日志持久化收尾（超时返回 false） */
  private async waitForTerminalLogDrain(sessionId: string, timeoutMs: number): Promise<boolean> {
    const drainPromise = this.stopTerminalTaskLogPersistence(sessionId);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const result = await Promise.race([drainPromise.then(() => 'drained' as const), timeoutPromise]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    return result === 'drained';
  }

  /** 等待 PTY 会话退出（超时返回 false） */
  private async waitForSessionExit(sessionId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!ptyManager.has(sessionId)) {
        return true;
      }
      await sleep(50);
    }
    return !ptyManager.has(sessionId);
  }

  private enqueueTerminalTaskLogLine(state: TerminalLogPersistState, line: string): void {
    const next = appendTerminalLogLine({
      pendingLines: state.pendingLines,
      droppedLines: state.droppedLines,
      line,
      maxLineLength: TERMINAL_LOG_MAX_LINE_LENGTH,
      maxPendingLines: TERMINAL_LOG_MAX_PENDING_LINES,
    });
    state.pendingLines = next.pendingLines;
    state.droppedLines = next.droppedLines;
  }

  private async flushTerminalTaskLogs(sessionId: string, force = false): Promise<void> {
    const state = this.terminalLogPersisters.get(sessionId);
    if (!state) return;
    await this.flushTerminalTaskLogsForState(state, force);
  }

  private async flushTerminalTaskLogsForState(state: TerminalLogPersistState, force: boolean): Promise<void> {
    if (state.flushInFlight) return;

    if (force && state.partialLine) {
      this.enqueueTerminalTaskLogLine(state, state.partialLine);
      state.partialLine = '';
    }

    if (state.pendingLines.length === 0) {
      if (state.droppedLines > 0) {
        console.warn(
          `[AgentSession] 警告: terminal 日志队列达到上限，已丢弃 ${state.droppedLines} 行旧日志(task=${state.taskId.slice(0, 8)})`
        );
        state.droppedLines = 0;
      }
      return;
    }

    state.flushInFlight = true;
    try {
      // 任务可能在日志落库前被删除，先做存在性校验避免 FK 冲突重试风暴
      const taskExists = await this.taskExists(state.taskId);
      if (!taskExists) {
        state.pendingLines = [];
        state.partialLine = '';
        state.droppedLines = 0;
        return;
      }

      while (state.pendingLines.length > 0) {
        const batchSize = Math.min(TERMINAL_LOG_BATCH_SIZE, state.pendingLines.length);
        const batch = state.pendingLines.slice(0, batchSize);
        const createdAt = new Date().toISOString();
        await db.insert(taskLogs).values(
          batch.map((line) => ({
            taskId: state.taskId,
            line,
            createdAt,
          }))
        );
        state.pendingLines = state.pendingLines.slice(batchSize);
        if (!force) break;
      }

      if (state.droppedLines > 0) {
        console.warn(
          `[AgentSession] 警告: terminal 日志队列达到上限，已丢弃 ${state.droppedLines} 行旧日志(task=${state.taskId.slice(0, 8)})`
        );
        state.droppedLines = 0;
      }
    } catch (err) {
      if (isSqliteForeignKeyConstraintError(err)) {
        // 任务已被删除或正在删除，清空缓冲避免后续重复报错
        state.pendingLines = [];
        state.partialLine = '';
        state.droppedLines = 0;
        return;
      }
      console.warn(`[AgentSession] terminal 日志持久化失败: ${(err as Error).message}`);
    } finally {
      state.flushInFlight = false;
    }
  }

  /**
   * 为流水线步骤注入完成检测 hook
   * 返回 true 表示注入成功（使用交互模式），false 表示回退到 autoExit
   */
  private async injectStepHook(
    agentDefinitionId: string,
    repoPath: string,
    pipelineId: string,
    taskId: string,
    stepIndex: number,
    nodeIndex: number,
  ): Promise<boolean> {
    const callbackToken = crypto.randomUUID();
    const serverPort = parseInt(process.env.PORT || '3000', 10);

    try {
      const result = await injectCompletionHook({
        agentDefinitionId,
        repoPath,
        serverPort,
        callbackToken,
        pipelineId,
        taskId,
      });

      if (result.hooked) {
        // 注册回调令牌
        this.callbackTokens.set(callbackToken, { pipelineId, taskId });
        // 保存清理函数
        this.hookCleanups.set(
          buildPipelineHookCleanupKey(pipelineId, stepIndex, nodeIndex),
          result.cleanup,
        );
        console.log(`[Pipeline] 已注入 hook: 步骤 ${stepIndex + 1} / 节点 ${nodeIndex + 1} (agent=${agentDefinitionId})`);
        return true;
      }
    } catch (err) {
      console.warn(`[Pipeline] Hook 注入失败，回退到 autoExit: ${(err as Error).message}`);
    }

    return false;
  }

  /** 批量清理流水线所有步骤/节点 hook */
  private cleanupPipelineHooks(pipelineId: string): void {
    cleanupPipelineHooksById(this.hookCleanups, pipelineId);
  }

  /** 清理流水线关联的 hook 回调令牌 */
  private cleanupPipelineCallbackTokens(pipelineId: string): void {
    cleanupPipelineCallbackTokensById(this.callbackTokens, pipelineId);
  }

  /** 检查任务是否仍存在（日志写入前防 FK 竞态） */
  private async taskExists(taskId: string): Promise<boolean> {
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    return Boolean(task);
  }

  /** 解析仓库本地路径 */
  private async resolveRepoPath(repoUrl?: string, workDir?: string): Promise<string> {
    // 用户直接指定了工作目录
    if (workDir) return normalizeHostPathInput(workDir);

    // 通过 repoUrl 查找仓库的 defaultWorkDir
    if (repoUrl) {
      const [repo] = await db
        .select()
        .from(repositories)
        .where(eq(repositories.repoUrl, repoUrl))
        .limit(1);

      if (repo?.defaultWorkDir) return normalizeHostPathInput(repo.defaultWorkDir);
    }

    // 使用环境变量 CAM_REPOS_DIR 约定目录
    const reposDir = process.env.CAM_REPOS_DIR;
    if (reposDir && repoUrl) {
      // 从 repoUrl 提取仓库名
      const repoName = repoUrl.split('/').pop()?.replace(/\.git$/, '') || 'workspace';
      return normalizeHostPathInput(`${reposDir}/${repoName}`);
    }

    // 兜底：当前工作目录
    return process.env.HOME || process.env.USERPROFILE || process.cwd();
  }

  /** 采集 git 信息（分支名 + 最新 commit） */
  private async collectGitInfo(repoPath: string): Promise<{ branch: string; lastCommit: string }> {
    try {
      const [branchResult, commitResult] = await Promise.all([
        execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath }),
        execFileAsync('git', ['log', '-1', '--format=%h %s'], { cwd: repoPath }),
      ]);
      return {
        branch: branchResult.stdout.trim(),
        lastCommit: commitResult.stdout.trim(),
      };
    } catch {
      return { branch: '', lastCommit: '' };
    }
  }

  /** 解析 Agent 所需环境变量（密钥注入） */
  private async resolveAgentEnv(
    agent: { id: string; requiredEnvVars: Array<{ name: string; required: boolean }> },
    repoUrl?: string,
  ): Promise<Record<string, string>> {
    const env: Record<string, string> = {};

    const scope: SecretScope = {
      agentDefinitionId: agent.id,
      repoUrl: repoUrl ?? null,
    };

    for (const envVar of agent.requiredEnvVars) {
      const value = await resolveEnvVarValue(envVar.name, scope);
      if (value) {
        env[envVar.name] = value;
      }
    }

    return env;
  }
}

// 全局单例
export const agentSessionManager = new AgentSessionManager();
