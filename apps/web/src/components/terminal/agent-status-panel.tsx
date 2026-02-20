// ============================================================
// Agent 状态面板（右侧可折叠）
// 展示所有 Agent 会话的实时状态列表
// ============================================================

'use client';

import { Bot, ChevronRight, ChevronLeft, GitBranch, CheckCircle2, XCircle, Circle, Loader2 } from 'lucide-react';
import { useState, useCallback } from 'react';
import { useTerminalStore } from '@/stores/terminal';
import { AgentSessionCard } from './agent-session-card';
import { AGENT_SESSION_UI_MESSAGES as MSG } from '@/lib/i18n/ui-messages';
import type { ClientMessage } from '@/lib/terminal/protocol';

interface AgentStatusPanelProps {
  send: (msg: ClientMessage) => void;
}

export function AgentStatusPanel({ send }: AgentStatusPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const sessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const setActiveSession = useTerminalStore((s) => s.setActiveSession);
  const pipelines = useTerminalStore((s) => s.pipelines);

  // 只展示 Agent 会话
  const agentSessions = sessions.filter((s) => s.isAgent);
  // 活跃流水线
  const activePipelines = pipelines.filter((p) => p.status === 'running');

  const handleView = useCallback((sessionId: string) => {
    setActiveSession(sessionId);
  }, [setActiveSession]);

  const handleCancel = useCallback((sessionId: string) => {
    send({ type: 'agent-cancel', sessionId });
  }, [send]);

  if (collapsed) {
    return (
      <div className="flex flex-col items-center border-l border-white/8 bg-[#080a0e] px-1 py-3">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
          title={MSG.statusPanel.title}
        >
          <ChevronLeft size={14} />
        </button>
        <div className="mt-2 flex flex-col items-center gap-1">
          <Bot size={14} className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{agentSessions.length}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-64 flex-col border-l border-white/8 bg-[#080a0e]">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{MSG.statusPanel.title}</span>
          <span className="text-xs text-muted-foreground">({agentSessions.length})</span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* 流水线进度 */}
      {activePipelines.length > 0 && (
        <div className="border-b border-white/8 p-2 space-y-2">
          {activePipelines.map((pipeline) => (
            <div key={pipeline.pipelineId} className="rounded-lg border border-primary/20 bg-primary/5 p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  <GitBranch size={12} />
                  {MSG.pipeline.progress}
                </span>
                <button
                  type="button"
                  onClick={() => send({ type: 'pipeline-cancel', pipelineId: pipeline.pipelineId })}
                  className="rounded px-1.5 py-0.5 text-[10px] text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  {MSG.pipeline.cancelPipeline}
                </button>
              </div>
              <div className="space-y-1">
                {pipeline.steps.map((step, i) => {
                  const icon = step.status === 'completed' ? <CheckCircle2 size={11} className="text-green-400" />
                    : step.status === 'running' ? <Loader2 size={11} className="text-primary animate-spin" />
                    : step.status === 'failed' ? <XCircle size={11} className="text-destructive" />
                    : <Circle size={11} className="text-white/20" />;
                  return (
                    <div
                      key={step.taskId}
                      className={`flex items-center gap-1.5 text-[11px] ${
                        step.status === 'running' ? 'text-foreground font-medium' : 'text-muted-foreground'
                      }`}
                    >
                      {icon}
                      <span className="truncate">{i + 1}. {step.title || `步骤 ${i + 1}`}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto p-2">
        {agentSessions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Bot size={24} className="text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">{MSG.statusPanel.empty}</p>
            <p className="text-xs text-muted-foreground/60">{MSG.statusPanel.emptyHint}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {agentSessions.map((session) => (
              <AgentSessionCard
                key={session.sessionId}
                sessionId={session.sessionId}
                agentDisplayName={session.agentInfo?.agentDisplayName ?? 'Agent'}
                prompt={session.agentInfo?.prompt ?? ''}
                workBranch={session.agentInfo?.workBranch ?? ''}
                status={session.agentInfo?.status ?? 'running'}
                elapsedMs={session.agentInfo?.elapsedMs ?? 0}
                isActive={session.sessionId === activeSessionId}
                onView={handleView}
                onCancel={handleCancel}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
