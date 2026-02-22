// ============================================================
// 终端 Zustand Store
// 管理终端会话列表、Agent 会话列表、激活标签、WebSocket 连接状态
// ============================================================

import { create } from 'zustand';
import type { SessionInfo, AgentSessionInfo, AgentSessionStatus } from '@/lib/terminal/protocol';

/** 视图模式 */
export type TerminalViewMode = 'terminal' | 'agent';

/** 流水线步骤状态 */
export interface TerminalPipelineStep {
  taskIds: string[];
  title: string;
  status: string;
  sessionIds?: string[];
}

/** 流水线状态 */
export interface TerminalPipelineState {
  pipelineId: string;
  steps: TerminalPipelineStep[];
  currentStep: number;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
}

/** 前端终端会话（包含 UI 状态） */
export interface TerminalSession {
  sessionId: string;
  shell: string;
  title: string;
  createdAt: string;
  /** 是否已连接到 PTY */
  attached: boolean;
  /** 是否为 Agent 会话 */
  isAgent?: boolean;
  /** Agent 相关信息（仅 Agent 会话） */
  agentInfo?: {
    agentDefinitionId: string;
    agentDisplayName: string;
    prompt: string;
    workBranch: string;
    status: AgentSessionStatus;
    exitCode?: number;
    elapsedMs: number;
    /** 项目绝对路径 */
    repoPath?: string;
    /** 恢复的 Claude Code 会话 ID */
    claudeSessionId?: string;
    /** 会话模式 */
    mode?: 'create' | 'resume' | 'continue';
  };
}

interface TerminalState {
  /** 当前视图模式 */
  viewMode: TerminalViewMode;
  /** 所有终端会话（包含普通终端和 Agent） */
  sessions: TerminalSession[];
  /** 当前激活标签的 sessionId */
  activeSessionId: string | null;
  /** WebSocket 连接状态 */
  connected: boolean;
  /** Agent 会话列表（独立于终端会话的完整 Agent 状态） */
  agentSessions: AgentSessionInfo[];
  /** 流水线列表 */
  pipelines: TerminalPipelineState[];

  // ---- actions ----
  setViewMode: (mode: TerminalViewMode) => void;
  addSession: (info: { sessionId: string; shell: string }) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  setConnected: (connected: boolean) => void;
  setSessions: (sessions: SessionInfo[]) => void;
  updateTitle: (sessionId: string, title: string) => void;
  // Agent 相关
  addAgentSession: (info: {
    sessionId: string;
    shell: string;
    agentDefinitionId: string;
    agentDisplayName: string;
    workBranch: string;
    prompt: string;
    repoPath?: string;
    claudeSessionId?: string;
    mode?: 'create' | 'resume' | 'continue';
  }) => void;
  updateAgentStatus: (sessionId: string, status: AgentSessionStatus, exitCode?: number, elapsedMs?: number) => void;
  setAgentSessions: (sessions: AgentSessionInfo[]) => void;
  // 流水线相关
  setPipelines: (pipelines: TerminalPipelineState[]) => void;
  addPipeline: (pipeline: TerminalPipelineState) => void;
  updatePipelineStep: (
    pipelineId: string,
    stepIndex: number,
    status: string,
    sessionIds?: string[],
    taskIds?: string[],
  ) => void;
  completePipeline: (pipelineId: string, finalStatus: 'completed' | 'failed' | 'cancelled') => void;
  pausePipeline: (pipelineId: string) => void;
  resumePipeline: (pipelineId: string, currentStep?: number, sessionIds?: string[]) => void;
}

let sessionCounter = 0;

