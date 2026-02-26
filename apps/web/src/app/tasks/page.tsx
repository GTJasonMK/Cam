// ============================================================
// 任务列表页面
// 使用 Tabs + DataTable + Modal 的标准管理页面模式
// ============================================================

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTaskStore, useAgentStore, useRepoStore } from '@/stores';
import type { TaskItem, AgentDefinitionItem, RepositoryItem } from '@/stores';
import { TASK_STATUS_COLORS, getStatusDisplayLabel } from '@/lib/constants';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { TabBar } from '@/components/ui/tabs';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Select } from '@/components/ui/input';
import { useFeedback } from '@/components/providers/feedback-provider';
import { formatTaskElapsed } from '@/lib/time/duration';
import { readApiEnvelope, resolveApiErrorMessage } from '@/lib/http/client-response';
import { formatDateTimeZhCn, toSafeTimestamp } from '@/lib/time/format';
import { truncateText } from '@/lib/terminal/display';
import { normalizeOptionalString } from '@/lib/validation/strings';
import { TASK_TEMPLATE_UI_MESSAGES } from '@/lib/i18n/ui-messages';
import { Plus, Layers, Search, ArrowUpDown, XCircle, RotateCcw, CheckCircle, X, ExternalLink, Trash2, TerminalSquare } from 'lucide-react';

const FILTER_STATUSES = ['', 'queued', 'waiting', 'running', 'awaiting_review', 'completed', 'failed', 'cancelled'];
const CANCELLABLE_STATUSES = new Set(['queued', 'waiting', 'running']);
const RERUNNABLE_STATUSES = new Set(['failed', 'cancelled', 'completed']);
const DELETABLE_STATUSES = new Set(['draft', 'completed', 'failed', 'cancelled']);

function canCancelTask(status: string): boolean {
  return CANCELLABLE_STATUSES.has(status);
}
function canRerunTask(task: Pick<TaskItem, 'status' | 'source'>): boolean {
  return task.source === 'scheduler' && RERUNNABLE_STATUSES.has(task.status);
}
function canDeleteTask(status: string): boolean {
  return DELETABLE_STATUSES.has(status);
}

function toOptionalString(value: string): string | undefined {
  return normalizeOptionalString(value) ?? undefined;
}

type TaskTemplateOption = {
  id: string;
  name: string;
  titleTemplate: string;
  promptTemplate: string;
  agentDefinitionId: string | null;
  repositoryId: string | null;
  repoUrl: string | null;
  baseBranch: string | null;
  workDir: string | null;
  pipelineSteps?: unknown[] | null;
  maxRetries?: number | null;
};

