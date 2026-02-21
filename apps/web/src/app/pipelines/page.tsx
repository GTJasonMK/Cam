'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  GitFork,
  Workflow,
  ArrowRight,
  RefreshCw,
  Plus,
  Save,
  Trash2,
  Layers,
} from 'lucide-react';

type PipelineParallelAgent = {
  title?: string;
  description: string;
  agentDefinitionId?: string;
};

type PipelineStep = {
  title: string;
  description: string;
  agentDefinitionId?: string;
  inputFiles?: string[];
  inputCondition?: string;
  parallelAgents?: PipelineParallelAgent[];
};

type PipelineTemplateItem = {
  id: string;
  name: string;
  agentDefinitionId: string | null;
  repoUrl: string | null;
  baseBranch: string | null;
  workDir: string | null;
  maxRetries: number | null;
  pipelineSteps: PipelineStep[] | null;
  updatedAt: string;
};

type AgentItem = {
  id: string;
  displayName: string;
};

type ParallelAgentForm = {
  _id: string;
  title: string;
  description: string;
  agentDefinitionId: string;
};

type StepForm = {
  _id: string;
  title: string;
  description: string;
  agentDefinitionId: string;
  inputFiles: string;
  inputCondition: string;
  parallelAgents: ParallelAgentForm[];
};

type PipelineEditorForm = {
  id: string | null;
  name: string;
  agentDefinitionId: string;
  repoUrl: string;
  baseBranch: string;
  workDir: string;
  maxRetries: number;
  steps: StepForm[];
};

const inputCls = 'w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/30';
const selectCls = 'rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/30';

let stepCounter = 0;
let parallelCounter = 0;

function nextStepId(): string {
  stepCounter += 1;
  return `step-${stepCounter}`;
}

function nextParallelId(): string {
  parallelCounter += 1;
  return `parallel-${parallelCounter}`;
}

function parseInputFiles(raw: string): string[] {
  const files = raw
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(files));
}

function formatInputFiles(files?: string[]): string {
  if (!files || files.length === 0) return '';
  return files.join(', ');
}

function createEmptyStep(): StepForm {
  return {
    _id: nextStepId(),
    title: '',
    description: '',
    agentDefinitionId: '',
    inputFiles: '',
    inputCondition: '',
    parallelAgents: [],
  };
}

function createEmptyEditorForm(): PipelineEditorForm {
  return {
    id: null,
    name: '',
    agentDefinitionId: '',
    repoUrl: '',
    baseBranch: '',
    workDir: '',
    maxRetries: 2,
    steps: [createEmptyStep(), createEmptyStep()],
  };
}

function templateToEditorForm(template: PipelineTemplateItem): PipelineEditorForm {
  const steps = (template.pipelineSteps ?? []).map((step) => ({
    _id: nextStepId(),
    title: step.title,
    description: step.description,
    agentDefinitionId: step.agentDefinitionId || '',
    inputFiles: formatInputFiles(step.inputFiles),
    inputCondition: step.inputCondition || '',
    parallelAgents: (step.parallelAgents ?? []).map((node) => ({
      _id: nextParallelId(),
      title: node.title || '',
      description: node.description,
      agentDefinitionId: node.agentDefinitionId || '',
    })),
  }));

  return {
    id: template.id,
    name: template.name,
    agentDefinitionId: template.agentDefinitionId || '',
    repoUrl: template.repoUrl || '',
    baseBranch: template.baseBranch || '',
    workDir: template.workDir || '',
    maxRetries: template.maxRetries ?? 2,
    steps: steps.length > 0 ? steps : [createEmptyStep(), createEmptyStep()],
  };
}

function normalizeRetries(value: number): number {
  if (!Number.isFinite(value)) return 2;
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  if (rounded > 20) return 20;
  return rounded;
}

