// ============================================================
// Agent 会话管理器（核心编排）
// 职责：查 Agent 定义 → 解密密钥 → 构造命令 → 创建 PTY → 状态跟踪
// ============================================================

import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentDefinitions, repositories, tasks } from '@/lib/db/schema';
import { resolveEnvVarValue, type SecretScope } from '@/lib/secrets/resolve';
import { sseManager } from '@/lib/sse/manager';
import { ptyManager } from './pty-manager';
import { resolveAgentCommand, generateWorkBranch } from './agent-command';
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
  status: 'running' | 'completed' | 'failed' | 'cancelled';
}

class AgentSessionManager {
  /** sessionId → AgentSessionMeta */
  private sessions: Map<string, AgentSessionMeta> = new Map();

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
      steps: Array<{ title: string; prompt: string }>;
    },
    user: { id: string; username: string },
  ): Promise<{ pipeline: TerminalPipeline; firstSessionMeta: AgentSessionMeta & { shell: string } }> {
    if (opts.steps.length < 2) {
      throw new Error('流水线至少需要 2 个步骤');
    }

    // 查询 Agent 定义（仅查一次）
    const [agent] = await db
      .select()
      .from(agentDefinitions)
      .where(eq(agentDefinitions.id, opts.agentDefinitionId))
      .limit(1);

    if (!agent) {
      throw new Error(`Agent 定义不存在: ${opts.agentDefinitionId}`);
    }

    const repoPath = await this.resolveRepoPath(opts.repoUrl, opts.workDir);
    const pipelineId = `pipeline/terminal-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    // 为所有步骤创建任务记录
    const steps: PipelineStep[] = opts.steps.map((s, i) => ({
      taskId: crypto.randomUUID(),
      title: s.title,
      prompt: s.prompt,
      status: i === 0 ? 'running' as const : 'draft' as const,
    }));

    // 批量 INSERT 任务
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      await db.insert(tasks).values({
        id: step.taskId,
        title: `[流水线 ${i + 1}/${steps.length}] ${step.title}`,
        description: step.prompt,
        agentDefinitionId: opts.agentDefinitionId,
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

    // 创建流水线状态
    const pipeline: TerminalPipeline = {
      pipelineId,
      userId: user.id,
      agentDefinitionId: opts.agentDefinitionId,
      agentDisplayName: agent.displayName,
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
    const firstSessionMeta = await this.createAgentSession(
      {
        agentDefinitionId: opts.agentDefinitionId,
        prompt: steps[0].prompt,
        repoUrl: opts.repoUrl,
        baseBranch: opts.baseBranch,
        workDir: opts.workDir,
        cols: opts.cols,
        rows: opts.rows,
        _pipelineTaskId: steps[0].taskId,
        _pipelineId: pipelineId,
      },
      user,
    );

    steps[0].sessionId = firstSessionMeta.sessionId;

    console.log(`[Pipeline] 已创建流水线: ${pipelineId} (${steps.length} 步, agent=${agent.displayName})`);

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

    // 启动下一步
    const nextStep = pipeline.steps[nextIndex];
    pipeline.currentStepIndex = nextIndex;
    nextStep.status = 'running';

    const sessionMeta = await this.createAgentSession(
      {
        agentDefinitionId: pipeline.agentDefinitionId,
        prompt: nextStep.prompt,
        repoUrl: pipeline.repoUrl,
        baseBranch: pipeline.baseBranch,
        workDir: pipeline.workDir || pipeline.repoPath,
        cols: pipeline.cols,
        rows: pipeline.rows,
        _pipelineTaskId: nextStep.taskId,
        _pipelineId: pipelineId,
      },
      user,
    );

    nextStep.sessionId = sessionMeta.sessionId;

    console.log(`[Pipeline] 推进到步骤 ${nextIndex + 1}/${pipeline.steps.length}: ${pipelineId}`);

    return sessionMeta;
  }

  /** 标记流水线当前步骤完成（由 handleAgentExit 调用） */
  markPipelineStepDone(pipelineId: string, sessionId: string, success: boolean): void {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) return;

    const step = pipeline.steps.find((s) => s.sessionId === sessionId);
    if (!step) return;

    step.status = success ? 'completed' : 'failed';

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
    if (!pipeline || pipeline.status !== 'running') return;

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

    console.log(`[Pipeline] 已取消流水线: ${pipelineId}`);
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
