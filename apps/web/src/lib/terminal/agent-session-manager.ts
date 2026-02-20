// ============================================================
// Agent 会话管理器（核心编排）
// 职责：查 Agent 定义 → 解密密钥 → 构造命令 → 创建 PTY → 状态跟踪
// 支持 Hook 驱动的流水线步骤完成检测（Claude Code Stop hook）
// ============================================================

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentDefinitions, repositories, tasks } from '@/lib/db/schema';
import { resolveEnvVarValue, type SecretScope } from '@/lib/secrets/resolve';
import { sseManager } from '@/lib/sse/manager';
import { ptyManager } from './pty-manager';
import { resolveAgentCommand, generateWorkBranch } from './agent-command';
import { injectCompletionHook } from './hook-injector';
import type { AgentSessionInfo, AgentSessionStatus } from './protocol';

const execFileAsync = promisify(execFile);

// Agent 会话空闲超时：4 小时
const AGENT_IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000;
// 取消等待超时：3 秒
const CANCEL_TIMEOUT_MS = 3000;

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
interface PipelineStep {
  taskId: string;
  title: string;
  prompt: string;
  /** 该步骤使用的 Agent（可覆盖流水线默认值） */
  agentDefinitionId?: string;
  sessionId?: string;
  status: 'draft' | 'running' | 'completed' | 'failed' | 'cancelled';
}

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
}

