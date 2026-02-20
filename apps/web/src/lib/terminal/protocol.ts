// ============================================================
// 终端 WebSocket 协议类型定义
// 单连接多会话：通过 sessionId 多路复用
// 包含普通终端会话 + Agent 编排会话两种模式
// ============================================================

/** 会话信息摘要 */
export interface SessionInfo {
  sessionId: string;
  shell: string;
  createdAt: string;
  /** 最近一次输入/输出的时间戳 */
  lastActivityAt: string;
}

// ---- Agent 会话相关类型 ----

export type AgentSessionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** Agent 会话信息（扩展 SessionInfo） */
export interface AgentSessionInfo extends SessionInfo {
  agentDefinitionId: string;
  agentDisplayName: string;
  prompt: string;
  repoUrl?: string;
  workBranch: string;
  status: AgentSessionStatus;
  /** 进程退出码（运行中为 undefined） */
  exitCode?: number;
  /** 已运行毫秒数 */
  elapsedMs: number;
}

// ---- 客户端 → 服务器 ----

export type ClientMessage =
  // 普通终端
  | { type: 'create'; cols: number; rows: number; shell?: string }
  | { type: 'input'; sessionId: string; data: string }
  | { type: 'resize'; sessionId: string; cols: number; rows: number }
  | { type: 'destroy'; sessionId: string }
  | { type: 'attach'; sessionId: string }
  | { type: 'list' }
  | { type: 'ping' }
  // Agent 编排
  | {
      type: 'agent-create';
      agentDefinitionId: string;
      prompt: string;
      repoUrl?: string;
      baseBranch?: string;
      workDir?: string;
      cols: number;
      rows: number;
      /** 会话模式：新建 / 恢复指定会话 / 继续最近会话 */
      mode?: 'create' | 'resume' | 'continue';
      /** mode='resume' 时必填：要恢复的 Claude Code 会话 ID */
      resumeSessionId?: string;
    }
  | { type: 'agent-cancel'; sessionId: string }
  | { type: 'agent-list' }
  // 流水线编排
  | {
      type: 'pipeline-create';
      /** 默认智能体（当步骤未指定时使用） */
      agentDefinitionId: string;
      workDir?: string;
      repoUrl?: string;
      baseBranch?: string;
      cols: number;
      rows: number;
      steps: Array<{ title: string; prompt: string; agentDefinitionId?: string }>;
    }
  | { type: 'pipeline-cancel'; pipelineId: string }
  | { type: 'pipeline-pause'; pipelineId: string }
  | { type: 'pipeline-resume'; pipelineId: string };

// ---- 服务器 → 客户端 ----

export type ServerMessage =
  // 普通终端
  | { type: 'created'; sessionId: string; shell: string }
  | { type: 'output'; sessionId: string; data: string }
  | { type: 'exited'; sessionId: string; exitCode: number }
  | { type: 'sessions'; sessions: SessionInfo[] }
  | { type: 'error'; message: string; sessionId?: string }
  | { type: 'pong' }
  // Agent 编排
  | {
      type: 'agent-created';
      sessionId: string;
      shell: string;
      agentDefinitionId: string;
      agentDisplayName: string;
      workBranch: string;
      status: AgentSessionStatus;
      /** 项目绝对路径 */
      repoPath: string;
      /** 会话模式 */
      mode: 'create' | 'resume' | 'continue';
      /** 恢复的 Claude Code 会话 ID（resume/continue 模式） */
      claudeSessionId?: string;
    }
  | {
      type: 'agent-status';
      sessionId: string;
      status: AgentSessionStatus;
      exitCode?: number;
      elapsedMs?: number;
    }
  | { type: 'agent-sessions'; sessions: AgentSessionInfo[] }
  // 流水线编排
  | {
      type: 'pipeline-created';
      pipelineId: string;
      steps: Array<{ taskId: string; title: string; status: string }>;
      currentStep: number;
      /** 第一步的 Agent 会话信息 */
      sessionId: string;
      shell: string;
      agentDisplayName: string;
      workBranch: string;
      repoPath: string;
    }
  | {
      type: 'pipeline-step-status';
      pipelineId: string;
      stepIndex: number;
      taskId: string;
      status: string;
      /** 新启动的 Agent 会话 ID（当步骤开始运行时） */
      sessionId?: string;
    }
  | {
      type: 'pipeline-completed';
      pipelineId: string;
      finalStatus: 'completed' | 'failed' | 'cancelled';
    }
  | {
      type: 'pipeline-paused';
      pipelineId: string;
      /** 暂停时当前步骤索引 */
      currentStep: number;
    }
  | {
      type: 'pipeline-resumed';
      pipelineId: string;
      /** 恢复后正在运行的步骤索引 */
      currentStep: number;
      /** 恢复后启动的 Agent 会话 ID（如有新步骤启动） */
      sessionId?: string;
    };
