// ============================================================
// 任务模板管理页面
// 使用 DataTable + Modal 的标准管理页面模式
// ============================================================

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgentStore, useRepoStore } from '@/stores';
import type { AgentDefinitionItem, RepositoryItem } from '@/stores';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useFeedback } from '@/components/providers/feedback-provider';
import { TEMPLATE_UI_MESSAGES } from '@/lib/i18n/ui-messages';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';

// ---- 类型定义 ----

type TaskTemplateItem = {
  id: string;
  name: string;
  titleTemplate: string;
  promptTemplate: string;
  agentDefinitionId: string | null;
  repositoryId: string | null;
  repoUrl: string | null;
  baseBranch: string | null;
  workDir: string | null;
  createdAt: string;
  updatedAt: string;
};

// ---- 表单状态 ----

interface TemplateFormData {
  name: string;
  titleTemplate: string;
  promptTemplate: string;
  agentDefinitionId: string;
  repositoryId: string;
  repoUrl: string;
  baseBranch: string;
  workDir: string;
}

const EMPTY_FORM: TemplateFormData = {
  name: '',
  titleTemplate: '',
  promptTemplate: '',
  agentDefinitionId: '',
  repositoryId: '',
  repoUrl: '',
  baseBranch: 'main',
  workDir: '',
};

