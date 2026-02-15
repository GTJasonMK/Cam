// ============================================================
// 工作节点管理页面
// 使用 DataTable 展示节点列表，行内操作按钮
// ============================================================

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWorkerStore } from '@/stores';
import type { WorkerItem } from '@/stores';
import { WORKER_STATUS_COLORS, getColorVar, getStatusDisplayLabel } from '@/lib/constants';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { useFeedback } from '@/components/providers/feedback-provider';
import { Trash2 } from 'lucide-react';

export default function WorkersPage() {
  const { workers, loading, fetchWorkers, updateWorkerStatus, pruneOfflineWorkers } = useWorkerStore();
  const { confirm: confirmDialog, notify } = useFeedback();
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [pruningOffline, setPruningOffline] = useState(false);

  useEffect(() => {
    fetchWorkers();
    const interval = setInterval(fetchWorkers, 5000);
    return () => clearInterval(interval);
  }, [fetchWorkers]);

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
          <span className="font-mono text-xs text-muted-foreground">{row.currentTaskId.slice(0, 8)}...</span>
        ) : (
          <span className="text-xs text-muted-foreground/50">-</span>
        ),
    },
    {
      key: 'cpuUsage',
      header: 'CPU',
      className: 'w-[120px]',
      cell: (row) => <InlineResourceBar value={row.cpuUsage} max={100} unit="%" />,
    },
    {
      key: 'memoryUsageMb',
      header: '内存',
      className: 'w-[120px]',
      cell: (row) => <InlineResourceBar value={row.memoryUsageMb} max={8192} unit="MB" />,
    },
    {
      key: 'completed',
      header: '已完成',
      className: 'w-[80px]',
      cell: (row) => <span className="text-xs text-success">{row.totalTasksCompleted}</span>,
    },
    {
      key: 'failed',
      header: '已失败',
      className: 'w-[80px]',
      cell: (row) => <span className="text-xs text-destructive">{row.totalTasksFailed}</span>,
    },
    {
      key: 'lastHeartbeatAt',
      header: '最后心跳',
      className: 'w-[100px]',
      cell: (row) =>
        row.lastHeartbeatAt ? (
          <span className="text-xs text-muted-foreground">{new Date(row.lastHeartbeatAt).toLocaleTimeString('zh-CN')}</span>
        ) : (
          <span className="text-xs text-muted-foreground/50">-</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[200px] text-right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          {row.status !== 'draining' && (
            <button
              type="button"
              disabled={pendingActionKey === `${row.id}:drain`}
              onClick={() => handleWorkerAction(row, 'drain')}
              className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              排空
            </button>
          )}
          {row.status !== 'offline' && (
            <button
              type="button"
              disabled={pendingActionKey === `${row.id}:offline`}
              onClick={() => handleWorkerAction(row, 'offline')}
              className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
            >
              离线
            </button>
          )}
          {(row.status === 'draining' || row.status === 'offline') && (
            <button
              type="button"
              disabled={pendingActionKey === `${row.id}:activate`}
              onClick={() => handleWorkerAction(row, 'activate')}
              className="rounded-md px-2 py-1 text-xs font-medium text-success transition-colors hover:bg-success/10 disabled:opacity-40"
            >
              恢复
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="工作节点" subtitle="监控工作节点与资源使用情况">
        <Button
          size="sm"
          variant="destructive"
          disabled={offlineCount === 0 || pruningOffline}
          onClick={handlePruneOfflineWorkers}
        >
          <Trash2 size={14} className="mr-1" />
          {pruningOffline ? '清理中...' : `清理离线 (${offlineCount})`}
        </Button>
      </PageHeader>

      {/* 摘要统计行 */}
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-xs text-muted-foreground">共 {workers.length} 个节点</span>
        <span className="h-3 w-px bg-border" />
        {Object.entries(WORKER_STATUS_COLORS).map(([status, token]) => {
          const count = statusCounts[status] || 0;
          if (count === 0) return null;
          return (
            <span key={status} className="flex items-center gap-1.5 text-xs">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: getColorVar(token) }} />
              <span className="text-muted-foreground">{count} {getStatusDisplayLabel(status)}</span>
            </span>
          );
        })}
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

// ---- 行内资源进度条 ----

function InlineResourceBar({ value, max, unit }: { value: number | null; max: number; unit: string }) {
  if (value == null) {
    return <span className="text-xs text-muted-foreground/40">-</span>;
  }
  const pct = Math.min((value / max) * 100, 100);
  const color =
    pct > 80 ? 'var(--color-destructive)' : pct > 50 ? 'var(--color-warning)' : 'var(--color-primary)';

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="font-mono text-[11px] text-muted-foreground/60">
        {value}{unit}
      </span>
    </div>
  );
}
