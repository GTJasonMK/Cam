// ============================================================
// 终端页面（任务页同构）
// 仅展示执行项列表，详细会话与 Agent 信息在工作节点页查看
// ============================================================

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bot, GitBranch, Plus, RefreshCw, Search, Square, TerminalSquare, Trash2, Wifi, WifiOff } from 'lucide-react';
import { useTerminalWs } from '@/hooks/useTerminalWs';
import { useTerminalStore } from '@/stores/terminal';
import { TerminalDetailDialog } from '@/components/terminal/terminal-detail-dialog';
import { AgentCreateDialog } from '@/components/terminal/agent-create-dialog';
import { PipelineCreateDialog } from '@/components/terminal/pipeline-create-dialog';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { TabBar } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { getStatusDisplayLabel, TASK_STATUS_COLORS } from '@/lib/constants';
import { readApiEnvelope, resolveApiErrorMessage } from '@/lib/http/client-response';
import { formatDurationMs } from '@/lib/time/duration';
import { formatDateTimeZhCn, toSafeTimestamp } from '@/lib/time/format';
import { truncateText } from '@/lib/terminal/display';
import { cn } from '@/lib/utils';
import { useFeedback } from '@/components/providers/feedback-provider';
import type { AgentSessionStatus } from '@/lib/terminal/protocol';
import type { TerminalSession } from '@/stores/terminal';

type TerminalPageMode = 'runtime' | 'history';
type ExecutionFilter = 'all' | 'terminal' | 'agent' | 'pipeline';
type PipelineStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

type SessionStatusPresentation = {
  status: string;
  label: string;
  colorToken: string;
  pulse: boolean;
};

type ExecutionRow = {
  id: string;
  executionId: string;
  title: string;
  kind: 'terminal' | 'agent' | 'pipeline';
  kindLabel: string;
  status: SessionStatusPresentation;
  meta: string;
  sessionId?: string;
  pipelineId?: string;
  running: boolean;
  sortTs: number;
};

type HistoryTaskRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  groupId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

const TERMINAL_TASK_RUNNING_STATUSES = new Set(['queued', 'waiting', 'running', 'awaiting_review']);
const TERMINAL_TASK_CANCELLABLE_STATUSES = new Set(['queued', 'waiting', 'running']);
const TERMINAL_TASK_DELETABLE_STATUSES = new Set(['draft', 'completed', 'failed', 'cancelled']);
const TERMINAL_HISTORY_STATUS_ORDER = ['running', 'awaiting_review', 'queued', 'waiting', 'completed', 'failed', 'cancelled', 'draft'];

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

const PIPELINE_STATUS_COLORS: Record<PipelineStatus, string> = {
  running: 'primary',
  paused: 'warning',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'muted-foreground',
};

const PIPELINE_STATUS_LABELS: Record<PipelineStatus, string> = {
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

function canDeleteTerminalHistoryTask(status: string): boolean {
  return TERMINAL_TASK_DELETABLE_STATUSES.has(status) || TERMINAL_TASK_CANCELLABLE_STATUSES.has(status);
}

function canStopTerminalHistoryTask(status: string): boolean {
  return TERMINAL_TASK_CANCELLABLE_STATUSES.has(status);
}

function needsStopBeforeDelete(status: string): boolean {
  return TERMINAL_TASK_CANCELLABLE_STATUSES.has(status) && !TERMINAL_TASK_DELETABLE_STATUSES.has(status);
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
    label: session.attached ? '执行中' : '未连接',
    colorToken: session.attached ? 'success' : 'warning',
    pulse: session.attached,
  };
}

