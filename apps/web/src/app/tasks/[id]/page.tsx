// ============================================================
// 任务详情页
// 单列布局: 顶部信息栏 + Tabs(日志 | 元信息 | 依赖关系)
// ============================================================

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { TaskItem } from '@/stores';
import { TASK_STATUS_COLORS } from '@/lib/constants';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
// Input/Textarea 未直接使用 (review/rerun 通过 promptDialog 弹窗)
import { useFeedback } from '@/components/providers/feedback-provider';
import { formatTaskElapsed } from '@/lib/time/duration';
import { TASK_DETAIL_UI_MESSAGES } from '@/lib/i18n/ui-messages';
import {
  ArrowLeft, Search, ExternalLink, X, RotateCcw,
  CheckCircle, XCircle, GitMerge, Clock, Bot, GitFork,
  GitBranch, FolderOpen, Server, Hash, Layers,
} from 'lucide-react';

type TaskMini = {
  id: string;
  title: string;
  status: string;
  groupId: string | null;
  createdAt: string;
};

export default function TaskDetailPage() {
  const params = useParams();
  const taskId = params.id as string;
  const { confirm: confirmDialog, prompt: promptDialog, notify } = useFeedback();

  const [task, setTask] = useState<TaskItem | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [relations, setRelations] = useState<{ dependencies: TaskMini[]; dependents: TaskMini[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [rerunLoading, setRerunLoading] = useState(false);
  const [logKeyword, setLogKeyword] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [activeTab, setActiveTab] = useState('logs');

  // ---- 数据获取 ----

  const fetchTask = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      const json = await res.json();
      if (json.success) {
        setTask(json.data);
        setError(null);
      } else {
        setError(json.error?.message || TASK_DETAIL_UI_MESSAGES.fetchTaskFailed);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/logs`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setLogs(json.data);
      }
    } catch {
      // 日志获取失败不阻塞页面
    }
  }, [taskId]);

  const fetchRelations = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/relations`);
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setRelations(json.data);
      }
    } catch {
      // ignore
    }
  }, [taskId]);

  useEffect(() => {
    fetchTask();
    fetchLogs();
    fetchRelations();
  }, [fetchTask, fetchLogs, fetchRelations]);

  useEffect(() => {
    if (!task) return;
    const autoRefreshStatuses = ['queued', 'running', 'waiting'];
    if (!autoRefreshStatuses.includes(task.status)) return;
    const interval = setInterval(() => {
      fetchTask();
      fetchLogs();
      fetchRelations();
    }, 3000);
    return () => clearInterval(interval);
  }, [task, fetchTask, fetchLogs, fetchRelations]);

  useEffect(() => {
    if (!task?.startedAt || task.completedAt) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [task?.startedAt, task?.completedAt]);

  // ---- 操作处理 ----

  const handleReview = async (action: 'approve' | 'reject', options?: { merge?: boolean }) => {
    let feedback: string | undefined;

    if (action === 'reject') {
      const result = await promptDialog({
        title: TASK_DETAIL_UI_MESSAGES.rejectFeedbackLabel,
        description: TASK_DETAIL_UI_MESSAGES.rejectFeedbackPlaceholder,
        label: TASK_DETAIL_UI_MESSAGES.rejectFeedbackLabel,
        placeholder: TASK_DETAIL_UI_MESSAGES.rejectFeedbackPlaceholder,
        defaultValue: task?.feedback || '',
        required: true,
        multiline: true,
        confirmText: TASK_DETAIL_UI_MESSAGES.rejectAndRerun,
      });
      if (result == null) return;
      if (!result.trim()) {
        notify({ type: 'error', title: TASK_DETAIL_UI_MESSAGES.reviewRequiredFeedbackTitle, message: TASK_DETAIL_UI_MESSAGES.reviewRequiredFeedbackMessage });
        return;
      }
      feedback = result.trim();
    }

    setReviewLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          merge: options?.merge ? true : undefined,
          feedback,
        }),
      });
      const json = await res.json().catch(() => null);
      if (json?.success) {
        await fetchTask();
        await fetchLogs();
        notify({
          type: 'success',
          title: action === 'approve' ? TASK_DETAIL_UI_MESSAGES.reviewApprovedTitle : TASK_DETAIL_UI_MESSAGES.reviewRejectedTitle,
          message: action === 'approve' ? TASK_DETAIL_UI_MESSAGES.reviewApprovedMessage : TASK_DETAIL_UI_MESSAGES.reviewRejectedMessage,
        });
      } else {
        notify({ type: 'error', title: TASK_DETAIL_UI_MESSAGES.reviewFailed, message: json?.error?.message || TASK_DETAIL_UI_MESSAGES.requestFailed });
      }
    } catch (err) {
      notify({ type: 'error', title: TASK_DETAIL_UI_MESSAGES.reviewFailed, message: (err as Error).message });
    } finally {
      setReviewLoading(false);
    }
  };

  const handleCancel = async () => {
    const label = task?.status === 'running' ? TASK_DETAIL_UI_MESSAGES.stop : TASK_DETAIL_UI_MESSAGES.cancel;
    const confirmed = await confirmDialog({
      title: TASK_DETAIL_UI_MESSAGES.stopOrCancelTaskTitle(label),
      description: TASK_DETAIL_UI_MESSAGES.stopOrCancelTaskDescription(label, task?.title),
      confirmText: label,
      confirmVariant: 'destructive',
    });
    if (!confirmed) return;

    setCancelLoading(true);
    try {
      await fetch(`/api/tasks/${taskId}/cancel`, { method: 'POST' });
      await fetchTask();
      await fetchLogs();
      notify({ type: 'success', title: TASK_DETAIL_UI_MESSAGES.cancelSuccessTitle, message: TASK_DETAIL_UI_MESSAGES.cancelSuccessMessage });
    } catch (err) {
      notify({ type: 'error', title: TASK_DETAIL_UI_MESSAGES.cancelFailed, message: (err as Error).message });
    } finally {
      setCancelLoading(false);
    }
  };

  const handleRerun = async () => {
    const feedback = await promptDialog({
      title: TASK_DETAIL_UI_MESSAGES.rerunTitle,
      description: TASK_DETAIL_UI_MESSAGES.rerunFeedbackPlaceholder,
      label: TASK_DETAIL_UI_MESSAGES.rerunFeedbackLabel,
      placeholder: TASK_DETAIL_UI_MESSAGES.rerunFeedbackPlaceholder,
      defaultValue: task?.feedback || '',
      multiline: true,
      confirmText: TASK_DETAIL_UI_MESSAGES.rerunDialogConfirm,
    });
    if (feedback == null) return;

    setRerunLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/rerun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedback.trim() || undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) {
        notify({ type: 'error', title: TASK_DETAIL_UI_MESSAGES.rerunFailed, message: json?.error?.message || TASK_DETAIL_UI_MESSAGES.requestFailed });
        return;
      }
      await fetchTask();
      await fetchLogs();
      notify({ type: 'success', title: TASK_DETAIL_UI_MESSAGES.rerunSuccessTitle, message: TASK_DETAIL_UI_MESSAGES.rerunSuccessMessage });
    } catch (err) {
      notify({ type: 'error', title: TASK_DETAIL_UI_MESSAGES.rerunFailed, message: (err as Error).message });
    } finally {
      setRerunLoading(false);
    }
  };

  // ---- 日志过滤 ----

  const filteredLogs = useMemo(() => {
    const keyword = logKeyword.trim().toLowerCase();
    if (!keyword) return logs;
    return logs.filter((line) => line.toLowerCase().includes(keyword));
  }, [logs, logKeyword]);

  const elapsed = formatTaskElapsed(task || {}, { nowMs });

  // ---- Tabs 配置 ----

  const depCount = relations ? relations.dependencies.length + relations.dependents.length : 0;
  const tabs = [
    { key: 'logs', label: TASK_DETAIL_UI_MESSAGES.logsTitle, count: logs.length },
    { key: 'meta', label: '元信息' },
    { key: 'deps', label: '依赖关系', count: depCount || undefined },
  ];

  // ---- 加载/错误 ----

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted-foreground">{TASK_DETAIL_UI_MESSAGES.loadingTask}</span>
        </div>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Card padding="lg" className="py-12 text-center">
          <p className="font-medium text-destructive">{error || TASK_DETAIL_UI_MESSAGES.taskNotFound}</p>
        </Card>
      </div>
    );
  }

  const colorToken = TASK_STATUS_COLORS[task.status] || 'muted-foreground';
  const canCancel = ['queued', 'waiting', 'running'].includes(task.status);
  const canRerun = ['failed', 'cancelled', 'completed'].includes(task.status);
  const isReview = task.status === 'awaiting_review';

  return (
    <div className="space-y-4">
      {/* 面包屑 */}
      <BackLink />

      {/* 顶部信息栏 */}
      <Card padding="lg">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold tracking-tight">{task.title}</h1>
              <StatusBadge status={task.status} colorToken={colorToken} size="md" />
            </div>
            {task.description && (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {task.description}
              </p>
            )}
            {/* 元信息行 */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <MetaChip icon={Bot} text={task.agentDefinitionId} />
              <MetaChip icon={GitFork} text={task.repoUrl} mono />
              <MetaChip icon={GitBranch} text={task.workBranch} />
              {task.assignedWorkerId && <MetaChip icon={Server} text={task.assignedWorkerId} />}
              <MetaChip icon={Clock} text={
                elapsed.text === '-' ? '-' : `${elapsed.text}${elapsed.ongoing ? TASK_DETAIL_UI_MESSAGES.elapsedOngoing : ''}`
              } />
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex shrink-0 items-center gap-2">
            {isReview && (
              <>
                <Button size="sm" variant="success" disabled={reviewLoading} onClick={() => handleReview('approve')}>
                  <CheckCircle size={14} className="mr-1" />
                  {reviewLoading ? TASK_DETAIL_UI_MESSAGES.processing : TASK_DETAIL_UI_MESSAGES.approve}
                </Button>
                <Button size="sm" variant="primary" disabled={reviewLoading} onClick={() => handleReview('approve', { merge: true })}>
                  <GitMerge size={14} className="mr-1" />
                  {reviewLoading ? TASK_DETAIL_UI_MESSAGES.processing : TASK_DETAIL_UI_MESSAGES.approveAndMerge}
                </Button>
                <Button size="sm" variant="destructive" disabled={reviewLoading} onClick={() => handleReview('reject')}>
                  <XCircle size={14} className="mr-1" />
                  {reviewLoading ? TASK_DETAIL_UI_MESSAGES.processing : TASK_DETAIL_UI_MESSAGES.rejectAndRerun}
                </Button>
              </>
            )}
            {canCancel && (
              <Button size="sm" variant="destructive" disabled={cancelLoading} onClick={handleCancel}>
                <X size={14} className="mr-1" />
                {cancelLoading ? TASK_DETAIL_UI_MESSAGES.processing : task.status === 'running' ? TASK_DETAIL_UI_MESSAGES.stop : TASK_DETAIL_UI_MESSAGES.cancel}
              </Button>
            )}
            {canRerun && (
              <Button size="sm" variant="secondary" disabled={rerunLoading} onClick={handleRerun}>
                <RotateCcw size={14} className="mr-1" />
                {rerunLoading ? TASK_DETAIL_UI_MESSAGES.rerunning : TASK_DETAIL_UI_MESSAGES.rerunDialogConfirm}
              </Button>
            )}
            {task.prUrl && (
              <a
                href={task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-primary transition-colors hover:bg-muted"
              >
                <ExternalLink size={13} />
                {TASK_DETAIL_UI_MESSAGES.viewPr}
              </a>
            )}
          </div>
        </div>

        {/* 审批总结 + 反馈 (仅 awaiting_review 时内联显示) */}
        {isReview && task.summary && (
          <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4 text-sm">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              {TASK_DETAIL_UI_MESSAGES.agentSummary}
            </p>
            <p className="whitespace-pre-wrap">{task.summary}</p>
          </div>
        )}
        {task.feedback && (
          <div className="mt-3 rounded-lg border border-border bg-muted/20 p-4 text-sm">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              {TASK_DETAIL_UI_MESSAGES.currentFeedback}
            </p>
            <p className="whitespace-pre-wrap">{task.feedback}</p>
          </div>
        )}
      </Card>

      {/* 等待原因提示 */}
      {task.status === 'waiting' && relations && relations.dependencies.length > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
          <p className="text-xs font-medium text-warning">{TASK_DETAIL_UI_MESSAGES.waitingDependenciesTitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {TASK_DETAIL_UI_MESSAGES.waitingDependenciesHint}
          </p>
        </div>
      )}

      {/* Tabs */}
      <Tabs tabs={tabs} activeKey={activeTab} onChange={setActiveTab} />

      {/* Tab 内容 */}
      {activeTab === 'logs' && (
        <LogsPanel
          logs={logs}
          filteredLogs={filteredLogs}
          logKeyword={logKeyword}
          onKeywordChange={setLogKeyword}
          status={task.status}
        />
      )}

      {activeTab === 'meta' && (
        <MetaPanel task={task} elapsed={elapsed} />
      )}

      {activeTab === 'deps' && (
        <DepsPanel relations={relations} />
      )}
    </div>
  );
}

// ---- 面包屑返回 ----

function BackLink() {
  return (
    <Link
      href="/tasks"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft size={15} />
      {TASK_DETAIL_UI_MESSAGES.backToTasks}
    </Link>
  );
}

// ---- 元信息小标签 ----

function MetaChip({ icon: Icon, text, mono }: { icon: React.ComponentType<{ size?: number; className?: string }>; text: string; mono?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${mono ? 'font-mono' : ''}`}>
      <Icon size={13} className="text-muted-foreground/50" />
      <span className="max-w-[200px] truncate">{text}</span>
    </span>
  );
}

// ---- 日志面板 ----

function LogsPanel({
  logs,
  filteredLogs,
  logKeyword,
  onKeywordChange,
  status,
}: {
  logs: string[];
  filteredLogs: string[];
  logKeyword: string;
  onKeywordChange: (v: string) => void;
  status: string;
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {status === 'running' && (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              {TASK_DETAIL_UI_MESSAGES.logsRealtime}
            </span>
          )}
          {logs.length > 0 && (
            <span className="text-xs text-muted-foreground/70">
              {filteredLogs.length}/{logs.length}
            </span>
          )}
        </div>
        <div className="relative w-72 max-w-full">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={logKeyword}
            onChange={(e) => onKeywordChange(e.target.value)}
            placeholder={TASK_DETAIL_UI_MESSAGES.logKeywordPlaceholder}
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/50 transition-colors hover:border-border-light focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        {filteredLogs.length > 0 ? (
          <div className="max-h-[600px] overflow-y-auto font-mono text-xs leading-relaxed">
            {filteredLogs.map((line, i) => (
              <div
                key={i}
                className={`flex gap-4 px-4 py-1 ${i % 2 === 0 ? '' : 'bg-muted/15'} hover:bg-primary/5 transition-colors duration-75`}
              >
                <span className="w-8 shrink-0 select-none text-right text-muted-foreground/30">
                  {i + 1}
                </span>
                <span className="whitespace-pre-wrap break-all">{line}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center text-sm text-muted-foreground">
            {logs.length > 0
              ? TASK_DETAIL_UI_MESSAGES.noMatchingLogs
              : ['queued', 'waiting', 'draft'].includes(status)
              ? TASK_DETAIL_UI_MESSAGES.taskNotStarted
              : TASK_DETAIL_UI_MESSAGES.noLogs}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- 元信息面板 ----

function MetaPanel({ task, elapsed }: { task: TaskItem; elapsed: { text: string; ongoing?: boolean } }) {
  const M = TASK_DETAIL_UI_MESSAGES.metaLabels;
  const colorToken = TASK_STATUS_COLORS[task.status] || 'muted-foreground';

  const fields: Array<{ label: string; value: React.ReactNode; icon?: React.ComponentType<{ size?: number; className?: string }> }> = [
    { label: M.taskId, value: <span className="font-mono text-[11px]">{task.id}</span>, icon: Hash },
    { label: M.status, value: <StatusBadge status={task.status} colorToken={colorToken} /> },
    { label: M.agent, value: task.agentDefinitionId, icon: Bot },
    { label: M.repoUrl, value: <span className="font-mono text-[11px] break-all">{task.repoUrl}</span>, icon: GitFork },
    { label: M.baseBranch, value: task.baseBranch, icon: GitBranch },
    { label: M.workBranch, value: task.workBranch, icon: GitBranch },
    { label: M.workDir, value: task.workDir || '-', icon: FolderOpen },
    { label: M.group, value: task.groupId || '-', icon: Layers },
    { label: M.dependencyCount, value: task.dependsOn?.length ? TASK_DETAIL_UI_MESSAGES.taskCount(task.dependsOn.length) : '-' },
    { label: M.worker, value: task.assignedWorkerId || TASK_DETAIL_UI_MESSAGES.unassigned, icon: Server },
    { label: M.retryCount, value: String(task.retryCount) },
    { label: M.createdAt, value: task.createdAt ? new Date(task.createdAt).toLocaleString('zh-CN') : '-', icon: Clock },
    { label: M.queuedAt, value: task.queuedAt ? new Date(task.queuedAt).toLocaleString('zh-CN') : '-' },
    { label: M.startedAt, value: task.startedAt ? new Date(task.startedAt).toLocaleString('zh-CN') : '-' },
    { label: M.completedAt, value: task.completedAt ? new Date(task.completedAt).toLocaleString('zh-CN') : '-' },
    { label: M.elapsed, value: elapsed.text === '-' ? '-' : `${elapsed.text}${elapsed.ongoing ? TASK_DETAIL_UI_MESSAGES.elapsedOngoing : ''}` },
  ];

  if (task.prUrl) {
    fields.push({
      label: M.pullRequest,
      value: (
        <a href={task.prUrl} target="_blank" rel="noopener noreferrer"
          className="text-xs font-medium text-primary underline underline-offset-2 hover:text-primary/80">
          {TASK_DETAIL_UI_MESSAGES.viewPr}
        </a>
      ),
    });
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <tbody>
          {fields.map((f, i) => (
            <tr key={f.label} className={`${i > 0 ? 'border-t border-border/50' : ''}`}>
              <td className="w-[160px] px-4 py-3 text-xs font-medium text-muted-foreground/60 align-top">
                {f.label}
              </td>
              <td className="px-4 py-3 text-xs break-all">
                {typeof f.value === 'string' ? <span>{f.value}</span> : f.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- 依赖关系面板 ----

function DepsPanel({ relations }: { relations: { dependencies: TaskMini[]; dependents: TaskMini[] } | null }) {
  if (!relations) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        {TASK_DETAIL_UI_MESSAGES.none}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DepsSection title={TASK_DETAIL_UI_MESSAGES.upstreamDeps} items={relations.dependencies} />
      <DepsSection title={TASK_DETAIL_UI_MESSAGES.downstreamTasks} items={relations.dependents} />
    </div>
  );
}

function DepsSection({ title, items }: { title: string; items: TaskMini[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">{TASK_DETAIL_UI_MESSAGES.none}</p>
      ) : (
        <div className="space-y-2">
          {items.map((d) => {
            const token = TASK_STATUS_COLORS[d.status] || 'muted-foreground';
            return (
              <Link
                key={d.id}
                href={`/tasks/${d.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-2.5 text-xs transition-colors hover:bg-muted/30"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{d.title}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground/60">{d.id.slice(0, 8)}</p>
                </div>
                <StatusBadge status={d.status} colorToken={token} />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
