// ============================================================
// 任务模板管理页面
// 支持单任务模板和流水线模板，Tab 切换筛选
// ============================================================

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgentStore, useRepoStore } from '@/stores';
import type { AgentDefinitionItem, RepositoryItem } from '@/stores';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { TabBar } from '@/components/ui/tabs';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useFeedback } from '@/components/providers/feedback-provider';
import { TEMPLATE_UI_MESSAGES } from '@/lib/i18n/ui-messages';
import { Plus, Pencil, Trash2, Search, Layers } from 'lucide-react';

// ---- 类型定义 ----

type PipelineStep = { title: string; description: string; agentDefinitionId?: string };

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
  pipelineSteps: PipelineStep[] | null;
  maxRetries: number | null;
  createdAt: string;
  updatedAt: string;
};

// ---- 表单状态 ----

type TemplateMode = 'single' | 'pipeline';

interface TemplateFormData {
  name: string;
  mode: TemplateMode;
  titleTemplate: string;
  promptTemplate: string;
  agentDefinitionId: string;
  repositoryId: string;
  repoUrl: string;
  baseBranch: string;
  workDir: string;
  pipelineSteps: Array<{ _id: string; title: string; description: string; agentDefinitionId: string }>;
  maxRetries: number;
}

const EMPTY_FORM: TemplateFormData = {
  name: '',
  mode: 'single',
  titleTemplate: '',
  promptTemplate: '',
  agentDefinitionId: '',
  repositoryId: '',
  repoUrl: '',
  baseBranch: 'main',
  workDir: '',
  pipelineSteps: [{ _id: '1', title: '', description: '', agentDefinitionId: '' }],
  maxRetries: 2,
};

// Tab 筛选键
type TabKey = 'all' | 'single' | 'pipeline';

export default function TemplatesPage() {
  const { agents, fetchAgents } = useAgentStore();
  const { repos, fetchRepos } = useRepoStore();
  const { confirm: confirmDialog, notify } = useFeedback();

  const [templates, setTemplates] = useState<TaskTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('all');
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

  // Tab 统计
  const tabCounts = useMemo(() => {
    let single = 0;
    let pipeline = 0;
    for (const t of templates) {
      if (t.pipelineSteps && t.pipelineSteps.length > 0) pipeline += 1;
      else single += 1;
    }
    return { all: templates.length, single, pipeline };
  }, [templates]);

  // 搜索 + Tab 过滤
  const filtered = useMemo(() => {
    let result = templates;
    // Tab 过滤
    if (activeTab === 'single') result = result.filter((t) => !t.pipelineSteps || t.pipelineSteps.length === 0);
    else if (activeTab === 'pipeline') result = result.filter((t) => t.pipelineSteps && t.pipelineSteps.length > 0);
    // 搜索
    const keyword = query.trim().toLowerCase();
    if (keyword) {
      result = result.filter((item) => {
        const text = [item.name, item.titleTemplate, item.promptTemplate, item.agentDefinitionId || '', item.repoUrl || '']
          .join(' ')
          .toLowerCase();
        return text.includes(keyword);
      });
    }
    return result;
  }, [templates, activeTab, query]);

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
      cell: (row) => (
        <div className="flex items-center gap-2">
          {row.pipelineSteps && row.pipelineSteps.length > 0 && (
            <Layers size={14} className="shrink-0 text-primary/70" />
          )}
          <span className="font-medium text-foreground">{row.name}</span>
        </div>
      ),
    },
    {
      key: 'type',
      header: TEMPLATE_UI_MESSAGES.templateType,
      className: 'w-[140px]',
      cell: (row) => {
        const isPipeline = row.pipelineSteps && row.pipelineSteps.length > 0;
        return (
          <span className={`text-sm ${isPipeline ? 'text-primary' : 'text-muted-foreground'}`}>
            {isPipeline ? TEMPLATE_UI_MESSAGES.typePipeline(row.pipelineSteps!.length) : TEMPLATE_UI_MESSAGES.typeSingle}
          </span>
        );
      },
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

  const tabs = [
    { key: 'all' as const, label: TEMPLATE_UI_MESSAGES.tabAll, count: tabCounts.all },
    { key: 'single' as const, label: TEMPLATE_UI_MESSAGES.tabSingle, count: tabCounts.single },
    { key: 'pipeline' as const, label: TEMPLATE_UI_MESSAGES.tabPipeline, count: tabCounts.pipeline },
  ];

  return (
    <div className="space-y-12">
      <PageHeader title={TEMPLATE_UI_MESSAGES.pageTitle} subtitle={TEMPLATE_UI_MESSAGES.pageSubtitle}>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={15} className="mr-1" />
          {TEMPLATE_UI_MESSAGES.newTemplate}
        </Button>
      </PageHeader>

      {/* Tab 筛选 */}
      <TabBar
        tabs={tabs}
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as TabKey)}
      />

      {/* 搜索栏 */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={TEMPLATE_UI_MESSAGES.searchPlaceholder}
          className="pl-9"
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
          if (!json?.success) throw new Error(json?.error?.message || TEMPLATE_UI_MESSAGES.requestFailed);
          notify({ type: 'success', title: TEMPLATE_UI_MESSAGES.editSuccessTitle, message: TEMPLATE_UI_MESSAGES.editSuccessMessage(payload.name) });
          fetchTemplates();
        }}
      />
    </div>
  );
}