export default function TerminalPage() {
  const router = useRouter();
  const { send, onOutput, onExit } = useTerminalWs();
  const { confirm: confirmDialog, notify } = useFeedback();
  const sessions = useTerminalStore((s) => s.sessions);
  const connected = useTerminalStore((s) => s.connected);
  const pipelines = useTerminalStore((s) => s.pipelines);

  // ---- 终端详情弹窗 ----
  const [terminalDialogSessionId, setTerminalDialogSessionId] = useState<string | null>(null);
  const terminalDialogSession = useMemo(
    () => sessions.find((s) => s.sessionId === terminalDialogSessionId) ?? null,
    [sessions, terminalDialogSessionId],
  );

  // ---- 输出路由：sessionId → handler ----
  const outputHandlersRef = useRef<Map<string, (data: string) => void>>(new Map());

  const registerOutput = useCallback((sessionId: string, handler: (data: string) => void) => {
    outputHandlersRef.current.set(sessionId, handler);
    send({ type: 'attach', sessionId });
  }, [send]);

  const unregisterOutput = useCallback((sessionId: string) => {
    outputHandlersRef.current.delete(sessionId);
  }, []);

  useEffect(() => {
    onOutput.current = (sessionId: string, data: string) => {
      const handler = outputHandlersRef.current.get(sessionId);
      handler?.(data);
    };
    onExit.current = (sessionId: string, _exitCode: number) => {
      outputHandlersRef.current.delete(sessionId);
    };
    return () => {
      onOutput.current = null;
      onExit.current = null;
    };
  }, [onOutput, onExit]);

  const [pageMode, setPageMode] = useState<TerminalPageMode>('runtime');
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [pipelineDialogOpen, setPipelineDialogOpen] = useState(false);
  const [filterKey, setFilterKey] = useState<ExecutionFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [runningOnly, setRunningOnly] = useState(false);
  const [historyTasks, setHistoryTasks] = useState<HistoryTaskRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyKeyword, setHistoryKeyword] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState('all');
  const [historyRunningOnly, setHistoryRunningOnly] = useState(false);
  const [historyPipelineOnly, setHistoryPipelineOnly] = useState(false);
  const [historyBulkDeleting, setHistoryBulkDeleting] = useState(false);

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
    [searchParams],
  );

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

  const fetchHistoryTasks = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) setHistoryLoading(true);
    try {
      const res = await fetch('/api/tasks?source=terminal');
      const json = await readApiEnvelope<Array<Record<string, unknown>>>(res);
      if (!res.ok || !json?.success || !Array.isArray(json?.data)) {
        setHistoryError(resolveApiErrorMessage(res, json, '加载终端历史失败'));
        return;
      }
      const normalized = json.data.map<HistoryTaskRow>((item) => ({
        id: typeof item.id === 'string' ? item.id : '',
        title: typeof item.title === 'string' ? item.title : '(未命名任务)',
        description: typeof item.description === 'string' ? item.description : '',
        status: typeof item.status === 'string' ? item.status : 'unknown',
        groupId: typeof item.groupId === 'string' ? item.groupId : null,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
        startedAt: typeof item.startedAt === 'string' ? item.startedAt : null,
        completedAt: typeof item.completedAt === 'string' ? item.completedAt : null,
      })).filter((item) => item.id);
      setHistoryTasks(normalized);
      setHistoryError(null);
    } catch (err) {
      setHistoryError((err as Error).message);
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  }, []);

  const stopHistoryTaskById = useCallback(async (taskId: string, reason: string, notifyOnError = true) => {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const json = await readApiEnvelope<unknown>(res);
      if (!res.ok || !json?.success) {
        if (notifyOnError) {
          notify({
            type: 'error',
            title: '停止任务失败',
            message: resolveApiErrorMessage(res, json, '请求失败'),
          });
        }
        return false;
      }
      return true;
    } catch (err) {
      if (notifyOnError) {
        notify({ type: 'error', title: '停止任务失败', message: (err as Error).message });
      }
      return false;
    }
  }, [notify]);

  const deleteHistoryTaskById = useCallback(async (taskId: string, notifyOnError = true) => {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
      const json = await readApiEnvelope<unknown>(res);
      if (!res.ok || !json?.success) {
        if (notifyOnError) {
          notify({
            type: 'error',
            title: '删除失败',
            message: resolveApiErrorMessage(res, json, '请求失败'),
          });
        }
        return false;
      }
      return true;
    } catch (err) {
      if (notifyOnError) {
        notify({ type: 'error', title: '删除失败', message: (err as Error).message });
      }
      return false;
    }
  }, [notify]);

  const handleDeleteHistoryTask = useCallback(async (task: HistoryTaskRow) => {
    if (!canDeleteTerminalHistoryTask(task.status)) {
      notify({ type: 'error', title: '当前状态不可删除', message: '该任务当前状态不支持删除。' });
      return;
    }

    const stopThenDelete = needsStopBeforeDelete(task.status);
    const confirmed = await confirmDialog(stopThenDelete
      ? {
          title: '停止并删除历史任务?',
          description: `任务 "${task.title}" 正在执行，将先停止再删除（不可恢复）。`,
          confirmText: '停止并删除',
          confirmVariant: 'destructive',
        }
      : {
          title: '删除历史任务?',
          description: `将永久删除 "${task.title}"（不可恢复）。`,
          confirmText: '删除',
          confirmVariant: 'destructive',
        });
    if (!confirmed) return;

    try {
      if (stopThenDelete) {
        const stopped = await stopHistoryTaskById(task.id, '用户在终端历史执行停止并删除');
        if (!stopped) return;
      }

      const deleted = await deleteHistoryTaskById(task.id);
      if (!deleted) return;

      setHistoryTasks((prev) => prev.filter((item) => item.id !== task.id));
      notify({
        type: 'success',
        title: stopThenDelete ? '历史任务已停止并删除' : '历史任务已删除',
        message: `任务 ${task.title} 已删除。`,
      });
    } catch (err) {
      notify({ type: 'error', title: '删除失败', message: (err as Error).message });
    }
  }, [confirmDialog, deleteHistoryTaskById, notify, stopHistoryTaskById]);

  const handleStopHistoryTask = useCallback(async (task: HistoryTaskRow) => {
    if (!canStopTerminalHistoryTask(task.status)) {
      notify({ type: 'error', title: '当前状态不可停止', message: '该任务当前状态无需停止。' });
      return;
    }

    const confirmed = await confirmDialog({
      title: '停止历史任务?',
      description: `将停止 "${task.title}"，任务记录会保留。`,
      confirmText: '停止',
      confirmVariant: 'destructive',
    });
    if (!confirmed) return;

    const stopped = await stopHistoryTaskById(task.id, '用户在终端历史执行停止任务');
    if (!stopped) return;

    try {
      const nowIso = new Date().toISOString();
      setHistoryTasks((prev) => prev.map((item) => {
        if (item.id !== task.id) return item;
        return {
          ...item,
          status: 'cancelled',
          completedAt: item.completedAt || nowIso,
        };
      }));
      notify({ type: 'success', title: '历史任务已停止', message: `任务 ${task.title} 已停止。` });
    } catch (err) {
      notify({ type: 'error', title: '停止任务失败', message: (err as Error).message });
    }
  }, [confirmDialog, notify, stopHistoryTaskById]);

  const handleBulkDeleteHistory = useCallback(async () => {
    const kw = historyKeyword.trim().toLowerCase();
    const targets = historyTasks
      .filter((task) => {
        if (historyStatusFilter !== 'all' && task.status !== historyStatusFilter) return false;
        if (historyRunningOnly && !TERMINAL_TASK_RUNNING_STATUSES.has(task.status)) return false;
        if (historyPipelineOnly && !task.groupId) return false;
        if (!kw) return true;
        const searchable = `${task.id} ${task.title} ${task.description} ${task.groupId || ''}`;
        return searchable.toLowerCase().includes(kw);
      })
      .filter((task) => canDeleteTerminalHistoryTask(task.status));
    if (targets.length === 0) return;

    const stopThenDeleteCount = targets.filter((task) => needsStopBeforeDelete(task.status)).length;
    const confirmed = await confirmDialog({
      title: '一键删除当前筛选结果?',
      description: stopThenDeleteCount > 0
        ? `将删除 ${targets.length} 条历史任务，其中 ${stopThenDeleteCount} 条会先停止再删除（不可恢复）。`
        : `将删除 ${targets.length} 条历史任务（不可恢复）。`,
      confirmText: '一键删除',
      confirmVariant: 'destructive',
    });
    if (!confirmed) return;

    setHistoryBulkDeleting(true);
    let success = 0;
    let failed = 0;
    const deletedTaskIds = new Set<string>();

    for (const task of targets) {
      try {
        if (needsStopBeforeDelete(task.status)) {
          const stopped = await stopHistoryTaskById(task.id, '用户在终端历史执行一键停止并删除', false);
          if (!stopped) {
            failed += 1;
            continue;
          }
        }

        const deleted = await deleteHistoryTaskById(task.id, false);
        if (!deleted) {
          failed += 1;
          continue;
        }

        deletedTaskIds.add(task.id);
        success += 1;
      } catch {
        failed += 1;
      }
    }

    setHistoryBulkDeleting(false);
    if (deletedTaskIds.size > 0) {
      setHistoryTasks((prev) => prev.filter((item) => !deletedTaskIds.has(item.id)));
    }

    if (success === 0) {
      notify({ type: 'error', title: '一键删除失败', message: '未成功删除任何历史任务。' });
      return;
    }
    if (failed > 0) {
      notify({ type: 'error', title: '一键删除部分完成', message: `已删除 ${success} 条，失败 ${failed} 条。` });
      return;
    }
    notify({ type: 'success', title: '一键删除完成', message: `已删除 ${success} 条历史任务。` });
  }, [
    confirmDialog,
    notify,
    historyTasks,
    historyKeyword,
    historyStatusFilter,
    historyRunningOnly,
    historyPipelineOnly,
    deleteHistoryTaskById,
    stopHistoryTaskById,
  ]);

  useEffect(() => {
    if (pageMode !== 'history') return;
    void fetchHistoryTasks();
    const timer = setInterval(() => {
      void fetchHistoryTasks({ silent: true });
    }, 10000);
    return () => clearInterval(timer);
  }, [pageMode, fetchHistoryTasks]);

  // 维持 attach，确保 exited 事件和状态变更能持续同步
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

  const handleDestroySession = useCallback((sessionId: string) => {
    send({ type: 'destroy', sessionId });
  }, [send]);

  const activePipelineCount = useMemo(
    () => pipelines.filter((pipeline) => pipeline.status === 'running' || pipeline.status === 'paused').length,
    [pipelines],
  );

  const runningAgentCount = useMemo(
    () => sessions.filter((session) => session.isAgent && session.agentInfo?.status === 'running').length,
    [sessions],
  );

  const rawRows = useMemo<ExecutionRow[]>(() => {
    const sessionRows = sessions.map<ExecutionRow>((session) => {
      const status = getSessionStatus(session);
      const kind: ExecutionRow['kind'] = session.isAgent ? 'agent' : 'terminal';
      const elapsed = session.isAgent && typeof session.agentInfo?.elapsedMs === 'number'
        ? ` · ${formatDurationMs(session.agentInfo.elapsedMs)}`
        : '';
      return {
        id: `session:${session.sessionId}`,
        executionId: session.sessionId,
        title: session.title,
        kind,
        kindLabel: kind === 'agent' ? 'Agent' : '终端命令',
        status,
        meta: `${session.isAgent ? 'Agent' : '终端'}${elapsed}`,
        sessionId: session.sessionId,
        running: status.status === 'running' || status.status === 'attached',
        sortTs: toSafeTimestamp(session.createdAt),
      };
    });

    const pipelineRows = pipelines.map<ExecutionRow>((pipeline) => ({
      id: `pipeline:${pipeline.pipelineId}`,
      executionId: pipeline.pipelineId,
      title: `流水线 ${truncateText(pipeline.pipelineId, 14)}`,
      kind: 'pipeline',
      kindLabel: '流水线',
      status: {
        status: pipeline.status,
        label: PIPELINE_STATUS_LABELS[pipeline.status],
        colorToken: PIPELINE_STATUS_COLORS[pipeline.status],
        pulse: pipeline.status === 'running',
      },
      meta: `步骤 ${pipeline.currentStep + 1}/${pipeline.steps.length}`,
      pipelineId: pipeline.pipelineId,
      running: pipeline.status === 'running' || pipeline.status === 'paused',
      sortTs: 0,
    }));

    return [...pipelineRows, ...sessionRows].sort((a, b) => {
      if (a.running && !b.running) return -1;
      if (!a.running && b.running) return 1;
      return b.sortTs - a.sortTs;
    });
  }, [sessions, pipelines]);

  const runtimeTabs = useMemo(() => ([
    { key: 'all', label: '全部', count: rawRows.length },
    { key: 'terminal', label: '终端命令', count: rawRows.filter((row) => row.kind === 'terminal').length },
    { key: 'agent', label: 'Agent', count: rawRows.filter((row) => row.kind === 'agent').length },
    { key: 'pipeline', label: '流水线', count: rawRows.filter((row) => row.kind === 'pipeline').length },
  ]), [rawRows]);

  const visibleRows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rawRows.filter((row) => {
      if (filterKey !== 'all' && row.kind !== filterKey) return false;
      if (runningOnly && !row.running) return false;
      if (!kw) return true;
      return `${row.title} ${row.executionId} ${row.kindLabel}`.toLowerCase().includes(kw);
    });
  }, [rawRows, filterKey, runningOnly, keyword]);

  const modeTabs = useMemo(() => ([
    { key: 'runtime', label: '运行态', count: rawRows.length },
    { key: 'history', label: '历史回溯', count: historyTasks.length },
  ]), [rawRows.length, historyTasks.length]);

  const historySummary = useMemo(() => {
    const total = historyTasks.length;
    const running = historyTasks.filter((task) => TERMINAL_TASK_RUNNING_STATUSES.has(task.status)).length;
    const pipelines = historyTasks.filter((task) => Boolean(task.groupId)).length;
    return { total, running, pipelines };
  }, [historyTasks]);

  const historyStatusTabs = useMemo(() => {
    const statusCounts = new Map<string, number>();
    for (const task of historyTasks) {
      statusCounts.set(task.status, (statusCounts.get(task.status) || 0) + 1);
    }
    const sortedStatuses = Array.from(statusCounts.keys()).sort((a, b) => {
      const aIndex = TERMINAL_HISTORY_STATUS_ORDER.indexOf(a);
      const bIndex = TERMINAL_HISTORY_STATUS_ORDER.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
    return [
      { key: 'all', label: '全部', count: historyTasks.length },
      ...sortedStatuses.map((status) => ({
        key: status,
        label: getStatusDisplayLabel(status),
        count: statusCounts.get(status) || 0,
      })),
    ];
  }, [historyTasks]);

  const visibleHistoryRows = useMemo(() => {
    const kw = historyKeyword.trim().toLowerCase();
    return historyTasks
      .filter((task) => {
        if (historyStatusFilter !== 'all' && task.status !== historyStatusFilter) return false;
        if (historyRunningOnly && !TERMINAL_TASK_RUNNING_STATUSES.has(task.status)) return false;
        if (historyPipelineOnly && !task.groupId) return false;
        if (!kw) return true;
        const searchable = `${task.id} ${task.title} ${task.description} ${task.groupId || ''}`;
        return searchable.toLowerCase().includes(kw);
      })
      .sort((a, b) => toSafeTimestamp(b.createdAt) - toSafeTimestamp(a.createdAt));
  }, [historyTasks, historyKeyword, historyStatusFilter, historyRunningOnly, historyPipelineOnly]);

  const bulkDeletableHistoryCount = useMemo(
    () => visibleHistoryRows.filter((row) => canDeleteTerminalHistoryTask(row.status)).length,
    [visibleHistoryRows],
  );

  const columns = useMemo<Column<ExecutionRow>[]>(() => ([
    {
      key: 'execution',
      header: '执行项',
      className: 'w-[280px]',
      cell: (row) => (
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-1.5">
            {row.kind === 'pipeline' ? (
              <GitBranch size={13} className="text-primary" />
            ) : row.kind === 'agent' ? (
              <Bot size={13} className="text-primary" />
            ) : (
              <TerminalSquare size={13} className="text-muted-foreground" />
            )}
            <span className="max-w-[260px] truncate text-sm font-medium text-foreground">{row.title}</span>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground">{truncateText(row.executionId, 14)}</p>
          <p className="text-[11px] text-muted-foreground">{row.meta}</p>
        </div>
      ),
    },
    {
      key: 'kind',
      header: '类型',
      className: 'w-[120px]',
      cell: (row) => <span className="text-xs text-muted-foreground">{row.kindLabel}</span>,
    },
    {
      key: 'status',
      header: '状态',
      className: 'w-[140px]',
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
      className: 'w-[360px] text-right',
      cell: (row) => (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {/* 终端会话：弹窗打开终端 */}
          {row.sessionId && row.kind === 'terminal' ? (
            <button
              type="button"
              onClick={() => setTerminalDialogSessionId(row.sessionId!)}
              className="rounded border border-primary/30 px-2 py-1 text-[11px] text-primary transition-colors hover:bg-primary/10"
            >
              终端详情
            </button>
          ) : null}

          {/* Agent 会话：弹窗打开终端 */}
          {row.sessionId && row.kind === 'agent' ? (
            <button
              type="button"
              onClick={() => setTerminalDialogSessionId(row.sessionId!)}
              className="rounded border border-primary/30 px-2 py-1 text-[11px] text-primary transition-colors hover:bg-primary/10"
            >
              终端详情
            </button>
          ) : null}

          {row.pipelineId ? (
            <Link
              href={`/workers/terminal?pipelineId=${encodeURIComponent(row.pipelineId)}`}
              className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground"
            >
              节点详情
            </Link>
          ) : null}

          {row.pipelineId && row.status.status === 'running' ? (
            <button
              type="button"
              onClick={() => send({ type: 'pipeline-pause', pipelineId: row.pipelineId! })}
              className="rounded border border-yellow-500/30 px-2 py-1 text-[11px] text-yellow-500 transition-colors hover:bg-yellow-500/10"
            >
              暂停
            </button>
          ) : null}

          {row.pipelineId && row.status.status === 'paused' ? (
            <button
              type="button"
              onClick={() => send({ type: 'pipeline-resume', pipelineId: row.pipelineId! })}
              className="rounded border border-green-500/30 px-2 py-1 text-[11px] text-green-500 transition-colors hover:bg-green-500/10"
            >
              继续
            </button>
          ) : null}

          {row.pipelineId && (row.status.status === 'running' || row.status.status === 'paused') ? (
            <button
              type="button"
              onClick={() => send({ type: 'pipeline-cancel', pipelineId: row.pipelineId! })}
              className="rounded border border-destructive/30 px-2 py-1 text-[11px] text-destructive transition-colors hover:bg-destructive/10"
            >
              取消
            </button>
          ) : null}

          {row.kind === 'agent' && row.sessionId && row.status.status === 'running' ? (
            <button
              type="button"
              onClick={() => send({ type: 'agent-cancel', sessionId: row.sessionId! })}
              className="rounded border border-destructive/30 px-2 py-1 text-[11px] text-destructive transition-colors hover:bg-destructive/10"
            >
              取消 Agent
            </button>
          ) : null}

          {row.sessionId && row.kind === 'terminal' ? (
            <button
              type="button"
              onClick={() => handleDestroySession(row.sessionId!)}
              className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground"
            >
              关闭
            </button>
          ) : null}
        </div>
      ),
    },
  ]), [send, handleDestroySession, setTerminalDialogSessionId]);

  const historyColumns = useMemo<Column<HistoryTaskRow>[]>(() => ([
    {
      key: 'task',
      header: '终端任务',
      className: 'w-[320px]',
      cell: (row) => (
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-1.5">
            <TerminalSquare size={13} className="text-muted-foreground" />
            <span className="max-w-[300px] truncate text-sm font-medium text-foreground">{row.title}</span>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground">{truncateText(row.id, 14)}</p>
          <p className="text-[11px] text-muted-foreground">
            {row.groupId ? `流水线 ${row.groupId}` : '独立终端会话'}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      className: 'w-[140px]',
      cell: (row) => (
        <StatusBadge
          status={row.status}
          colorToken={TASK_STATUS_COLORS[row.status] || 'muted-foreground'}
          label={getStatusDisplayLabel(row.status)}
          pulse={TERMINAL_TASK_RUNNING_STATUSES.has(row.status)}
        />
      ),
    },
    {
      key: 'time',
      header: '时间',
      className: 'w-[220px]',
      cell: (row) => (
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>创建: {formatDateTimeZhCn(row.createdAt)}</p>
          <p>开始: {formatDateTimeZhCn(row.startedAt)}</p>
          <p>结束: {formatDateTimeZhCn(row.completedAt)}</p>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[260px] text-right',
      cell: (row) => (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Link
            href={`/tasks/${encodeURIComponent(row.id)}`}
            className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground"
          >
            任务详情
          </Link>
          {row.groupId?.startsWith('pipeline/') ? (
            <Link
              href={`/workers/terminal?pipelineId=${encodeURIComponent(row.groupId)}`}
              className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground"
            >
              节点详情
            </Link>
          ) : null}
          {canStopTerminalHistoryTask(row.status) ? (
            <button
              type="button"
              onClick={() => void handleStopHistoryTask(row)}
              className="inline-flex items-center gap-1 rounded border border-destructive/35 px-2 py-1 text-[11px] text-destructive transition-colors hover:bg-destructive/10"
              title="停止任务（保留历史）"
            >
              <Square size={12} />
              停止
            </button>
          ) : null}
          <button
            type="button"
            disabled={!canDeleteTerminalHistoryTask(row.status)}
            onClick={() => void handleDeleteHistoryTask(row)}
            className={cn(
              'inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] transition-colors',
              !canDeleteTerminalHistoryTask(row.status)
                ? 'cursor-not-allowed border-border/60 text-muted-foreground/50'
                : 'border-destructive/35 text-destructive hover:bg-destructive/10',
            )}
            title={canDeleteTerminalHistoryTask(row.status)
              ? (needsStopBeforeDelete(row.status) ? '先停止再删除' : '删除历史任务')
              : '当前状态不可删除'}
          >
            <Trash2 size={12} />
            {needsStopBeforeDelete(row.status) ? '停止并删除' : '删除'}
          </button>
        </div>
      ),
    },
  ]), [handleDeleteHistoryTask, handleStopHistoryTask]);

  return (
    <div className="space-y-12">
      <PageHeader
        title="终端"
        subtitle={pageMode === 'runtime'
          ? '执行视图（流水线 / 终端命令）；详细会话与 Agent 信息请在工作节点查看'
          : '历史回溯（终端来源任务）；可回看历史执行与日志'}
      >
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            disabled={!connected}
            onClick={() => setPipelineDialogOpen(true)}
          >
            <GitBranch size={15} className="mr-1" />
            新建流水线
          </Button>
          <Button
            variant="secondary"
            disabled={!connected}
            onClick={() => setAgentDialogOpen(true)}
          >
            <Bot size={15} className="mr-1" />
            新建 Agent
          </Button>
          <Button disabled={!connected} onClick={handleNewTerminal}>
            <Plus size={15} className="mr-1" />
            新建终端
          </Button>
        </div>
      </PageHeader>

      <TabBar
        tabs={modeTabs}
        activeKey={pageMode}
        onChange={(key) => setPageMode((key as TerminalPageMode) || 'runtime')}
      />

      {pageMode === 'runtime' ? (
        <>
          <div className="flex flex-wrap items-center gap-5 rounded-xl border border-border bg-card/70 px-5 py-4">
            <span className="inline-flex items-center gap-2 text-sm">
              {connected ? <Wifi size={15} className="text-success" /> : <WifiOff size={15} className="text-destructive" />}
              <span className={cn('font-medium', connected ? 'text-success' : 'text-destructive')}>
                {connected ? '已连接' : '未连接'}
              </span>
            </span>
            <span className="h-3 w-px bg-border" />
            <span className="text-sm text-muted-foreground">执行项 <span className="font-semibold text-foreground">{rawRows.length}</span></span>
            <span className="text-sm text-muted-foreground">运行中 Agent <span className="font-semibold text-primary">{runningAgentCount}</span></span>
            <span className="text-sm text-muted-foreground">活跃流水线 <span className="font-semibold text-primary">{activePipelineCount}</span></span>
          </div>

          <TabBar
            tabs={runtimeTabs}
            activeKey={filterKey}
            onChange={(key) => setFilterKey((key as ExecutionFilter) || 'all')}
          />

          <div className="flex flex-wrap items-end justify-between gap-5">
            <div className="flex flex-wrap items-end gap-5">
              <div className="relative w-80 max-w-full">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="执行名称 / 会话 ID / 流水线 ID"
                  className="pl-10"
                />
              </div>
              <Button
                variant={runningOnly ? 'secondary' : 'ghost'}
                size="sm"
                className="h-11 border border-border"
                onClick={() => setRunningOnly((prev) => !prev)}
              >
                {runningOnly ? '仅看运行中' : '显示全部状态'}
              </Button>
            </div>

            <div className="flex items-center gap-2.5">
              <Button variant="ghost" size="sm" onClick={() => router.push('/workers/terminal')}>
                查看终端节点详情
              </Button>
            </div>
          </div>

          <DataTable
            columns={columns}
            data={visibleRows}
            rowKey={(r) => r.id}
            emptyMessage="未找到匹配执行项"
            emptyHint={keyword || filterKey !== 'all' || !runningOnly ? '请尝试调整筛选条件。' : '先创建终端命令、Agent 或流水线。'}
          />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-5 rounded-xl border border-border bg-card/70 px-5 py-4">
            <span className="text-sm text-muted-foreground">历史终端任务 <span className="font-semibold text-foreground">{historySummary.total}</span></span>
            <span className="text-sm text-muted-foreground">运行中 <span className="font-semibold text-primary">{historySummary.running}</span></span>
            <span className="text-sm text-muted-foreground">流水线任务 <span className="font-semibold text-primary">{historySummary.pipelines}</span></span>
          </div>

          <TabBar
            tabs={historyStatusTabs}
            activeKey={historyStatusFilter}
            onChange={(key) => setHistoryStatusFilter(key || 'all')}
          />

          <div className="flex flex-wrap items-end justify-between gap-5">
            <div className="flex flex-wrap items-end gap-5">
              <div className="relative w-96 max-w-full">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={historyKeyword}
                  onChange={(e) => setHistoryKeyword(e.target.value)}
                  placeholder="任务标题 / 任务 ID / 流水线 ID"
                  className="pl-10"
                />
              </div>
              <Button
                variant={historyRunningOnly ? 'secondary' : 'ghost'}
                size="sm"
                className="h-11 border border-border"
                onClick={() => setHistoryRunningOnly((prev) => !prev)}
              >
                {historyRunningOnly ? '仅看运行中' : '显示全部状态'}
              </Button>
              <Button
                variant={historyPipelineOnly ? 'secondary' : 'ghost'}
                size="sm"
                className="h-11 border border-border"
                onClick={() => setHistoryPipelineOnly((prev) => !prev)}
              >
                {historyPipelineOnly ? '仅流水线任务' : '全部任务'}
              </Button>
            </div>

            <div className="flex items-center gap-2.5">
              <Button
                variant="destructive"
                size="sm"
                className="h-11"
                onClick={() => void handleBulkDeleteHistory()}
                disabled={historyBulkDeleting || historyLoading || bulkDeletableHistoryCount === 0}
              >
                <Trash2 size={14} className="mr-1.5" />
                {historyBulkDeleting ? '一键删除中...' : `一键删除 (${bulkDeletableHistoryCount})`}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-11 border border-border"
                onClick={() => void fetchHistoryTasks()}
                disabled={historyLoading}
              >
                <RefreshCw size={14} className={cn('mr-1.5', historyLoading && 'animate-spin')} />
                刷新历史
              </Button>
              <Button variant="ghost" size="sm" onClick={() => router.push('/workers/terminal')}>
                查看终端节点详情
              </Button>
            </div>
          </div>

          {historyError ? (
            <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              历史任务加载失败：{historyError}
            </div>
          ) : null}

          <DataTable
            columns={historyColumns}
            data={visibleHistoryRows}
            rowKey={(row) => row.id}
            loading={historyLoading && historyTasks.length === 0}
            emptyMessage="未找到匹配历史任务"
            emptyHint={historyKeyword || historyStatusFilter !== 'all' || historyRunningOnly || historyPipelineOnly
              ? '请尝试调整筛选条件。'
              : '暂无终端历史任务。'}
          />
        </>
      )}

      <AgentCreateDialog
        open={agentDialogOpen}
        onOpenChange={setAgentDialogOpen}
        send={send}
        prefill={prefill}
      />

      <PipelineCreateDialog
        open={pipelineDialogOpen}
        onOpenChange={setPipelineDialogOpen}
        send={send}
      />

      {terminalDialogSession && (
        <TerminalDetailDialog
          open={terminalDialogSessionId !== null}
          onOpenChange={(open) => { if (!open) setTerminalDialogSessionId(null); }}
          sessionId={terminalDialogSession.sessionId}
          title={terminalDialogSession.title}
          send={send}
          registerOutput={registerOutput}
          unregisterOutput={unregisterOutput}
        />
      )}
    </div>
  );
}