export default function TemplatesPage() {
  const { agents, fetchAgents } = useAgentStore();
  const { repos, fetchRepos } = useRepoStore();
  const { confirm: confirmDialog, notify } = useFeedback();

  const [templates, setTemplates] = useState<TaskTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplateItem | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/task-templates');
      const json = await res.json().catch(() => null);
      if (!json?.success || !Array.isArray(json?.data)) {
        setError(json?.error?.message || TEMPLATE_UI_MESSAGES.requestFailed);
        return;
      }
      setTemplates(json.data as TaskTemplateItem[]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
    fetchAgents();
    fetchRepos();
  }, [fetchTemplates, fetchAgents, fetchRepos]);

  // 搜索过滤
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return templates;
    return templates.filter((item) => {
      const text = [item.name, item.titleTemplate, item.promptTemplate, item.agentDefinitionId || '', item.repoUrl || '']
        .join(' ')
        .toLowerCase();
      return text.includes(keyword);
    });
  }, [templates, query]);

  // 删除操作
  const handleDelete = async (item: TaskTemplateItem) => {
    const confirmed = await confirmDialog({
      title: TEMPLATE_UI_MESSAGES.deleteTitle(item.name),
      description: TEMPLATE_UI_MESSAGES.deleteDescription,
      confirmText: TEMPLATE_UI_MESSAGES.deleteConfirm,
      confirmVariant: 'destructive',
    });
    if (!confirmed) return;

    const res = await fetch(`/api/task-templates/${item.id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => null);
    if (!json?.success) {
      notify({ type: 'error', title: TEMPLATE_UI_MESSAGES.deleteFailed, message: json?.error?.message || TEMPLATE_UI_MESSAGES.requestFailed });
      return;
    }
    notify({ type: 'success', title: TEMPLATE_UI_MESSAGES.deleteSuccessTitle, message: TEMPLATE_UI_MESSAGES.deleteSuccessMessage(item.name) });
    fetchTemplates();
  };

  // 表格列定义
  const columns: Column<TaskTemplateItem>[] = [
    {
      key: 'name',
      header: TEMPLATE_UI_MESSAGES.fields.name,
      className: 'w-[160px]',
      cell: (row) => <span className="font-medium text-foreground">{row.name}</span>,
    },
    {
      key: 'titleTemplate',
      header: TEMPLATE_UI_MESSAGES.fields.titleTemplate,
      className: 'w-[200px]',
      cell: (row) => <span className="text-sm text-muted-foreground truncate block max-w-[200px]">{row.titleTemplate}</span>,
    },
    {
      key: 'agentDefinitionId',
      header: TEMPLATE_UI_MESSAGES.fields.agentDefinition,
      className: 'w-[140px]',
      cell: (row) => (
        <span className="font-mono text-xs text-muted-foreground">{row.agentDefinitionId || '-'}</span>
      ),
    },
    {
      key: 'repoUrl',
      header: TEMPLATE_UI_MESSAGES.fields.repoUrl,
      cell: (row) => (
        <span className="font-mono text-xs text-muted-foreground truncate block max-w-[220px]">{row.repoUrl || '-'}</span>
      ),
    },
    {
      key: 'updatedAt',
      header: TEMPLATE_UI_MESSAGES.cardUpdatedAt,
      className: 'w-[150px]',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.updatedAt).toLocaleString('zh-CN')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[100px] text-right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => setEditingTemplate(row)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={TEMPLATE_UI_MESSAGES.edit}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={() => handleDelete(row)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            title={TEMPLATE_UI_MESSAGES.deleteConfirm}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={TEMPLATE_UI_MESSAGES.pageTitle} subtitle={TEMPLATE_UI_MESSAGES.pageSubtitle}>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={15} className="mr-1" />
          {TEMPLATE_UI_MESSAGES.newTemplate}
        </Button>
      </PageHeader>

      {/* 搜索栏 */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={TEMPLATE_UI_MESSAGES.searchPlaceholder}
          className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/50 transition-colors hover:border-border-light focus:border-primary focus:outline-none"
        />
      </div>

      {/* 错误提示 */}
      {!loading && error ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {TEMPLATE_UI_MESSAGES.loadFailedTitle}: {error}
        </div>
      ) : null}

      {/* 数据表格 */}
      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(r) => r.id}
        loading={loading}
        emptyMessage={TEMPLATE_UI_MESSAGES.empty}
        emptyHint={TEMPLATE_UI_MESSAGES.emptyHint}
      />

      {/* 创建 Modal */}
      <TemplateFormModal
        open={createOpen}
        title={TEMPLATE_UI_MESSAGES.createTitle}
        initialData={EMPTY_FORM}
        agents={agents}
        repos={repos}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (data) => {
          const payload = buildPayload(data);
          const res = await fetch('/api/task-templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const json = await res.json().catch(() => null);
          if (!json?.success) throw new Error(json?.error?.message || TEMPLATE_UI_MESSAGES.requestFailed);
          notify({ type: 'success', title: TEMPLATE_UI_MESSAGES.createSuccessTitle, message: TEMPLATE_UI_MESSAGES.createSuccessMessage(payload.name) });
          fetchTemplates();
        }}
      />

      {/* 编辑 Modal */}
      <TemplateFormModal
        open={editingTemplate !== null}
        title={TEMPLATE_UI_MESSAGES.editTitle}
        initialData={
          editingTemplate
            ? {
                name: editingTemplate.name,
                titleTemplate: editingTemplate.titleTemplate,
                promptTemplate: editingTemplate.promptTemplate,
                agentDefinitionId: editingTemplate.agentDefinitionId || '',
                repositoryId: editingTemplate.repositoryId || '',
                repoUrl: editingTemplate.repoUrl || '',
                baseBranch: editingTemplate.baseBranch || 'main',
                workDir: editingTemplate.workDir || '',
              }
            : EMPTY_FORM
        }
        agents={agents}
        repos={repos}
        onClose={() => setEditingTemplate(null)}
        onSubmit={async (data) => {
          if (!editingTemplate) return;
          const payload = buildPayload(data);
          const res = await fetch(`/api/task-templates/${editingTemplate.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const json = await res.json().catch(() => null);
          if (!json?.success) throw new Error(json?.error?.message || TEMPLATE_UI_MESSAGES.requestFailed);
          notify({ type: 'success', title: TEMPLATE_UI_MESSAGES.editSuccessTitle, message: TEMPLATE_UI_MESSAGES.editSuccessMessage(payload.name) });
          fetchTemplates();
        }}
      />
    </div>
  );
}

// ---- 构造提交 payload ----

function buildPayload(data: TemplateFormData) {
  return {
    name: data.name.trim(),
    titleTemplate: data.titleTemplate.trim(),
    promptTemplate: data.promptTemplate.trim(),
    agentDefinitionId: data.agentDefinitionId.trim() || null,
    repositoryId: data.repositoryId.trim() || null,
    repoUrl: data.repoUrl.trim() || null,
    baseBranch: data.baseBranch.trim() || null,
    workDir: data.workDir.trim() || null,
  };
}