export default function TasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tasks, loading, fetchTasks, createTask, createPipeline } = useTaskStore();
  const { agents, fetchAgents } = useAgentStore();
  const { repos, fetchRepos } = useRepoStore();
  const { confirm: confirmDialog, prompt: promptDialog, notify } = useFeedback();
  const [createMode, setCreateMode] = useState<'single' | 'pipeline' | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>(searchParams.get('status') ?? '');
  const [filterGroupId, setFilterGroupId] = useState<string>('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');
  const [groupActionLoading, setGroupActionLoading] = useState(false);
  const [restartFromTaskId, setRestartFromTaskId] = useState<string>('');
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [batchActionLoading, setBatchActionLoading] = useState<null | 'cancel' | 'rerun' | 'delete'>(null);
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
      (a, b) => toSafeTimestamp(a.createdAt) - toSafeTimestamp(b.createdAt)
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
      const aTs = toSafeTimestamp(a.createdAt);
      const bTs = toSafeTimestamp(b.createdAt);
      return sortDirection === 'asc' ? aTs - bTs : bTs - aTs;
    });
  }, [tasksInScope, filterStatus, searchKeyword, sortDirection]);

  const selectedCancellableCount = useMemo(
    () => visibleTasks.filter((t) => selectedTaskIds.has(t.id) && canCancelTask(t.status)).length,
    [visibleTasks, selectedTaskIds]
  );
  const selectedRerunnableCount = useMemo(
    () => visibleTasks.filter((t) => selectedTaskIds.has(t.id) && canRerunTask(t)).length,
    [visibleTasks, selectedTaskIds]
  );
  const selectedDeletableCount = useMemo(
    () => visibleTasks.filter((t) => selectedTaskIds.has(t.id) && canDeleteTask(t.status)).length,
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

  const requestApi = useCallback(
    async <T,>(
      input: RequestInfo | URL,
      init: RequestInit | undefined,
      fallbackMessage: string,
    ): Promise<{ ok: boolean; data: T | undefined; errorMessage: string }> => {
      try {
        const response = await fetch(input, init);
        const payload = await readApiEnvelope<T>(response);
        if (!response.ok || !payload?.success) {
          return {
            ok: false,
            data: undefined,
            errorMessage: resolveApiErrorMessage(response, payload, fallbackMessage),
          };
        }
        return { ok: true, data: payload.data, errorMessage: '' };
      } catch (error) {
        return {
          ok: false,
          data: undefined,
          errorMessage: error instanceof Error && error.message ? error.message : fallbackMessage,
        };
      }
    },
    [],
  );

  const cancelTaskById = useCallback(
    async (taskId: string, reason?: string) => {
      const normalizedReason = reason ? toOptionalString(reason) : undefined;
      return requestApi<unknown>(
        `/api/tasks/${taskId}/cancel`,
        {
          method: 'POST',
          ...(normalizedReason
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: normalizedReason }),
              }
            : {}),
        },
        '请求失败',
      );
    },
    [requestApi],
  );

  const rerunTaskById = useCallback(
    async (taskId: string, feedback?: string) => {
      const normalizedFeedback = feedback ? toOptionalString(feedback) : undefined;
      return requestApi<unknown>(
        `/api/tasks/${taskId}/rerun`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback: normalizedFeedback }),
        },
        '请求失败',
      );
    },
    [requestApi],
  );

  const deleteTaskById = useCallback(
    async (taskId: string) => requestApi<unknown>(`/api/tasks/${taskId}`, { method: 'DELETE' }, '请求失败'),
    [requestApi],
  );

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

      const result = await requestApi<{ cancelled?: number }>(
        '/api/task-groups/cancel',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId: filterGroupId, reason: reason ? toOptionalString(reason) : undefined }),
        },
        '请求失败',
      );
      if (!result.ok) {
        notify({ type: 'error', title: '分组取消失败', message: result.errorMessage });
        return;
      }
      notify({ type: 'success', title: '分组已取消', message: `已取消 ${result.data?.cancelled ?? 0} 个任务` });
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

      const result = await requestApi<{ requeued?: number }>(
        '/api/task-groups/rerun-failed',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId: filterGroupId, feedback: toOptionalString(feedback) }),
        },
        '请求失败',
      );
      if (!result.ok) {
        notify({ type: 'error', title: '重跑失败', message: result.errorMessage });
        return;
      }
      notify({ type: 'success', title: '分组已重新入队', message: `已重排队 ${result.data?.requeued ?? 0} 个任务` });
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

      const result = await requestApi<{ resetTasks?: number }>(
        '/api/task-groups/restart-from',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId: filterGroupId, fromTaskId: restartFromTaskId, feedback: toOptionalString(feedback) }),
        },
        '请求失败',
      );
      if (!result.ok) {
        notify({ type: 'error', title: '重启失败', message: result.errorMessage });
        return;
      }
      notify({ type: 'success', title: '重启已提交', message: `已重置 ${result.data?.resetTasks ?? 0} 个任务` });
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
      const result = await cancelTaskById(task.id);
      if (result.ok) success += 1;
      else failed += 1;
    }
    setBatchActionLoading(null);
    setSelectedTaskIds(new Set());
    await fetchTasks();
    if (failed > 0) { notify({ type: 'error', title: '批量取消部分失败', message: `成功 ${success}，失败 ${failed}` }); return; }
    notify({ type: 'success', title: '批量取消完成', message: `已取消 ${success} 个任务` });
  };

  const handleBatchRerun = async () => {
    const targets = visibleTasks.filter((t) => selectedTaskIds.has(t.id) && canRerunTask(t));
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

    const normalizedFeedback = toOptionalString(feedback);
    setBatchActionLoading('rerun');
    let success = 0, failed = 0;
    for (const task of targets) {
      const result = await rerunTaskById(task.id, normalizedFeedback);
      if (result.ok) success += 1;
      else failed += 1;
    }
    setBatchActionLoading(null);
    setSelectedTaskIds(new Set());
    await fetchTasks();
    if (failed > 0) { notify({ type: 'error', title: '批量重跑部分失败', message: `成功 ${success}，失败 ${failed}` }); return; }
    notify({ type: 'success', title: '批量重跑完成', message: `已重跑 ${success} 个任务` });
  };

  const handleBatchDelete = async () => {
    const targets = visibleTasks.filter((t) => selectedTaskIds.has(t.id) && canDeleteTask(t.status));
    if (targets.length === 0) return;
    const confirmed = await confirmDialog({
      title: '删除已选任务?',
      description: `将永久删除 ${targets.length} 个任务记录（不可恢复）。`,
      confirmText: '批量删除',
      confirmVariant: 'destructive',
    });
    if (!confirmed) return;

    setBatchActionLoading('delete');
    let success = 0, failed = 0;
    for (const task of targets) {
      const result = await deleteTaskById(task.id);
      if (result.ok) success += 1;
      else failed += 1;
    }
    setBatchActionLoading(null);
    setSelectedTaskIds(new Set());
    await fetchTasks();
    if (failed > 0) { notify({ type: 'error', title: '批量删除部分失败', message: `成功 ${success}，失败 ${failed}` }); return; }
    notify({ type: 'success', title: '批量删除完成', message: `已删除 ${success} 个任务` });
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
    const result = await requestApi<unknown>(
      `/api/tasks/${task.id}/review`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          merge: options?.merge ? true : undefined,
          feedback: feedback ? toOptionalString(feedback) : undefined,
        }),
      },
      '请求失败',
    );
    if (!result.ok) {
      notify({ type: 'error', title: '审批失败', message: result.errorMessage });
      return;
    }
    notify({ type: 'success', title: '审批已更新', message: action === 'approve' ? '任务已通过审批。' : '任务已拒绝并重跑。' });
    fetchTasks();
  };

  const handleRowCancel = async (task: TaskItem) => {
    const label = task.status === 'running' ? '停止' : '取消';
    const confirmed = await confirmDialog({
      title: `确认${label}任务?`, description: `${label}任务 "${task.title}"`, confirmText: label, confirmVariant: 'destructive',
    });
    if (!confirmed) return;
    const result = await cancelTaskById(task.id);
    if (!result.ok) {
      notify({ type: 'error', title: `${label}失败`, message: result.errorMessage });
      return;
    }
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
    const result = await rerunTaskById(task.id, feedback);
    if (!result.ok) {
      notify({ type: 'error', title: '重跑失败', message: result.errorMessage });
      return;
    }
    notify({ type: 'success', title: '任务已重新入队', message: '任务已重新入队。' });
    fetchTasks();
  };

  const handleRowDelete = async (task: TaskItem) => {
    const deletable = canDeleteTask(task.status);
    const stoppable = canCancelTask(task.status);
    if (!deletable && !stoppable) {
      notify({
        type: 'error',
        title: '当前状态不可删除',
        message: '请先将任务处理到可删除状态，或先停止任务后再删除。',
      });
      return;
    }

    const confirmed = await confirmDialog(deletable
      ? {
          title: '删除任务?',
          description: `任务 "${task.title}" 将被永久删除（不可恢复）。`,
          confirmText: '删除',
          confirmVariant: 'destructive',
        }
      : {
          title: '停止并删除任务?',
          description: `任务 "${task.title}" 正在执行，将先停止再删除（不可恢复）。`,
          confirmText: '停止并删除',
          confirmVariant: 'destructive',
        });
    if (!confirmed) return;

    if (!deletable && stoppable) {
      const cancelResult = await cancelTaskById(task.id, '用户在任务页执行停止并删除');
      if (!cancelResult.ok) {
        notify({ type: 'error', title: '停止任务失败', message: cancelResult.errorMessage });
        return;
      }
    }

    const result = await deleteTaskById(task.id);
    if (!result.ok) {
      notify({ type: 'error', title: '删除失败', message: result.errorMessage });
      return;
    }
    notify({
      type: 'success',
      title: deletable ? '任务已删除' : '任务已停止并删除',
      message: `任务 ${task.title} 已删除。`,
    });
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
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
            {row.source === 'terminal' && <span title="终端会话"><TerminalSquare size={13} className="shrink-0 text-primary/70" /></span>}
            {row.title}
          </p>
          {row.description && (
            <p className="mt-1 truncate text-sm text-muted-foreground/70">{row.description.slice(0, 100)}</p>
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
      cell: (row) => <span className="text-sm text-muted-foreground">{row.agentDefinitionId}</span>,
    },
    {
      key: 'branch',
      header: '分支',
      className: 'w-[130px]',
      cell: (row) => <span className="font-mono text-sm text-muted-foreground">{row.workBranch}</span>,
    },
    {
      key: 'worker',
      header: 'Worker',
      className: 'w-[100px]',
      cell: (row) => <span className="text-sm text-muted-foreground">{row.assignedWorkerId || '-'}</span>,
    },
    {
      key: 'createdAt',
      header: '创建时间',
      className: 'w-[130px]',
      cell: (row) => <span className="text-sm text-muted-foreground">{formatDateTimeZhCn(row.createdAt)}</span>,
    },
    {
      key: 'elapsed',
      header: '耗时',
      className: 'w-[100px]',
      cell: (row) => {
        const elapsed = formatTaskElapsed(row, { nowMs });
        return (
          <span className="text-sm text-muted-foreground">
            {elapsed.text !== '-' ? elapsed.text : '-'}
            {elapsed.ongoing ? ' ...' : ''}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[230px] text-right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {row.status === 'awaiting_review' && (
            <>
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-success hover:bg-success/10"
                onClick={() => handleRowReview(row, 'approve')} aria-label="通过">
                <CheckCircle size={16} />
              </Button>
              <Button variant="ghost" size="sm" className="text-primary hover:bg-primary/10"
                onClick={() => handleRowReview(row, 'approve', { merge: true })}>
                通过+合并
              </Button>
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-destructive hover:bg-destructive/10"
                onClick={() => handleRowReview(row, 'reject')} aria-label="拒绝并重跑">
                <XCircle size={16} />
              </Button>
            </>
          )}
          {canCancelTask(row.status) && (
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-destructive hover:bg-destructive/10"
              onClick={() => handleRowCancel(row)} aria-label={row.status === 'running' ? '停止' : '取消'}>
              <X size={16} />
            </Button>
          )}
          {canRerunTask(row) && (
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0"
              onClick={() => handleRowRerun(row)} aria-label="重跑">
              <RotateCcw size={16} />
            </Button>
          )}
          {(canDeleteTask(row.status) || canCancelTask(row.status)) && (
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-destructive hover:bg-destructive/10"
              onClick={() => handleRowDelete(row)} aria-label={canDeleteTask(row.status) ? '删除' : '停止并删除'}>
              <Trash2 size={16} />
            </Button>
          )}
          {row.prUrl && (
            <a href={row.prUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary/10" aria-label="查看 PR">
              <ExternalLink size={16} />
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
    <div className="space-y-12">
      <PageHeader title="任务" subtitle="管理与监控编排任务">
        <div className="flex items-center gap-3">
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
      <TabBar
        tabs={tabs}
        activeKey={filterStatus || 'all'}
        onChange={(key) => setFilterStatus(key === 'all' ? '' : key)}
      />

      {/* 工具栏: 搜索 + 分组筛选 + 排序 + 批量操作 */}
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-wrap items-end gap-5">
          <div className="relative w-72">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="标题 / 描述 / ID"
              className="pl-10"
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSortDirection((d) => d === 'desc' ? 'asc' : 'desc')}
            className="h-11 border border-border"
            aria-label="切换排序"
          >
            <ArrowUpDown size={14} />
            {sortDirection === 'desc' ? '最新优先' : '最早优先'}
          </Button>
        </div>

        {/* 批量操作 */}
        {selectedTaskIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-sm text-muted-foreground">已选 {selectedTaskIds.size} 项</span>
            <Button size="sm" variant="destructive" disabled={batchActionLoading !== null || selectedCancellableCount === 0} onClick={handleBatchCancel}>
              {batchActionLoading === 'cancel' ? '取消中...' : `批量取消 (${selectedCancellableCount})`}
            </Button>
            <Button size="sm" variant="secondary" disabled={batchActionLoading !== null || selectedRerunnableCount === 0} onClick={handleBatchRerun}>
              {batchActionLoading === 'rerun' ? '重跑中...' : `批量重跑 (${selectedRerunnableCount})`}
            </Button>
            <Button size="sm" variant="destructive" disabled={batchActionLoading !== null || selectedDeletableCount === 0} onClick={handleBatchDelete}>
              {batchActionLoading === 'delete' ? '删除中...' : `批量删除 (${selectedDeletableCount})`}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedTaskIds(new Set())}>
              清空
            </Button>
          </div>
        )}
      </div>

      {/* 分组汇总 */}
      {filterGroupId && groupSummary && (
        <Card padding="lg">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground/60">分组</p>
              <p className="truncate font-mono text-base">{filterGroupId}</p>
              <p className="mt-1.5 text-sm text-muted-foreground/70">
                {groupSummary.completed}/{groupSummary.total} 已完成 ({groupSummary.percent}%)
                {groupSummary.blocked > 0 ? ` | ${groupSummary.blocked} 个阻塞` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button size="sm" variant="destructive" disabled={groupActionLoading || groupCancellableCount === 0} onClick={handleCancelGroup}>
                取消分组
              </Button>
              <Button size="sm" variant="secondary" disabled={groupActionLoading || groupRerunnableCount === 0} onClick={handleRerunFailedInGroup}>
                重跑失败
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setFilterGroupId('')}>
                清空筛选
              </Button>
            </div>
          </div>

          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-success transition-all duration-500" style={{ width: `${groupSummary.percent}%` }} />
          </div>

          {groupTaskOptions.length > 0 && (
            <div className="mt-4 flex flex-wrap items-end gap-3">
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
  const [templates, setTemplates] = useState<TaskTemplateOption[]>([]);
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
      const json = await readApiEnvelope<TaskTemplateOption[]>(res);
      if (!res.ok || !json?.success || !Array.isArray(json?.data)) return;
      const templateList = json.data;
      setTemplates(templateList);
      if (typeof nextTemplateId === 'string') { setTemplateId(nextTemplateId); return; }
      setTemplateId((prev) => (prev && templateList.some((item: { id: string }) => item.id === prev) ? prev : ''));
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
          repoUrl: normalizeOptionalString(form.repoUrl),
          baseBranch: normalizeOptionalString(form.baseBranch),
          workDir: normalizeOptionalString(form.workDir),
        }),
      });
      const json = await readApiEnvelope<{ id?: string }>(res);
      if (!res.ok || !json?.success) {
        notify({
          type: 'error',
          title: TASK_TEMPLATE_UI_MESSAGES.saveFailedTitle,
          message: resolveApiErrorMessage(res, json, ''),
        });
        return;
      }
      notify({ type: 'success', title: TASK_TEMPLATE_UI_MESSAGES.saveSuccessTitle, message: TASK_TEMPLATE_UI_MESSAGES.saveSuccessMessage(name.trim()) });
      await fetchTemplates(json.data?.id);
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
        <Button size="sm" disabled={!canSubmit} loading={saving} onClick={handleSubmit}>创建并入队</Button>
      </>
    }>
      <div className="space-y-5">
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
          <p className="mt-2.5 text-sm text-muted-foreground/70">
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
        <details className="rounded-lg border border-border bg-muted/10 px-4 py-4">
          <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">高级编排选项</summary>
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
              <p className="mb-2 block text-sm font-medium text-muted-foreground">已选依赖</p>
              {form.dependsOn.length === 0 ? <p className="text-sm text-muted-foreground/60">暂无</p> : (
                <div className="flex flex-wrap gap-2">
                  {form.dependsOn.map((id) => (
                    <button key={id} type="button"
                      onClick={() => setForm((prev) => ({ ...prev, dependsOn: prev.dependsOn.filter((x) => x !== id) }))}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-2 text-sm text-muted-foreground hover:bg-muted/40" title="点击移除">
                      <span className="font-mono">{truncateText(id, 8)}</span>
                      <X size={12} className="text-muted-foreground/50" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </details>

        {submitError && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
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

type PipelineTemplate = {
  id: string;
  name: string;
  agentDefinitionId: string | null;
  repositoryId: string | null;
  repoUrl: string | null;
  baseBranch: string | null;
  workDir: string | null;
  pipelineSteps: Array<{ title: string; description: string; agentDefinitionId?: string }> | null;
  maxRetries: number | null;
};

let _pipelineStepIdCounter = 100;

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
    steps: Array<{ title: string; description: string; agentDefinitionId?: string }>;
  }) => Promise<{ success: boolean; groupId?: string; errorMessage?: string; missingEnvVars?: string[] }>;
}) {
  const { prompt: promptDialog, notify } = useFeedback();
  const [form, setForm] = useState({
    agentDefinitionId: '', repoUrl: '', baseBranch: 'main', workDir: '', maxRetries: 2, groupId: '',
  });
  const [repoPresetId, setRepoPresetId] = useState('');
  const [steps, setSteps] = useState<Array<{ _id: string; title: string; description: string; agentDefinitionId: string }>>([{ _id: '1', title: '', description: '', agentDefinitionId: '' }]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [missingEnvVars, setMissingEnvVars] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // 流水线模板相关状态
  const [pipelineTemplates, setPipelineTemplates] = useState<PipelineTemplate[]>([]);
  const [pipelineTemplateId, setPipelineTemplateId] = useState('');
  const [templateLoading, setTemplateLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ agentDefinitionId: agents[0]?.id || '', repoUrl: '', baseBranch: 'main', workDir: '', maxRetries: 2, groupId: '' });
      setRepoPresetId(''); setSteps([{ _id: '1', title: '', description: '', agentDefinitionId: '' }]);
      setSubmitError(null); setMissingEnvVars([]); setSaving(false); setPipelineTemplateId('');
    }
  }, [open, agents]);

  // 加载流水线模板列表
  const fetchPipelineTemplates = useCallback(async (nextId?: string) => {
    setTemplateLoading(true);
    try {
      const res = await fetch('/api/task-templates');
      const json = await readApiEnvelope<PipelineTemplate[]>(res);
      if (!res.ok || !json?.success || !Array.isArray(json?.data)) return;
      // 只保留流水线模板（pipelineSteps 非空）
      const pipelines = json.data.filter(
        (t) => t.pipelineSteps && t.pipelineSteps.length > 0
      );
      setPipelineTemplates(pipelines);
      if (typeof nextId === 'string') { setPipelineTemplateId(nextId); return; }
      setPipelineTemplateId((prev) => (prev && pipelines.some((t) => t.id === prev) ? prev : ''));
    } finally { setTemplateLoading(false); }
  }, []);

  useEffect(() => { if (open) fetchPipelineTemplates(); }, [open, fetchPipelineTemplates]);

  // 选择模板后自动填充
  const applyPipelineTemplate = (selectedId: string) => {
    setPipelineTemplateId(selectedId);
    if (!selectedId) return;
    const tpl = pipelineTemplates.find((t) => t.id === selectedId);
    if (!tpl) return;
    const preset = tpl.repositoryId ? repos.find((r) => r.id === tpl.repositoryId) : null;
    setRepoPresetId(tpl.repositoryId || '');
    setForm((prev) => ({
      ...prev,
      agentDefinitionId: tpl.agentDefinitionId || prev.agentDefinitionId,
      repoUrl: preset?.repoUrl || tpl.repoUrl || prev.repoUrl,
      baseBranch: tpl.baseBranch || preset?.defaultBaseBranch || prev.baseBranch,
      workDir: tpl.workDir || preset?.defaultWorkDir || '',
      maxRetries: tpl.maxRetries ?? prev.maxRetries,
    }));
    // 填充步骤
    if (tpl.pipelineSteps && tpl.pipelineSteps.length > 0) {
      const newSteps = tpl.pipelineSteps.map((s) => {
        _pipelineStepIdCounter += 1;
        return { _id: String(_pipelineStepIdCounter), title: s.title, description: s.description, agentDefinitionId: s.agentDefinitionId || '' };
      });
      setSteps(newSteps);
    }
  };

  // 保存当前配置为流水线模板
  const handleSaveAsTemplate = async () => {
    const validSteps = steps
      .map((s) => ({
        title: s.title.trim(),
        description: s.description.trim(),
        ...(s.agentDefinitionId.trim() ? { agentDefinitionId: s.agentDefinitionId.trim() } : {}),
      }))
      .filter((s) => s.title && s.description);
    if (validSteps.length === 0) {
      notify({ type: 'error', title: '缺少步骤', message: '请至少填写 1 个完整步骤再保存模板。' });
      return;
    }
    const name = await promptDialog({
      title: TASK_TEMPLATE_UI_MESSAGES.pipelineSaveDialog.title,
      description: TASK_TEMPLATE_UI_MESSAGES.pipelineSaveDialog.description,
      label: TASK_TEMPLATE_UI_MESSAGES.pipelineSaveDialog.label,
      placeholder: TASK_TEMPLATE_UI_MESSAGES.pipelineSaveDialog.placeholder,
      defaultValue: '', required: true,
      confirmText: TASK_TEMPLATE_UI_MESSAGES.pipelineSaveDialog.confirmText,
    });
    if (name === null || !name.trim()) return;
    setTemplateLoading(true);
    try {
      const res = await fetch('/api/task-templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          titleTemplate: '(流水线模板)',
          promptTemplate: '(流水线模板)',
          agentDefinitionId: form.agentDefinitionId || null,
          repositoryId: repoPresetId || null,
          repoUrl: normalizeOptionalString(form.repoUrl),
          baseBranch: normalizeOptionalString(form.baseBranch),
          workDir: normalizeOptionalString(form.workDir),
          pipelineSteps: validSteps,
          maxRetries: form.maxRetries,
        }),
      });
      const json = await readApiEnvelope<{ id?: string }>(res);
      if (!res.ok || !json?.success) {
        notify({
          type: 'error',
          title: TASK_TEMPLATE_UI_MESSAGES.saveFailedTitle,
          message: resolveApiErrorMessage(res, json, ''),
        });
        return;
      }
      notify({ type: 'success', title: TASK_TEMPLATE_UI_MESSAGES.saveSuccessTitle, message: TASK_TEMPLATE_UI_MESSAGES.saveSuccessMessage(name.trim()) });
      await fetchPipelineTemplates(json.data?.id);
    } finally { setTemplateLoading(false); }
  };

  const handleSubmit = async () => {
    const normalizedSteps = steps
      .map((s) => ({
        title: s.title.trim(),
        description: s.description.trim(),
        ...(s.agentDefinitionId.trim() ? { agentDefinitionId: s.agentDefinitionId.trim() } : {}),
      }))
      .filter((s) => s.title || s.description);
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
        <Button size="sm" variant="secondary" onClick={() => {
          _pipelineStepIdCounter += 1;
          setSteps((s) => [...s, { _id: String(_pipelineStepIdCounter), title: '', description: '', agentDefinitionId: '' }]);
        }}>
          <Plus size={13} className="mr-1" /> 添加步骤
        </Button>
        <Button size="sm" disabled={!canSubmit} loading={saving} onClick={handleSubmit}>创建流水线</Button>
      </>
    }>
      <div className="space-y-5">
        {/* 流水线模板区 */}
        <div className="rounded-lg border border-border bg-muted/10 p-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Select
              label={TASK_TEMPLATE_UI_MESSAGES.pipelineTemplateSelectLabel}
              value={pipelineTemplateId}
              onChange={(e) => applyPipelineTemplate(e.target.value)}
              options={[
                { value: '', label: templateLoading ? TASK_TEMPLATE_UI_MESSAGES.pipelineTemplateSelectLoading : TASK_TEMPLATE_UI_MESSAGES.pipelineTemplateSelectNone },
                ...pipelineTemplates.map((t) => ({
                  value: t.id,
                  label: `${t.name} (${t.pipelineSteps?.length ?? 0} 步骤)`,
                })),
              ]}
            />
            <Button type="button" size="sm" variant="secondary" disabled={templateLoading} onClick={handleSaveAsTemplate}>
              {TASK_TEMPLATE_UI_MESSAGES.pipelineSaveCurrentAction}
            </Button>
          </div>
          <p className="mt-2.5 text-sm text-muted-foreground/70">
            {TASK_TEMPLATE_UI_MESSAGES.pipelineSectionHint}
            <Link href="/templates" className="ml-1 underline hover:text-foreground">{TASK_TEMPLATE_UI_MESSAGES.manageLink}</Link>
          </p>
        </div>

        <p className="text-sm text-muted-foreground">
          将创建 {steps.length} 个任务，并自动串行依赖(步骤 N 依赖步骤 N-1)。
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="默认智能体" value={form.agentDefinitionId}
            onChange={(e) => setForm({ ...form, agentDefinitionId: e.target.value })}
            options={[
              { value: '', label: '不指定（各步骤单独配置）' },
              ...agents.map((a) => ({ value: a.id, label: a.displayName })),
            ]} />
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
            <div key={step._id} className="rounded-lg border border-border bg-muted/10 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-muted-foreground">
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
                <Select label="智能体" value={step.agentDefinitionId}
                  onChange={(e) => setSteps((s) => s.map((x, i) => (i === idx ? { ...x, agentDefinitionId: e.target.value } : x)))}
                  options={[
                    { value: '', label: form.agentDefinitionId ? '使用默认智能体' : '不指定' },
                    ...agents.map((a) => ({ value: a.id, label: a.displayName })),
                  ]} />
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
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
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
