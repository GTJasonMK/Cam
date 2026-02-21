// ============================================================
// 仪表盘 — 客户端交互层
// 接收服务端预取数据，负责后续实时更新和交互
// 折叠下方表格区域通过 dynamic import 拆分为独立 chunk，
// 减少首屏 JS 解析/水合阻塞时间
// ============================================================

'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useDashboardStore, type WorkerItem } from '@/stores';
import {
  getColorVar,
  getGradientBg,
} from '@/lib/constants';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ListTodo, Play, Clock, AlertTriangle, XCircle,
  CheckCircle, Wifi, WifiOff, TerminalSquare,
} from 'lucide-react';
import type { DashboardData } from '@/lib/dashboard/queries';

// 折叠下方表格区域 — 独立 chunk（DataTable / StatusBadge / InlineBar / formatDurationMs）
const DashboardTables = dynamic(() => import('./dashboard-tables'), {
  loading: () => <TablesSkeleton />,
});

export default function DashboardClient({ initialData }: { initialData: DashboardData }) {
  const { data, loading, fetchDashboard, sseConnected } = useDashboardStore();

  // 首次挂载：用服务端数据初始化 store
  useEffect(() => {
    useDashboardStore.setState({ data: initialData as never, loading: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 定时刷新（30 秒）
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchDashboard({ silent: true });
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  const displayData = data ?? (initialData as never);
  const kpi = displayData?.kpi;
  const agentSessionSummary = displayData?.agentSessionSummary;

  return (
    <div className="space-y-14">
      <PageHeader title="仪表盘" subtitle="编排系统运行概况">
        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
          {sseConnected ? <Wifi size={16} className="text-success" /> : <WifiOff size={16} className="text-warning" />}
          <span>{sseConnected ? '实时流已连接' : '实时流重连中'}</span>
        </div>
      </PageHeader>

      {/* KPI 指标行 */}
      <div className="grid grid-cols-1 gap-9 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="总任务" value={kpi?.totalTasks ?? 0} icon={ListTodo} token="muted-foreground" href="/tasks" />
        <KpiCard label="运行中" value={kpi?.runningTasks ?? 0} icon={Play} token="primary" href="/tasks?status=running" />
        <KpiCard label="排队中" value={kpi?.queuedTasks ?? 0} icon={Clock} token="accent" href="/tasks?status=queued" />
        <KpiCard label="待审批" value={kpi?.awaitingReview ?? 0} icon={AlertTriangle} token="warning" href="/tasks?status=awaiting_review" />
        <KpiCard label="已完成" value={kpi?.completedTasks ?? 0} icon={CheckCircle} token="success" href="/tasks?status=completed" />
        <KpiCard label="失败" value={kpi?.failedTasks ?? 0} icon={XCircle} token="destructive" href="/tasks?status=failed" />
        <KpiCard label="活跃会话" value={agentSessionSummary?.activeCount ?? 0} icon={TerminalSquare} token="primary" href="/terminal" />
      </div>

      {/* 折叠下方：Worker 表格 + Agent 统计 + 最近事件 */}
      <DashboardTables
        workers={(displayData?.workers || []) as WorkerItem[]}
        workerSummary={displayData?.workerSummary ?? null}
        agentStats={displayData?.agentStats || []}
        durationSummary={displayData?.durationSummary ?? null}
        recentEvents={(displayData?.recentEvents || []).map((e: { type: string; timestamp: string }) => ({ type: e.type, timestamp: e.timestamp }))}
        agentSessions={agentSessionSummary?.sessions ?? []}
        isLoading={loading && !data}
      />
    </div>
  );
}

// ---- KPI 卡片 ----

function KpiCard({
  label,
  value,
  icon: Icon,
  token,
  href,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  token: string;
  href?: string;
}) {
  const isActive = value > 0 && token !== 'muted-foreground';
  const iconColor = isActive ? getColorVar(token) : 'var(--color-muted-foreground)';
  const valueColor = isActive ? getColorVar(token) : 'var(--color-foreground)';

  const content = (
    <div
      className={`group relative min-h-[9.25rem] overflow-hidden rounded-2xl border border-border p-7 shadow-[var(--shadow-card)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        isActive || href ? 'hover:-translate-y-0.5 hover:border-border-light hover:shadow-[var(--shadow-card-hover)]' : ''
      }${href ? ' cursor-pointer' : ''}`}
      style={
        isActive
          ? {
              borderColor: `color-mix(in srgb, ${getColorVar(token)} 30%, transparent)`,
              background: getGradientBg(token),
            }
          : undefined
      }
    >
      {/* 活跃态角落光晕装饰 */}
      {isActive && (
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-25 blur-3xl"
          style={{ background: getColorVar(token) }}
        />
      )}
      <div className="relative flex items-start justify-between gap-4">
        <p className="pt-0.5 text-[0.95rem] font-medium tracking-[0.01em] text-muted-foreground">{label}</p>
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl"
          style={{
            color: iconColor,
            background: isActive
              ? `color-mix(in srgb, ${getColorVar(token)} 12%, transparent)`
              : 'var(--color-muted)',
            border: isActive
              ? `1px solid color-mix(in srgb, ${getColorVar(token)} 20%, transparent)`
              : '1px solid transparent',
          }}
        >
          <Icon size={20} />
        </span>
      </div>
      <div className="mt-6">
        <span className="text-[3rem] font-bold leading-none tracking-[-0.03em]" style={{ color: valueColor }}>
          {value}
        </span>
      </div>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}

// ---- 表格区域加载骨架 ----

function TablesSkeleton() {
  return (
    <div className="grid gap-9 xl:grid-cols-3">
      <div className="space-y-9 xl:col-span-2">
        <div className="rounded-2xl border border-border p-8 shadow-[var(--shadow-card)]">
          <Skeleton className="mb-7 h-4 w-20" />
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-border p-8 shadow-[var(--shadow-card)]">
          <Skeleton className="mb-7 h-4 w-24" />
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
      <div className="rounded-2xl border border-border shadow-[var(--shadow-card)]">
        <div className="border-b border-border/30 px-7 py-5">
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="space-y-5 p-7">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-start gap-4">
              <Skeleton className="mt-2 h-1.5 w-1.5 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3.5 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
