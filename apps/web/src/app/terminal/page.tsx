// ============================================================
// 终端页面
// 任务页风格：页头 + 概览统计 + 会话列表 + 终端详情
// ============================================================

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Bot, GitBranch, Pause, Play, Plus, Square, TerminalSquare, Wifi, WifiOff } from 'lucide-react';
import { useTerminalWs } from '@/hooks/useTerminalWs';
import { useTerminalStore } from '@/stores/terminal';
import { TerminalTabs } from '@/components/terminal/terminal-tabs';
import { AgentCreateDialog } from '@/components/terminal/agent-create-dialog';
import { PipelineCreateDialog } from '@/components/terminal/pipeline-create-dialog';
import { PageHeader } from '@/components/ui/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { formatDurationMs } from '@/lib/time/duration';
import { TASK_STATUS_COLORS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { AgentSessionStatus } from '@/lib/terminal/protocol';
import type { TerminalSession } from '@/stores/terminal';

// xterm 依赖 DOM API，必须 ssr: false
const TerminalPanel = dynamic(
  () => import('@/components/terminal/terminal-panel'),
  { ssr: false },
);

type SessionFilter = 'all' | 'running' | 'agent' | 'terminal';

const AGENT_STATUS_COLORS: Record<AgentSessionStatus, string> = {
  running: 'primary',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'muted-foreground',
};

const AGENT_STATUS_LABELS: Record<AgentSessionStatus, string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const PIPELINE_STATUS_COLORS: Record<'running' | 'paused' | 'completed' | 'failed' | 'cancelled', string> = {
  running: 'primary',
  paused: 'warning',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'muted-foreground',
};

const PIPELINE_STATUS_LABELS: Record<'running' | 'paused' | 'completed' | 'failed' | 'cancelled', string> = {
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

function shortId(id: string, length = 10): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}...`;
}

function getSessionStatus(session: TerminalSession): SessionStatusPresentation {
  if (session.isAgent) {
    const status = session.agentInfo?.status ?? 'running';
    return {
      status,
      label: AGENT_STATUS_LABELS[status],
      colorToken: AGENT_STATUS_COLORS[status],
      pulse: status === 'running',
    };
  }

  return {
    status: session.attached ? 'attached' : 'detached',
    label: session.attached ? '已连接' : '待连接',
    colorToken: session.attached ? 'success' : 'warning',
    pulse: false,
  };
}

type SessionStatusPresentation = {
  status: string;
  label: string;
  colorToken: string;
  pulse: boolean;
};

type TerminalSessionRow = {
  sessionId: string;
  title: string;
  kind: 'agent' | 'terminal';
  status: SessionStatusPresentation;
  workBranch: string;
  elapsedMs: number | null;
  prompt: string;
  raw: TerminalSession;
};

export default function TerminalPage() {
  const { send, onOutput, onExit } = useTerminalWs();
  const sessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const connected = useTerminalStore((s) => s.connected);
  const pipelines = useTerminalStore((s) => s.pipelines);
  const setActiveSession = useTerminalStore((s) => s.setActiveSession);
  const removeSession = useTerminalStore((s) => s.removeSession);

  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [pipelineDialogOpen, setPipelineDialogOpen] = useState(false);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all');
  const [keyword, setKeyword] = useState('');

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
  const openPipelineFromQuery = useMemo(
    () => searchParams.get('pipeline') === '1' || searchParams.get('mode') === 'pipeline',
    [searchParams]
  );

  // URL 参数存在时自动打开 Agent 创建对话框
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (prefill && !prefillAppliedRef.current) {
      prefillAppliedRef.current = true;
      setAgentDialogOpen(true);
    }
  }, [prefill]);

  const pipelinePrefillAppliedRef = useRef(false);
  useEffect(() => {
    if (openPipelineFromQuery && !pipelinePrefillAppliedRef.current) {
      pipelinePrefillAppliedRef.current = true;
      setPipelineDialogOpen(true);
    }
  }, [openPipelineFromQuery]);

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

  const handleRemoveSessionOnly = useCallback((sessionId: string) => {
    removeSession(sessionId);
  }, [removeSession]);

  const handleDestroySession = useCallback((sessionId: string) => {
    send({ type: 'destroy', sessionId });
    removeSession(sessionId);
  }, [removeSession, send]);

  // 首次进入且无会话时自动创建
  const autoCreatedRef = useRef(false);
  useEffect(() => {
    if (connected && sessions.length === 0 && !autoCreatedRef.current) {
      autoCreatedRef.current = true;
      handleNewTerminal();
    }
  }, [connected, sessions.length, handleNewTerminal]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.sessionId === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const runningAgentCount = useMemo(
    () => sessions.filter((session) => session.isAgent && session.agentInfo?.status === 'running').length,
    [sessions],
  );

  const activePipelines = useMemo(
    () => pipelines.filter((pipeline) => pipeline.status === 'running' || pipeline.status === 'paused'),
    [pipelines],
  );

  const runningPipelineCount = useMemo(
    () => pipelines.filter((pipeline) => pipeline.status === 'running').length,
    [pipelines],
  );

  const sortedPipelines = useMemo(() => {
    return [...pipelines].sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (a.status !== 'running' && b.status === 'running') return 1;
      if (a.status === 'paused' && b.status !== 'paused') return -1;
      if (a.status !== 'paused' && b.status === 'paused') return 1;
      return a.pipelineId.localeCompare(b.pipelineId);
    });
  }, [pipelines]);

  const filteredSessions = useMemo(() => {
    const keywordLower = keyword.trim().toLowerCase();

    const sorted = [...sessions].sort((a, b) => {
      if (a.sessionId === activeSessionId) return -1;
      if (b.sessionId === activeSessionId) return 1;

      const aRunning = a.isAgent && a.agentInfo?.status === 'running';
      const bRunning = b.isAgent && b.agentInfo?.status === 'running';
      if (aRunning && !bRunning) return -1;
      if (!aRunning && bRunning) return 1;

      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return Number.isFinite(bTime) && Number.isFinite(aTime) ? bTime - aTime : 0;
    });

    return sorted.filter((session) => {
      if (sessionFilter === 'running' && (!session.isAgent || session.agentInfo?.status !== 'running')) {
        return false;
      }
      if (sessionFilter === 'agent' && !session.isAgent) {
        return false;
      }
      if (sessionFilter === 'terminal' && session.isAgent) {
        return false;
      }

      if (!keywordLower) return true;
      const haystack = [
        session.title,
        session.sessionId,
        session.agentInfo?.agentDisplayName ?? '',
        session.agentInfo?.prompt ?? '',
        session.agentInfo?.workBranch ?? '',
      ].join(' ').toLowerCase();
      return haystack.includes(keywordLower);
    });
  }, [sessions, sessionFilter, keyword, activeSessionId]);

  const sessionFilterCounts = useMemo(() => {
    return {
      all: sessions.length,
      running: sessions.filter((session) => session.isAgent && session.agentInfo?.status === 'running').length,
      agent: sessions.filter((session) => session.isAgent).length,
      terminal: sessions.filter((session) => !session.isAgent).length,
    } satisfies Record<SessionFilter, number>;
  }, [sessions]);

  const filteredSessionRows = useMemo<TerminalSessionRow[]>(
    () => filteredSessions.map((session) => ({
      sessionId: session.sessionId,
      title: session.title,
      kind: session.isAgent ? 'agent' : 'terminal',
      status: getSessionStatus(session),
      workBranch: session.agentInfo?.workBranch ?? '-',
      elapsedMs: session.isAgent ? (session.agentInfo?.elapsedMs ?? 0) : null,
      prompt: session.agentInfo?.prompt ?? '',
      raw: session,
    })),
    [filteredSessions],
  );

  const selectedSessionKeys = useMemo(
    () => (activeSessionId ? new Set([activeSessionId]) : undefined),
    [activeSessionId],
  );

  const sessionColumns = useMemo<Column<TerminalSessionRow>[]>(() => ([
    {
      key: 'session',
      header: '会话',
      className: 'w-[260px]',
      cell: (row) => (
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-1.5">
            {row.kind === 'agent' ? <Bot size={12} className="text-primary" /> : <TerminalSquare size={12} className="text-muted-foreground" />}
            <span className="max-w-[240px] truncate text-sm font-medium text-foreground">{row.title}</span>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground">{shortId(row.sessionId, 12)}</p>
          {row.prompt ? (
            <p className="max-w-[280px] truncate text-[11px] text-muted-foreground">{row.prompt}</p>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            {row.kind === 'agent' ? 'Agent' : '终端'}
            {' · '}
            {row.workBranch}
            {row.elapsedMs !== null ? ` · ${formatDurationMs(row.elapsedMs)}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      className: 'w-[130px]',
      cell: (row) => (
        <StatusBadge
          status={row.status.status}
          colorToken={row.status.colorToken}
          label={row.status.label}
          pulse={row.status.pulse}
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[170px] text-right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          {row.raw.isAgent && row.raw.agentInfo?.status === 'running' ? (
            <button
              type="button"
              onClick={() => send({ type: 'agent-cancel', sessionId: row.sessionId })}
              className="rounded border border-destructive/30 px-2 py-1 text-[11px] text-destructive transition-colors hover:bg-destructive/10"
            >
              取消
            </button>
          ) : null}
          <Link
            href={`/workers?sessionId=${encodeURIComponent(row.sessionId)}`}
            className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground"
          >
            节点
          </Link>
          <button
            type="button"
            onClick={() => handleDestroySession(row.sessionId)}
            className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground"
          >
            关闭
          </button>
        </div>
      ),
    },
  ]), [handleDestroySession, send]);

  return (
    <div className="space-y-10">
      <PageHeader title="终端" subtitle="统一管理终端会话、Agent 执行与流水线进度">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!connected}
            onClick={() => setPipelineDialogOpen(true)}
          >
            <GitBranch size={15} className="mr-1" />
            新建流水线
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!connected}
            onClick={() => setAgentDialogOpen(true)}
          >
            <Bot size={15} className="mr-1" />
            新建 Agent
          </Button>
          <Button
            size="sm"
            disabled={!connected}
            onClick={handleNewTerminal}
          >
            <Plus size={15} className="mr-1" />
            新建终端
          </Button>
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-5 rounded-xl border border-border bg-card/70 px-5 py-4">
        <span className="inline-flex items-center gap-2 text-sm">
          {connected ? <Wifi size={15} className="text-success" /> : <WifiOff size={15} className="text-destructive" />}
          <span className={cn('font-medium', connected ? 'text-success' : 'text-destructive')}>
            {connected ? '已连接' : '未连接'}
          </span>
        </span>
        <span className="h-3 w-px bg-border" />
        <span className="text-sm text-muted-foreground">会话总数 <span className="font-semibold text-foreground">{sessions.length}</span></span>
        <span className="text-sm text-muted-foreground">运行中 Agent <span className="font-semibold text-primary">{runningAgentCount}</span></span>
        <span className="text-sm text-muted-foreground">活跃流水线 <span className="font-semibold text-primary">{activePipelines.length}</span></span>
        <span className="text-sm text-muted-foreground">运行中流水线 <span className="font-semibold text-primary">{runningPipelineCount}</span></span>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <div className="space-y-6">
          <section className="overflow-hidden rounded-2xl border border-border bg-card/80 shadow-[var(--shadow-card)]">
            <div className="border-b border-border px-4 py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">会话列表</span>
                <span className="text-xs text-muted-foreground">{filteredSessions.length} / {sessions.length}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {([
                  { key: 'all', label: '全部' },
                  { key: 'running', label: '运行中' },
                  { key: 'agent', label: 'Agent' },
                  { key: 'terminal', label: '终端' },
                ] as Array<{ key: SessionFilter; label: string }>).map((filter) => {
                  const active = sessionFilter === filter.key;
                  return (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => setSessionFilter(filter.key)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
                        active
                          ? 'border-primary/35 bg-primary/12 text-primary'
                          : 'border-border bg-input-bg text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {filter.label}
                      <span className={cn(
                        'rounded px-1.5 py-0.5 text-[11px]',
                        active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
                      )}
                      >
                        {sessionFilterCounts[filter.key]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索会话标题、ID、分支或提示词"
                className="mt-3 h-9 w-full rounded-lg border border-border bg-input-bg px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/40"
              />
            </div>

            <div className="max-h-[560px] overflow-y-auto p-3">
              <DataTable
                columns={sessionColumns}
                data={filteredSessionRows}
                rowKey={(row) => row.sessionId}
                onRowClick={(row) => setActiveSession(row.sessionId)}
                selectedKeys={selectedSessionKeys}
                borderless
                stickyHeader
                emptyMessage={sessions.length === 0 ? (connected ? '暂无会话，点击上方按钮创建。' : '正在连接终端服务...') : '没有匹配的会话'}
                emptyHint={sessions.length === 0 ? '你可以在页头创建终端、Agent 或流水线。' : '请调整筛选条件或搜索关键词。'}
              />
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-border bg-card/80 shadow-[var(--shadow-card)]">
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">流水线执行</span>
                <span className="text-xs text-muted-foreground">活跃 {activePipelines.length}</span>
              </div>
            </div>
            <div className="max-h-[420px] space-y-2 overflow-y-auto p-3">
              {sortedPipelines.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  暂无流水线执行记录
                </div>
              ) : (
                sortedPipelines.map((pipeline) => (
                  <div key={pipeline.pipelineId} className="rounded-lg border border-border bg-card-elevated/65 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <GitBranch size={13} className="text-primary" />
                          <span className="font-mono text-xs text-muted-foreground">{pipeline.pipelineId}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          当前步骤 {pipeline.currentStep + 1}/{pipeline.steps.length}
                        </p>
                      </div>
                      <StatusBadge
                        status={pipeline.status}
                        colorToken={PIPELINE_STATUS_COLORS[pipeline.status]}
                        label={PIPELINE_STATUS_LABELS[pipeline.status]}
                        pulse={pipeline.status === 'running'}
                      />
                    </div>

                    {(pipeline.status === 'running' || pipeline.status === 'paused') ? (
                      <div className="mt-2 flex items-center gap-2">
                        <Link
                          href={`/workers?pipelineId=${encodeURIComponent(pipeline.pipelineId)}`}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground"
                        >
                          节点视图
                        </Link>
                        {pipeline.status === 'running' ? (
                          <button
                            type="button"
                            onClick={() => send({ type: 'pipeline-pause', pipelineId: pipeline.pipelineId })}
                            className="inline-flex items-center gap-1 rounded border border-yellow-500/30 px-2 py-1 text-xs text-yellow-500 transition-colors hover:bg-yellow-500/10"
                          >
                            <Pause size={11} />
                            暂停
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => send({ type: 'pipeline-resume', pipelineId: pipeline.pipelineId })}
                            className="inline-flex items-center gap-1 rounded border border-green-500/30 px-2 py-1 text-xs text-green-500 transition-colors hover:bg-green-500/10"
                          >
                            <Play size={11} />
                            继续
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => send({ type: 'pipeline-cancel', pipelineId: pipeline.pipelineId })}
                          className="inline-flex items-center gap-1 rounded border border-destructive/30 px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
                        >
                          <Square size={11} />
                          取消
                        </button>
                      </div>
                    ) : null}

                    <div className="mt-3 space-y-1.5">
                      {pipeline.steps.map((step, index) => {
                        const isCurrent = index === pipeline.currentStep;
                        return (
                          <div
                            key={`${pipeline.pipelineId}-${index}-${step.title}`}
                            className={cn(
                              'rounded border px-2 py-1.5',
                              isCurrent ? 'border-primary/30 bg-primary/10' : 'border-border bg-background/40',
                            )}
                          >
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="text-muted-foreground">{index + 1}.</span>
                              <span className={cn('text-foreground', isCurrent && 'font-semibold')}>
                                {step.title || `步骤 ${index + 1}`}
                              </span>
                              <StatusBadge
                                status={step.status}
                                colorToken={TASK_STATUS_COLORS[step.status] || 'muted-foreground'}
                                size="sm"
                              />
                              {step.taskIds.length > 0 ? (
                                <span className="text-[11px] text-muted-foreground">
                                  {step.taskIds.length} 个任务
                                </span>
                              ) : null}
                            </div>
                            {step.sessionIds && step.sessionIds.length > 0 ? (
                              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                                会话: {step.sessionIds.map((id) => shortId(id, 8)).join(', ')}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <section className="overflow-hidden rounded-2xl border border-border bg-card/80 shadow-[var(--shadow-card)]">
          <div className="border-b border-border px-4 py-3">
            {activeSession ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{activeSession.title}</span>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {activeSession.isAgent ? 'Agent' : '终端'}
                    </span>
                    {activeSession.isAgent ? (
                      <StatusBadge
                        status={activeSession.agentInfo?.status ?? 'running'}
                        colorToken={AGENT_STATUS_COLORS[activeSession.agentInfo?.status ?? 'running']}
                        label={AGENT_STATUS_LABELS[activeSession.agentInfo?.status ?? 'running']}
                      />
                    ) : null}
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">ID: {activeSession.sessionId}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/workers?sessionId=${encodeURIComponent(activeSession.sessionId)}`}
                    className={buttonVariants({ size: 'sm', variant: 'secondary' })}
                  >
                    工作节点
                  </Link>
                  {activeSession.isAgent && activeSession.agentInfo?.status === 'running' ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => send({ type: 'agent-cancel', sessionId: activeSession.sessionId })}
                    >
                      <Square size={13} className="mr-1" />
                      取消 Agent
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDestroySession(activeSession.sessionId)}
                  >
                    关闭会话
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">暂无可用会话</div>
            )}
          </div>

          {sessions.length > 0 ? (
            <div className="border-b border-border bg-[var(--background-elevated)]">
              <TerminalTabs
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelect={setActiveSession}
                onClose={handleRemoveSessionOnly}
                send={send}
              />
            </div>
          ) : null}

          <div className="relative h-[min(68vh,760px)] overflow-hidden bg-[var(--background-elevated)]">
            {sessions.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">
                    {connected ? '点击“新建终端”或“新建 Agent”开始使用' : '正在连接服务器...'}
                  </p>
                  {connected ? (
                    <div className="mt-3 flex items-center justify-center gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setAgentDialogOpen(true)}>
                        <Bot size={14} className="mr-1" />
                        新建 Agent
                      </Button>
                      <Button size="sm" onClick={handleNewTerminal}>
                        <Plus size={14} className="mr-1" />
                        新建终端
                      </Button>
                    </div>
                  ) : null}
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
        </section>
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
