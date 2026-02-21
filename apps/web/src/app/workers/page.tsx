// ============================================================
// 工作节点管理页面
// 使用 DataTable 展示节点列表，行内操作按钮
// ============================================================

'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkerStore } from '@/stores';
import type { WorkerItem } from '@/stores';
import { TASK_STATUS_COLORS, WORKER_STATUS_COLORS, getColorVar, getStatusDisplayLabel } from '@/lib/constants';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { useFeedback } from '@/components/providers/feedback-provider';
import { Activity, Trash2, RefreshCw } from 'lucide-react';
import { InlineBar } from '@/components/ui/inline-bar';
import { formatDurationMs } from '@/lib/time/duration';

type RuntimeSessionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

type RuntimeSessionItem = {
  sessionId: string;
  agentDefinitionId: string;
  agentDisplayName: string;
  prompt: string;
  status: RuntimeSessionStatus;
  exitCode: number | null;
  elapsedMs: number;
  workBranch: string;
  repoUrl: string | null;
  createdAt: string;
  lastActivityAt: string;
  taskId: string | null;
  pipelineId: string | null;
  repoPath: string | null;
  mode: 'create' | 'resume' | 'continue' | null;
  claudeSessionId: string | null;
};

type RuntimePipelineNode = {
  nodeIndex: number;
  title: string;
  status: 'draft' | 'running' | 'completed' | 'failed' | 'cancelled';
  sessionId: string | null;
  taskId: string;
  agentDefinitionId: string | null;
};

type RuntimePipelineStep = {
  stepId: string;
  stepIndex: number;
  title: string;
  status: 'draft' | 'running' | 'completed' | 'failed' | 'cancelled';
  inputFiles: string[];
  inputCondition: string | null;
  nodes: RuntimePipelineNode[];
};

type RuntimePipelineItem = {
  pipelineId: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  currentStepIndex: number;
  totalSteps: number;
  steps: RuntimePipelineStep[];
};

type RuntimeSummary = {
  totalSessions: number;
  runningSessions: number;
  totalPipelines: number;
  activePipelines: number;
  runningPipelines: number;
  pausedPipelines: number;
};

const RUNTIME_SESSION_STATUS_COLORS: Record<RuntimeSessionStatus, string> = {
  running: 'primary',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'muted-foreground',
};

const RUNTIME_PIPELINE_STATUS_COLORS: Record<RuntimePipelineItem['status'], string> = {
  running: 'primary',
  paused: 'warning',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'muted-foreground',
};

const RUNTIME_PIPELINE_FILTER_ALL = '__all__';
const RUNTIME_PIPELINE_FILTER_ONLY = '__pipeline_only__';