export default function PipelinesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<PipelineTemplateItem[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [editor, setEditor] = useState<PipelineEditorForm>(createEmptyEditorForm);
  const selectedTemplateIdRef = useRef('');

  useEffect(() => {
    selectedTemplateIdRef.current = selectedTemplateId;
  }, [selectedTemplateId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [templateRes, agentRes] = await Promise.all([
        fetch('/api/task-templates'),
        fetch('/api/agents'),
      ]);
      const [templateJson, agentJson] = await Promise.all([templateRes.json(), agentRes.json()]);

      if (!templateJson.success || !Array.isArray(templateJson.data)) {
        throw new Error(templateJson.error?.message || '加载流水线模板失败');
      }
      if (!agentJson.success || !Array.isArray(agentJson.data)) {
        throw new Error(agentJson.error?.message || '加载智能体列表失败');
      }

      const pipelineTemplates = (templateJson.data as PipelineTemplateItem[]).filter(
        (item) => Array.isArray(item.pipelineSteps) && item.pipelineSteps.length > 0,
      );
      const knownAgents = (agentJson.data as AgentItem[]).map((a) => ({
        id: a.id,
        displayName: a.displayName,
      }));

      setTemplates(pipelineTemplates);
      setAgents(knownAgents);

      if (pipelineTemplates.length === 0) {
        setSelectedTemplateId('');
        setEditor((prev) => ({
          ...createEmptyEditorForm(),
          agentDefinitionId: prev.agentDefinitionId || knownAgents[0]?.id || '',
        }));
        return;
      }

      const currentSelected = selectedTemplateIdRef.current;
      const fallbackId = currentSelected && pipelineTemplates.some((tpl) => tpl.id === currentSelected)
        ? currentSelected
        : pipelineTemplates[0].id;

      const selected = pipelineTemplates.find((tpl) => tpl.id === fallbackId) || pipelineTemplates[0];
      setSelectedTemplateId(selected.id);
      setEditor(templateToEditorForm(selected));
    } catch (err) {
      setError((err as Error).message || '加载流水线模板失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    let steps = 0;
    let parallelNodes = 0;
    for (const tpl of templates) {
      for (const step of tpl.pipelineSteps ?? []) {
        steps += 1;
        parallelNodes += step.parallelAgents?.length ?? 0;
      }
    }
    return { count: templates.length, steps, parallelNodes };
  }, [templates]);

  const setDraftNew = useCallback(() => {
    setSelectedTemplateId('');
    setEditor((prev) => ({
      ...createEmptyEditorForm(),
      agentDefinitionId: prev.agentDefinitionId || agents[0]?.id || '',
    }));
    setError('');
  }, [agents]);

  const selectTemplate = useCallback((templateId: string) => {
    setSelectedTemplateId(templateId);
    const selected = templates.find((tpl) => tpl.id === templateId);
    if (!selected) return;
    setEditor(templateToEditorForm(selected));
    setError('');
  }, [templates]);

  const updateEditorField = useCallback((
    field: 'name' | 'agentDefinitionId' | 'repoUrl' | 'baseBranch' | 'workDir' | 'maxRetries',
    value: string | number,
  ) => {
    setEditor((prev) => ({ ...prev, [field]: value }));
  }, []);

  const updateStep = useCallback((stepId: string, patch: Partial<StepForm>) => {
    setEditor((prev) => ({
      ...prev,
      steps: prev.steps.map((step) => (step._id === stepId ? { ...step, ...patch } : step)),
    }));
  }, []);

  const addStep = useCallback(() => {
    setEditor((prev) => ({ ...prev, steps: [...prev.steps, createEmptyStep()] }));
  }, []);

  const removeStep = useCallback((stepId: string) => {
    setEditor((prev) => {
      if (prev.steps.length <= 2) return prev;
      return {
        ...prev,
        steps: prev.steps.filter((step) => step._id !== stepId),
      };
    });
  }, []);

  const addParallelAgent = useCallback((stepId: string) => {
    setEditor((prev) => ({
      ...prev,
      steps: prev.steps.map((step) => (
        step._id === stepId
          ? {
              ...step,
              parallelAgents: [
                ...step.parallelAgents,
                {
                  _id: nextParallelId(),
                  title: '',
                  description: '',
                  agentDefinitionId: '',
                },
              ],
            }
          : step
      )),
    }));
  }, []);

  const removeParallelAgent = useCallback((stepId: string, parallelId: string) => {
    setEditor((prev) => ({
      ...prev,
      steps: prev.steps.map((step) => (
        step._id === stepId
          ? {
              ...step,
              parallelAgents: step.parallelAgents.filter((node) => node._id !== parallelId),
            }
          : step
      )),
    }));
  }, []);

  const updateParallelAgent = useCallback((
    stepId: string,
    parallelId: string,
    field: 'title' | 'description' | 'agentDefinitionId',
    value: string,
  ) => {
    setEditor((prev) => ({
      ...prev,
      steps: prev.steps.map((step) => (
        step._id === stepId
          ? {
              ...step,
              parallelAgents: step.parallelAgents.map((node) => (
                node._id === parallelId ? { ...node, [field]: value } : node
              )),
            }
          : step
      )),
    }));
  }, []);

  const validateEditor = useCallback((): string | null => {
    if (!editor.name.trim()) return '请先填写流水线模板名称';
    if (editor.steps.length < 2) return '流水线至少需要 2 个步骤';
    const hasInvalidStep = editor.steps.some((step) => !step.title.trim() || !step.description.trim());
    if (hasInvalidStep) return '每个步骤都需要填写标题和描述';
    for (const step of editor.steps) {
      const hasInvalidParallel = step.parallelAgents.some((node) => !node.description.trim());
      if (hasInvalidParallel) {
        return '并行子任务的提示词不能为空';
      }
    }
    return null;
  }, [editor]);

  const saveTemplate = useCallback(async () => {
    const validationError = validateEditor();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const pipelineSteps = editor.steps.map((step) => {
        const normalizedParallel = step.parallelAgents
          .map((node) => ({
            ...(node.title.trim() ? { title: node.title.trim() } : {}),
            description: node.description.trim(),
            ...(node.agentDefinitionId ? { agentDefinitionId: node.agentDefinitionId } : {}),
          }))
          .filter((node) => node.description.length > 0);

        return {
          title: step.title.trim(),
          description: step.description.trim(),
          ...(step.agentDefinitionId ? { agentDefinitionId: step.agentDefinitionId } : {}),
          ...(parseInputFiles(step.inputFiles).length > 0
            ? { inputFiles: parseInputFiles(step.inputFiles) }
            : {}),
          ...(step.inputCondition.trim() ? { inputCondition: step.inputCondition.trim() } : {}),
          ...(normalizedParallel.length > 0 ? { parallelAgents: normalizedParallel } : {}),
        };
      });

      const payload = {
        name: editor.name.trim(),
        titleTemplate: '(流水线模板)',
        promptTemplate: '(流水线模板)',
        agentDefinitionId: editor.agentDefinitionId || null,
        repoUrl: editor.repoUrl.trim() || null,
        baseBranch: editor.baseBranch.trim() || null,
        workDir: editor.workDir.trim() || null,
        maxRetries: normalizeRetries(editor.maxRetries),
        pipelineSteps,
      };

      const isEditing = Boolean(editor.id);
      const endpoint = isEditing ? `/api/task-templates/${editor.id}` : '/api/task-templates';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) {
        throw new Error(json.error?.message || (isEditing ? '保存流水线模板失败' : '创建流水线模板失败'));
      }

      const maybeId = typeof json.data?.id === 'string' ? json.data.id : null;
      await load();
      if (!isEditing && maybeId) {
        setSelectedTemplateId(maybeId);
      }
    } catch (err) {
      setError((err as Error).message || '保存流水线模板失败');
    } finally {
      setSaving(false);
    }
  }, [editor, load, validateEditor]);

  const deleteTemplate = useCallback(async () => {
    if (!editor.id) {
      setError('当前为新建草稿，未保存到模板库');
      return;
    }

    const ok = window.confirm(`确认删除流水线模板「${editor.name || editor.id}」？`);
    if (!ok) return;

    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/task-templates/${editor.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!json.success) {
        throw new Error(json.error?.message || '删除流水线模板失败');
      }
      setSelectedTemplateId('');
      setEditor(createEmptyEditorForm());
      await load();
    } catch (err) {
      setError((err as Error).message || '删除流水线模板失败');
    } finally {
      setSaving(false);
    }
  }, [editor.id, editor.name, load]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
              <Workflow size={20} />
              流水线编辑工作台
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              以可视化节点卡片维护步骤、并行子任务、输入文件和输入条件，统一落盘到 `.conversations/step[]` 协作约束。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-border-light hover:text-foreground"
            >
              <RefreshCw size={14} />
              刷新
            </button>
            <Link
              href="/terminal?pipeline=1"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              运行流水线
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>流水线模板: {summary.count}</span>
          <span>总步骤: {summary.steps}</span>
          <span>并行子任务: {summary.parallelNodes}</span>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border border-border bg-card/70 p-5 text-sm text-muted-foreground">
          正在加载流水线模板...
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && (
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-border bg-card/70 p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-foreground">流水线模板</div>
              <button
                type="button"
                onClick={setDraftNew}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-border-light hover:text-foreground"
              >
                <Plus size={12} />
                新建
              </button>
            </div>

            {templates.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无流水线模板，先在右侧创建一个。</p>
            ) : (
              <div className="space-y-2">
                {templates.map((tpl) => {
                  const isSelected = selectedTemplateId === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => selectTemplate(tpl.id)}
                      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? 'border-primary/35 bg-primary/10'
                          : 'border-border bg-card/70 hover:border-border-light'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <GitFork size={13} />
                        <span className="truncate">{tpl.name}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {(tpl.pipelineSteps?.length ?? 0)} 步骤
                        {(tpl.pipelineSteps?.reduce((acc, step) => acc + (step.parallelAgents?.length ?? 0), 0) ?? 0) > 0
                          ? ` · ${tpl.pipelineSteps?.reduce((acc, step) => acc + (step.parallelAgents?.length ?? 0), 0)} 并行`
                          : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          <section className="rounded-xl border border-border bg-card/70 p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
                  <Layers size={16} />
                  {editor.id ? '编辑流水线模板' : '新建流水线模板'}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  每个步骤可配置默认 Agent、输入约束和并行子任务（节点级 Agent/提示词）。
                </p>
              </div>
              <div className="flex items-center gap-2">
                {editor.id && (
                  <button
                    type="button"
                    onClick={() => void deleteTemplate()}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                    删除
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void saveTemplate()}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  <Save size={14} />
                  {saving ? '保存中...' : editor.id ? '保存修改' : '创建模板'}
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">模板名称</label>
                <input
                  value={editor.name}
                  onChange={(e) => updateEditorField('name', e.target.value)}
                  placeholder="例如：并行代码评审流水线"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">默认 Agent</label>
                <select
                  value={editor.agentDefinitionId}
                  onChange={(e) => updateEditorField('agentDefinitionId', e.target.value)}
                  className={`w-full ${selectCls}`}
                >
                  <option value="">不指定</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.displayName} ({agent.id})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">仓库地址（可选）</label>
                <input
                  value={editor.repoUrl}
                  onChange={(e) => updateEditorField('repoUrl', e.target.value)}
                  placeholder="git@github.com:org/repo.git"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">基线分支（可选）</label>
                <input
                  value={editor.baseBranch}
                  onChange={(e) => updateEditorField('baseBranch', e.target.value)}
                  placeholder="main"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">工作目录（可选）</label>
                <input
                  value={editor.workDir}
                  onChange={(e) => updateEditorField('workDir', e.target.value)}
                  placeholder="/path/to/project"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">最大重试次数</label>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={String(editor.maxRetries)}
                  onChange={(e) => updateEditorField('maxRetries', Number(e.target.value || 0))}
                  className={inputCls}
                />
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">可视化节点编排</h3>
                <button
                  type="button"
                  onClick={addStep}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-border-light hover:text-foreground"
                >
                  <Plus size={12} />
                  添加步骤
                </button>
              </div>

              <div className="space-y-3">
                {editor.steps.map((step, stepIndex) => (
                  <div key={step._id} className="relative rounded-lg border border-border bg-card/70 p-3">
                    {stepIndex > 0 && (
                      <span className="pointer-events-none absolute -top-3 left-6 h-3 border-l border-primary/35" />
                    )}

                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-primary">步骤 {stepIndex + 1}</span>
                      {editor.steps.length > 2 && (
                        <button
                          type="button"
                          onClick={() => removeStep(step._id)}
                          className="rounded p-1 text-destructive/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                          title="删除步骤"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        value={step.title}
                        onChange={(e) => updateStep(step._id, { title: e.target.value })}
                        placeholder="步骤标题"
                        className={inputCls}
                      />
                      <select
                        value={step.agentDefinitionId}
                        onChange={(e) => updateStep(step._id, { agentDefinitionId: e.target.value })}
                        className={`w-full ${selectCls}`}
                      >
                        <option value="">使用默认 Agent</option>
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.displayName} ({agent.id})</option>
                        ))}
                      </select>
                      <textarea
                        value={step.description}
                        onChange={(e) => updateStep(step._id, { description: e.target.value })}
                        rows={3}
                        placeholder="步骤提示词"
                        className={`resize-none sm:col-span-2 ${inputCls}`}
                      />
                      <input
                        value={step.inputFiles}
                        onChange={(e) => updateStep(step._id, { inputFiles: e.target.value })}
                        placeholder="输入文件（逗号/换行分隔）"
                        className={inputCls}
                      />
                      <input
                        value={step.inputCondition}
                        onChange={(e) => updateStep(step._id, { inputCondition: e.target.value })}
                        placeholder="输入条件（可选）"
                        className={inputCls}
                      />
                    </div>

                    <div className="mt-3 rounded-md border border-border bg-background/45 p-2">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-muted-foreground">并行子任务节点（可选）</span>
                        <button
                          type="button"
                          onClick={() => addParallelAgent(step._id)}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-border-light hover:text-foreground"
                        >
                          <Plus size={11} />
                          添加节点
                        </button>
                      </div>

                      {step.parallelAgents.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground/80">
                          未配置并行节点时，步骤将按当前“步骤提示词”执行单 Agent 任务。
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {step.parallelAgents.map((node, nodeIndex) => (
                            <div key={node._id} className="rounded border border-border bg-card/60 p-2">
                              <div className="mb-2 flex items-center justify-between">
                                <span className="flex items-center gap-1 text-[11px] text-primary">
                                  <Layers size={11} />
                                  节点 {nodeIndex + 1}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeParallelAgent(step._id, node._id)}
                                  className="rounded p-1 text-destructive/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                                  title="删除并行节点"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <input
                                  value={node.title}
                                  onChange={(e) => updateParallelAgent(step._id, node._id, 'title', e.target.value)}
                                  placeholder="节点标题（可选）"
                                  className={inputCls}
                                />
                                <select
                                  value={node.agentDefinitionId}
                                  onChange={(e) => updateParallelAgent(step._id, node._id, 'agentDefinitionId', e.target.value)}
                                  className={`w-full ${selectCls}`}
                                >
                                  <option value="">使用步骤/默认 Agent</option>
                                  {agents.map((agent) => (
                                    <option key={agent.id} value={agent.id}>{agent.displayName} ({agent.id})</option>
                                  ))}
                                </select>
                                <textarea
                                  value={node.description}
                                  onChange={(e) => updateParallelAgent(step._id, node._id, 'description', e.target.value)}
                                  rows={2}
                                  placeholder="节点提示词"
                                  className={`resize-none sm:col-span-2 ${inputCls}`}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-card/70 p-2 text-xs text-muted-foreground">
              <Layers size={14} className="mt-0.5 shrink-0" />
              <div>
                当前页面只负责流水线模板编辑。运行流水线请点击右上角“运行流水线”，进入终端面板后可查看每个 Agent 的实时会话输出。
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