// ---- 模板数据 → 表单数据 ----

function templateToFormData(item: TaskTemplateItem | null): TemplateFormData {
  if (!item) return EMPTY_FORM;
  const isPipeline = item.pipelineSteps && item.pipelineSteps.length > 0;
  return {
    name: item.name,
    mode: isPipeline ? 'pipeline' : 'single',
    titleTemplate: item.titleTemplate,
    promptTemplate: item.promptTemplate,
    agentDefinitionId: item.agentDefinitionId || '',
    repositoryId: item.repositoryId || '',
    repoUrl: item.repoUrl || '',
    baseBranch: item.baseBranch || 'main',
    workDir: item.workDir || '',
    pipelineSteps: isPipeline
      ? item.pipelineSteps!.map((s, i) => ({
          _id: String(i + 1),
          title: s.title,
          description: s.description,
          agentDefinitionId: s.agentDefinitionId || '',
        }))
      : [{ _id: '1', title: '', description: '', agentDefinitionId: '' }],
    maxRetries: item.maxRetries ?? 2,
  };
}

// ---- 构造提交 payload ----

function buildPayload(data: TemplateFormData) {
  const base = {
    name: data.name.trim(),
    agentDefinitionId: data.agentDefinitionId.trim() || null,
    repositoryId: data.repositoryId.trim() || null,
    repoUrl: data.repoUrl.trim() || null,
    baseBranch: data.baseBranch.trim() || null,
    workDir: data.workDir.trim() || null,
  };

  if (data.mode === 'pipeline') {
    const steps = data.pipelineSteps
      .map((s) => ({
        title: s.title.trim(),
        description: s.description.trim(),
        ...(s.agentDefinitionId.trim() ? { agentDefinitionId: s.agentDefinitionId.trim() } : {}),
      }))
      .filter((s) => s.title && s.description);
    return {
      ...base,
      titleTemplate: data.titleTemplate.trim() || '(流水线模板)',
      promptTemplate: data.promptTemplate.trim() || '(流水线模板)',
      pipelineSteps: steps.length > 0 ? steps : null,
      maxRetries: data.maxRetries,
    };
  }

  return {
    ...base,
    titleTemplate: data.titleTemplate.trim(),
    promptTemplate: data.promptTemplate.trim(),
    pipelineSteps: null,
    maxRetries: data.maxRetries,
  };
}

// ---- 模板表单 Modal ----