/** 步骤完成事件载荷 */
export interface PipelineStepCompletedEvent {
  pipelineId: string;
  taskId: string;
  userId: string;
  sessionId?: string;
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
      meta.taskId = opts._pipelineTaskId;
      meta.pipelineId = opts._pipelineId;
      // 更新任务状态为 running + startedAt
      const now = new Date().toISOString();
      db.update(tasks)
        .set({ status: 'running', startedAt: now })
        .where(eq(tasks.id, opts._pipelineTaskId))
        .catch((err) => console.warn(`[AgentSession] 流水线任务状态更新失败: ${(err as Error).message}`));
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
        console.log(`[AgentSession] 已创建任务记录: ${taskId.slice(0, 8)}`);
      } catch (err) {
        console.warn(`[AgentSession] 任务记录创建失败，不影响会话运行: ${(err as Error).message}`);
      }
    }

    return { ...meta, sessionId, shell };
  }

  /** 处理 Agent PTY 退出 */
  handleAgentExit(sessionId: string, exitCode: number): void {
    const meta = this.sessions.get(sessionId);
    if (!meta || meta.status !== 'running') return;

    const newStatus: AgentSessionStatus = exitCode === 0 ? 'completed' : 'failed';
    const elapsedMs = Date.now() - meta.startedAt;

    // 更新 tasks 表状态（异步，不阻塞）
    if (meta.taskId) {
      db.update(tasks)
        .set({ status: newStatus, completedAt: new Date().toISOString() })
        .where(eq(tasks.id, meta.taskId))
        .catch((err) => console.warn(`[AgentSession] 任务状态更新失败: ${(err as Error).message}`));
    }

    // 更新流水线步骤状态
    if (meta.pipelineId) {
      this.markPipelineStepDone(meta.pipelineId, sessionId, exitCode === 0);
    }

    // 尝试获取当前分支名和最新 commit（异步，不阻塞状态更新）
    this.collectGitInfo(meta.repoPath).then((gitInfo) => {
      const updatedMeta: AgentSessionMeta = {
        ...meta,
        status: newStatus,
        exitCode,
      };
      this.sessions.set(sessionId, updatedMeta);

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
      // git 信息采集失败，仍然正常更新状态
      const updatedMeta: AgentSessionMeta = {
        ...meta,
        status: newStatus,
        exitCode,
      };
      this.sessions.set(sessionId, updatedMeta);

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

    // 发送 Ctrl+C
    ptyManager.write(sessionId, '\x03');

    // 更新状态
    const updatedMeta: AgentSessionMeta = { ...meta, status: 'cancelled' };
    this.sessions.set(sessionId, updatedMeta);

    // 更新 tasks 表状态
    if (meta.taskId) {
      db.update(tasks)
        .set({ status: 'cancelled', completedAt: new Date().toISOString() })
        .where(eq(tasks.id, meta.taskId))
        .catch((err) => console.warn(`[AgentSession] 任务状态更新失败: ${(err as Error).message}`));
    }

    // 3 秒后如果 PTY 仍在运行则强制销毁
    setTimeout(() => {
      if (ptyManager.has(sessionId)) {
        console.log(`[AgentSession] 强制销毁: ${sessionId}`);
        ptyManager.destroy(sessionId);
      }
    }, CANCEL_TIMEOUT_MS);

    const elapsedMs = Date.now() - meta.startedAt;
    console.log(`[AgentSession] 已取消: ${sessionId}`);

    sseManager.broadcast('agent.session.cancelled', {
      sessionId,
      agentDefinitionId: meta.agentDefinitionId,
      status: 'cancelled',
      elapsedMs,
    });
  }

  /** 获取指定用户的所有 Agent 会话 */
  listByUser(userId: string): AgentSessionInfo[] {
    const now = Date.now();
    const result: AgentSessionInfo[] = [];

    for (const meta of this.sessions.values()) {
      if (meta.userId !== userId) continue;

      // 获取 PTY 会话信息补充 SessionInfo 字段
      const ptySession = ptyManager.listByUser(userId).find((s) => s.sessionId === meta.sessionId);

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
        elapsedMs: now - meta.startedAt,
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

  /** 清理已结束的会话记录（可定期调用） */
  cleanupFinished(): void {
    for (const [id, meta] of this.sessions) {
      if (meta.status !== 'running' && !ptyManager.has(id)) {
        this.sessions.delete(id);
      }
    }
  }

  /** 获取当前活跃（running）Agent 会话数 */
  getActiveSessionCount(): number {
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
        elapsedMs: now - meta.startedAt,
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
      steps: Array<{ title: string; prompt: string; agentDefinitionId?: string }>;
    },
    user: { id: string; username: string },
  ): Promise<{ pipeline: TerminalPipeline; firstSessionMeta: AgentSessionMeta & { shell: string } }> {
    if (opts.steps.length < 2) {
      throw new Error('流水线至少需要 2 个步骤');
    }

    // 收集所有涉及的 Agent ID（去重）
    const allAgentIds = new Set<string>();
    for (const step of opts.steps) {
      allAgentIds.add(step.agentDefinitionId || opts.agentDefinitionId);
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
    const pipelineId = `pipeline/terminal-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    // 为所有步骤创建任务记录
    const steps: PipelineStep[] = opts.steps.map((s, i) => ({
      taskId: crypto.randomUUID(),
      title: s.title,
      prompt: s.prompt,
      agentDefinitionId: s.agentDefinitionId || undefined,
      status: i === 0 ? 'running' as const : 'draft' as const,
    }));

    // 批量 INSERT 任务
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepAgentId = step.agentDefinitionId || opts.agentDefinitionId;
      await db.insert(tasks).values({
        id: step.taskId,
        title: `[流水线 ${i + 1}/${steps.length}] ${step.title}`,
        description: step.prompt,
        agentDefinitionId: stepAgentId,
        repoUrl: opts.repoUrl || '',
        baseBranch: opts.baseBranch || '',
        workBranch: '',
        workDir: repoPath,
        status: i === 0 ? 'running' : 'draft',
        source: 'terminal',
        groupId: pipelineId,
        createdAt: now,
        startedAt: i === 0 ? now : null,
        maxRetries: 0,
      });
    }

    // 第一步使用的 Agent
    const firstStepAgentId = steps[0].agentDefinitionId || opts.agentDefinitionId;

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
      steps,
      currentStepIndex: 0,
      status: 'running',
    };
    this.pipelines.set(pipelineId, pipeline);

    // 启动第一步（跳过任务自动创建）
    // Claude Code：注入 Stop hook，使用交互模式；其他 Agent：使用 autoExit
    const firstStepHooked = await this.injectStepHook(
      firstStepAgentId, repoPath, pipelineId, steps[0].taskId, 0,
    );

    const firstSessionMeta = await this.createAgentSession(
      {
        agentDefinitionId: firstStepAgentId,
        prompt: steps[0].prompt,
        repoUrl: opts.repoUrl,
        baseBranch: opts.baseBranch,
        workDir: opts.workDir,
        cols: opts.cols,
        rows: opts.rows,
        autoExit: !firstStepHooked,
        _pipelineTaskId: steps[0].taskId,
        _pipelineId: pipelineId,
      },
      user,
    );

    steps[0].sessionId = firstSessionMeta.sessionId;

    const agentNames = [...allAgentIds].map((id) => agentCache.get(id)!.displayName);
    console.log(`[Pipeline] 已创建流水线: ${pipelineId} (${steps.length} 步, agents=[${agentNames.join(', ')}])`);

    return { pipeline, firstSessionMeta };
  }

  /**
   * 推进流水线：检查当前步骤是否已完成，启动下一步
   * 返回新会话 meta（若有下一步），否则返回 null
   */
  async advancePipeline(
    pipelineId: string,
    user: { id: string; username: string },
  ): Promise<(AgentSessionMeta & { shell: string }) | null> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline || pipeline.status !== 'running') return null;

    const currentStep = pipeline.steps[pipeline.currentStepIndex];
    if (!currentStep || currentStep.status !== 'completed') return null;

    const nextIndex = pipeline.currentStepIndex + 1;

    // 已是最后一步 → 流水线完成
    if (nextIndex >= pipeline.steps.length) {
      pipeline.status = 'completed';
      console.log(`[Pipeline] 流水线完成: ${pipelineId}`);
      return null;
    }

    // 启动下一步（使用步骤级 Agent 或流水线默认 Agent）
    const nextStep = pipeline.steps[nextIndex];
    pipeline.currentStepIndex = nextIndex;
    nextStep.status = 'running';

    const nextAgentId = nextStep.agentDefinitionId || pipeline.agentDefinitionId;

    // 注入 hook（Claude Code 使用交互模式，其他 Agent 使用 autoExit）
    const nextStepHooked = await this.injectStepHook(
      nextAgentId, pipeline.repoPath, pipelineId, nextStep.taskId, nextIndex,
    );

    const sessionMeta = await this.createAgentSession(
      {
        agentDefinitionId: nextAgentId,
        prompt: nextStep.prompt,
        repoUrl: pipeline.repoUrl,
        baseBranch: pipeline.baseBranch,
        workDir: pipeline.workDir || pipeline.repoPath,
        cols: pipeline.cols,
        rows: pipeline.rows,
        autoExit: !nextStepHooked,
        _pipelineTaskId: nextStep.taskId,
        _pipelineId: pipelineId,
      },
      user,
    );

    nextStep.sessionId = sessionMeta.sessionId;

    console.log(`[Pipeline] 推进到步骤 ${nextIndex + 1}/${pipeline.steps.length}: ${pipelineId}`);

    return sessionMeta;
  }

  /** 标记流水线当前步骤完成（由 handleAgentExit 或 hook 回调调用） */
  markPipelineStepDone(pipelineId: string, sessionId: string, success: boolean): void {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) return;

    const step = pipeline.steps.find((s) => s.sessionId === sessionId);
    if (!step) return;

    // 幂等防护：防止 hook 回调和 onExit 竞争重复处理
    if (step.status === 'completed' || step.status === 'failed' || step.status === 'cancelled') return;

    step.status = success ? 'completed' : 'failed';

    // 清理该步骤的 hook
    const cleanupKey = `${pipelineId}:${pipeline.steps.indexOf(step)}`;
    const cleanup = this.hookCleanups.get(cleanupKey);
    if (cleanup) {
      cleanup().catch(() => {});
      this.hookCleanups.delete(cleanupKey);
    }

    // 步骤失败 → 流水线失败（不自动推进）
    if (!success) {
      pipeline.status = 'failed';
      // 将剩余 draft 步骤标为 cancelled
      for (const s of pipeline.steps) {
        if (s.status === 'draft') {
          s.status = 'cancelled';
          db.update(tasks)
            .set({ status: 'cancelled', completedAt: new Date().toISOString() })
            .where(eq(tasks.id, s.taskId))
            .catch(() => {});
        }
      }
      console.log(`[Pipeline] 步骤失败，流水线终止: ${pipelineId}`);
    }
  }

  /** 取消流水线 */
  cancelPipeline(pipelineId: string): void {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline || (pipeline.status !== 'running' && pipeline.status !== 'paused')) return;

    pipeline.status = 'cancelled';
    const now = new Date().toISOString();

    // 取消当前运行的 Agent 会话
    const currentStep = pipeline.steps[pipeline.currentStepIndex];
    if (currentStep?.sessionId && currentStep.status === 'running') {
      this.cancelAgentSession(currentStep.sessionId);
      currentStep.status = 'cancelled';
    }

    // 将所有 draft 步骤标为 cancelled
    for (const step of pipeline.steps) {
      if (step.status === 'draft') {
        step.status = 'cancelled';
        db.update(tasks)
          .set({ status: 'cancelled', completedAt: now })
          .where(eq(tasks.id, step.taskId))
          .catch(() => {});
      }
    }

    // 清理所有 hook
    this.cleanupPipelineHooks(pipelineId, pipeline.steps.length);

    // 清理所有关联的回调令牌
    for (const [token, info] of this.callbackTokens) {
      if (info.pipelineId === pipelineId) {
        this.callbackTokens.delete(token);
      }
    }

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
  ): Promise<{ advanced: boolean; sessionMeta?: AgentSessionMeta & { shell: string } }> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline || pipeline.status !== 'paused') {
      return { advanced: false };
    }

    pipeline.status = 'running';

    const currentStep = pipeline.steps[pipeline.currentStepIndex];

    // 当前步骤仍在运行 → 只恢复状态，等步骤完成后自动推进
    if (currentStep && currentStep.status === 'running') {
      console.log(`[Pipeline] 已恢复流水线（当前步骤仍在运行）: ${pipelineId}`);
      return { advanced: false };
    }

    // 当前步骤已完成 → 立即推进到下一步
    if (currentStep && currentStep.status === 'completed') {
      const nextMeta = await this.advancePipeline(pipelineId, user);
      if (nextMeta) {
        console.log(`[Pipeline] 已恢复并推进流水线: ${pipelineId}`);
        return { advanced: true, sessionMeta: nextMeta };
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
    const tokenInfo = this.callbackTokens.get(token);
    if (!tokenInfo || tokenInfo.pipelineId !== pipelineId || tokenInfo.taskId !== taskId) {
      return false;
    }

    // 令牌一次性使用
    this.callbackTokens.delete(token);

    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) return false;

    // 按 taskId 查找步骤
    const step = pipeline.steps.find((s) => s.taskId === taskId);
    if (!step || step.status !== 'running') return false;

    // 标记步骤完成
    step.status = 'completed';

    // 更新 tasks 表
    if (step.taskId) {
      db.update(tasks)
        .set({ status: 'completed', completedAt: new Date().toISOString() })
        .where(eq(tasks.id, step.taskId))
        .catch((err) => console.warn(`[Pipeline] hook 回调更新任务失败: ${(err as Error).message}`));
    }

    // 清理该步骤的 hook
    const stepIndex = pipeline.steps.indexOf(step);
    const cleanupKey = `${pipelineId}:${stepIndex}`;
    const cleanup = this.hookCleanups.get(cleanupKey);
    if (cleanup) {
      cleanup().catch(() => {});
      this.hookCleanups.delete(cleanupKey);
    }

    // 终止 Agent PTY（交互模式下 Claude 仍在运行）
    if (step.sessionId) {
      this.terminateAgentSession(step.sessionId);
    }

    console.log(`[Pipeline] Hook 回调: 步骤 ${stepIndex + 1} 完成 (pipeline=${pipelineId})`);

    // 发射事件，WS handler 订阅后推进流水线
    const event: PipelineStepCompletedEvent = {
      pipelineId,
      taskId,
      userId: pipeline.userId,
      sessionId: step.sessionId,
    };
    this.events.emit('pipeline-step-completed', event);

    return true;
  }

  /**
   * 终止 Agent 会话（用于 hook 完成后关闭交互式 PTY）
   * 先发送 Ctrl+C，然后延迟销毁。
   */
  private terminateAgentSession(sessionId: string): void {
    const meta = this.sessions.get(sessionId);
    if (!meta || meta.status !== 'running') return;

    // 更新状态为 completed（hook 回调意味着任务成功完成）
    const updatedMeta: AgentSessionMeta = { ...meta, status: 'completed', exitCode: 0 };
    this.sessions.set(sessionId, updatedMeta);

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
    return this.pipelines.get(pipelineId);
  }

  /** 获取指定用户的所有流水线 */
  listPipelinesByUser(userId: string): TerminalPipeline[] {
    const result: TerminalPipeline[] = [];
    for (const p of this.pipelines.values()) {
      if (p.userId === userId) result.push(p);
    }
    return result;
  }

  // ---- 内部方法 ----

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
        this.hookCleanups.set(`${pipelineId}:${stepIndex}`, result.cleanup);
        console.log(`[Pipeline] 已注入 hook: 步骤 ${stepIndex + 1} (agent=${agentDefinitionId})`);
        return true;
      }
    } catch (err) {
      console.warn(`[Pipeline] Hook 注入失败，回退到 autoExit: ${(err as Error).message}`);
    }

    return false;
  }

  /** 批量清理流水线所有步骤的 hook */
  private cleanupPipelineHooks(pipelineId: string, stepCount: number): void {
    for (let i = 0; i < stepCount; i++) {
      const key = `${pipelineId}:${i}`;
      const cleanup = this.hookCleanups.get(key);
      if (cleanup) {
        cleanup().catch(() => {});
        this.hookCleanups.delete(key);
      }
    }
  }

  /** 解析仓库本地路径 */
  private async resolveRepoPath(repoUrl?: string, workDir?: string): Promise<string> {
    // 用户直接指定了工作目录
    if (workDir) return workDir;

    // 通过 repoUrl 查找仓库的 defaultWorkDir
    if (repoUrl) {
      const [repo] = await db
        .select()
        .from(repositories)
        .where(eq(repositories.repoUrl, repoUrl))
        .limit(1);

      if (repo?.defaultWorkDir) return repo.defaultWorkDir;
    }

    // 使用环境变量 CAM_REPOS_DIR 约定目录
    const reposDir = process.env.CAM_REPOS_DIR;
    if (reposDir && repoUrl) {
      // 从 repoUrl 提取仓库名
      const repoName = repoUrl.split('/').pop()?.replace(/\.git$/, '') || 'workspace';
      return `${reposDir}/${repoName}`;
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
