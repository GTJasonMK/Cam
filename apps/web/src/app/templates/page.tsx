// ============================================================
// 提示词管理页面
// 仅管理单任务提示词；流水线模板编辑已迁移到 /pipelines
// ============================================================

'use client';

import Link from 'next/link';
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
import { Plus, Pencil, Trash2, Search, ArrowRight } from 'lucide-react';

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
  pipelineSteps: unknown[] | null;
  maxRetries: number | null;
  createdAt: string;
  updatedAt: string;
};

interface PromptTemplateFormData {
  name: string;
  titleTemplate: string;
  promptTemplate: string;
  agentDefinitionId: string;
  repositoryId: string;
  repoUrl: string;
  baseBranch: string;
  workDir: string;
  maxRetries: number;
}

const EMPTY_FORM: PromptTemplateFormData = {
  name: '',
  titleTemplate: '',
  promptTemplate: '',
  agentDefinitionId: '',
  repositoryId: '',
  repoUrl: '',
  baseBranch: 'main',
  workDir: '',
  maxRetries: 2,
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

      const singleTemplates = (json.data as TaskTemplateItem[]).filter(
        (item) => !item.pipelineSteps || item.pipelineSteps.length === 0,
      );
      setTemplates(singleTemplates);
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

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return templates;
    return templates.filter((item) => {
      const text = [
        item.name,
        item.titleTemplate,
        item.promptTemplate,
        item.agentDefinitionId || '',
        item.repoUrl || '',
      ].join(' ').toLowerCase();
      return text.includes(keyword);
    });
  }, [templates, query]);

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
      notify({
        type: 'error',
        title: TEMPLATE_UI_MESSAGES.deleteFailed,
        message: json?.error?.message || TEMPLATE_UI_MESSAGES.requestFailed,
      });
      return;
    }
    notify({
      type: 'success',
      title: TEMPLATE_UI_MESSAGES.deleteSuccessTitle,
      message: TEMPLATE_UI_MESSAGES.deleteSuccessMessage(item.name),
    });
    fetchTemplates();
  };

  const columns: Column<TaskTemplateItem>[] = [
    {
      key: 'name',
      header: TEMPLATE_UI_MESSAGES.fields.name,
      className: 'w-[180px]',
      cell: (row) => (
        <span className="font-medium text-foreground">{row.name}</span>
      ),
    },
    {
      key: 'titleTemplate',
      header: TEMPLATE_UI_MESSAGES.fields.titleTemplate,
      cell: (row) => (
        <span className="text-sm text-muted-foreground truncate block max-w-[260px]">{row.titleTemplate || '-'}</span>
      ),
    },
    {
      key: 'agentDefinitionId',
      header: TEMPLATE_UI_MESSAGES.fields.agentDefinition,
      className: 'w-[170px]',
      cell: (row) => (
        <span className="font-mono text-xs text-muted-foreground">{row.agentDefinitionId || '-'}</span>
      ),
    },
    {
      key: 'updatedAt',
      header: TEMPLATE_UI_MESSAGES.cardUpdatedAt,
      className: 'w-[170px]',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">{new Date(row.updatedAt).toLocaleString('zh-CN')}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[110px] text-right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setEditingTemplate(row)}
            aria-label={TEMPLATE_UI_MESSAGES.edit}
          >
            <Pencil size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive"
            onClick={() => handleDelete(row)}
            aria-label={TEMPLATE_UI_MESSAGES.deleteConfirm}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-10">
      <PageHeader title={TEMPLATE_UI_MESSAGES.pageTitle} subtitle={TEMPLATE_UI_MESSAGES.pageSubtitle}>
        <Link
          href="/pipelines"
          className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-border-light hover:text-foreground"
        >
          流水线编辑
          <ArrowRight size={14} className="ml-1" />
        </Link>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={15} className="mr-1" />
          {TEMPLATE_UI_MESSAGES.newTemplate}
        </Button>
      </PageHeader>

      <div className="rounded-lg border border-border bg-card/70 px-4 py-3 text-xs text-muted-foreground">
        当前页面仅管理单任务提示词。流水线模板的创建与编辑已迁移至
        {' '}
        <Link href="/pipelines" className="text-primary hover:underline">
          /pipelines
        </Link>
        。
      </div>

      <div className="relative max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={TEMPLATE_UI_MESSAGES.searchPlaceholder}
          className="pl-9"
        />
      </div>

      {!loading && error ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {TEMPLATE_UI_MESSAGES.loadFailedTitle}: {error}
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(r) => r.id}
        loading={loading}
        emptyMessage={TEMPLATE_UI_MESSAGES.empty}
        emptyHint={TEMPLATE_UI_MESSAGES.emptyHint}
      />

      <PromptTemplateFormModal
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
          if (!json?.success) {
            throw new Error(json?.error?.message || TEMPLATE_UI_MESSAGES.requestFailed);
          }
          notify({
            type: 'success',
            title: TEMPLATE_UI_MESSAGES.createSuccessTitle,
            message: TEMPLATE_UI_MESSAGES.createSuccessMessage(payload.name),
          });
          fetchTemplates();
        }}
      />

      <PromptTemplateFormModal
        open={editingTemplate !== null}
        title={TEMPLATE_UI_MESSAGES.editTitle}
        initialData={templateToFormData(editingTemplate)}
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
          if (!json?.success) {
            throw new Error(json?.error?.message || TEMPLATE_UI_MESSAGES.requestFailed);
          }
          notify({
            type: 'success',
            title: TEMPLATE_UI_MESSAGES.editSuccessTitle,
            message: TEMPLATE_UI_MESSAGES.editSuccessMessage(payload.name),
          });
          fetchTemplates();
        }}
      />
    </div>
  );
}

