// ============================================================
// 终端页面
// 全屏布局：工具栏 + 标签栏 + xterm 面板 + Agent 状态面板
// ============================================================

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useTerminalWs } from '@/hooks/useTerminalWs';
import { useTerminalStore } from '@/stores/terminal';
import { TerminalTabs } from '@/components/terminal/terminal-tabs';
import { TerminalToolbar } from '@/components/terminal/terminal-toolbar';
import { AgentCreateDialog } from '@/components/terminal/agent-create-dialog';
import { PipelineCreateDialog } from '@/components/terminal/pipeline-create-dialog';
import { AgentStatusPanel } from '@/components/terminal/agent-status-panel';

// xterm 依赖 DOM API，必须 ssr: false
const TerminalPanel = dynamic(
  () => import('@/components/terminal/terminal-panel'),
  { ssr: false },
);

export default function TerminalPage() {
  const { send, onOutput, onExit } = useTerminalWs();
  const sessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const connected = useTerminalStore((s) => s.connected);
  const viewMode = useTerminalStore((s) => s.viewMode);
  const setViewMode = useTerminalStore((s) => s.setViewMode);
  const setActiveSession = useTerminalStore((s) => s.setActiveSession);
  const removeSession = useTerminalStore((s) => s.removeSession);

  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [pipelineDialogOpen, setPipelineDialogOpen] = useState(false);

  // URL 参数预填充（从任务详情页跳转过来时使用）
  const searchParams = useSearchParams();
  const prefill = useMemo(() => {
    const agent = searchParams.get('agent');
    const repo = searchParams.get('repo');
    const branch = searchParams.get('branch');
    const dir = searchParams.get('dir');
    const prompt = searchParams.get('prompt');
    if (!agent && !repo && !dir) return undefined;
    return {
      agentDefinitionId: agent || undefined,
      repoUrl: repo || undefined,
      baseBranch: branch || undefined,
      workDir: dir || undefined,
      prompt: prompt || undefined,
    };
  }, [searchParams]);

  // URL 参数存在时自动打开 Agent 创建对话框
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (prefill && !prefillAppliedRef.current) {
      prefillAppliedRef.current = true;
      setAgentDialogOpen(true);
    }
  }, [prefill]);

  // 输出回调注册表：sessionId → handler
  const outputHandlers = useRef<Map<string, (data: string) => void>>(new Map());
  // 输出缓冲区：xterm.js 加载前暂存 PTY 输出，加载后一次性回放
  const outputBuffers = useRef<Map<string, string[]>>(new Map());

  const registerOutput = useCallback((sessionId: string, handler: (data: string) => void) => {
    outputHandlers.current.set(sessionId, handler);
    // 回放在 handler 注册前缓冲的所有输出（Claude TUI 初始渲染等）
    const buf = outputBuffers.current.get(sessionId);
    if (buf) {
      for (const data of buf) handler(data);
      outputBuffers.current.delete(sessionId);
    }
  }, []);

  const unregisterOutput = useCallback((sessionId: string) => {
    outputHandlers.current.delete(sessionId);
    outputBuffers.current.delete(sessionId);
  }, []);

  // 绑定 WebSocket 输出/退出回调
  useEffect(() => {
    onOutput.current = (sessionId, data) => {
      const handler = outputHandlers.current.get(sessionId);
      if (handler) {
        handler(data);
      } else {
        // xterm.js 尚未加载完成，缓冲输出等待回放
        let buf = outputBuffers.current.get(sessionId);
        if (!buf) {
          buf = [];
          outputBuffers.current.set(sessionId, buf);
        }
        buf.push(data);
      }
    };
    onExit.current = (sessionId, exitCode) => {
      console.log(`[Terminal] 会话 ${sessionId} 退出, code=${exitCode}`);
      removeSession(sessionId);
    };
  }, [onOutput, onExit, removeSession]);

  // 页面加载时，自动 attach 已有会话
  useEffect(() => {
    if (!connected || sessions.length === 0) return;
    for (const session of sessions) {
      if (!session.attached) {
        send({ type: 'attach', sessionId: session.sessionId });
      }
    }
  }, [connected, sessions, send]);

  const handleNewTerminal = useCallback(() => {
    send({ type: 'create', cols: 80, rows: 24 });
  }, [send]);

  const handleCloseSession = useCallback((sessionId: string) => {
    removeSession(sessionId);
  }, [removeSession]);

  // 首次进入且无会话时自动创建
  const autoCreatedRef = useRef(false);
  useEffect(() => {
    if (connected && sessions.length === 0 && !autoCreatedRef.current) {
      autoCreatedRef.current = true;
      handleNewTerminal();
    }
  }, [connected, sessions.length, handleNewTerminal]);

  // 是否有 Agent 会话（决定是否显示右侧面板）
  const hasAgentSessions = sessions.some((s) => s.isAgent);

  return (
    <div className="-mx-8 -my-14 flex h-screen flex-col sm:-mx-12 lg:-mx-16 lg:-my-16">
      {/* 工具栏 */}
      <TerminalToolbar
        connected={connected}
        sessionCount={sessions.length}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onNewTerminal={handleNewTerminal}
        onNewAgent={() => setAgentDialogOpen(true)}
        onNewPipeline={() => setPipelineDialogOpen(true)}
      />

      {/* 标签栏 */}
      <div className="border-b border-white/8 bg-[#080a0e]">
        <TerminalTabs
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={setActiveSession}
          onClose={handleCloseSession}
          send={send}
        />
      </div>

      {/* 主内容区：终端面板 + Agent 状态面板 */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* 终端面板区 */}
        <div className="relative flex-1 overflow-hidden bg-[#0a0c12]">
          {sessions.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  {connected ? '点击"新建终端"或"新建 Agent"开始使用' : '正在连接服务器...'}
                </p>
              </div>
            </div>
          ) : (
            sessions.map((session) => (
              <TerminalPanel
                key={session.sessionId}
                sessionId={session.sessionId}
                active={session.sessionId === activeSessionId}
                send={send}
                registerOutput={registerOutput}
                unregisterOutput={unregisterOutput}
              />
            ))
          )}
        </div>

        {/* 右侧 Agent 状态面板（有 Agent 会话时显示） */}
        {(viewMode === 'agent' || hasAgentSessions) && (
          <AgentStatusPanel send={send} />
        )}
      </div>

      {/* Agent 创建对话框 */}
      <AgentCreateDialog
        open={agentDialogOpen}
        onOpenChange={setAgentDialogOpen}
        send={send}
        prefill={prefill}
      />

      {/* 流水线创建对话框 */}
      <PipelineCreateDialog
        open={pipelineDialogOpen}
        onOpenChange={setPipelineDialogOpen}
        send={send}
      />
    </div>
  );
}