// ---- 模板表单 Modal ----

function TemplateFormModal({
  open,
  title,
  initialData,
  agents,
  repos,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initialData: TemplateFormData;
  agents: AgentDefinitionItem[];
  repos: RepositoryItem[];
  onClose: () => void;
  onSubmit: (data: TemplateFormData) => Promise<void>;
}) {
  const [form, setForm] = useState<TemplateFormData>(initialData);
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

  // 选择仓库预设时自动填充相关字段
  const handleRepositoryChange = (repositoryId: string) => {
    const selectedRepo = repos.find((repo) => repo.id === repositoryId);
    setForm((prev) => ({
      ...prev,
      repositoryId,
      repoUrl: selectedRepo?.repoUrl || prev.repoUrl,
      baseBranch: selectedRepo?.defaultBaseBranch || prev.baseBranch,
      workDir: selectedRepo?.defaultWorkDir || prev.workDir,
    }));
  };

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

  const canSubmit = !saving && form.name.trim() !== '' && form.titleTemplate.trim() !== '' && form.promptTemplate.trim() !== '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {TEMPLATE_UI_MESSAGES.close}
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
            {saving ? TEMPLATE_UI_MESSAGES.saveInProgress : TEMPLATE_UI_MESSAGES.saveAction}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* 基本信息 */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={TEMPLATE_UI_MESSAGES.fields.name}
            required
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder={TEMPLATE_UI_MESSAGES.fields.namePlaceholder}
          />
          <Input
            label={TEMPLATE_UI_MESSAGES.fields.titleTemplate}
            required
            value={form.titleTemplate}
            onChange={(e) => setForm((prev) => ({ ...prev, titleTemplate: e.target.value }))}
            placeholder={TEMPLATE_UI_MESSAGES.fields.titleTemplatePlaceholder}
          />
          <Select
            label={TEMPLATE_UI_MESSAGES.fields.agentDefinition}
            value={form.agentDefinitionId}
            onChange={(e) => setForm((prev) => ({ ...prev, agentDefinitionId: e.target.value }))}
            options={[
              { value: '', label: TEMPLATE_UI_MESSAGES.fields.agentDefinitionNone },
              ...agents.map((agent) => ({ value: agent.id, label: `${agent.displayName} (${agent.id})` })),
            ]}
          />
          <Select
            label={TEMPLATE_UI_MESSAGES.fields.repository}
            value={form.repositoryId}
            onChange={(e) => handleRepositoryChange(e.target.value)}
            options={[
              { value: '', label: TEMPLATE_UI_MESSAGES.fields.repositoryNone },
              ...repos.map((repo) => ({ value: repo.id, label: repo.name })),
            ]}
          />
          <Input
            label={TEMPLATE_UI_MESSAGES.fields.repoUrl}
            value={form.repoUrl}
            onChange={(e) => setForm((prev) => ({ ...prev, repoUrl: e.target.value }))}
            placeholder={TEMPLATE_UI_MESSAGES.fields.repoUrlPlaceholder}
          />
          <Input
            label={TEMPLATE_UI_MESSAGES.fields.baseBranch}
            value={form.baseBranch}
            onChange={(e) => setForm((prev) => ({ ...prev, baseBranch: e.target.value }))}
            placeholder={TEMPLATE_UI_MESSAGES.fields.baseBranchPlaceholder}
          />
          <Input
            label={TEMPLATE_UI_MESSAGES.fields.workDir}
            value={form.workDir}
            onChange={(e) => setForm((prev) => ({ ...prev, workDir: e.target.value }))}
            placeholder={TEMPLATE_UI_MESSAGES.fields.workDirPlaceholder}
          />
          <div className="flex items-end pb-1">
            <p className="text-xs text-muted-foreground/70">{TEMPLATE_UI_MESSAGES.fields.usageHint}</p>
          </div>
        </div>

        {/* Prompt 模板 */}
        <Textarea
          label={TEMPLATE_UI_MESSAGES.fields.prompt}
          required
          rows={6}
          value={form.promptTemplate}
          onChange={(e) => setForm((prev) => ({ ...prev, promptTemplate: e.target.value }))}
          placeholder={TEMPLATE_UI_MESSAGES.fields.promptPlaceholder}
        />

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