function templateToFormData(item: TaskTemplateItem | null): PromptTemplateFormData {
  if (!item) return EMPTY_FORM;
  return {
    name: item.name,
    titleTemplate: item.titleTemplate,
    promptTemplate: item.promptTemplate,
    agentDefinitionId: item.agentDefinitionId || '',
    repositoryId: item.repositoryId || '',
    repoUrl: item.repoUrl || '',
    baseBranch: item.baseBranch || 'main',
    workDir: item.workDir || '',
    maxRetries: item.maxRetries ?? 2,
  };
}

function buildPayload(data: PromptTemplateFormData) {
  return {
    name: data.name.trim(),
    titleTemplate: data.titleTemplate.trim(),
    promptTemplate: data.promptTemplate.trim(),
    agentDefinitionId: data.agentDefinitionId.trim() || null,
    repositoryId: data.repositoryId.trim() || null,
    repoUrl: data.repoUrl.trim() || null,
    baseBranch: data.baseBranch.trim() || null,
    workDir: data.workDir.trim() || null,
    pipelineSteps: null,
    maxRetries: normalizeRetries(data.maxRetries),
  };
}

function normalizeRetries(value: number): number {
  if (!Number.isFinite(value)) return 2;
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  if (rounded > 20) return 20;
  return rounded;
}

function PromptTemplateFormModal({
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
  initialData: PromptTemplateFormData;
  agents: AgentDefinitionItem[];
  repos: RepositoryItem[];
  onClose: () => void;
  onSubmit: (data: PromptTemplateFormData) => Promise<void>;
}) {
  const [form, setForm] = useState<PromptTemplateFormData>(initialData);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(initialData);
    setSubmitError(null);
    setSaving(false);
  }, [open, initialData]);

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

  const canSubmit = !saving
    && form.name.trim() !== ''
    && form.titleTemplate.trim() !== ''
    && form.promptTemplate.trim() !== '';

  const handleSubmit = async () => {
    if (!canSubmit) return;
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={(
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {TEMPLATE_UI_MESSAGES.close}
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
            {saving ? TEMPLATE_UI_MESSAGES.saveInProgress : TEMPLATE_UI_MESSAGES.saveAction}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
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

        <div className="grid gap-4 sm:grid-cols-2">
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
          <Input
            label={TEMPLATE_UI_MESSAGES.pipelineMaxRetries}
            type="number"
            min={0}
            max={20}
            value={String(form.maxRetries)}
            onChange={(e) => setForm((prev) => ({ ...prev, maxRetries: Number(e.target.value || 0) }))}
          />
        </div>

        <Textarea
          label={TEMPLATE_UI_MESSAGES.fields.prompt}
          required
          rows={7}
          value={form.promptTemplate}
          onChange={(e) => setForm((prev) => ({ ...prev, promptTemplate: e.target.value }))}
          placeholder={TEMPLATE_UI_MESSAGES.fields.promptPlaceholder}
        />

        {submitError ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {submitError}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