export const useTerminalStore = create<TerminalState>((set, get) => ({
  viewMode: 'terminal',
  sessions: [],
  activeSessionId: null,
  connected: false,
  agentSessions: [],
  pipelines: [],

  setViewMode: (mode) => set({ viewMode: mode }),

  addSession: (info) => {
    sessionCounter++;
    const session: TerminalSession = {
      sessionId: info.sessionId,
      shell: info.shell,
      title: `终端 ${sessionCounter}`,
      createdAt: new Date().toISOString(),
      attached: true,
    };
    set((state) => ({
      sessions: [...state.sessions, session],
      activeSessionId: info.sessionId,
    }));
  },

  removeSession: (sessionId) => {
    set((state) => {
      const newSessions = state.sessions.filter((s) => s.sessionId !== sessionId);
      let newActive = state.activeSessionId;
      if (newActive === sessionId) {
        newActive = newSessions.length > 0 ? newSessions[newSessions.length - 1].sessionId : null;
      }
      return { sessions: newSessions, activeSessionId: newActive };
    });
  },

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  setConnected: (connected) => set({ connected }),

  setSessions: (serverSessions) => {
    const { sessions: existing } = get();
    const existingMap = new Map(existing.map((s) => [s.sessionId, s]));

    const merged = serverSessions.map((ss) => {
      const prev = existingMap.get(ss.sessionId);
      if (prev) return prev;
      sessionCounter++;
      return {
        sessionId: ss.sessionId,
        shell: ss.shell,
        title: `终端 ${sessionCounter}`,
        createdAt: ss.createdAt,
        attached: false,
      };
    });

    set((state) => ({
      sessions: merged,
      activeSessionId: state.activeSessionId && merged.some((s) => s.sessionId === state.activeSessionId)
        ? state.activeSessionId
        : merged.length > 0 ? merged[0].sessionId : null,
    }));
  },

  updateTitle: (sessionId, title) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId ? { ...s, title } : s,
      ),
    }));
  },

  // ---- Agent actions ----

  addAgentSession: (info) => {
    const session: TerminalSession = {
      sessionId: info.sessionId,
      shell: info.shell,
      title: `🤖 ${info.agentDisplayName}`,
      createdAt: new Date().toISOString(),
      attached: true,
      isAgent: true,
      agentInfo: {
        agentDefinitionId: info.agentDefinitionId,
        agentDisplayName: info.agentDisplayName,
        prompt: info.prompt,
        workBranch: info.workBranch,
        status: 'running',
        elapsedMs: 0,
        repoPath: info.repoPath,
        claudeSessionId: info.claudeSessionId,
        mode: info.mode,
      },
    };
    set((state) => ({
      sessions: [...state.sessions, session],
      activeSessionId: info.sessionId,
      viewMode: 'agent',
    }));
  },

  updateAgentStatus: (sessionId, status, exitCode, elapsedMs) => {
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (s.sessionId !== sessionId || !s.agentInfo) return s;
        return {
          ...s,
          agentInfo: {
            ...s.agentInfo,
            status,
            exitCode: exitCode ?? s.agentInfo.exitCode,
            elapsedMs: elapsedMs ?? s.agentInfo.elapsedMs,
          },
        };
      }),
      agentSessions: state.agentSessions.map((a) =>
        a.sessionId === sessionId
          ? { ...a, status, exitCode: exitCode ?? a.exitCode, elapsedMs: elapsedMs ?? a.elapsedMs }
          : a,
      ),
    }));
  },

  setAgentSessions: (sessions) => {
    set((state) => {
      const nextSessions = [...state.sessions];
      const upsertSession = (session: TerminalSession) => {
        const index = nextSessions.findIndex((item) => item.sessionId === session.sessionId);
        if (index >= 0) {
          nextSessions[index] = session;
          return;
        }
        nextSessions.push(session);
      };

      for (const agent of sessions) {
        const prev = nextSessions.find((item) => item.sessionId === agent.sessionId);
        // 仅合并运行中或当前已存在的会话，避免把纯历史会话注入 runtime 列表导致反复 attach 报错
        if (agent.status !== 'running' && !prev) continue;

        upsertSession({
          sessionId: agent.sessionId,
          shell: prev?.shell ?? 'agent',
          title: `🤖 ${agent.agentDisplayName}`,
          createdAt: prev?.createdAt ?? agent.createdAt,
          attached: prev?.attached ?? false,
          isAgent: true,
          agentInfo: {
            agentDefinitionId: agent.agentDefinitionId,
            agentDisplayName: agent.agentDisplayName,
            prompt: agent.prompt,
            workBranch: agent.workBranch,
            status: agent.status,
            exitCode: agent.exitCode,
            elapsedMs: agent.elapsedMs,
            repoPath: prev?.agentInfo?.repoPath,
            claudeSessionId: prev?.agentInfo?.claudeSessionId,
            mode: prev?.agentInfo?.mode,
          },
        });
      }

      return { agentSessions: sessions, sessions: nextSessions };
    });
  },

  // ---- Pipeline actions ----

  setPipelines: (pipelines) => {
    set({ pipelines });
  },

  addPipeline: (pipeline) => {
    set((state) => ({
      pipelines: state.pipelines.some((item) => item.pipelineId === pipeline.pipelineId)
        ? state.pipelines.map((item) => (item.pipelineId === pipeline.pipelineId ? pipeline : item))
        : [...state.pipelines, pipeline],
    }));
  },

  updatePipelineStep: (pipelineId, stepIndex, status, sessionIds, taskIds) => {
    set((state) => ({
      pipelines: state.pipelines.map((p) => {
        if (p.pipelineId !== pipelineId) return p;
        const newSteps = p.steps.map((s, i) =>
          i === stepIndex
            ? {
                ...s,
                status,
                ...(taskIds ? { taskIds } : {}),
                ...(sessionIds ? { sessionIds } : {}),
              }
            : s,
        );
        return {
          ...p,
          steps: newSteps,
          currentStep: status === 'running' ? stepIndex : p.currentStep,
        };
      }),
    }));
  },

  completePipeline: (pipelineId, finalStatus) => {
    set((state) => ({
      pipelines: state.pipelines.map((p) =>
        p.pipelineId === pipelineId ? { ...p, status: finalStatus } : p,
      ),
    }));
  },

  pausePipeline: (pipelineId) => {
    set((state) => ({
      pipelines: state.pipelines.map((p) =>
        p.pipelineId === pipelineId ? { ...p, status: 'paused' as const } : p,
      ),
    }));
  },

  resumePipeline: (pipelineId, currentStep, sessionIds) => {
    set((state) => ({
      pipelines: state.pipelines.map((p) =>
        p.pipelineId === pipelineId
          ? {
              ...p,
              status: 'running' as const,
              ...(typeof currentStep === 'number' ? { currentStep } : {}),
              steps: p.steps.map((step, index) =>
                typeof currentStep === 'number' && index === currentStep
                  ? {
                      ...step,
                      status: 'running',
                      ...(sessionIds && sessionIds.length > 0 ? { sessionIds } : {}),
                    }
                  : step,
              ),
            }
          : p,
      ),
    }));
  },
}));
