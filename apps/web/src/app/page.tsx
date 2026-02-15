// ============================================================
// 仪表盘页面
// 紧凑 KPI + Worker 表格 + Agent 统计表格 + 最近事件
// ============================================================

'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useDashboardStore } from '@/stores';
import type { WorkerItem, AgentStatItem } from '@/stores';
import {
  WORKER_STATUS_COLORS,
  EVENT_TYPE_COLORS,
  getColorVar,
} from '@/lib/constants';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { formatDurationMs } from '@/lib/time/duration';
import {
  ListTodo, Play, Clock, AlertTriangle, XCircle,
  CheckCircle, Wifi, WifiOff,
} from 'lucide-react';

export default function DashboardPage() {
  const { data, loading, fetchDashboard, sseConnected } = useDashboardStore();

  useEffect(() => {
    void fetchDashboard();
    const interval = setInterval(() => {
      void fetchDashboard({ silent: true });
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted-foreground">正在加载仪表盘...</span>
        </div>
      </div>
    );
  }

  const kpi = data?.kpi;
  const ws = data?.workerSummary;
  const agentStats = data?.agentStats || [];
  const durationSummary = data?.durationSummary;

  return (
    <div className="space-y-4">
      <PageHeader title="仪表盘" subtitle="编排系统运行概况">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {sseConnected ? <Wifi size={14} className="text-success" /> : <WifiOff size={14} className="text-warning" />}
          <span>{sseConnected ? '实时流已连接' : '实时流重连中'}</span>
        </div>
      </PageHeader>

      {/* KPI 指标行 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="总任务" value={kpi?.totalTasks ?? 0} icon={ListTodo} token="muted-foreground" />
        <KpiCard label="运行中" value={kpi?.runningTasks ?? 0} icon={Play} token="primary" />
        <KpiCard label="排队中" value={kpi?.queuedTasks ?? 0} icon={Clock} token="accent" />
        <KpiCard label="待审批" value={kpi?.awaitingReview ?? 0} icon={AlertTriangle} token="warning" />
        <KpiCard label="已完成" value={kpi?.completedTasks ?? 0} icon={CheckCircle} token="success" />
        <KpiCard label="失败" value={kpi?.failedTasks ?? 0} icon={XCircle} token="destructive" />
      </div>

      {/* 两列布局: Worker + 最近事件 */}
      <div className="grid gap-4 xl:grid-cols-3">
        {/* 左: Worker 状态表格 */}
        <div className="xl:col-span-2 space-y-4">
          <Card padding="lg">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">工作节点</p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <WorkerDot label="空闲" value={ws?.idle ?? 0} token="success" />
                <WorkerDot label="忙碌" value={ws?.busy ?? 0} token="primary" />
                <WorkerDot label="排空" value={ws?.draining ?? 0} token="warning" />
                <WorkerDot label="离线" value={ws?.offline ?? 0} token="destructive" />
              </div>
            </div>
            <DataTable
              columns={workerColumns}
              data={data?.workers || []}
              rowKey={(r) => r.id}
              loading={loading && !data}
              emptyMessage="暂无在线工作节点"
            />
          </Card>

          {/* Agent 统计表格 */}
          <Card padding="lg">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">智能体统计</p>
              {durationSummary && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>均耗 {durationSummary.completedAvgDurationMs != null ? formatDurationMs(durationSummary.completedAvgDurationMs) : '-'}</span>
                  <span>最长 {durationSummary.completedMaxDurationMs != null ? formatDurationMs(durationSummary.completedMaxDurationMs) : '-'}</span>
                </div>
              )}
            </div>
            <DataTable
              columns={agentColumns}
              data={agentStats.slice(0, 10)}
              rowKey={(r) => r.agentDefinitionId}
              loading={loading && !data}
              emptyMessage="暂无智能体执行数据"
            />
          </Card>
        </div>

        {/* 右: 最近事件 */}
        <div>
          <Card padding="none">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">最近事件</p>
              <Link
                href="/events"
                className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                查看全部
              </Link>
            </div>
            <div className="max-h-[540px] overflow-y-auto">
              {data?.recentEvents && data.recentEvents.length > 0 ? (
                <div className="divide-y divide-border/30">
                  {data.recentEvents.slice(0, 20).map((e, i) => {
                    const prefix = e.type.split('.')[0];
                    const dotColor = EVENT_TYPE_COLORS[prefix] || 'muted-foreground';
                    return (
                      <div
                        key={i}
                        className="flex items-start gap-3 px-4 py-2.5 transition-colors duration-100 hover:bg-muted/20"
                      >
                        <span
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: getColorVar(dotColor) }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{e.type}</p>
                          <p className="text-[11px] text-muted-foreground/60">
                            {new Date(e.timestamp).toLocaleString('zh-CN')}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                  暂无事件
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---- KPI 卡片 ----

function KpiCard({
  label,
  value,
  icon: Icon,
  token,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  token: string;
}) {
  const isActive = value > 0 && token !== 'muted-foreground';
  const iconColor = isActive ? getColorVar(token) : 'var(--color-muted-foreground)';
  const valueColor = isActive ? getColorVar(token) : 'var(--color-foreground)';
  return (
    <div
      className="rounded-xl border border-border p-4"
      style={isActive ? { borderColor: `color-mix(in srgb, ${getColorVar(token)} 30%, transparent)` } : undefined}
    >
      <div className="flex items-center justify-between">
        <span style={{ color: iconColor }}><Icon size={16} /></span>
        <span className="text-2xl font-bold tracking-tighter" style={{ color: valueColor }}>
          {value}
        </span>
      </div>
      <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

// ---- Worker 状态点 ----

function WorkerDot({ label, value, token }: { label: string; value: number; token: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: getColorVar(token) }} />
      {label} {value}
    </span>
  );
}

// ---- Worker 表格列 ----

const workerColumns: Column<WorkerItem>[] = [
  {
    key: 'name',
    header: '名称',
    className: 'w-[140px]',
    cell: (row) => <span className="text-sm font-medium">{row.name}</span>,
  },
  {
    key: 'status',
    header: '状态',
    className: 'w-[100px]',
    cell: (row) => {
      const token = WORKER_STATUS_COLORS[row.status] || 'muted-foreground';
      return <StatusBadge status={row.status} colorToken={token} />;
    },
  },
  {
    key: 'currentTask',
    header: '当前任务',
    cell: (row) => (
      <span className="text-xs text-muted-foreground">
        {row.currentTaskId ? (
          <Link href={`/tasks/${row.currentTaskId}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            {row.currentTaskId.slice(0, 8)}
          </Link>
        ) : '-'}
      </span>
    ),
  },
  {
    key: 'cpu',
    header: 'CPU',
    className: 'w-[120px]',
    cell: (row) => <InlineBar value={row.cpuUsage} max={100} unit="%" />,
  },
  {
    key: 'memory',
    header: '内存',
    className: 'w-[120px]',
    cell: (row) => <InlineBar value={row.memoryUsageMb} max={8192} unit="MB" />,
  },
];

// ---- Agent 统计表格列 ----

const agentColumns: Column<AgentStatItem>[] = [
  {
    key: 'agent',
    header: '智能体',
    className: 'min-w-[140px]',
    cell: (row) => (
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.displayName}</p>
        <p className="truncate font-mono text-[10px] text-muted-foreground/60">{row.agentDefinitionId}</p>
      </div>
    ),
  },
  {
    key: 'total',
    header: '总数',
    className: 'w-[70px]',
    cell: (row) => <span className="font-mono text-xs">{row.total}</span>,
  },
  {
    key: 'completed',
    header: '完成',
    className: 'w-[70px]',
    cell: (row) => <span className="font-mono text-xs text-success">{row.completed}</span>,
  },
  {
    key: 'failed',
    header: '失败',
    className: 'w-[70px]',
    cell: (row) => <span className="font-mono text-xs text-destructive">{row.failed}</span>,
  },
  {
    key: 'successRate',
    header: '成功率',
    className: 'w-[80px]',
    cell: (row) => <span className="font-mono text-xs">{row.successRate === null ? '-' : `${row.successRate}%`}</span>,
  },
  {
    key: 'avgDuration',
    header: '均耗',
    className: 'w-[90px]',
    cell: (row) => (
      <span className="font-mono text-xs">{row.avgDurationMs === null ? '-' : formatDurationMs(row.avgDurationMs)}</span>
    ),
  },
];

// ---- 内联进度条 ----

function InlineBar({ value, max, unit }: { value: number | null; max: number; unit: string }) {
  if (value == null) return <span className="text-xs text-muted-foreground/40">-</span>;
  const pct = Math.min((value / max) * 100, 100);
  const color = pct > 80 ? 'var(--color-destructive)' : pct > 50 ? 'var(--color-warning)' : 'var(--color-primary)';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="font-mono text-[11px] text-muted-foreground">{value}{unit}</span>
    </div>
  );
}
