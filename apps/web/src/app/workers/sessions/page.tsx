// ============================================================
// 托管会话池页面
// 统一管理项目内可复用的 Claude/Codex 会话
// ============================================================

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CloudDownload, RefreshCw, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { useFeedback } from '@/components/providers/feedback-provider';
import { DEPLOYABLE_CLI_CONFIGS, type DeployableCliAgentId } from '@/lib/agents/cli-profiles';
import { formatDateTimeZhCn, toSafeTimestamp } from '@/lib/time/format';
import { readApiEnvelope, resolveApiErrorMessage } from '@/lib/http/client-response';
import { truncateText } from '@/lib/terminal/display';

type ManagedSessionItem = {
  sessionKey: string;
  userId: string;
  repoPath: string;
  agentDefinitionId: string;
  mode: 'resume' | 'continue';
  resumeSessionId?: string;
  source: 'external' | 'managed';
  title?: string;
  createdAt: string;
  updatedAt: string;
  leased: boolean;
};

type DiscoveredSessionItem = {
  sessionId: string;
  lastModified: string;
  sizeBytes: number;
};

const AGENT_OPTIONS = [
  { value: 'all', label: '全部 Agent' },
  ...DEPLOYABLE_CLI_CONFIGS.map((item) => ({ value: item.id, label: item.label })),
];

