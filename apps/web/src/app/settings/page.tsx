// ============================================================
// 设置页面
// 分区卡片布局 + 密钥管理使用 Modal + DataTable
// ============================================================

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { useFeedback } from '@/components/providers/feedback-provider';
import { getBadgeBg, getColorVar } from '@/lib/constants';
import { Plus, RefreshCw, RotateCcw, Trash2, Key } from 'lucide-react';

// ---- 类型定义 ----

type SecretItem = {
  id: string;
  name: string;
  repositoryId: string | null;
  agentDefinitionId: string | null;
  createdAt: string;
  updatedAt: string;
};

type RepoMini = { id: string; name: string };

interface SettingsData {
  docker: { socketPath: string; available: boolean };
  keys: Array<{ name: string; present: boolean }>;
  agents: Array<{
    id: string;
    displayName: string;
    requiredEnvVars: Array<{ name: string; required: boolean; sensitive: boolean; present: boolean }>;
  }>;
}

interface SecretFormData {
  name: string;
  value: string;
  repositoryId: string;
  agentDefinitionId: string;
}

const EMPTY_SECRET_FORM: SecretFormData = { name: '', value: '', repositoryId: '', agentDefinitionId: '' };

export default function SettingsPage() {
  const { confirm: confirmDialog, prompt: promptDialog, notify } = useFeedback();
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);

  const [secrets, setSecrets] = useState<SecretItem[]>([]);
  const [secretsLoading, setSecretsLoading] = useState(false);
  const [secretsError, setSecretsError] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoMini[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings/env');
        const json = await res.json();
        if (!cancelled && json.success) setData(json.data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchSecrets = useCallback(async () => {
    setSecretsLoading(true);
    setSecretsError(null);
    try {
      const res = await fetch('/api/secrets');
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setSecretsError(json?.error?.message || `HTTP ${res.status}`);
        return;
      }
      setSecrets(Array.isArray(json.data) ? (json.data as SecretItem[]) : []);
    } catch (err) {
      setSecretsError((err as Error).message);
    } finally {
      setSecretsLoading(false);
    }
  }, []);

  const fetchRepos = useCallback(async () => {
    try {
      const res = await fetch('/api/repos');
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) return;
      const rows = Array.isArray(json.data) ? (json.data as Array<{ id: string; name: string }>) : [];
      setRepos(rows.map((r) => ({ id: r.id, name: r.name })));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSecrets();
    fetchRepos();
  }, [fetchRepos, fetchSecrets]);

  const missingRequired = useMemo(() => {
    if (!data) return [];
    const rows: Array<{ agentId: string; agentName: string; varName: string }> = [];
    for (const a of data.agents) {
      for (const ev of a.requiredEnvVars) {
        if (ev.required && !ev.present) {
          rows.push({ agentId: a.id, agentName: a.displayName, varName: ev.name });
        }
      }
    }
    return rows;
  }, [data]);

  const repoNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of repos) map.set(r.id, r.name);
    return map;
  }, [repos]);

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of data?.agents || []) map.set(a.id, a.displayName);
    return map;
  }, [data]);

  const handleRotateSecret = async (secret: SecretItem) => {
    const value = await promptDialog({
      title: `轮换密钥: ${secret.name}`,
      description: '请输入新的密钥值。',
      label: '密钥值',
      placeholder: '输入新的值',
      defaultValue: '',
      required: true,
      confirmText: '确认轮换',
    });
    if (value === null) return;
    if (!value.trim()) {
      notify({ type: 'error', title: '字段校验失败', message: 'value 不能为空' });
      return;
    }

    const res = await fetch(`/api/secrets/${secret.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      notify({ type: 'error', title: '轮换失败', message: json?.error?.message || `HTTP ${res.status}` });
      return;
    }
    await fetchSecrets();
    notify({ type: 'success', title: '密钥已轮换', message: `${secret.name} 已更新。` });
  };

  const handleDeleteSecret = async (secret: SecretItem) => {
    const confirmed = await confirmDialog({
      title: `删除密钥 "${secret.name}"?`,
      description: '删除后该密钥将不再参与变量解析。',
      confirmText: '删除',
      confirmVariant: 'destructive',
    });
    if (!confirmed) return;

    const res = await fetch(`/api/secrets/${secret.id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      notify({ type: 'error', title: '删除失败', message: json?.error?.message || `HTTP ${res.status}` });
      return;
    }
    await fetchSecrets();
    notify({ type: 'success', title: '密钥已删除', message: `${secret.name} 已删除。` });
  };

  // 密钥表格列定义
  const sortedSecrets = useMemo(
    () => secrets.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [secrets]
  );

  const secretColumns: Column<SecretItem>[] = [
    {
      key: 'name',
      header: '名称',
      className: 'w-[180px]',
      cell: (row) => <span className="font-medium text-foreground">{row.name}</span>,
    },
    {
      key: 'scope',
      header: '作用域',
      cell: (row) => {
        const parts: string[] = [];
        if (row.repositoryId) parts.push(`仓库: ${repoNameById.get(row.repositoryId) || row.repositoryId}`);
        if (row.agentDefinitionId) parts.push(`智能体: ${agentNameById.get(row.agentDefinitionId) || row.agentDefinitionId}`);
        const scope = parts.length > 0 ? parts.join(' / ') : '全局';
        return <span className="text-xs text-muted-foreground">{scope}</span>;
      },
    },
    {
      key: 'updatedAt',
      header: '更新时间',
      className: 'w-[150px]',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">{new Date(row.updatedAt).toLocaleString('zh-CN')}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[120px] text-right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => handleRotateSecret(row)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="轮换"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            onClick={() => handleDeleteSecret(row)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            title="删除"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="设置" subtitle="系统配置" />

      {loading ? (
        <Card padding="lg" className="py-16 text-center text-sm text-muted-foreground">
          正在加载环境状态...
        </Card>
      ) : !data ? (
        <Card padding="lg" className="py-16 text-center text-sm text-destructive">
          设置加载失败。
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Docker 运行环境 */}
          <Card padding="lg">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">运行环境</p>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <StatusPill label="Docker" ok={data.docker.available} />
              <span className="text-xs font-mono text-muted-foreground">{data.docker.socketPath}</span>
            </div>
            {!data.docker.available && (
              <p className="mt-3 text-xs text-muted-foreground">
                Docker 不可用时，容器调度会跳过；可改用外部常驻工作节点进程。
              </p>
            )}
          </Card>

          {/* 认证状态 */}
          <Card padding="lg">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">密钥与令牌</p>
            <div className="flex flex-wrap gap-2">
              {data.keys.map((k) => (
                <StatusPill key={k.name} label={k.name} ok={k.present} />
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
              只展示是否配置，不会显示实际值。建议配置 CAM_AUTH_TOKEN 保护系统访问，CAM_MASTER_KEY 托管敏感值；GITHUB_TOKEN/GITLAB_TOKEN/GITEA_TOKEN 用于自动创建 PR/MR；CAM_WEBHOOK_URL/CAM_WEBHOOK_URLS 可配置状态变更通知。
            </p>
          </Card>

          {/* 密钥管理 */}
          <Card padding="lg">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">密钥管理</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  密钥加密存储在 SQLite 中(需 CAM_MASTER_KEY)。作用域越具体优先级越高。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={secretsLoading} onClick={fetchSecrets}>
                  <RefreshCw size={13} className={secretsLoading ? 'animate-spin mr-1' : 'mr-1'} />
                  刷新
                </Button>
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus size={14} className="mr-1" />
                  添加密钥
                </Button>
              </div>
            </div>

            {secretsError && (
              <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive">
                加载密钥失败: {secretsError}
              </div>
            )}

            <DataTable
              columns={secretColumns}
              data={sortedSecrets}
              rowKey={(r) => r.id}
              loading={secretsLoading}
              emptyMessage="暂无密钥配置"
              emptyHint="点击「添加密钥」创建第一个密钥。"
            />
          </Card>

          {/* 智能体缺失环境变量 */}
          <Card padding="lg">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">智能体环境变量</p>
            {missingRequired.length === 0 ? (
              <p className="text-sm text-muted-foreground">当前智能体定义所需环境变量均已配置。</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  以下为智能体定义声明的必需环境变量，但当前服务端未配置:
                </p>
                <div className="max-h-[280px] overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs">
                  {missingRequired.map((r, i) => (
                    <div key={`${r.agentId}-${r.varName}-${i}`} className="py-0.5 text-muted-foreground">
                      <span className="text-foreground">[{r.agentId}]</span> {r.varName}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* 创建密钥 Modal */}
      <SecretFormModal
        open={createOpen}
        repos={repos}
        agents={data?.agents || []}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (formData) => {
          const res = await fetch('/api/secrets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: formData.name.trim(),
              value: formData.value,
              repositoryId: formData.repositoryId || undefined,
              agentDefinitionId: formData.agentDefinitionId || undefined,
            }),
          });
          const json = await res.json().catch(() => null);
          if (!res.ok || !json?.success) throw new Error(json?.error?.message || `HTTP ${res.status}`);
          await fetchSecrets();
          notify({ type: 'success', title: '密钥已创建', message: '已创建密钥。' });
        }}
      />
    </div>
  );
}

// ---- 创建密钥 Modal ----

function SecretFormModal({
  open,
  repos,
  agents,
  onClose,
  onSubmit,
}: {
  open: boolean;
  repos: RepoMini[];
  agents: Array<{ id: string; displayName: string }>;
  onClose: () => void;
  onSubmit: (data: SecretFormData) => Promise<void>;
}) {
  const [form, setForm] = useState<SecretFormData>(EMPTY_SECRET_FORM);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_SECRET_FORM);
      setSubmitError(null);
      setSaving(false);
    }
  }, [open]);

  const handleSubmit = async () => {
    setSaving(true);
    setSubmitError(null);
    try {
      await onSubmit(form);
      onClose();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = !saving && form.name.trim() !== '' && form.value.trim() !== '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="添加密钥"
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
            <Key size={13} className="mr-1" />
            {saving ? '保存中...' : '保存'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="名称"
            required
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            placeholder="OPENAI_API_KEY"
          />
          <Input
            label="值"
            type="password"
            required
            value={form.value}
            onChange={(e) => setForm((s) => ({ ...s, value: e.target.value }))}
            placeholder="sk-..."
          />
          <Select
            label="仓库作用域"
            value={form.repositoryId}
            onChange={(e) => setForm((s) => ({ ...s, repositoryId: e.target.value }))}
            options={[{ value: '', label: '全局' }, ...repos.map((r) => ({ value: r.id, label: r.name }))]}
          />
          <Select
            label="智能体作用域"
            value={form.agentDefinitionId}
            onChange={(e) => setForm((s) => ({ ...s, agentDefinitionId: e.target.value }))}
            options={[{ value: '', label: '全局' }, ...agents.map((a) => ({ value: a.id, label: a.displayName }))]}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          作用域越具体优先级越高: 仓库+智能体 &gt; 仓库 &gt; 智能体 &gt; 全局。
        </p>

        {submitError ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {submitError}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

// ---- 状态指示标签 ----

function StatusPill({ label, ok }: { label: string; ok: boolean }) {
  const token = ok ? 'success' : 'destructive';
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold"
      style={{ background: getBadgeBg(token), color: getColorVar(token) }}
      title={ok ? '已配置' : '缺失'}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: getColorVar(token) }} />
      {label}
    </span>
  );
}