export default function WorkersPage() {
  const searchParams = useSearchParams();
  const sessionIdFromQuery = (searchParams.get('sessionId') || '').trim();
  const pipelineIdFromQuery = (searchParams.get('pipelineId') || '').trim();
  const { workers, loading, fetchWorkers, updateWorkerStatus, pruneOfflineWorkers } = useWorkerStore();
  const { confirm: confirmDialog, notify } = useFeedback();
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [pruningOffline, setPruningOffline] = useState(false);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeSummary, setRuntimeSummary] = useState<RuntimeSummary>({
    totalSessions: 0,
    runningSessions: 0,
    totalPipelines: 0,
    activePipelines: 0,
    runningPipelines: 0,
    pausedPipelines: 0,
  });
  const [runtimeSessions, setRuntimeSessions] = useState<RuntimeSessionItem[]>([]);
  const [runtimePipelines, setRuntimePipelines] = useState<RuntimePipelineItem[]>([]);
  const [runtimeSessionKeyword, setRuntimeSessionKeyword] = useState(sessionIdFromQuery);
  const [runtimeRunningOnly, setRuntimeRunningOnly] = useState(false);
  const [runtimePipelineFilter, setRuntimePipelineFilter] = useState<string>(
    pipelineIdFromQuery || RUNTIME_PIPELINE_FILTER_ALL,
  );

  const fetchRuntime = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) setRuntimeLoading(true);
    try {
      const res = await fetch('/api/workers/runtime');
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setRuntimeError(json?.error?.message || `HTTP ${res.status}`);
        return;
      }
      setRuntimeSummary(json.data.summary as RuntimeSummary);
      setRuntimeSessions(json.data.agentSessions as RuntimeSessionItem[]);
      setRuntimePipelines(json.data.pipelines as RuntimePipelineItem[]);
      setRuntimeError(null);
    } catch (err) {
      setRuntimeError((err as Error).message);
    } finally {
      if (!silent) setRuntimeLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchWorkers();
    void fetchRuntime();
    const interval = setInterval(() => {
      void fetchWorkers();
      void fetchRuntime({ silent: true });
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchWorkers, fetchRuntime]);

  useEffect(() => {
    setRuntimeSessionKeyword(sessionIdFromQuery);
  }, [sessionIdFromQuery]);

  useEffect(() => {
    setRuntimePipelineFilter(pipelineIdFromQuery || RUNTIME_PIPELINE_FILTER_ALL);
  }, [pipelineIdFromQuery]);

  const handleWorkerAction = useCallback(
    async (worker: WorkerItem, action: 'drain' | 'offline' | 'activate') => {
      if (action === 'offline') {
        const confirmed = await confirmDialog({
          title: `强制将 ${worker.name} 置为离线?`,
          description: '该操作会立即清空当前任务绑定，适用于异常节点人工摘除。',
          confirmText: '强制离线',
          confirmVariant: 'destructive',
        });
        if (!confirmed) return;
      }

      const actionKey = `${worker.id}:${action}`;
      setPendingActionKey(actionKey);
      const res = await updateWorkerStatus(worker.id, action);
      setPendingActionKey(null);

      if (!res.success) {
        notify({ type: 'error', title: '节点操作失败', message: res.errorMessage || '请求失败' });
        return;
      }

      const actionText = action === 'drain' ? '已切换为排空中' : action === 'offline' ? '已强制离线' : '已恢复可调度';
      notify({ type: 'success', title: '节点状态已更新', message: `${worker.name} ${actionText}` });
    },
    [confirmDialog, notify, updateWorkerStatus]
  );

  const handlePruneOfflineWorkers = useCallback(async () => {
    const offlineWorkers = workers.filter((w) => w.status === 'offline');
    if (offlineWorkers.length === 0) {
      notify({ type: 'error', title: '无可清理节点', message: '当前没有离线节点记录。' });
      return;
    }

    const confirmed = await confirmDialog({
      title: `清理 ${offlineWorkers.length} 个离线节点记录?`,
      description: '仅删除状态为 offline 的历史记录，不影响在线节点。',
      confirmText: '确认清理',
      confirmVariant: 'destructive',
    });
    if (!confirmed) return;

    setPruningOffline(true);
    const result = await pruneOfflineWorkers();
    setPruningOffline(false);

    if (!result.success) {
      notify({ type: 'error', title: '清理失败', message: result.errorMessage || '请求失败' });
      return;
    }
    notify({ type: 'success', title: '清理完成', message: `已删除 ${result.removed ?? 0} 个离线节点记录。` });
  }, [confirmDialog, notify, pruneOfflineWorkers, workers]);

  // 统计
  const statusCounts: Record<string, number> = {};
  for (const w of workers) {
    statusCounts[w.status] = (statusCounts[w.status] || 0) + 1;
  }
  const offlineCount = statusCounts.offline || 0;

  const filteredRuntimeSessions = useMemo(() => {
    const keyword = runtimeSessionKeyword.trim().toLowerCase();
    let filtered = runtimeSessions;

    if (keyword) {
      filtered = filtered.filter((session) => {
        const text = [
          session.sessionId,
          session.agentDefinitionId,
          session.agentDisplayName,
          session.prompt,
          session.workBranch,
          session.pipelineId || '',
          session.taskId || '',
        ].join(' ').toLowerCase();
        return text.includes(keyword);
      });
    }

    if (runtimeRunningOnly) {
      filtered = filtered.filter((session) => session.status === 'running');
    }

    if (runtimePipelineFilter === RUNTIME_PIPELINE_FILTER_ONLY) {
      filtered = filtered.filter((session) => Boolean(session.pipelineId));
    } else if (runtimePipelineFilter !== RUNTIME_PIPELINE_FILTER_ALL) {
      filtered = filtered.filter((session) => session.pipelineId === runtimePipelineFilter);
    }

    return filtered;
  }, [runtimeSessions, runtimeSessionKeyword, runtimeRunningOnly, runtimePipelineFilter]);

  const runtimeRunningSessionCount = useMemo(
    () => runtimeSessions.filter((session) => session.status === 'running').length,
    [runtimeSessions],
  );

  const runtimePipelineSessionCount = useMemo(
    () => runtimeSessions.filter((session) => Boolean(session.pipelineId)).length,
    [runtimeSessions],
  );

  const runtimePipelineFilterOptions = useMemo(() => {
    const perPipelineCount = new Map<string, number>();

    for (const session of runtimeSessions) {
      if (!session.pipelineId) continue;
      perPipelineCount.set(session.pipelineId, (perPipelineCount.get(session.pipelineId) || 0) + 1);
    }

    for (const pipeline of runtimePipelines) {
      if (!perPipelineCount.has(pipeline.pipelineId)) {
        perPipelineCount.set(pipeline.pipelineId, 0);
      }
    }

    if (pipelineIdFromQuery && !perPipelineCount.has(pipelineIdFromQuery)) {
      perPipelineCount.set(pipelineIdFromQuery, 0);
    }

    const pipelineIds = Array.from(perPipelineCount.keys()).sort();

    return [
      { value: RUNTIME_PIPELINE_FILTER_ALL, label: '全部会话' },
      { value: RUNTIME_PIPELINE_FILTER_ONLY, label: `仅流水线会话 (${runtimePipelineSessionCount})` },
      ...pipelineIds.map((pipelineId) => ({
        value: pipelineId,
        label: `${pipelineId} (${perPipelineCount.get(pipelineId) || 0})`,
      })),
    ];
  }, [pipelineIdFromQuery, runtimePipelines, runtimeSessions, runtimePipelineSessionCount]);

  const hasRuntimeSessionFilters = useMemo(
    () => runtimeSessionKeyword.trim() !== ''
      || runtimeRunningOnly
      || runtimePipelineFilter !== RUNTIME_PIPELINE_FILTER_ALL,
    [runtimePipelineFilter, runtimeRunningOnly, runtimeSessionKeyword],
  );

  const sortedRuntimeSessions = useMemo(() => {
    return [...filteredRuntimeSessions].sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (a.status !== 'running' && b.status === 'running') return 1;
      return b.elapsedMs - a.elapsedMs;
    });
  }, [filteredRuntimeSessions]);

  const highlightedRuntimeSessionKeys = useMemo(() => {
    if (!sessionIdFromQuery) return undefined;
    return sortedRuntimeSessions.some((session) => session.sessionId === sessionIdFromQuery)
      ? new Set([sessionIdFromQuery])
      : undefined;
  }, [sessionIdFromQuery, sortedRuntimeSessions]);

  const sortedRuntimePipelines = useMemo(() => {
    return [...runtimePipelines].sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (a.status !== 'running' && b.status === 'running') return 1;
      if (a.status === 'paused' && b.status !== 'paused') return -1;
      if (a.status !== 'paused' && b.status === 'paused') return 1;
      return a.pipelineId.localeCompare(b.pipelineId);
    });
  }, [runtimePipelines]);

  const runtimeSessionColumns: Column<RuntimeSessionItem>[] = [
    {
      key: 'sessionId',
      header: '会话 ID',
      className: 'w-[180px]',
      cell: (row) => (
        <span className="font-mono text-xs text-muted-foreground">{row.sessionId.slice(0, 12)}</span>
      ),
    },
    {
      key: 'agent',
      header: 'Agent',
      className: 'w-[180px]',
      cell: (row) => (
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">{row.agentDisplayName}</div>
          <div className="font-mono text-[11px] text-muted-foreground">{row.agentDefinitionId}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      className: 'w-[110px]',
      cell: (row) => (
        <StatusBadge status={row.status} colorToken={RUNTIME_SESSION_STATUS_COLORS[row.status]} />
      ),
    },
    {
      key: 'elapsed',
      header: '执行时长',
      className: 'w-[120px]',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDurationMs(row.elapsedMs)}</span>
      ),
    },
    {
      key: 'scope',
      header: '归属',
      className: 'w-[170px]',
      cell: (row) => (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">
            {row.pipelineId ? `流水线: ${row.pipelineId}` : '独立 Agent'}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">{row.workBranch || '-'}</div>
        </div>
      ),
    },
    {
      key: 'task',
      header: '任务',
      className: 'w-[130px]',
      cell: (row) => (
        row.taskId ? (
          <Link href={`/tasks/${row.taskId}`} className="font-mono text-xs text-primary hover:underline">
            {row.taskId.slice(0, 8)}...
          </Link>
        ) : <span className="text-xs text-muted-foreground">-</span>
      ),
    },
    {
      key: 'prompt',
      header: '执行内容',
      cell: (row) => (
        <span className="block max-w-[320px] truncate text-xs text-muted-foreground">
          {row.prompt || '-'}
        </span>
      ),
    },
  ];

  // 表格列定义
  const columns: Column<WorkerItem>[] = [
    {
      key: 'name',
      header: '名称',
      className: 'w-[150px]',
      cell: (row) => <span className="font-medium text-foreground">{row.name}</span>,
    },
    {
      key: 'status',
      header: '状态',
      className: 'w-[100px]',
      cell: (row) => {
        const colorToken = WORKER_STATUS_COLORS[row.status] || 'muted-foreground';
        return <StatusBadge status={row.status} colorToken={colorToken} />;
      },
    },
    {
      key: 'currentTaskId',
      header: '当前任务',
      className: 'w-[130px]',
      cell: (row) =>
        row.currentTaskId ? (
          <span className="font-mono text-sm text-muted-foreground">{row.currentTaskId.slice(0, 8)}...</span>
        ) : (
          <span className="text-sm text-muted-foreground/50">-</span>
        ),
    },
    {
      key: 'cpuUsage',
      header: 'CPU',
      className: 'w-[120px]',
      cell: (row) => <InlineBar value={row.cpuUsage} max={100} unit="%" />,
    },
    {
      key: 'memoryUsageMb',
      header: '内存',
      className: 'w-[120px]',
      cell: (row) => <InlineBar value={row.memoryUsageMb} max={8192} unit="MB" />,
    },
    {
      key: 'completed',
      header: '已完成',
      className: 'w-[80px]',
      cell: (row) => <span className="text-sm text-success">{row.totalTasksCompleted}</span>,
    },
    {
      key: 'failed',
      header: '已失败',
      className: 'w-[80px]',
      cell: (row) => <span className="text-sm text-destructive">{row.totalTasksFailed}</span>,
    },
    {
      key: 'lastHeartbeatAt',
      header: '最后心跳',
      className: 'w-[100px]',
      cell: (row) =>
        row.lastHeartbeatAt ? (
          <span className="text-sm text-muted-foreground">{new Date(row.lastHeartbeatAt).toLocaleTimeString('zh-CN')}</span>
        ) : (
          <span className="text-sm text-muted-foreground/50">-</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[200px] text-right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          {row.status !== 'draining' && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pendingActionKey === `${row.id}:drain`}
              onClick={() => handleWorkerAction(row, 'drain')}
            >
              排空
            </Button>
          )}
          {row.status !== 'offline' && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pendingActionKey === `${row.id}:offline`}
              onClick={() => handleWorkerAction(row, 'offline')}
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              离线
            </Button>
          )}
          {(row.status === 'draining' || row.status === 'offline') && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pendingActionKey === `${row.id}:activate`}
              onClick={() => handleWorkerAction(row, 'activate')}
              className="text-success hover:bg-success/10"
            >
              恢复
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-12">
      <PageHeader title="工作节点" subtitle="监控工作节点与资源使用情况">
        <Button
          size="sm"
          variant="destructive"
          loading={pruningOffline}
          disabled={offlineCount === 0 || pruningOffline}
          onClick={handlePruneOfflineWorkers}
        >
          <Trash2 size={16} className="mr-1.5" />
          清理离线 ({offlineCount})
        </Button>
      </PageHeader>

      {/* 摘要统计行 */}
      <div className="flex flex-wrap items-center gap-5 rounded-xl border border-border bg-card/70 px-5 py-4">
        <span className="text-sm text-muted-foreground">共 {workers.length} 个节点</span>
        <span className="h-3 w-px bg-border" />
        {Object.entries(WORKER_STATUS_COLORS).map(([status, token]) => {
          const count = statusCounts[status] || 0;
          if (count === 0) return null;
          return (
            <span key={status} className="flex items-center gap-2.5 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: getColorVar(token) }} />
              <span className="text-muted-foreground">{count} {getStatusDisplayLabel(status)}</span>
            </span>
          );
        })}
      </div>

      {/* 终端执行单元 */}
      <div className="space-y-4 rounded-xl border border-border bg-card/70 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-primary" />
            <span className="text-sm font-semibold text-foreground">终端执行单元</span>
            <span className="text-xs text-muted-foreground">（Agent 会话 + 流水线）</span>
          </div>
          <Button size="sm" variant="secondary" loading={runtimeLoading} onClick={() => void fetchRuntime()}>
            <RefreshCw size={14} className="mr-1.5" />
            刷新执行状态
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-5 text-sm">
          <span className="text-muted-foreground">
            会话总数
            {' '}
            <span className="font-semibold text-foreground">{runtimeSummary.totalSessions}</span>
          </span>
          <span className="text-muted-foreground">
            运行中会话
            {' '}
            <span className="font-semibold text-primary">{runtimeSummary.runningSessions}</span>
          </span>
          <span className="text-muted-foreground">
            活跃流水线
            {' '}
            <span className="font-semibold text-primary">{runtimeSummary.activePipelines}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <Input
              label="会话筛选"
              value={runtimeSessionKeyword}
              onChange={(event) => setRuntimeSessionKeyword(event.target.value)}
              placeholder="按会话 ID / Agent / 分支 / 提示词筛选"
            />
          </div>
          <div className="min-w-[260px] flex-1">
            <Select
              label="流水线聚焦"
              value={runtimePipelineFilter}
              onChange={(event) => setRuntimePipelineFilter(event.target.value)}
              options={runtimePipelineFilterOptions}
            />
          </div>
          <Button
            size="sm"
            variant={runtimeRunningOnly ? 'secondary' : 'ghost'}
            onClick={() => setRuntimeRunningOnly((prev) => !prev)}
          >
            仅看运行中
            {' '}
            ({runtimeRunningSessionCount})
          </Button>
          <Button
            size="sm"
            variant={runtimePipelineFilter === RUNTIME_PIPELINE_FILTER_ONLY ? 'secondary' : 'ghost'}
            onClick={() => setRuntimePipelineFilter((prev) => (
              prev === RUNTIME_PIPELINE_FILTER_ONLY
                ? RUNTIME_PIPELINE_FILTER_ALL
                : RUNTIME_PIPELINE_FILTER_ONLY
            ))}
          >
            仅流水线会话
            {' '}
            ({runtimePipelineSessionCount})
          </Button>
          {hasRuntimeSessionFilters ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRuntimeSessionKeyword('');
                setRuntimeRunningOnly(false);
                setRuntimePipelineFilter(RUNTIME_PIPELINE_FILTER_ALL);
              }}
            >
              清空筛选
            </Button>
          ) : null}
        </div>

        {sessionIdFromQuery ? (
          <p className="text-xs text-muted-foreground">
            已从终端页定位会话:
            {' '}
            <span className="font-mono">{sessionIdFromQuery}</span>
          </p>
        ) : null}

        {pipelineIdFromQuery ? (
          <p className="text-xs text-muted-foreground">
            已从终端页定位流水线:
            {' '}
            <span className="font-mono">{pipelineIdFromQuery}</span>
          </p>
        ) : null}

        {runtimeError && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            终端执行状态加载失败: {runtimeError}
          </div>
        )}

        <DataTable
          columns={runtimeSessionColumns}
          data={sortedRuntimeSessions}
          rowKey={(row) => row.sessionId}
          loading={runtimeLoading && sortedRuntimeSessions.length === 0}
          emptyMessage="暂无终端会话"
          emptyHint="在终端页启动 Agent 或流水线后，会在此展示每个会话的执行状态。"
          selectedKeys={highlightedRuntimeSessionKeys}
        />

        {sortedRuntimePipelines.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">流水线明细</div>
            {sortedRuntimePipelines.map((pipeline) => (
              <div key={pipeline.pipelineId} className="rounded-lg border border-border bg-card-elevated/65 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{pipeline.pipelineId}</span>
                  <StatusBadge
                    status={pipeline.status}
                    colorToken={RUNTIME_PIPELINE_STATUS_COLORS[pipeline.status]}
                    label={`${getStatusDisplayLabel(pipeline.status)} · 步骤 ${pipeline.currentStepIndex + 1}/${pipeline.totalSteps}`}
                  />
                </div>

                <div className="mt-2 space-y-1.5">
                  {pipeline.steps.map((step) => (
                    <div key={`${pipeline.pipelineId}-${step.stepId}`} className="rounded border border-border bg-background/45 px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-muted-foreground">步骤 {step.stepIndex + 1}</span>
                        <span className="text-foreground">{step.title}</span>
                        <StatusBadge
                          status={step.status}
                          colorToken={TASK_STATUS_COLORS[step.status] || 'muted-foreground'}
                          size="sm"
                        />
                      </div>
                      <div className="mt-1 space-y-1">
                        {step.nodes.map((node) => (
                          <div key={`${pipeline.pipelineId}-${step.stepId}-${node.nodeIndex}`} className="flex flex-wrap items-center gap-2 text-[11px]">
                            <span className="text-muted-foreground">节点 {node.nodeIndex + 1}</span>
                            <span className="text-muted-foreground">{node.title}</span>
                            <StatusBadge
                              status={node.status}
                              colorToken={TASK_STATUS_COLORS[node.status] || 'muted-foreground'}
                              size="sm"
                            />
                            {node.sessionId && (
                              <span className="font-mono text-muted-foreground">{node.sessionId.slice(0, 10)}</span>
                            )}
                            {node.taskId && (
                              <Link href={`/tasks/${node.taskId}`} className="font-mono text-primary hover:underline">
                                {node.taskId.slice(0, 8)}...
                              </Link>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 数据表格 */}
      <DataTable
        columns={columns}
        data={workers}
        rowKey={(r) => r.id}
        loading={loading && workers.length === 0}
        emptyMessage="暂无工作节点注册"
        emptyHint="任务调度时会自动创建工作节点。"
      />
    </div>
  );
}