let _stepIdCounter = 100;

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
    // 流水线模式校验
    if (form.mode === 'pipeline') {
      const validSteps = form.pipelineSteps.filter((s) => s.title.trim() && s.description.trim());
      if (validSteps.length === 0) {
        setSubmitError(TEMPLATE_UI_MESSAGES.pipelineStepRequired);
        return;
      }
    }
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

  const canSubmit = (() => {
    if (saving || !form.name.trim()) return false;
    if (form.mode === 'single') {
      return form.titleTemplate.trim() !== '' && form.promptTemplate.trim() !== '';
    }
    // 流水线模式：至少 1 个有效步骤
    return form.pipelineSteps.some((s) => s.title.trim() && s.description.trim());
  })();

  const addStep = () => {
    _stepIdCounter += 1;
    setForm((prev) => ({
      ...prev,
      pipelineSteps: [...prev.pipelineSteps, { _id: String(_stepIdCounter), title: '', description: '', agentDefinitionId: '' }],
    }));
  };

  const removeStep = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      pipelineSteps: prev.pipelineSteps.filter((_, i) => i !== idx),
    }));
  };

  const updateStep = (idx: number, field: 'title' | 'description' | 'agentDefinitionId', value: string) => {
    setForm((prev) => ({
      ...prev,
      pipelineSteps: prev.pipelineSteps.map((s, i) => (i === idx ? { ...s, [field]: value } : s)),
    }));
  };

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
          {form.mode === 'pipeline' && (
            <Button variant="secondary" size="sm" onClick={addStep}>
              <Plus size={13} className="mr-1" />
              {TEMPLATE_UI_MESSAGES.pipelineAddStep}
            </Button>
          )}
          <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
            {saving ? TEMPLATE_UI_MESSAGES.saveInProgress : TEMPLATE_UI_MESSAGES.saveAction}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* 模板类型切换 + 名称 */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={TEMPLATE_UI_MESSAGES.fields.name}
            required
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder={TEMPLATE_UI_MESSAGES.fields.namePlaceholder}
          />
          <Select
            label={TEMPLATE_UI_MESSAGES.templateType}
            value={form.mode}
            onChange={(e) => setForm((prev) => ({ ...prev, mode: e.target.value as TemplateMode }))}
            options={[
              { value: 'single', label: TEMPLATE_UI_MESSAGES.templateTypeSingle },
              { value: 'pipeline', label: TEMPLATE_UI_MESSAGES.templateTypePipeline },
            ]}
          />
        </div>

        {/* 单任务模式：标题模板 */}
        {form.mode === 'single' && (
          <Input
            label={TEMPLATE_UI_MESSAGES.fields.titleTemplate}
            required
            value={form.titleTemplate}
            onChange={(e) => setForm((prev) => ({ ...prev, titleTemplate: e.target.value }))}
            placeholder={TEMPLATE_UI_MESSAGES.fields.titleTemplatePlaceholder}
          />
        )}

        {/* 共享字段：Agent + Repo */}
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

        {/* 单任务模式：Prompt 模板 */}
        {form.mode === 'single' && (
          <Textarea
            label={TEMPLATE_UI_MESSAGES.fields.prompt}
            required
            rows={6}
            value={form.promptTemplate}
            onChange={(e) => setForm((prev) => ({ ...prev, promptTemplate: e.target.value }))}
            placeholder={TEMPLATE_UI_MESSAGES.fields.promptPlaceholder}
          />
        )}

        {/* 流水线模式：步骤编辑器 */}
        {form.mode === 'pipeline' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              将创建 {form.pipelineSteps.length} 个步骤，自动串行依赖（步骤 N 依赖步骤 N-1）。
            </p>
            {form.pipelineSteps.map((step, idx) => (
              <div key={step._id} className="rounded-lg border border-border bg-muted/10 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-muted-foreground">
                    {TEMPLATE_UI_MESSAGES.pipelineStepTitle(idx + 1)}
                    {idx > 0 ? `（依赖步骤 ${idx}）` : ''}
                  </p>
                  {form.pipelineSteps.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeStep(idx)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label={TEMPLATE_UI_MESSAGES.pipelineStepTitleLabel}
                    required
                    value={step.title}
                    onChange={(e) => updateStep(idx, 'title', e.target.value)}
                    placeholder={TEMPLATE_UI_MESSAGES.pipelineStepTitlePlaceholder}
                  />
                  <Select
                    label={TEMPLATE_UI_MESSAGES.fields.agentDefinition}
                    value={step.agentDefinitionId}
                    onChange={(e) => updateStep(idx, 'agentDefinitionId', e.target.value)}
                    options={[
                      { value: '', label: form.agentDefinitionId ? '使用默认智能体' : TEMPLATE_UI_MESSAGES.fields.agentDefinitionNone },
                      ...agents.map((agent) => ({ value: agent.id, label: `${agent.displayName} (${agent.id})` })),
                    ]}
                  />
                  <div className="sm:col-span-2">
                    <Textarea
                      label={TEMPLATE_UI_MESSAGES.pipelineStepDescLabel}
                      required
                      rows={3}
                      value={step.description}
                      onChange={(e) => updateStep(idx, 'description', e.target.value)}
                      placeholder={TEMPLATE_UI_MESSAGES.pipelineStepDescPlaceholder}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

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
