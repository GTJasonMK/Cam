// ============================================================
// 任务节点页面
// 仅展示任务调度 Worker 资源与节点操作
// ============================================================

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkerStore } from '@/stores';
import type { WorkerItem } from '@/stores';
import { WORKER_STATUS_COLORS, getColorVar, getStatusDisplayLabel } from '@/lib/constants';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button, buttonVariants } from '@/components/ui/button';
import { useFeedback } from '@/components/providers/feedback-provider';
import { Trash2 } from 'lucide-react';
import { InlineBar } from '@/components/ui/inline-bar';

export default function WorkersPage() {
  const { workers, loading, fetchWorkers, updateWorkerStatus, pruneOfflineWorkers } = useWorkerStore();
  const { confirm: confirmDialog, notify } = useFeedback();
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [pruningOffline, setPruningOffline] = useState(false);

  useEffect(() => {
    void fetchWorkers();
    const interval = setInterval(() => {
      void fetchWorkers();
    }, 5000);
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

  const statusCounts: Record<string, number> = {};
  for (const worker of workers) {
    statusCounts[worker.status] = (statusCounts[worker.status] || 0) + 1;
  }
  const offlineCount = statusCounts.offline || 0;

  const columns: Column<WorkerItem>[] = useMemo(() => ([
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
      className: 'w-[220px] text-right',
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
  ]), [handleWorkerAction, pendingActionKey]);

  return (
    <div className="space-y-12">
      <PageHeader title="任务节点" subtitle="监控任务调度节点与资源使用情况">
        <div className="flex items-center gap-2">
          <Link href="/workers/terminal" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            终端节点详情
          </Link>
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
        </div>
      </PageHeader>

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

      <DataTable
        columns={columns}
        data={workers}
        rowKey={(row) => row.id}
        loading={loading && workers.length === 0}
        emptyMessage="暂无工作节点注册"
        emptyHint="任务调度时会自动创建工作节点。"
      />
    </div>
  );
}