export default function WorkerSessionsPage() {
  const { confirm: confirmDialog, notify } = useFeedback();

  const [workDirFilter, setWorkDirFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('all');
  const [managedSessions, setManagedSessions] = useState<ManagedSessionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const [scanPath, setScanPath] = useState('');
  const [scanAgent, setScanAgent] = useState<DeployableCliAgentId>('claude-code');
  const [scanRuntime, setScanRuntime] = useState<'native' | 'wsl'>('native');
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [discoveredSessions, setDiscoveredSessions] = useState<DiscoveredSessionItem[]>([]);
  const [selectedDiscoveredIds, setSelectedDiscoveredIds] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const fetchManagedSessions = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (workDirFilter.trim()) query.set('workDir', workDirFilter.trim());
      if (agentFilter !== 'all') query.set('agentDefinitionId', agentFilter);
      const res = await fetch(`/api/terminal/session-pool?${query.toString()}`);
      const json = await readApiEnvelope<ManagedSessionItem[]>(res);
      if (!res.ok || !json?.success || !Array.isArray(json?.data)) {
        setError(resolveApiErrorMessage(res, json, '加载托管会话失败'));
        return;
      }
      setManagedSessions(json.data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [agentFilter, workDirFilter]);

  useEffect(() => {
    void fetchManagedSessions();
  }, [fetchManagedSessions, refreshToken]);

  const refreshAll = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const handleScanSessions = useCallback(async () => {
    if (!scanPath.trim()) {
      setScanError('请先填写项目目录');
      return;
    }
    setScanLoading(true);
    setScanError(null);
    try {
      const query = new URLSearchParams({
        path: scanPath.trim(),
        agent: scanAgent,
      });
      if (scanAgent === 'codex') {
        query.set('runtime', scanRuntime);
      }
      const res = await fetch(`/api/terminal/browse?${query.toString()}`);
      const json = await readApiEnvelope<{ agentSessions?: DiscoveredSessionItem[] }>(res);
      if (!res.ok || !json?.success) {
        setScanError(resolveApiErrorMessage(res, json, '扫描会话失败'));
        setDiscoveredSessions([]);
        setSelectedDiscoveredIds([]);
        return;
      }
      const sessions = Array.isArray(json?.data?.agentSessions)
        ? (json.data.agentSessions as DiscoveredSessionItem[])
        : [];
      const sorted = sessions
        .filter((item) => Boolean(item.sessionId))
        .sort((a, b) => toSafeTimestamp(b.lastModified) - toSafeTimestamp(a.lastModified));
      setDiscoveredSessions(sorted);
      setSelectedDiscoveredIds(sorted.map((item) => item.sessionId));
    } catch (err) {
      setScanError((err as Error).message);
      setDiscoveredSessions([]);
      setSelectedDiscoveredIds([]);
    } finally {
      setScanLoading(false);
    }
  }, [scanAgent, scanPath, scanRuntime]);

  const toggleDiscoveredSelection = useCallback((sessionId: string) => {
    setSelectedDiscoveredIds((prev) => (
      prev.includes(sessionId)
        ? prev.filter((id) => id !== sessionId)
        : [...prev, sessionId]
    ));
  }, []);

  const handleImportSelected = useCallback(async () => {
    if (!scanPath.trim()) {
      setScanError('请先填写项目目录');
      return;
    }
    if (selectedDiscoveredIds.length === 0) {
      setScanError('请先选择至少一个会话');
      return;
    }
    setImporting(true);
    try {
      const sessions = selectedDiscoveredIds.map((sessionId) => ({
        agentDefinitionId: scanAgent,
        mode: 'resume' as const,
        resumeSessionId: sessionId,
        source: 'external' as const,
        title: `${scanAgent}#${truncateText(sessionId, 8)}`,
      }));
      const res = await fetch('/api/terminal/session-pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workDir: scanPath.trim(),
          sessions,
        }),
      });
      const json = await readApiEnvelope<unknown>(res);
      if (!res.ok || !json?.success) {
        setScanError(resolveApiErrorMessage(res, json, '导入会话失败'));
        return;
      }
      notify({
        type: 'success',
        title: '导入成功',
        message: `已导入 ${selectedDiscoveredIds.length} 个会话`,
      });
      setError(null);
      refreshAll();
    } catch (err) {
      setScanError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }, [notify, refreshAll, scanAgent, scanPath, selectedDiscoveredIds]);

  const handleDeleteSession = useCallback(async (session: ManagedSessionItem) => {
    const confirmed = await confirmDialog({
      title: '删除托管会话?',
      description: `将删除 ${session.sessionKey}。流水线后续将无法再复用该会话。`,
      confirmText: '删除',
      confirmVariant: 'destructive',
    });
    if (!confirmed) return;

    try {
      const res = await fetch('/api/terminal/session-pool', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey: session.sessionKey }),
      });
      const json = await readApiEnvelope<unknown>(res);
      if (!res.ok || !json?.success) {
        notify({
          type: 'error',
          title: '删除失败',
          message: resolveApiErrorMessage(res, json, '删除托管会话失败'),
        });
        return;
      }
      notify({ type: 'success', title: '删除成功', message: session.sessionKey });
      refreshAll();
    } catch (err) {
      notify({
        type: 'error',
        title: '删除失败',
        message: (err as Error).message,
      });
    }
  }, [confirmDialog, notify, refreshAll]);

  const handleClearAll = useCallback(async () => {
    const scopeText = workDirFilter.trim()
      ? `目录 ${workDirFilter.trim()}`
      : '当前用户下全部目录';
    const agentText = agentFilter === 'all' ? '全部 Agent' : agentFilter;
    const confirmed = await confirmDialog({
      title: '清空托管会话池?',
      description: `将清空范围：${scopeText} / ${agentText}。此操作不可恢复。`,
      confirmText: '确认清空',
      confirmVariant: 'destructive',
    });
    if (!confirmed) return;

    try {
      const body: {
        clearAll: boolean;
        workDir?: string;
        agentDefinitionId?: string;
      } = { clearAll: true };
      if (workDirFilter.trim()) body.workDir = workDirFilter.trim();
      if (agentFilter !== 'all') body.agentDefinitionId = agentFilter;

      const res = await fetch('/api/terminal/session-pool', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await readApiEnvelope<{ removed?: number }>(res);
      if (!res.ok || !json?.success) {
        notify({
          type: 'error',
          title: '清空失败',
          message: resolveApiErrorMessage(res, json, '清空托管会话失败'),
        });
        return;
      }
      const removed = Number(json?.data?.removed ?? 0);
      notify({
        type: 'success',
        title: '清空成功',
        message: `已删除 ${removed} 条会话`,
      });
      refreshAll();
    } catch (err) {
      notify({
        type: 'error',
        title: '清空失败',
        message: (err as Error).message,
      });
    }
  }, [agentFilter, confirmDialog, notify, refreshAll, workDirFilter]);

  const managedColumns: Column<ManagedSessionItem>[] = useMemo(() => ([
    {
      key: 'sessionKey',
      header: '会话键',
      className: 'w-[220px]',
      cell: (row) => (
        <div className="space-y-1">
          <span className="font-mono text-xs text-foreground">{truncateText(row.sessionKey, 24)}</span>
          {row.resumeSessionId ? (
            <div className="font-mono text-[11px] text-muted-foreground">
              resume: {truncateText(row.resumeSessionId, 16)}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground">continue 模式</div>
          )}
        </div>
      ),
    },
    {
      key: 'agent',
      header: 'Agent',
      className: 'w-[130px]',
      cell: (row) => <span className="text-sm text-foreground">{row.agentDefinitionId}</span>,
    },
    {
      key: 'repoPath',
      header: '目录',
      className: 'w-[280px]',
      cell: (row) => (
        <span className="block max-w-[300px] truncate font-mono text-[11px] text-muted-foreground">
          {row.repoPath}
        </span>
      ),
    },
    {
      key: 'mode',
      header: '模式',
      className: 'w-[90px]',
      cell: (row) => <span className="text-sm text-muted-foreground">{row.mode}</span>,
    },
    {
      key: 'source',
      header: '来源',
      className: 'w-[90px]',
      cell: (row) => <span className="text-sm text-muted-foreground">{row.source}</span>,
    },
    {
      key: 'leased',
      header: '租约',
      className: 'w-[110px]',
      cell: (row) => (
        <StatusBadge
          status={row.leased ? 'leased' : 'available'}
          colorToken={row.leased ? 'warning' : 'success'}
          label={row.leased ? '使用中' : '空闲'}
        />
      ),
    },
    {
      key: 'updatedAt',
      header: '更新时间',
      className: 'w-[160px]',
      cell: (row) => <span className="text-xs text-muted-foreground">{formatDateTimeZhCn(row.updatedAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[80px] text-right',
      cell: (row) => (
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => void handleDeleteSession(row)}
        >
          删除
        </Button>
      ),
    },
  ]), [handleDeleteSession]);

  return (
    <div className="space-y-12">
      <PageHeader title="托管会话池" subtitle="管理项目可复用会话，供流水线按策略复用">
        <div className="flex items-center gap-2">
          <Link href="/workers" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            任务节点
          </Link>
          <Link href="/workers/terminal" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            终端节点
          </Link>
          <Button size="sm" variant="secondary" loading={loading} onClick={refreshAll}>
            <RefreshCw size={14} className="mr-1.5" />
            刷新
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={managedSessions.length === 0}
            onClick={() => void handleClearAll()}
          >
            <Trash2 size={14} className="mr-1.5" />
            一键清空
          </Button>
        </div>
      </PageHeader>

      <div className="space-y-4 rounded-xl border border-border bg-card/70 px-5 py-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Input
            label="目录过滤"
            placeholder="例如：/mnt/e/Code/Cam"
            value={workDirFilter}
            onChange={(event) => setWorkDirFilter(event.target.value)}
          />
          <Select
            label="Agent 过滤"
            value={agentFilter}
            onChange={(event) => setAgentFilter(event.target.value)}
            options={AGENT_OPTIONS}
          />
          <div className="flex items-end">
            <Button size="sm" className="w-full" onClick={refreshAll}>
              应用筛选
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            托管会话池加载失败: {error}
          </div>
        ) : null}

        <DataTable
          columns={managedColumns}
          data={managedSessions}
          rowKey={(row) => row.sessionKey}
          loading={loading && managedSessions.length === 0}
          emptyMessage="暂无托管会话"
          emptyHint="可在下方通过扫描导入，或在创建流水线时导入后自动进入会话池。"
        />
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card/70 px-5 py-4">
        <div className="flex items-center gap-2">
          <CloudDownload size={15} className="text-primary" />
          <span className="text-sm font-semibold text-foreground">本地会话扫描导入</span>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Input
            label="项目目录"
            placeholder="例如：/mnt/e/Code/Cam"
            value={scanPath}
            onChange={(event) => setScanPath(event.target.value)}
          />
          <Select
            label="Agent"
            value={scanAgent}
            onChange={(event) => setScanAgent(event.target.value as DeployableCliAgentId)}
            options={AGENT_OPTIONS.filter((item) => item.value !== 'all')}
          />
          <Select
            label="Codex Runtime"
            value={scanRuntime}
            onChange={(event) => setScanRuntime(event.target.value as 'native' | 'wsl')}
            options={[
              { value: 'native', label: 'native' },
              { value: 'wsl', label: 'wsl' },
            ]}
            disabled={scanAgent !== 'codex'}
          />
          <div className="flex items-end">
            <Button size="sm" className="w-full" loading={scanLoading} onClick={() => void handleScanSessions()}>
              扫描会话
            </Button>
          </div>
        </div>

        {scanError ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            扫描失败: {scanError}
          </div>
        ) : null}

        <div className="space-y-2 rounded-lg border border-border bg-background/45 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">发现 {discoveredSessions.length} 个会话</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={selectedDiscoveredIds.length === 0 || importing}
              loading={importing}
              onClick={() => void handleImportSelected()}
            >
              导入选中 ({selectedDiscoveredIds.length})
            </Button>
          </div>

          {discoveredSessions.length === 0 ? (
            <div className="text-xs text-muted-foreground">暂无扫描结果</div>
          ) : (
            <div className="max-h-60 space-y-1 overflow-y-auto pr-1">
              {discoveredSessions.map((session) => {
                const checked = selectedDiscoveredIds.includes(session.sessionId);
                return (
                  <label
                    key={session.sessionId}
                    className="flex cursor-pointer items-center gap-2 rounded border border-border bg-background/50 px-2 py-1.5 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDiscoveredSelection(session.sessionId)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="font-mono text-foreground">{truncateText(session.sessionId, 16)}</span>
                    <span className="ml-auto text-muted-foreground">{formatDateTimeZhCn(session.lastModified)}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
