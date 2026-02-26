// ============================================================
// 智能体定义管理页面
// 使用 DataTable + Modal 的标准管理页面模式
// ============================================================

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAgentStore } from '@/stores';
import type { AgentDefinitionItem } from '@/stores';
import { getBadgeBg, getColorVar } from '@/lib/constants';
import { readApiEnvelope, resolveApiErrorMessage } from '@/lib/http/client-response';
import { normalizeOptionalString } from '@/lib/validation/strings';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { TabBar } from '@/components/ui/tabs';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { useFeedback } from '@/components/providers/feedback-provider';
import { Plus, Pencil, Trash2 } from 'lucide-react';

// ---- 表单状态 ----

interface AgentFormData {
  id: string;
  displayName: string;
  description: string;
  dockerImage: string;
  command: string;
  args: string;
  envVars: EnvVarRow[];
  runtime: string;
}

interface EnvVarRow {
  name: string;
  required: boolean;
  sensitive: boolean;
  description: string;
}

const EMPTY_FORM: AgentFormData = {
  id: '',
  displayName: '',
  description: '',
  dockerImage: '',
  command: '',
  args: '',
  envVars: [],
  runtime: 'native',
};

export default function AgentsPage() {
  const { agents, loading, fetchAgents } = useAgentStore();
  const { confirm: confirmDialog, notify } = useFeedback();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentDefinitionItem | null>(null);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Tab 过滤
  const builtInCount = agents.filter((a) => a.builtIn).length;
  const customCount = agents.filter((a) => !a.builtIn).length;

  const filtered = useMemo(() => {
    if (activeTab === 'builtin') return agents.filter((a) => a.builtIn);
    if (activeTab === 'custom') return agents.filter((a) => !a.builtIn);
    return agents;
  }, [agents, activeTab]);

  const handleDelete = async (agent: AgentDefinitionItem) => {
    if (agent.builtIn) {
      notify({ type: 'error', title: '删除被拒绝', message: '内置智能体定义不允许删除' });
      return;
    }
    const confirmed = await confirmDialog({
      title: `删除智能体定义 "${agent.id}"?`,
      description: '删除后该智能体将无法继续用于新任务。',
      confirmText: '删除',
      confirmVariant: 'destructive',
    });
    if (!confirmed) return;

    await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' });
    notify({ type: 'success', title: '智能体已删除', message: `${agent.id} 已删除。` });
    fetchAgents();
  };

  // 表格列定义
  const columns: Column<AgentDefinitionItem>[] = [
    {
      key: 'displayName',
      header: '名称',
      className: 'w-[160px]',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{row.displayName}</span>
          {row.builtIn && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: getBadgeBg('accent'), color: getColorVar('accent') }}
            >
              内置
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'id',
      header: 'ID',
      className: 'w-[140px]',
      cell: (row) => <span className="font-mono text-xs text-muted-foreground">{row.id}</span>,
    },
    {
      key: 'dockerImage',
      header: 'Docker 镜像',
      cell: (row) => <span className="font-mono text-xs text-muted-foreground truncate block max-w-[200px]">{row.dockerImage}</span>,
    },
    {
      key: 'command',
      header: '命令',
      className: 'w-[180px]',
      cell: (row) => (
        <span className="font-mono text-xs text-muted-foreground truncate block max-w-[180px]">
          {row.command} {(row.args || []).join(' ')}
        </span>
      ),
    },
    {
      key: 'capabilities',
      header: '能力标签',
      className: 'w-[200px]',
      cell: (row) => {
        const caps = Object.entries(row.capabilities || {}).filter(([, v]) => v);
        const envVars = row.requiredEnvVars || [];
        return (
          <div className="flex flex-wrap gap-1">
            {caps.map(([key]) => (
              <span
                key={key}
                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{ background: getBadgeBg('success'), color: getColorVar('success') }}
              >
                {key}
              </span>
            ))}
            {envVars.slice(0, 2).map((ev) => (
              <span
                key={ev.name}
                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  background: ev.required ? getBadgeBg('warning') : 'var(--color-muted)',
                  color: ev.required ? getColorVar('warning') : getColorVar('muted-foreground'),
                }}
              >
                {ev.name}
              </span>
            ))}
            {envVars.length > 2 && (
              <span className="text-[10px] text-muted-foreground/50">+{envVars.length - 2}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[100px] text-right',
      cell: (row) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setEditingAgent(row)}
              aria-label="编辑"
            >
              <Pencil size={14} />
            </Button>
            {!row.builtIn && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive"
                onClick={() => handleDelete(row)}
                aria-label="删除"
              >
                <Trash2 size={14} />
              </Button>
            )}
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-12">
      <PageHeader title="智能体定义" subtitle="配置编码智能体模板">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={15} className="mr-1" />
          新建智能体
        </Button>
      </PageHeader>

      {/* Tab 筛选 */}
      <TabBar
        tabs={[
          { key: 'all', label: '全部', count: agents.length },
          { key: 'builtin', label: '内置', count: builtInCount },
          { key: 'custom', label: '自定义', count: customCount },
        ]}
        activeKey={activeTab}
        onChange={setActiveTab}
      />

      {/* 数据表格 */}
      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(r) => r.id}
        loading={loading}
        emptyMessage="暂无智能体定义"
        emptyHint="可执行 pnpm db:seed 加载内置定义。"
      />

      {/* 创建 Modal */}
      <AgentFormModal
        open={createOpen}
        title="注册新智能体"
        mode="create"
        initialData={EMPTY_FORM}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (data) => {
          const res = await fetch('/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: data.id.trim(),
              displayName: data.displayName.trim(),
              description: normalizeOptionalString(data.description),
              dockerImage: data.dockerImage.trim(),
              command: data.command.trim(),
              args: data.args.split(' ').filter(Boolean),
              requiredEnvVars: normalizeEnvVars(data.envVars),
              capabilities: { nonInteractive: true, autoGitCommit: false, outputSummary: false, promptFromFile: false },
              defaultResourceLimits: { memoryLimitMb: 4096, timeoutMinutes: 120 },
              runtime: data.runtime,
            }),
          });
          const json = await readApiEnvelope<unknown>(res);
          if (!res.ok || !json?.success) {
            throw new Error(resolveApiErrorMessage(res, json, '创建失败'));
          }
          notify({ type: 'success', title: '智能体已创建', message: `${data.id} 已创建。` });
          fetchAgents();
        }}
      />

      {/* 编辑 Modal */}
      <AgentFormModal
        open={editingAgent !== null}
        title="编辑智能体"
        mode="edit"
        initialData={
          editingAgent
            ? {
                id: editingAgent.id,
                displayName: editingAgent.displayName,
                description: editingAgent.description || '',
                dockerImage: editingAgent.dockerImage,
                command: editingAgent.command,
                args: (editingAgent.args || []).join(' '),
                envVars: (editingAgent.requiredEnvVars || []).map((ev) => ({
                  name: ev.name,
                  required: Boolean(ev.required),
                  sensitive: Boolean(ev.sensitive),
                  description: ev.description || '',
                })),
                runtime: (editingAgent as AgentDefinitionItem & { runtime?: string }).runtime || 'native',
              }
            : EMPTY_FORM
        }
        onClose={() => setEditingAgent(null)}
        onSubmit={async (data) => {
          if (!editingAgent) return;
          const res = await fetch(`/api/agents/${editingAgent.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: editingAgent.id,
              displayName: data.displayName.trim(),
              description: normalizeOptionalString(data.description),
              icon: null,
              dockerImage: data.dockerImage.trim(),
              command: data.command.trim(),
              args: data.args.split(' ').filter(Boolean),
              requiredEnvVars: normalizeEnvVars(data.envVars),
              capabilities: editingAgent.capabilities,
              defaultResourceLimits: editingAgent.defaultResourceLimits,
              runtime: data.runtime,
            }),
          });
          const json = await readApiEnvelope<unknown>(res);
          if (!res.ok || !json?.success) {
            throw new Error(resolveApiErrorMessage(res, json, '更新失败'));
          }
          notify({ type: 'success', title: '智能体已更新', message: `${editingAgent.id} 已更新。` });
          fetchAgents();
        }}
      />
    </div>
  );
}

// ---- 环境变量去重工具 ----

function normalizeEnvVars(rows: EnvVarRow[]): EnvVarRow[] {
  const map = new Map<string, EnvVarRow>();
  for (const r of rows) {
    const name = (r.name || '').trim();
    if (!name) continue;
    const existing = map.get(name);
    if (!existing) {
      map.set(name, { name, required: Boolean(r.required), sensitive: Boolean(r.sensitive), description: (r.description || '').trim() });
      continue;
    }
    existing.required = existing.required || Boolean(r.required);
    existing.sensitive = existing.sensitive || Boolean(r.sensitive);
    if (!existing.description && r.description) existing.description = (r.description || '').trim();
  }
  return Array.from(map.values());
}

// ---- 智能体表单 Modal ----

function AgentFormModal({
  open,
  title,
  mode,
  initialData,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  mode: 'create' | 'edit';
  initialData: AgentFormData;
  onClose: () => void;
  onSubmit: (data: AgentFormData) => Promise<void>;
}) {
  const [form, setForm] = useState<AgentFormData>(initialData);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 打开时重置表单
  useEffect(() => {
    if (open) {
      setForm(initialData);
      setSubmitError(null);
      setSaving(false);
    }
  }, [open, initialData]);

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

  const canSubmit =
    !saving &&
    form.displayName.trim() !== '' &&
    form.dockerImage.trim() !== '' &&
    form.command.trim() !== '' &&
    (mode === 'edit' || form.id.trim() !== '');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" disabled={!canSubmit} loading={saving} onClick={handleSubmit}>
            {mode === 'create' ? '创建' : '保存'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === 'create' && (
            <Input
              label="ID"
              required
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="my-custom-agent"
            />
          )}
          <Input
            label="显示名称"
            required
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            placeholder="My Agent"
          />
          <Input
            label="Docker 镜像"
            required
            value={form.dockerImage}
            onChange={(e) => setForm({ ...form, dockerImage: e.target.value })}
            placeholder="cam-worker:my-agent"
          />
          <Input
            label="启动命令"
            required
            value={form.command}
            onChange={(e) => setForm({ ...form, command: e.target.value })}
            placeholder="python"
          />
          <Input
            label="参数(空格分隔)"
            value={form.args}
            onChange={(e) => setForm({ ...form, args: e.target.value })}
            placeholder="--task {{prompt}} --auto"
          />
        </div>

        <Textarea
          label="描述"
          rows={3}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="可选描述..."
        />

        {/* 运行时环境 */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">运行时环境</label>
          <select
            value={form.runtime}
            onChange={(e) => setForm({ ...form, runtime: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
          >
            <option value="native">原生执行（直接启动命令）</option>
            <option value="wsl">WSL（通过 Windows Subsystem for Linux 执行）</option>
          </select>
          <p className="text-[11px] text-muted-foreground">
            {form.runtime === 'wsl'
              ? '命令将通过 wsl.exe 在 Linux 子系统中执行，工作目录自动转换为 /mnt/ 路径'
              : 'Windows 上使用 cmd.exe 中转，Linux/macOS 直接执行'}
          </p>
        </div>

        {/* 环境变量编辑器 */}
        <EnvVarsEditor envVars={form.envVars} onChange={(envVars) => setForm({ ...form, envVars })} />

        {/* 提交错误 */}
        {submitError ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {submitError}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

// ---- 环境变量编辑器 ----

function EnvVarsEditor({
  envVars,
  onChange,
}: {
  envVars: EnvVarRow[];
  onChange: (rows: EnvVarRow[]) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">环境变量</p>
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            声明智能体运行时需要注入的环境变量。
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onChange([...envVars, { name: '', required: true, sensitive: true, description: '' }])}
        >
          <Plus size={13} className="mr-1" />
          添加
        </Button>
      </div>

      {envVars.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">未声明环境变量。</p>
      ) : (
        <div className="space-y-2">
          {envVars.map((row, idx) => (
            <div key={idx} className="rounded-lg border border-border bg-background p-3">
              <div className="grid gap-3 sm:grid-cols-6">
                <div className="sm:col-span-2">
                  <Input
                    label="名称"
                    value={row.name}
                    onChange={(e) =>
                      onChange(envVars.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))
                    }
                    placeholder="OPENAI_API_KEY"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    label="描述"
                    value={row.description}
                    onChange={(e) =>
                      onChange(envVars.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r)))
                    }
                    placeholder="用于..."
                  />
                </div>
                <div className="sm:col-span-1">
                  <label className="mb-2 block text-xs font-medium text-muted-foreground">必填</label>
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={row.required}
                      onChange={(e) =>
                        onChange(envVars.map((r, i) => (i === idx ? { ...r, required: e.target.checked } : r)))
                      }
                    />
                    <span className="text-muted-foreground">必填</span>
                  </label>
                </div>
                <div className="flex items-end justify-between sm:col-span-1">
                  <div>
                    <label className="mb-2 block text-xs font-medium text-muted-foreground">敏感</label>
                    <label className="inline-flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={row.sensitive}
                        onChange={(e) =>
                          onChange(envVars.map((r, i) => (i === idx ? { ...r, sensitive: e.target.checked } : r)))
                        }
                      />
                      <span className="text-muted-foreground">敏感</span>
                    </label>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => onChange(envVars.filter((_, i) => i !== idx))}
                    aria-label="移除"
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
