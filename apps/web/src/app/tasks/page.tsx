// ============================================================
// 任务列表页面
// 使用 Tabs + DataTable + Modal 的标准管理页面模式
// ============================================================

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTaskStore, useAgentStore, useRepoStore } from '@/stores';
import type { TaskItem, AgentDefinitionItem, RepositoryItem } from '@/stores';
import { TASK_STATUS_COLORS, getStatusDisplayLabel } from '@/lib/constants';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Tabs } from '@/components/ui/tabs';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Select } from '@/components/ui/input';
import { useFeedback } from '@/components/providers/feedback-provider';
import { formatTaskElapsed } from '@/lib/time/duration';
import { TASK_TEMPLATE_UI_MESSAGES } from '@/lib/i18n/ui-messages';
import { Plus, Layers, Search, ArrowUpDown, XCircle, RotateCcw, CheckCircle, X, ExternalLink, Trash2 } from 'lucide-react';

const FILTER_STATUSES = ['', 'queued', 'waiting', 'running', 'awaiting_review', 'completed', 'failed', 'cancelled'];
const CANCELLABLE_STATUSES = new Set(['queued', 'waiting', 'running']);
const RERUNNABLE_STATUSES = new Set(['failed', 'cancelled', 'completed']);

function canCancelTask(status: string): boolean {
  return CANCELLABLE_STATUSES.has(status);
}
function canRerunTask(status: string): boolean {
  return RERUNNABLE_STATUSES.has(status);
}

