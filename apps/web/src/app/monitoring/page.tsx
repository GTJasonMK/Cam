// ============================================================
// 监控面板
// 展示系统资源 + 应用运行状态 + 趋势历史
// ============================================================

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Cpu, HardDrive, MemoryStick, RefreshCw, Server, Workflow } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { InlineBar } from '@/components/ui/inline-bar';
import { readApiEnvelope, resolveApiErrorMessage } from '@/lib/http/client-response';
import { formatDurationMs } from '@/lib/time/duration';
import type { MonitoringHistoryPoint, MonitoringOverview } from '@/lib/monitoring/types';

const POLL_INTERVAL_MS = 5_000;

const WINDOW_OPTIONS = [
  { value: '15', label: '最近 15 分钟' },
  { value: '30', label: '最近 30 分钟' },
  { value: '60', label: '最近 1 小时' },
  { value: '180', label: '最近 3 小时' },
];

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${value.toFixed(1)}%`;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatRate(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '-';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

type LineSeries = {
  label: string;
  color: string;
  values: Array<number | null>;
};

function TrendChart({
  data,
  title,
  series,
  valueFormatter,
}: {
  data: MonitoringHistoryPoint[];
  title: string;
  series: LineSeries[];
  valueFormatter: (value: number | null) => string;
}) {
  const width = 860;
  const height = 220;
  const paddingX = 16;
  const paddingY = 16;

  const maxValue = useMemo(() => {
    let max = 0;
    for (const item of series) {
      for (const value of item.values) {
        if (value === null || !Number.isFinite(value)) continue;
        if (value > max) max = value;
      }
    }
    return max > 0 ? max : 1;
  }, [series]);

  const xForIndex = useCallback(
    (index: number) => {
      if (data.length <= 1) return paddingX;
      const plotWidth = width - paddingX * 2;
      return paddingX + (index / (data.length - 1)) * plotWidth;
    },
    [data.length],
  );

  const yForValue = useCallback(
    (value: number) => {
      const plotHeight = height - paddingY * 2;
      return height - paddingY - (value / maxValue) * plotHeight;
    },
    [maxValue],
  );

  return (
    <Card padding="lg" className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground">峰值 {valueFormatter(maxValue)}</span>
      </div>

      <div className="rounded-xl border border-border bg-background/40 p-3">
        {data.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">暂无监控数据</div>
        ) : (
          <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full">
            {Array.from({ length: 4 }, (_, idx) => {
              const y = paddingY + ((height - paddingY * 2) / 3) * idx;
              return (
                <line
                  key={`grid-${idx}`}
                  x1={paddingX}
                  y1={y}
                  x2={width - paddingX}
                  y2={y}
                  stroke="color-mix(in srgb, var(--color-border) 70%, transparent)"
                  strokeWidth={1}
                />
              );
            })}
            {series.map((item) => {
              const points = item.values
                .map((value, index) => {
                  if (value === null || !Number.isFinite(value)) return null;
                  return `${xForIndex(index)},${yForValue(value)}`;
                })
                .filter(Boolean)
                .join(' ');

              if (!points) return null;
              return (
                <polyline
                  key={item.label}
                  fill="none"
                  stroke={item.color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  points={points}
                />
              );
            })}
          </svg>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs">
        {series.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-2 text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </Card>
  );
}

export default function MonitoringPage() {
  const [windowMinutes, setWindowMinutes] = useState('30');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MonitoringOverview | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const fetchMonitoring = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const response = await fetch(`/api/monitoring?minutes=${encodeURIComponent(windowMinutes)}`, {
          cache: 'no-store',
        });
        const payload = await readApiEnvelope<MonitoringOverview>(response);

        if (!response.ok || !payload?.success || !payload.data) {
          setError(resolveApiErrorMessage(response, payload, `HTTP ${response.status}`));
          return;
        }

        setData(payload.data);
        setError(null);
        setLastUpdatedAt(new Date().toISOString());
      } catch (err) {
        setError(err instanceof Error ? err.message : '读取监控数据失败');
      } finally {
        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [windowMinutes],
  );

  useEffect(() => {
    void fetchMonitoring();
    const timer = setInterval(() => {
      void fetchMonitoring({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchMonitoring]);

  const current = data?.current;
  const history = useMemo(() => data?.history ?? [], [data?.history]);

  const resourceSeries = useMemo(() => {
    return [
      {
        label: 'CPU',
        color: 'var(--color-primary)',
        values: history.map((item) => item.cpuUsagePercent),
      },
      {
        label: '内存',
        color: 'var(--color-accent)',
        values: history.map((item) => item.memoryUsagePercent),
      },
      {
        label: '磁盘',
        color: 'var(--color-warning)',
        values: history.map((item) => item.diskUsagePercent),
      },
    ] satisfies LineSeries[];
  }, [history]);

  const networkSeries = useMemo(() => {
    return [
      {
        label: '入站',
        color: 'var(--color-cyan)',
        values: history.map((item) => item.networkRxBytesPerSec),
      },
      {
        label: '出站',
        color: 'var(--color-success)',
        values: history.map((item) => item.networkTxBytesPerSec),
      },
    ] satisfies LineSeries[];
  }, [history]);

  return (
    <div className="space-y-10">
      <PageHeader title="监控面板" subtitle="实时观察服务器资源、调度负载与会话运行状态">
        <div className="flex items-center gap-2">
          <Select
            className="min-w-[150px]"
            options={WINDOW_OPTIONS}
            value={windowMinutes}
            onChange={(event) => setWindowMinutes(event.target.value)}
          />
          <Button size="sm" variant="secondary" loading={refreshing} onClick={() => void fetchMonitoring({ silent: true })}>
            <RefreshCw size={15} />
            刷新
          </Button>
        </div>
      </PageHeader>

      {error ? (
        <Card padding="md" className="border-destructive/35 bg-destructive/5 text-sm text-destructive">
          监控数据读取失败: {error}
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Cpu}
          label="CPU"
          value={formatPercent(current?.system.cpuUsagePercent)}
          detail={`Load: ${current?.system.loadAvg1m ?? '-'} / ${current?.system.loadAvg5m ?? '-'} / ${current?.system.loadAvg15m ?? '-'}`}
          progressValue={current?.system.cpuUsagePercent ?? 0}
          progressMax={100}
          loading={loading && !data}
        />
        <MetricCard
          icon={MemoryStick}
          label="内存"
          value={formatPercent(current?.system.memoryUsagePercent)}
          detail={`${formatBytes(current?.system.memoryUsedBytes)} / ${formatBytes(current?.system.memoryTotalBytes)}`}
          progressValue={current?.system.memoryUsagePercent ?? 0}
          progressMax={100}
          loading={loading && !data}
        />
        <MetricCard
          icon={HardDrive}
          label="磁盘"
          value={formatPercent(current?.system.diskUsagePercent)}
          detail={`${formatBytes(current?.system.diskUsedBytes)} / ${formatBytes(current?.system.diskTotalBytes)}`}
          progressValue={current?.system.diskUsagePercent ?? 0}
          progressMax={100}
          loading={loading && !data}
        />
        <MetricCard
          icon={Activity}
          label="网络吞吐"
          value={`${formatRate(current?.system.networkRxBytesPerSec ?? 0)} ↓`}
          detail={`${formatRate(current?.system.networkTxBytesPerSec ?? 0)} ↑`}
          progressValue={Math.max(current?.system.networkRxBytesPerSec ?? 0, current?.system.networkTxBytesPerSec ?? 0)}
          progressMax={Math.max(
            ...history.map((item) => Math.max(item.networkRxBytesPerSec, item.networkTxBytesPerSec)),
            1,
          )}
          loading={loading && !data}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card padding="lg" className="space-y-4">
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Workflow size={17} className="text-primary" />
            调度与任务
          </h3>
          <SummaryRow label="总任务" value={`${current?.app.tasks.total ?? 0}`} />
          <SummaryRow label="运行中" value={`${current?.app.tasks.running ?? 0}`} token="primary" />
          <SummaryRow label="排队中" value={`${current?.app.tasks.queued ?? 0}`} token="warning" />
          <SummaryRow label="已完成" value={`${current?.app.tasks.completed ?? 0}`} token="success" />
          <SummaryRow label="失败" value={`${current?.app.tasks.failed ?? 0}`} token="destructive" />
        </Card>

        <Card padding="lg" className="space-y-4">
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Server size={17} className="text-primary" />
            节点与会话
          </h3>
          <SummaryRow label="工作节点总数" value={`${current?.app.workers.total ?? 0}`} />
          <SummaryRow label="忙碌节点" value={`${current?.app.workers.busy ?? 0}`} token="primary" />
          <SummaryRow label="离线节点" value={`${current?.app.workers.offline ?? 0}`} token="destructive" />
          <SummaryRow label="活跃会话" value={`${current?.app.runtime.activeSessions ?? 0}`} token="accent" />
          <SummaryRow label="活跃流水线" value={`${current?.app.runtime.activePipelines ?? 0}`} token="warning" />
        </Card>

        <Card padding="lg" className="space-y-4">
          <h3 className="text-base font-semibold text-foreground">服务进程</h3>
          <SummaryRow label="主机" value={data?.systemInfo.hostname || '-'} />
          <SummaryRow label="系统" value={`${data?.systemInfo.platform || '-'} ${data?.systemInfo.release || ''}`.trim()} />
          <SummaryRow label="Node" value={data?.systemInfo.nodeVersion || '-'} />
          <SummaryRow label="PID" value={String(data?.systemInfo.pid || '-')} />
          <SummaryRow
            label="进程运行时长"
            value={current ? formatDurationMs((current.system.processUptimeSec || 0) * 1000) : '-'}
          />
          <SummaryRow label="上次刷新" value={lastUpdatedAt ? formatTime(lastUpdatedAt) : '-'} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <TrendChart
          data={history}
          title={`资源趋势（${data?.historyWindowMinutes ?? Number(windowMinutes)} 分钟）`}
          series={resourceSeries}
          valueFormatter={(value) => formatPercent(value)}
        />
        <TrendChart
          data={history}
          title={`网络趋势（采样间隔 ${Math.round((data?.sampleIntervalMs || POLL_INTERVAL_MS) / 1000)} 秒）`}
          series={networkSeries}
          valueFormatter={(value) => formatRate(value || 0)}
        />
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  progressValue,
  progressMax,
  loading,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  detail: string;
  progressValue: number;
  progressMax: number;
  loading: boolean;
}) {
  return (
    <Card padding="lg" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="rounded-md border border-border bg-card-elevated/70 p-1.5 text-primary">
          <Icon size={15} />
        </span>
      </div>
      <div>
        <p className="text-3xl font-semibold tracking-tight text-foreground">{loading ? '--' : value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{loading ? '读取中...' : detail}</p>
      </div>
      <InlineBar value={progressValue} max={progressMax || 1} unit="" />
    </Card>
  );
}

function SummaryRow({
  label,
  value,
  token,
}: {
  label: string;
  value: string;
  token?: 'primary' | 'success' | 'warning' | 'destructive' | 'accent';
}) {
  const color = token ? `var(--color-${token})` : 'var(--color-foreground)';
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-background/35 px-3 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
