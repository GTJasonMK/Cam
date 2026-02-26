// ============================================================
// 仪表盘 — 折叠下方表格区域（动态导入，独立 chunk）
// 包含：Worker 表格、Agent 统计表格、最近事件列表
// ============================================================

'use client';

import Link from 'next/link';
import {
  WORKER_STATUS_COLORS,
  EVENT_TYPE_COLORS,
  getColorVar,
} from '@/lib/constants';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { InlineBar } from '@/components/ui/inline-bar';
import { formatDurationMs } from '@/lib/time/duration';
import { formatDateTimeZhCn } from '@/lib/time/format';
import { truncateText } from '@/lib/terminal/display';
import type { WorkerItem, AgentStatItem } from '@/stores';

/** 活跃 Agent 会话条目 */
interface AgentSessionItem {
  sessionId: string;
  agentDisplayName: string;
  status: string;
  elapsedMs: number;
  repoPath?: string;
}

interface DashboardTablesProps {
  workers: WorkerItem[];
  workerSummary: { idle: number; busy: number; draining: number; offline: number } | null;
  agentStats: AgentStatItem[];
  durationSummary: { completedAvgDurationMs: number | null; completedMaxDurationMs: number | null } | null;
  recentEvents: Array<{ type: string; timestamp: string }>;
  agentSessions: AgentSessionItem[];
  isLoading: boolean;
}

export default function DashboardTables({ workers, workerSummary: ws, agentStats, durationSummary, recentEvents, agentSessions, isLoading }: DashboardTablesProps) {

  return (
    <div className="grid gap-9 xl:grid-cols-3">
      {/* 左: Worker 状态表格 + 活跃 Agent 会话 + Agent 统计 */}
      <div className="space-y-9 xl:col-span-2">
        {/* 活跃 Agent 会话表格（有活跃会话时显示） */}
        {agentSessions.length > 0 && (
          <Card padding="lg">
            <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">活跃 Agent 会话</p>
              <Link href="/terminal" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                打开终端
              </Link>
            </div>
            <DataTable
              columns={agentSessionColumns}
              data={agentSessions}
              rowKey={(r) => r.sessionId}
              loading={isLoading}
              emptyMessage="暂无活跃会话"
            />
          </Card>
        )}

        <Card padding="lg">
          <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">工作节点</p>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <WorkerDot label="空闲" value={ws?.idle ?? 0} token="success" />
              <WorkerDot label="忙碌" value={ws?.busy ?? 0} token="primary" />
              <WorkerDot label="排空" value={ws?.draining ?? 0} token="warning" />
              <WorkerDot label="离线" value={ws?.offline ?? 0} token="destructive" />
            </div>
          </div>
          <DataTable
            columns={workerColumns}
            data={workers}
            rowKey={(r) => r.id}
            loading={isLoading}
            emptyMessage="暂无在线工作节点"
          />
        </Card>

        {/* Agent 统计表格 */}
        <Card padding="lg">
          <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">智能体统计</p>
            {durationSummary && (
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span>均耗 {durationSummary.completedAvgDurationMs != null ? formatDurationMs(durationSummary.completedAvgDurationMs) : '-'}</span>
                <span>最长 {durationSummary.completedMaxDurationMs != null ? formatDurationMs(durationSummary.completedMaxDurationMs) : '-'}</span>
              </div>
            )}
          </div>
          <DataTable
            columns={agentColumns}
            data={agentStats.slice(0, 10)}
            rowKey={(r) => r.agentDefinitionId}
            loading={isLoading}
            emptyMessage="暂无智能体执行数据"
          />
        </Card>
      </div>

      {/* 右: 最近事件 */}
      <div>
        <Card padding="none">
          <div className="flex items-center justify-between border-b border-border/30 px-7 py-5">
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">最近事件</p>
            <Link
              href="/events"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              查看全部
            </Link>
          </div>
          <div className="max-h-[540px] overflow-y-auto">
            {recentEvents.length > 0 ? (
              <div className="divide-y divide-border/30">
                {recentEvents.slice(0, 20).map((e, i) => {
                  const prefix = e.type.split('.')[0];
                  const dotColor = EVENT_TYPE_COLORS[prefix] || 'muted-foreground';
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-4 px-7 py-5 transition-colors duration-100 hover:bg-muted/20"
                    >
                      <span
                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: getColorVar(dotColor) }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.95rem] font-medium">{e.type}</p>
                        <p className="text-sm text-muted-foreground/60">
                          {formatDateTimeZhCn(e.timestamp)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-6 py-16 text-center text-lg text-muted-foreground">
                暂无事件
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---- Worker 状态点 ----

function WorkerDot({ label, value, token }: { label: string; value: number; token: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="h-2 w-2 rounded-full" style={{ background: getColorVar(token) }} />
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
    className: 'w-[140px]',
    cell: (row) => (
      <span className="text-sm text-muted-foreground">
        {row.currentTaskId ? (
          <Link href={`/tasks/${row.currentTaskId}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            {truncateText(row.currentTaskId, 8)}
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
    cell: (row) => <span className="font-mono text-sm">{row.total}</span>,
  },
  {
    key: 'completed',
    header: '完成',
    className: 'w-[70px]',
    cell: (row) => <span className="font-mono text-sm text-success">{row.completed}</span>,
  },
  {
    key: 'failed',
    header: '失败',
    className: 'w-[70px]',
    cell: (row) => <span className="font-mono text-sm text-destructive">{row.failed}</span>,
  },
  {
    key: 'successRate',
    header: '成功率',
    className: 'w-[80px]',
    cell: (row) => <span className="font-mono text-sm">{row.successRate === null ? '-' : `${row.successRate}%`}</span>,
  },
  {
    key: 'avgDuration',
    header: '均耗',
    className: 'w-[90px]',
    cell: (row) => (
      <span className="font-mono text-sm">{row.avgDurationMs === null ? '-' : formatDurationMs(row.avgDurationMs)}</span>
    ),
  },
];

// ---- 活跃 Agent 会话表格列 ----

const AGENT_SESSION_STATUS_COLORS: Record<string, string> = {
  running: 'primary',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'warning',
};

const agentSessionColumns: Column<AgentSessionItem>[] = [
  {
    key: 'agent',
    header: '智能体',
    className: 'min-w-[120px]',
    cell: (row) => <span className="text-sm font-medium">{row.agentDisplayName}</span>,
  },
  {
    key: 'status',
    header: '状态',
    className: 'w-[90px]',
    cell: (row) => {
      const token = AGENT_SESSION_STATUS_COLORS[row.status] || 'muted-foreground';
      return <StatusBadge status={row.status} colorToken={token} />;
    },
  },
  {
    key: 'elapsed',
    header: '运行时间',
    className: 'w-[100px]',
    cell: (row) => <span className="font-mono text-sm">{formatDurationMs(row.elapsedMs)}</span>,
  },
  {
    key: 'repoPath',
    header: '项目路径',
    className: 'min-w-[160px]',
    cell: (row) => (
      <span className="truncate font-mono text-xs text-muted-foreground" title={row.repoPath}>
        {row.repoPath || '-'}
      </span>
    ),
  },
];