export default function TasksPage() {
  const router = useRouter();
  const { tasks, loading, fetchTasks, createTask, createPipeline } = useTaskStore();
  const { agents, fetchAgents } = useAgentStore();
  const { repos, fetchRepos } = useRepoStore();
  const { confirm: confirmDialog, prompt: promptDialog, notify } = useFeedback();
  const [createMode, setCreateMode] = useState<'single' | 'pipeline' | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterGroupId, setFilterGroupId] = useState<string>('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');
  const [groupActionLoading, setGroupActionLoading] = useState(false);
  const [restartFromTaskId, setRestartFromTaskId] = useState<string>('');
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [batchActionLoading, setBatchActionLoading] = useState<null | 'cancel' | 'rerun'>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    fetchTasks();
    fetchAgents();
    fetchRepos();
    const interval = setInterval(() => fetchTasks(), 5000);
    return () => clearInterval(interval);
  }, [fetchTasks, fetchAgents, fetchRepos]);

  const groupIds = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.groupId) set.add(t.groupId);
    }
    return Array.from(set).sort();
  }, [tasks]);

  const tasksInScope = useMemo(() => {
    if (!filterGroupId) return tasks;
    return tasks.filter((t) => t.groupId === filterGroupId);
  }, [tasks, filterGroupId]);

  const groupTaskOptions = useMemo(() => {
    if (!filterGroupId) return [];
    const sorted = [...tasksInScope].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    return sorted.map((t, idx) => ({
      value: t.id,
      label: `${idx + 1}. ${t.title} (${getStatusDisplayLabel(t.status)})`,
    }));
  }, [filterGroupId, tasksInScope]);

  useEffect(() => {
    if (!filterGroupId) { setRestartFromTaskId(''); return; }
    if (restartFromTaskId && groupTaskOptions.some((o) => o.value === restartFromTaskId)) return;
    if (groupTaskOptions.length > 0) setRestartFromTaskId(groupTaskOptions[0].value);
  }, [filterGroupId, groupTaskOptions, restartFromTaskId]);

  // 按状态统计
  const statusCounts: Record<string, number> = {};
  for (const t of tasksInScope) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  }

  const groupSummary = useMemo(() => {
    if (!filterGroupId) return null;
    const total = tasksInScope.length;
    const completed = tasksInScope.filter((t) => t.status === 'completed').length;
    const percent = total ? Math.round((completed / total) * 100) : 0;
    const byId = new Map(tasks.map((t) => [t.id, t]));
    let blocked = 0;
    let waitingOnDeps = 0;
    for (const t of tasksInScope) {
      const deps = t.dependsOn || [];
      if (t.status !== 'waiting' || deps.length === 0) continue;
      const depTasks = deps.map((id) => byId.get(id)).filter(Boolean) as TaskItem[];
      if (depTasks.length !== deps.length) { blocked += 1; continue; }
      if (depTasks.some((d) => d.status === 'failed' || d.status === 'cancelled')) { blocked += 1; continue; }
      waitingOnDeps += 1;
    }
    return { total, completed, percent, blocked, waitingOnDeps };
  }, [filterGroupId, tasksInScope, tasks]);

  const visibleTasks = useMemo(() => {
    let filtered = !filterStatus ? tasksInScope : tasksInScope.filter((t) => t.status === filterStatus);
    const keyword = searchKeyword.trim().toLowerCase();
    if (keyword) {
      filtered = filtered.filter((t) => {
        const text = [t.id, t.title, t.description, t.status, t.agentDefinitionId, t.workBranch, t.groupId || ''].join(' ').toLowerCase();
        return text.includes(keyword);
      });
    }
    return [...filtered].sort((a, b) => {
      const aTs = new Date(a.createdAt).getTime();
      const bTs = new Date(b.createdAt).getTime();
      return sortDirection === 'asc' ? aTs - bTs : bTs - aTs;
    });
  }, [tasksInScope, filterStatus, searchKeyword, sortDirection]);

  const selectedCancellableCount = useMemo(
    () => visibleTasks.filter((t) => selectedTaskIds.has(t.id) && canCancelTask(t.status)).length,
    [visibleTasks, selectedTaskIds]
  );
  const selectedRerunnableCount = useMemo(
    () => visibleTasks.filter((t) => selectedTaskIds.has(t.id) && canRerunTask(t.status)).length,
    [visibleTasks, selectedTaskIds]
  );

  const hasOngoingVisibleTasks = useMemo(
    () => visibleTasks.some((t) => (t.status === 'running' || t.status === 'awaiting_review') && Boolean(t.startedAt) && !t.completedAt),
    [visibleTasks]
  );

  useEffect(() => {
    const visibleIdSet = new Set(visibleTasks.map((t) => t.id));
    setSelectedTaskIds((prev) => {
      const next = new Set([...prev].filter((id) => visibleIdSet.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleTasks]);

  useEffect(() => {
    if (!hasOngoingVisibleTasks) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasOngoingVisibleTasks]);

  const groupRerunnableCount = useMemo(() => {
    if (!filterGroupId) return 0;
    return tasksInScope.filter((t) => t.status === 'failed' || t.status === 'cancelled').length;
  }, [filterGroupId, tasksInScope]);

  const groupCancellableCount = useMemo(() => {
    if (!filterGroupId) return 0;
    return tasksInScope.filter((t) => !['cancelled', 'completed', 'failed'].includes(t.status)).length;
  }, [filterGroupId, tasksInScope]);

  // ---- 分组操作 ----

  const handleCancelGroup = async () => {
    if (!filterGroupId) return;
    const confirmed = await confirmDialog({
      title: '取消该分组任务?',
      description: `分组 "${filterGroupId}" 中所有非终态任务将被取消。`,
      confirmText: '取消分组任务',
      confirmVariant: 'destructive',
    });
    if (!confirmed) return;

    setGroupActionLoading(true);
    try {
      const reason = await promptDialog({
        title: '取消原因(可选)', description: '该原因仅用于事件审计记录。',
        label: '原因', placeholder: '输入取消原因(可选)', defaultValue: '', confirmText: '提交',
      });
      if (reason === null) return;

      const res = await fetch('/api/task-groups/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: filterGroupId, reason: reason?.trim() || undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) { notify({ type: 'error', title: '分组取消失败', message: json?.error?.message || '请求失败' }); return; }
      notify({ type: 'success', title: '分组已取消', message: `已取消 ${json?.data?.cancelled ?? 0} 个任务` });
      await fetchTasks();
    } finally { setGroupActionLoading(false); }
  };

  const handleRerunFailedInGroup = async () => {
    if (!filterGroupId || groupRerunnableCount === 0) return;
    const confirmed = await confirmDialog({
      title: '重跑失败任务?',
      description: `将重跑分组 "${filterGroupId}" 中 ${groupRerunnableCount} 个失败/已取消任务。`,
      confirmText: '重跑',
    });
    if (!confirmed) return;

    setGroupActionLoading(true);
    try {
      const feedback = await promptDialog({
        title: '重跑反馈(可选)', description: '将覆盖本次被重跑任务的 feedback。',
        label: '反馈', placeholder: '输入反馈(可选)', defaultValue: '', multiline: true, confirmText: '提交',
      });
      if (feedback === null) return;

      const res = await fetch('/api/task-groups/rerun-failed', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: filterGroupId, feedback: feedback.trim() || undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) { notify({ type: 'error', title: '重跑失败', message: json?.error?.message || '请求失败' }); return; }
      notify({ type: 'success', title: '分组已重新入队', message: `已重排队 ${json?.data?.requeued ?? 0} 个任务` });
      await fetchTasks();
    } finally { setGroupActionLoading(false); }
  };

  const handleRestartFrom = async () => {
    if (!filterGroupId || !restartFromTaskId) return;
    const confirmed = await confirmDialog({
      title: '从该步骤重启?', description: '该步骤将重新入队，下游任务会重置为 waiting。', confirmText: '重启',
    });
    if (!confirmed) return;

    setGroupActionLoading(true);
    try {
      const feedback = await promptDialog({
        title: '重启反馈(可选)', description: '将写入该 step 的 feedback。',
        label: '反馈', placeholder: '输入反馈(可选)', defaultValue: '', multiline: true, confirmText: '提交',
      });
      if (feedback === null) return;

      const res = await fetch('/api/task-groups/restart-from', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: filterGroupId, fromTaskId: restartFromTaskId, feedback: feedback.trim() || undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) { notify({ type: 'error', title: '重启失败', message: json?.error?.message || '请求失败' }); return; }
      notify({ type: 'success', title: '重启已提交', message: `已重置 ${json?.data?.resetTasks ?? 0} 个任务` });
      await fetchTasks();
    } finally { setGroupActionLoading(false); }
  };

  // ---- 批量操作 ----

  const handleBatchCancel = async () => {
    const targets = visibleTasks.filter((t) => selectedTaskIds.has(t.id) && canCancelTask(t.status));
    if (targets.length === 0) return;
    const confirmed = await confirmDialog({
      title: '取消已选任务?', description: `将取消 ${targets.length} 个任务。`, confirmText: '批量取消', confirmVariant: 'destructive',
    });
    if (!confirmed) return;

    setBatchActionLoading('cancel');
    let success = 0, failed = 0;
    for (const task of targets) {
      try {
        const res = await fetch(`/api/tasks/${task.id}/cancel`, { method: 'POST' });
        const json = await res.json().catch(() => null);
        if (json?.success) success += 1; else failed += 1;
      } catch { failed += 1; }
    }
    setBatchActionLoading(null);
    setSelectedTaskIds(new Set());
    await fetchTasks();
    if (failed > 0) { notify({ type: 'error', title: '批量取消部分失败', message: `成功 ${success}，失败 ${failed}` }); return; }
    notify({ type: 'success', title: '批量取消完成', message: `已取消 ${success} 个任务` });
  };

  const handleBatchRerun = async () => {
    const targets = visibleTasks.filter((t) => selectedTaskIds.has(t.id) && canRerunTask(t.status));
    if (targets.length === 0) return;
    const feedback = await promptDialog({
      title: '批量重跑反馈(可选)', description: '将统一追加到本次重跑任务。',
      label: '反馈', placeholder: '输入反馈(可选)', defaultValue: '', multiline: true, confirmText: '批量重跑',
    });
    if (feedback === null) return;
    const confirmed = await confirmDialog({
      title: '重跑已选任务?', description: `将重跑 ${targets.length} 个任务。`, confirmText: '确认重跑',
    });
    if (!confirmed) return;

    setBatchActionLoading('rerun');
    let success = 0, failed = 0;
    for (const task of targets) {
      try {
        const res = await fetch(`/api/tasks/${task.id}/rerun`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback: feedback.trim() || undefined }),
        });
        const json = await res.json().catch(() => null);
        if (json?.success) success += 1; else failed += 1;
      } catch { failed += 1; }
    }
    setBatchActionLoading(null);
    setSelectedTaskIds(new Set());
    await fetchTasks();
    if (failed > 0) { notify({ type: 'error', title: '批量重跑部分失败', message: `成功 ${success}，失败 ${failed}` }); return; }
    notify({ type: 'success', title: '批量重跑完成', message: `已重跑 ${success} 个任务` });
  };

  // ---- 单行操作 ----

  const handleRowReview = async (task: TaskItem, action: 'approve' | 'reject', options?: { merge?: boolean }) => {
    let feedback: string | null = null;
    if (action === 'reject') {
      feedback = await promptDialog({
        title: '拒绝反馈(必填)', description: '拒绝后会自动重跑，并将反馈注入下一次提示词。',
        label: '反馈', placeholder: '请输入拒绝原因/反馈', defaultValue: task.feedback || '',
        required: true, multiline: true, confirmText: '拒绝并重跑',
      });
      if (feedback == null) return;
      if (!feedback.trim()) { notify({ type: 'error', title: '反馈必填', message: '拒绝操作必须填写反馈。' }); return; }
    }
    const res = await fetch(`/api/tasks/${task.id}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, merge: options?.merge ? true : undefined, feedback: feedback?.trim() || undefined }),
    });
    const json = await res.json().catch(() => null);
    if (!json?.success) { notify({ type: 'error', title: '审批失败', message: json?.error?.message || '请求失败' }); return; }
    notify({ type: 'success', title: '审批已更新', message: action === 'approve' ? '任务已通过审批。' : '任务已拒绝并重跑。' });
    fetchTasks();
  };

  const handleRowCancel = async (task: TaskItem) => {
    const label = task.status === 'running' ? '停止' : '取消';
    const confirmed = await confirmDialog({
      title: `确认${label}任务?`, description: `${label}任务 "${task.title}"`, confirmText: label, confirmVariant: 'destructive',
    });
    if (!confirmed) return;
    await fetch(`/api/tasks/${task.id}/cancel`, { method: 'POST' });
    notify({ type: 'success', title: '任务已取消', message: `任务 ${task.title} 已取消。` });
    fetchTasks();
  };

  const handleRowRerun = async (task: TaskItem) => {
    const feedback = await promptDialog({
      title: '重跑反馈(可选)', description: '将追加到提示词。',
      label: '反馈', placeholder: '输入重跑反馈(可选)', defaultValue: task.feedback || '',
      multiline: true, confirmText: '重跑',
    });
    if (feedback == null) return;
    const res = await fetch(`/api/tasks/${task.id}/rerun`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: feedback.trim() || undefined }),
    });
    const json = await res.json().catch(() => null);
    if (!json?.success) { notify({ type: 'error', title: '重跑失败', message: json?.error?.message || '请求失败' }); return; }
    notify({ type: 'success', title: '任务已重新入队', message: '任务已重新入队。' });
    fetchTasks();
  };

  // ---- 表格列 ----

  const columns: Column<TaskItem>[] = [
    {
      key: 'title',
      header: '标题',
      className: 'min-w-[200px]',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{row.title}</p>
          {row.description && (
            <p className="truncate text-xs text-muted-foreground/60 mt-0.5 max-w-[280px]">{row.description.slice(0, 80)}</p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      className: 'w-[110px]',
      cell: (row) => {
        const token = TASK_STATUS_COLORS[row.status] || 'muted-foreground';
        return <StatusBadge status={row.status} colorToken={token} />;
      },
    },
    {
      key: 'agent',
      header: 'Agent',
      className: 'w-[120px]',
      cell: (row) => <span className="text-xs text-muted-foreground">{row.agentDefinitionId}</span>,
    },
    {
      key: 'branch',
      header: '分支',
      className: 'w-[130px]',
      cell: (row) => <span className="font-mono text-xs text-muted-foreground">{row.workBranch}</span>,
    },
    {
      key: 'worker',
      header: 'Worker',
      className: 'w-[100px]',
      cell: (row) => <span className="text-xs text-muted-foreground">{row.assignedWorkerId || '-'}</span>,
    },
    {
      key: 'createdAt',
      header: '创建时间',
      className: 'w-[130px]',
      cell: (row) => <span className="text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString('zh-CN')}</span>,
    },
    {
      key: 'elapsed',
      header: '耗时',
      className: 'w-[100px]',
      cell: (row) => {
        const elapsed = formatTaskElapsed(row, { nowMs });
        return (
          <span className="text-xs text-muted-foreground">
            {elapsed.text !== '-' ? elapsed.text : '-'}
            {elapsed.ongoing ? ' ...' : ''}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[200px] text-right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {row.status === 'awaiting_review' && (
            <>
              <button type="button" onClick={() => handleRowReview(row, 'approve')}
                className="rounded-md px-2 py-1 text-xs font-medium text-success transition-colors hover:bg-success/10" title="通过">
                <CheckCircle size={14} />
              </button>
              <button type="button" onClick={() => handleRowReview(row, 'approve', { merge: true })}
                className="rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10" title="通过并合并">
                通过+合并
              </button>
              <button type="button" onClick={() => handleRowReview(row, 'reject')}
                className="rounded-md px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10" title="拒绝并重跑">
                <XCircle size={14} />
              </button>
            </>
          )}
          {canCancelTask(row.status) && (
            <button type="button" onClick={() => handleRowCancel(row)}
              className="rounded-md px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10" title={row.status === 'running' ? '停止' : '取消'}>
              <X size={14} />
            </button>
          )}
          {canRerunTask(row.status) && (
            <button type="button" onClick={() => handleRowRerun(row)}
              className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="重跑">
              <RotateCcw size={14} />
            </button>
          )}
          {row.prUrl && (
            <a href={row.prUrl} target="_blank" rel="noopener noreferrer"
              className="rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10" title="查看 PR">
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      ),
    },
  ];

  // ---- Tabs ----

  const tabs = FILTER_STATUSES.map((s) => ({
    key: s || 'all',
    label: s ? getStatusDisplayLabel(s) : '全部',
    count: s ? (statusCounts[s] || 0) : tasksInScope.length,
  }));

  return (
    <div className="space-y-4">
      <PageHeader title="任务" subtitle="管理与监控编排任务">
        <div className="flex items-center gap-2">
          <Button onClick={() => setCreateMode('single')}>
            <Plus size={15} className="mr-1" />
            新建任务
          </Button>
          <Button variant="secondary" onClick={() => setCreateMode('pipeline')}>
            <Layers size={15} className="mr-1" />
            新建流水线
          </Button>
        </div>
      </PageHeader>

      {/* 状态 Tabs */}
      <Tabs
        tabs={tabs}
        activeKey={filterStatus || 'all'}
        onChange={(key) => setFilterStatus(key === 'all' ? '' : key)}
      />

      {/* 工具栏: 搜索 + 分组筛选 + 排序 + 批量操作 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="标题 / 描述 / ID"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/50 transition-colors hover:border-border-light focus:border-primary focus:outline-none"
            />
          </div>
          {groupIds.length > 0 && (
            <div className="w-48">
              <Select
                label="分组"
                value={filterGroupId}
                onChange={(e) => setFilterGroupId(e.target.value)}
                options={[{ value: '', label: '全部分组' }, ...groupIds.map((g) => ({ value: g, label: g }))]}
              />
            </div>
          )}
          <button
            onClick={() => setSortDirection((d) => d === 'desc' ? 'asc' : 'desc')}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="切换排序"
          >
            <ArrowUpDown size={13} />
            {sortDirection === 'desc' ? '最新优先' : '最早优先'}
          </button>
        </div>

        {/* 批量操作 */}
        {selectedTaskIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">已选 {selectedTaskIds.size} 项</span>
            <Button size="sm" variant="destructive" disabled={batchActionLoading !== null || selectedCancellableCount === 0} onClick={handleBatchCancel}>
              {batchActionLoading === 'cancel' ? '取消中...' : `批量取消 (${selectedCancellableCount})`}
            </Button>
            <Button size="sm" variant="secondary" disabled={batchActionLoading !== null || selectedRerunnableCount === 0} onClick={handleBatchRerun}>
              {batchActionLoading === 'rerun' ? '重跑中...' : `批量重跑 (${selectedRerunnableCount})`}
            </Button>
            <button onClick={() => setSelectedTaskIds(new Set())}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
              清空
            </button>
          </div>
        )}
      </div>

      {/* 分组汇总 */}
      {filterGroupId && groupSummary && (
        <Card padding="lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">分组</p>
              <p className="truncate font-mono text-sm">{filterGroupId}</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                {groupSummary.completed}/{groupSummary.total} 已完成 ({groupSummary.percent}%)
                {groupSummary.blocked > 0 ? ` | ${groupSummary.blocked} 个阻塞` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="destructive" disabled={groupActionLoading || groupCancellableCount === 0} onClick={handleCancelGroup}>
                取消分组
              </Button>
              <Button size="sm" variant="secondary" disabled={groupActionLoading || groupRerunnableCount === 0} onClick={handleRerunFailedInGroup}>
                重跑失败
              </Button>
              <button onClick={() => setFilterGroupId('')}
                className="rounded-lg bg-muted px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors">
                清空筛选
              </button>
            </div>
          </div>

          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-success transition-all duration-500" style={{ width: `${groupSummary.percent}%` }} />
          </div>

          {groupTaskOptions.length > 0 && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[260px] flex-1">
                <Select label="从步骤重启" value={restartFromTaskId}
                  onChange={(e) => setRestartFromTaskId(e.target.value)} options={groupTaskOptions} />
              </div>
              <Button size="sm" disabled={groupActionLoading || !restartFromTaskId} onClick={handleRestartFrom}>
                重启
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* 数据表格 */}
      <DataTable
        columns={columns}
        data={visibleTasks}
        rowKey={(r) => r.id}
        loading={loading && tasks.length === 0}
        emptyMessage="未找到匹配任务"
        emptyHint={filterStatus || searchKeyword ? '请尝试调整筛选条件。' : '先创建一个任务开始使用。'}
        selectable
        selectedKeys={selectedTaskIds}
        onSelectionChange={setSelectedTaskIds}
        onRowClick={(row) => router.push(`/tasks/${row.id}`)}
      />

      {/* 创建任务 Modal */}
      <CreateTaskModal
        open={createMode === 'single'}
        agents={agents}
        repos={repos}
        availableTasks={tasks}
        onClose={() => setCreateMode(null)}
        onCreated={() => { setCreateMode(null); fetchTasks(); }}
        createTask={createTask}
      />

      {/* 创建流水线 Modal */}
      <CreatePipelineModal
        open={createMode === 'pipeline'}
        agents={agents}
        repos={repos}
        onClose={() => setCreateMode(null)}
        onCreated={(groupId) => {
          setCreateMode(null);
          setFilterGroupId(groupId);
          setFilterStatus('');
          fetchTasks();
        }}
        createPipeline={createPipeline}
      />
    </div>
  );
}

// ---- 创建任务 Modal ----

function CreateTaskModal({
  open, agents, repos, availableTasks, onClose, onCreated, createTask,
}: {
  open: boolean;
  agents: AgentDefinitionItem[];
  repos: RepositoryItem[];
  availableTasks: TaskItem[];
  onClose: () => void;
  onCreated: () => void;
  createTask: (input: Record<string, unknown>) => Promise<{ success: boolean; errorMessage?: string; missingEnvVars?: string[] }>;
}) {
  const { prompt: promptDialog, notify } = useFeedback();
  const [form, setForm] = useState({
    title: '', description: '', agentDefinitionId: '', repoUrl: '', baseBranch: 'main',
    workDir: '', maxRetries: 2, groupId: '', dependsOn: [] as string[],
  });
  const [repoPresetId, setRepoPresetId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState<Array<{
    id: string; name: string; titleTemplate: string; promptTemplate: string;
    agentDefinitionId: string | null; repositoryId: string | null;
    repoUrl: string | null; baseBranch: string | null; workDir: string | null;
  }>>([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [depToAdd, setDepToAdd] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [missingEnvVars, setMissingEnvVars] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ title: '', description: '', agentDefinitionId: agents[0]?.id || '', repoUrl: '', baseBranch: 'main', workDir: '', maxRetries: 2, groupId: '', dependsOn: [] });
      setRepoPresetId(''); setTemplateId(''); setSubmitError(null); setMissingEnvVars([]); setSaving(false);
    }
  }, [open, agents]);

  const fetchTemplates = useCallback(async (nextTemplateId?: string) => {
    setTemplateLoading(true);
    try {
      const res = await fetch('/api/task-templates');
      const json = await res.json().catch(() => null);
      if (!json?.success || !Array.isArray(json?.data)) return;
      setTemplates(json.data);
      if (typeof nextTemplateId === 'string') { setTemplateId(nextTemplateId); return; }
      setTemplateId((prev) => (prev && json.data.some((item: { id: string }) => item.id === prev) ? prev : ''));
    } finally { setTemplateLoading(false); }
  }, []);

  useEffect(() => { if (open) fetchTemplates(); }, [open, fetchTemplates]);

  const applyTemplate = (selectedId: string) => {
    setTemplateId(selectedId);
    if (!selectedId) return;
    const tpl = templates.find((item) => item.id === selectedId);
    if (!tpl) return;
    const preset = tpl.repositoryId ? repos.find((r) => r.id === tpl.repositoryId) : null;
    setRepoPresetId(tpl.repositoryId || '');
    setForm((prev) => ({
      ...prev, title: tpl.titleTemplate, description: tpl.promptTemplate,
      agentDefinitionId: tpl.agentDefinitionId || prev.agentDefinitionId,
      repoUrl: preset?.repoUrl || tpl.repoUrl || prev.repoUrl,
      baseBranch: tpl.baseBranch || preset?.defaultBaseBranch || prev.baseBranch,
      workDir: tpl.workDir || preset?.defaultWorkDir || '',
    }));
  };

  const handleSaveTemplate = async () => {
    if (!form.description.trim()) { notify({ type: 'error', title: TASK_TEMPLATE_UI_MESSAGES.missingPromptTitle, message: TASK_TEMPLATE_UI_MESSAGES.missingPromptMessage }); return; }
    const name = await promptDialog({
      title: TASK_TEMPLATE_UI_MESSAGES.saveDialog.title, description: TASK_TEMPLATE_UI_MESSAGES.saveDialog.description,
      label: TASK_TEMPLATE_UI_MESSAGES.saveDialog.label, placeholder: TASK_TEMPLATE_UI_MESSAGES.saveDialog.placeholder,
      defaultValue: form.title.trim() || '', required: true, confirmText: TASK_TEMPLATE_UI_MESSAGES.saveDialog.confirmText,
    });
    if (name === null || !name.trim()) return;
    setTemplateLoading(true);
    try {
      const res = await fetch('/api/task-templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), titleTemplate: form.title.trim(), promptTemplate: form.description.trim(),
          agentDefinitionId: form.agentDefinitionId || null, repositoryId: repoPresetId || null,
          repoUrl: form.repoUrl.trim() || null, baseBranch: form.baseBranch.trim() || null, workDir: form.workDir.trim() || null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) { notify({ type: 'error', title: TASK_TEMPLATE_UI_MESSAGES.saveFailedTitle, message: json?.error?.message || '' }); return; }
      notify({ type: 'success', title: TASK_TEMPLATE_UI_MESSAGES.saveSuccessTitle, message: TASK_TEMPLATE_UI_MESSAGES.saveSuccessMessage(name.trim()) });
      await fetchTemplates(json?.data?.id);
    } finally { setTemplateLoading(false); }
  };

  const handleSubmit = async () => {
    setSaving(true);
    const payload: Record<string, unknown> = {
      title: form.title, description: form.description, agentDefinitionId: form.agentDefinitionId,
      repositoryId: repoPresetId || undefined, repoUrl: form.repoUrl, baseBranch: form.baseBranch,
      workDir: form.workDir || undefined, maxRetries: form.maxRetries, groupId: form.groupId || undefined, dependsOn: form.dependsOn,
    };
    const result = await createTask(payload);
    setSaving(false);
    if (result.success) { setSubmitError(null); setMissingEnvVars([]); onCreated(); return; }
    setSubmitError(result.errorMessage || '创建任务失败');
    setMissingEnvVars(result.missingEnvVars || []);
  };

  const canSubmit = !saving && form.title.trim() !== '' && form.description.trim() !== '' && form.repoUrl.trim() !== '';

  return (
    <Modal open={open} onClose={onClose} title="创建任务" size="xl" footer={
      <>
        <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
        <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>{saving ? '创建中...' : '创建并入队'}</Button>
      </>
    }>
      <div className="space-y-4">
        {/* 模板区 */}
        <div className="rounded-lg border border-border bg-muted/10 p-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
            <Select label={TASK_TEMPLATE_UI_MESSAGES.templateSelectLabel} value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              options={[{ value: '', label: templateLoading ? TASK_TEMPLATE_UI_MESSAGES.templateSelectLoading : TASK_TEMPLATE_UI_MESSAGES.templateSelectNone }, ...templates.map((item) => ({ value: item.id, label: item.name }))]} />
            <Button type="button" size="sm" variant="secondary" disabled={templateLoading} onClick={handleSaveTemplate}>
              {TASK_TEMPLATE_UI_MESSAGES.saveCurrentAction}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground/70">
            {TASK_TEMPLATE_UI_MESSAGES.sectionHint}
            <Link href="/templates" className="ml-1 underline hover:text-foreground">{TASK_TEMPLATE_UI_MESSAGES.manageLink}</Link>
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="标题" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Select label="智能体" value={form.agentDefinitionId}
            onChange={(e) => setForm({ ...form, agentDefinitionId: e.target.value })}
            options={agents.map((a) => ({ value: a.id, label: a.displayName }))} />
          <Select label="仓库预设" value={repoPresetId}
            onChange={(e) => {
              const next = e.target.value; setRepoPresetId(next);
              const preset = repos.find((r) => r.id === next);
              if (!preset) return;
              setForm((prev) => ({ ...prev, repoUrl: preset.repoUrl, baseBranch: preset.defaultBaseBranch || prev.baseBranch, workDir: preset.defaultWorkDir || '' }));
            }}
            options={[{ value: '', label: '自定义(手动填写 URL)' }, ...repos.map((r) => ({ value: r.id, label: r.name }))]} />
          <Input label="Git 仓库地址" required value={form.repoUrl} onChange={(e) => setForm({ ...form, repoUrl: e.target.value })} placeholder="git@github.com:user/repo.git" />
          <Input label="基线分支" value={form.baseBranch} onChange={(e) => setForm({ ...form, baseBranch: e.target.value })} />
          <Input label="工作目录" value={form.workDir} onChange={(e) => setForm({ ...form, workDir: e.target.value })} placeholder="packages/app" />
        </div>

        <Textarea label="任务描述 / 提示词" required rows={4} value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="描述要交给编码智能体执行的任务..." />

        {/* 高级编排 */}
        <details className="rounded-lg border border-border bg-muted/10 px-4 py-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">高级编排选项</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Input label="最大重试次数" type="number" min={0} max={20} value={String(form.maxRetries)}
              onChange={(e) => setForm({ ...form, maxRetries: Number(e.target.value || 0) })} />
            <Input label="分组 ID(可选)" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })} placeholder="feature/login" />
            <Select label="添加依赖" value={depToAdd}
              onChange={(e) => {
                const id = e.target.value; setDepToAdd('');
                if (!id) return;
                setForm((prev) => ({ ...prev, dependsOn: prev.dependsOn.includes(id) ? prev.dependsOn : [...prev.dependsOn, id] }));
              }}
              options={[{ value: '', label: '选择任务...' }, ...availableTasks.map((t) => ({ value: t.id, label: `${t.title} (${getStatusDisplayLabel(t.status)})` }))]} />
            <div>
              <p className="mb-2 block text-xs font-medium text-muted-foreground">已选依赖</p>
              {form.dependsOn.length === 0 ? <p className="text-xs text-muted-foreground/60">暂无</p> : (
                <div className="flex flex-wrap gap-2">
                  {form.dependsOn.map((id) => (
                    <button key={id} type="button"
                      onClick={() => setForm((prev) => ({ ...prev, dependsOn: prev.dependsOn.filter((x) => x !== id) }))}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/40" title="点击移除">
                      <span className="font-mono">{id.slice(0, 8)}</span>
                      <span className="text-muted-foreground/50">x</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </details>

        {submitError && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive">
            <div className="font-medium">{submitError}</div>
            {missingEnvVars.length > 0 && (
              <div className="mt-1 text-muted-foreground">
                缺少环境变量: <span className="font-mono">{missingEnvVars.join(', ')}</span>
                (可在 <Link className="underline" href="/settings">设置</Link> 中配置密钥)
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---- 创建流水线 Modal ----

function CreatePipelineModal({
  open, agents, repos, onClose, onCreated, createPipeline,
}: {
  open: boolean;
  agents: AgentDefinitionItem[];
  repos: RepositoryItem[];
  onClose: () => void;
  onCreated: (groupId: string) => void;
  createPipeline: (input: {
    agentDefinitionId: string; repositoryId?: string; repoUrl: string; baseBranch?: string;
    workDir?: string; maxRetries?: number; groupId?: string;
    steps: Array<{ title: string; description: string }>;
  }) => Promise<{ success: boolean; groupId?: string; errorMessage?: string; missingEnvVars?: string[] }>;
}) {
  const [form, setForm] = useState({
    agentDefinitionId: '', repoUrl: '', baseBranch: 'main', workDir: '', maxRetries: 2, groupId: '',
  });
  const [repoPresetId, setRepoPresetId] = useState('');
  const [steps, setSteps] = useState<Array<{ title: string; description: string }>>([{ title: '', description: '' }]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [missingEnvVars, setMissingEnvVars] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ agentDefinitionId: agents[0]?.id || '', repoUrl: '', baseBranch: 'main', workDir: '', maxRetries: 2, groupId: '' });
      setRepoPresetId(''); setSteps([{ title: '', description: '' }]); setSubmitError(null); setMissingEnvVars([]); setSaving(false);
    }
  }, [open, agents]);

  const handleSubmit = async () => {
    const normalizedSteps = steps.map((s) => ({ title: s.title.trim(), description: s.description.trim() })).filter((s) => s.title || s.description);
    if (normalizedSteps.length === 0) { setSubmitError('请至少添加 1 个步骤'); return; }
    if (normalizedSteps.some((s) => !s.title || !s.description)) { setSubmitError('每个步骤都必须包含标题与描述'); return; }

    setSaving(true);
    const result = await createPipeline({
      agentDefinitionId: form.agentDefinitionId, repositoryId: repoPresetId || undefined,
      repoUrl: form.repoUrl, baseBranch: form.baseBranch, workDir: form.workDir || undefined,
      maxRetries: form.maxRetries, groupId: form.groupId || undefined, steps: normalizedSteps,
    });
    setSaving(false);
    if (result.success) { setSubmitError(null); setMissingEnvVars([]); onCreated(result.groupId || form.groupId || 'pipeline'); return; }
    setSubmitError(result.errorMessage || '创建流水线失败');
    setMissingEnvVars(result.missingEnvVars || []);
  };

  const canSubmit = !saving && form.repoUrl.trim() !== '' && steps.some((s) => s.title.trim() && s.description.trim());

  return (
    <Modal open={open} onClose={onClose} title="创建流水线" size="xl" footer={
      <>
        <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
        <Button size="sm" variant="secondary" onClick={() => setSteps((s) => [...s, { title: '', description: '' }])}>
          <Plus size={13} className="mr-1" /> 添加步骤
        </Button>
        <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>{saving ? '创建中...' : '创建流水线'}</Button>
      </>
    }>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          将创建 {steps.length} 个任务，并自动串行依赖(步骤 N 依赖步骤 N-1)。
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="智能体" value={form.agentDefinitionId}
            onChange={(e) => setForm({ ...form, agentDefinitionId: e.target.value })}
            options={agents.map((a) => ({ value: a.id, label: a.displayName }))} />
          <Input label="基线分支" value={form.baseBranch} onChange={(e) => setForm({ ...form, baseBranch: e.target.value })} />
          <Select label="仓库预设" value={repoPresetId}
            onChange={(e) => {
              const next = e.target.value; setRepoPresetId(next);
              const preset = repos.find((r) => r.id === next);
              if (!preset) return;
              setForm((prev) => ({ ...prev, repoUrl: preset.repoUrl, baseBranch: preset.defaultBaseBranch || prev.baseBranch, workDir: preset.defaultWorkDir || '' }));
            }}
            options={[{ value: '', label: '自定义' }, ...repos.map((r) => ({ value: r.id, label: r.name }))]} />
          <Input label="Git 仓库地址" required value={form.repoUrl} onChange={(e) => setForm({ ...form, repoUrl: e.target.value })} placeholder="git@github.com:user/repo.git" />
          <Input label="工作目录" value={form.workDir} onChange={(e) => setForm({ ...form, workDir: e.target.value })} placeholder="packages/app" />
          <Input label="最大重试" type="number" min={0} max={20} value={String(form.maxRetries)} onChange={(e) => setForm({ ...form, maxRetries: Number(e.target.value || 0) })} />
          <Input label="分组 ID(可选)" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })} placeholder="pipeline/feature-login" />
        </div>

        <div className="space-y-3">
          {steps.map((step, idx) => (
            <div key={idx} className="rounded-lg border border-border bg-muted/10 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground">
                  步骤 {idx + 1}{idx > 0 ? `(依赖步骤 ${idx})` : ''}
                </p>
                {steps.length > 1 && (
                  <button type="button" onClick={() => setSteps((s) => s.filter((_, i) => i !== idx))}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="标题" required value={step.title}
                  onChange={(e) => setSteps((s) => s.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)))}
                  placeholder="例如: 扫描仓库结构" />
                <div className="sm:col-span-2">
                  <Textarea label="描述 / 提示词" required rows={3} value={step.description}
                    onChange={(e) => setSteps((s) => s.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))}
                    placeholder="描述该步骤需要智能体执行的内容..." />
                </div>
              </div>
            </div>
          ))}
        </div>

        {submitError && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive">
            <div className="font-medium">{submitError}</div>
            {missingEnvVars.length > 0 && (
              <div className="mt-1 text-muted-foreground">
                缺少环境变量: <span className="font-mono">{missingEnvVars.join(', ')}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
