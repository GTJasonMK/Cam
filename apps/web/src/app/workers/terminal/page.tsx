// ============================================================
// 终端节点页面
// 展示终端会话、Agent 与流水线执行详情
// ============================================================

'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TASK_STATUS_COLORS, getStatusDisplayLabel } from '@/lib/constants';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Activity, RefreshCw } from 'lucide-react';
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

export default function WorkerTerminalPage() {
  const searchParams = useSearchParams();
  const sessionIdFromQuery = (searchParams.get('sessionId') || '').trim();
  const pipelineIdFromQuery = (searchParams.get('pipelineId') || '').trim();

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
    void fetchRuntime();
    const interval = setInterval(() => {
      void fetchRuntime({ silent: true });
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchRuntime]);

  useEffect(() => {
    setRuntimeSessionKeyword(sessionIdFromQuery);
  }, [sessionIdFromQuery]);

  useEffect(() => {
    setRuntimePipelineFilter(pipelineIdFromQuery || RUNTIME_PIPELINE_FILTER_ALL);
  }, [pipelineIdFromQuery]);

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

  return (
    <div className="space-y-12">
      <PageHeader title="终端节点" subtitle="查看终端会话、Agent 与流水线执行详情">
        <div className="flex items-center gap-2">
          <Link href="/workers" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            任务节点
          </Link>
          <Button size="sm" variant="secondary" loading={runtimeLoading} onClick={() => void fetchRuntime()}>
            <RefreshCw size={14} className="mr-1.5" />
            刷新执行状态
          </Button>
        </div>
      </PageHeader>

      <div className="space-y-4 rounded-xl border border-border bg-card/70 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-primary" />
            <span className="text-sm font-semibold text-foreground">终端执行概览</span>
          </div>
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
          <span className="text-muted-foreground">
            运行中流水线
            {' '}
            <span className="font-semibold text-primary">{runtimeSummary.runningPipelines}</span>
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
            已定位会话:
            {' '}
            <span className="font-mono">{sessionIdFromQuery}</span>
          </p>
        ) : null}

        {pipelineIdFromQuery ? (
          <p className="text-xs text-muted-foreground">
            已定位流水线:
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
    </div>
  );
}
