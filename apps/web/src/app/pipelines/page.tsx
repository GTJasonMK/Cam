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
  Download,
  Upload,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Copy,
  AlertTriangle,
  Eye,
  Pencil,
} from 'lucide-react';
import {
  buildExportDataFromForm,
  downloadPipelineJson,
  openPipelineFile,
  parsePipelineImport,
  sanitizePipelineImportAgentIds,
} from '@/lib/pipeline-io';
import { resolveKnownAgentIdsForImport } from '@/lib/agents/known-agent-ids';
import { Modal } from '@/components/ui/modal';

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
  promptTemplate: string;
  agentDefinitionId: string | null;
  repoUrl: string | null;
  baseBranch: string | null;
  workDir: string | null;
  maxRetries: number | null;
  pipelineSteps: PipelineStep[] | null;
  updatedAt: string;
};

type PromptTemplateOption = {
  id: string;
  name: string;
  promptTemplate: string;
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

type PromptEditorTarget =
  | { kind: 'step'; stepId: string }
  | { kind: 'parallel'; stepId: string; parallelId: string };

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

function buildEditorSnapshot(form: PipelineEditorForm): string {
  return JSON.stringify({
    id: form.id,
    name: form.name,
    agentDefinitionId: form.agentDefinitionId,
    repoUrl: form.repoUrl,
    baseBranch: form.baseBranch,
    workDir: form.workDir,
    maxRetries: form.maxRetries,
    steps: form.steps.map((step) => ({
      title: step.title,
      description: step.description,
      agentDefinitionId: step.agentDefinitionId,
      inputFiles: step.inputFiles,
      inputCondition: step.inputCondition,
      parallelAgents: step.parallelAgents.map((node) => ({
        title: node.title,
        description: node.description,
        agentDefinitionId: node.agentDefinitionId,
      })),
    })),
  });
}

function summarizePrompt(raw: string, maxLength = 120): string {
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return '（空）';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

export default function PipelinesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<PipelineTemplateItem[]>([]);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplateOption[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [editor, setEditor] = useState<PipelineEditorForm>(createEmptyEditorForm);
  const [activeStepId, setActiveStepId] = useState('');
  const [expandedParallelStepIds, setExpandedParallelStepIds] = useState<string[]>([]);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState('');
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [promptEditorTarget, setPromptEditorTarget] = useState<PromptEditorTarget | null>(null);
  const [promptEditorDraft, setPromptEditorDraft] = useState('');
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState('');
  const selectedTemplateIdRef = useRef('');
  const editorSnapshot = useMemo(() => buildEditorSnapshot(editor), [editor]);
  const hasUnsavedChanges = lastSavedSnapshot ? editorSnapshot !== lastSavedSnapshot : false;

  useEffect(() => {
    selectedTemplateIdRef.current = selectedTemplateId;
  }, [selectedTemplateId]);

  useEffect(() => {
    if (lastSavedSnapshot) return;
    setLastSavedSnapshot(editorSnapshot);
  }, [editorSnapshot, lastSavedSnapshot]);

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

      const allTemplates = templateJson.data as PipelineTemplateItem[];
      const pipelineTemplates = allTemplates.filter(
        (item) => Array.isArray(item.pipelineSteps) && item.pipelineSteps.length > 0,
      );
      const singlePromptTemplates = allTemplates
        .filter((item) => !Array.isArray(item.pipelineSteps) || item.pipelineSteps.length === 0)
        .map((item) => ({
          id: item.id,
          name: item.name,
          promptTemplate: item.promptTemplate,
        }));
      const knownAgents = (agentJson.data as AgentItem[]).map((a) => ({
        id: a.id,
        displayName: a.displayName,
      }));

      setTemplates(pipelineTemplates);
      setPromptTemplates(singlePromptTemplates);
      setAgents(knownAgents);

      if (pipelineTemplates.length === 0) {
        const nextEditor = {
          ...createEmptyEditorForm(),
          agentDefinitionId: knownAgents[0]?.id || '',
        };
        setSelectedTemplateId('');
        setEditor(nextEditor);
        setLastSavedSnapshot(buildEditorSnapshot(nextEditor));
        setActiveStepId(nextEditor.steps[0]?._id || '');
        setExpandedParallelStepIds([]);
        return;
      }

      const currentSelected = selectedTemplateIdRef.current;
      const fallbackId = currentSelected && pipelineTemplates.some((tpl) => tpl.id === currentSelected)
        ? currentSelected
        : pipelineTemplates[0].id;

      const selected = pipelineTemplates.find((tpl) => tpl.id === fallbackId) || pipelineTemplates[0];
      const nextEditor = templateToEditorForm(selected);
      setSelectedTemplateId(selected.id);
      setEditor(nextEditor);
      setLastSavedSnapshot(buildEditorSnapshot(nextEditor));
      setActiveStepId(nextEditor.steps[0]?._id || '');
      setExpandedParallelStepIds([]);
    } catch (err) {
      setError((err as Error).message || '加载流水线模板失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!hasUnsavedChanges || saving) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [hasUnsavedChanges, saving]);

  useEffect(() => {
    if (activeStepId && !editor.steps.some((step) => step._id === activeStepId)) {
      setActiveStepId(editor.steps[0]?._id || '');
    }
    setExpandedParallelStepIds((prev) => {
      const valid = new Set(editor.steps.map((step) => step._id));
      const next = prev.filter((stepId) => valid.has(stepId));
      return next.length === prev.length ? prev : next;
    });
  }, [activeStepId, editor.steps]);

  useEffect(() => {
    if (!promptEditorTarget) return;
    if (promptEditorTarget.kind === 'step') {
      const exists = editor.steps.some((step) => step._id === promptEditorTarget.stepId);
      if (!exists) {
        setPromptEditorOpen(false);
        setPromptEditorTarget(null);
        setPromptEditorDraft('');
        setSelectedPromptTemplateId('');
      }
      return;
    }
    const step = editor.steps.find((item) => item._id === promptEditorTarget.stepId);
    const exists = Boolean(step?.parallelAgents.some((node) => node._id === promptEditorTarget.parallelId));
    if (!exists) {
      setPromptEditorOpen(false);
      setPromptEditorTarget(null);
      setPromptEditorDraft('');
      setSelectedPromptTemplateId('');
    }
  }, [editor.steps, promptEditorTarget]);

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

  const agentLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) {
      map.set(agent.id, `${agent.displayName} (${agent.id})`);
    }
    return map;
  }, [agents]);

  const previewSteps = useMemo(() => {
    return editor.steps.map((step, index) => {
      const inheritedAgentId = step.agentDefinitionId || editor.agentDefinitionId || '';
      const inputFiles = parseInputFiles(step.inputFiles);
      const parallelNodes = step.parallelAgents.map((node, nodeIndex) => ({
        id: node._id,
        title: node.title.trim() || `并行节点 ${nodeIndex + 1}`,
        promptPreview: summarizePrompt(node.description),
        agentId: node.agentDefinitionId || inheritedAgentId,
      }));
      return {
        id: step._id,
        index: index + 1,
        title: step.title.trim() || '未命名步骤',
        promptPreview: summarizePrompt(step.description),
        agentId: inheritedAgentId,
        inputFiles,
        inputCondition: step.inputCondition.trim(),
        parallelNodes,
      };
    });
  }, [editor.steps, editor.agentDefinitionId]);

  const promptEditorInfo = useMemo(() => {
    if (!promptEditorTarget) return null;
    if (promptEditorTarget.kind === 'step') {
      const stepIndex = editor.steps.findIndex((step) => step._id === promptEditorTarget.stepId);
      if (stepIndex < 0) return null;
      const step = editor.steps[stepIndex];
      return {
        title: `编辑步骤 ${stepIndex + 1} 提示词`,
        description: step.title.trim() || `步骤 ${stepIndex + 1}`,
      };
    }

    const stepIndex = editor.steps.findIndex((step) => step._id === promptEditorTarget.stepId);
    if (stepIndex < 0) return null;
    const step = editor.steps[stepIndex];
    const parallelIndex = step.parallelAgents.findIndex((node) => node._id === promptEditorTarget.parallelId);
    if (parallelIndex < 0) return null;
    const node = step.parallelAgents[parallelIndex];
    return {
      title: `编辑并行节点 ${parallelIndex + 1} 提示词`,
      description: node.title.trim() || `步骤 ${stepIndex + 1} · 并行节点 ${parallelIndex + 1}`,
    };
  }, [editor.steps, promptEditorTarget]);

  const selectedPromptTemplate = useMemo(
    () => promptTemplates.find((item) => item.id === selectedPromptTemplateId) || null,
    [promptTemplates, selectedPromptTemplateId],
  );

  const stepIssues = useMemo<Record<string, string[]>>(() => {
    const byId: Record<string, string[]> = {};
    for (const step of editor.steps) {
      const issues: string[] = [];
      if (!step.title.trim()) issues.push('缺少步骤标题');
      if (!step.description.trim()) issues.push('缺少步骤提示词');
      step.parallelAgents.forEach((node, idx) => {
        if (!node.description.trim()) {
          issues.push(`并行节点 ${idx + 1} 提示词为空`);
        }
      });
      byId[step._id] = issues;
    }
    return byId;
  }, [editor.steps]);

  const invalidStepCount = useMemo(
    () => editor.steps.filter((step) => (stepIssues[step._id]?.length ?? 0) > 0).length,
    [editor.steps, stepIssues],
  );

  const confirmDiscardChanges = useCallback(() => {
    if (!hasUnsavedChanges) return true;
    return window.confirm('当前有未保存修改，继续操作将丢失这些修改，确认继续吗？');
  }, [hasUnsavedChanges]);

  const setDraftNew = useCallback(() => {
    if (!confirmDiscardChanges()) return;
    const nextEditor = {
      ...createEmptyEditorForm(),
      agentDefinitionId: agents[0]?.id || '',
    };
    setSelectedTemplateId('');
    setEditor(nextEditor);
    setLastSavedSnapshot(buildEditorSnapshot(nextEditor));
    setActiveStepId(nextEditor.steps[0]?._id || '');
    setExpandedParallelStepIds([]);
    setError('');
  }, [agents, confirmDiscardChanges]);

  const selectTemplate = useCallback((templateId: string) => {
    if (templateId === selectedTemplateId) return;
    if (!confirmDiscardChanges()) return;
    setSelectedTemplateId(templateId);
    const selected = templates.find((tpl) => tpl.id === templateId);
    if (!selected) return;
    const nextEditor = templateToEditorForm(selected);
    setEditor(nextEditor);
    setLastSavedSnapshot(buildEditorSnapshot(nextEditor));
    setActiveStepId(nextEditor.steps[0]?._id || '');
    setExpandedParallelStepIds([]);
    setError('');
  }, [confirmDiscardChanges, selectedTemplateId, templates]);

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
    const newStep = createEmptyStep();
    setEditor((prev) => ({ ...prev, steps: [...prev.steps, newStep] }));
    setActiveStepId(newStep._id);
  }, []);

  const removeStep = useCallback((stepId: string) => {
    setEditor((prev) => {
      if (prev.steps.length <= 2) return prev;
      return {
        ...prev,
        steps: prev.steps.filter((step) => step._id !== stepId),
      };
    });
    setExpandedParallelStepIds((prev) => prev.filter((id) => id !== stepId));
  }, []);

  const moveStep = useCallback((stepId: string, direction: -1 | 1) => {
    setEditor((prev) => {
      const index = prev.steps.findIndex((step) => step._id === stepId);
      if (index < 0) return prev;
      const target = index + direction;
      if (target < 0 || target >= prev.steps.length) return prev;
      const nextSteps = [...prev.steps];
      const [moved] = nextSteps.splice(index, 1);
      nextSteps.splice(target, 0, moved);
      return {
        ...prev,
        steps: nextSteps,
      };
    });
    setActiveStepId(stepId);
  }, []);

  const duplicateStep = useCallback((stepId: string) => {
    const duplicatedId = nextStepId();
    setEditor((prev) => {
      const index = prev.steps.findIndex((step) => step._id === stepId);
      if (index < 0) return prev;
      const source = prev.steps[index];
      const duplicated: StepForm = {
        _id: duplicatedId,
        title: source.title ? `${source.title}（副本）` : '',
        description: source.description,
        agentDefinitionId: source.agentDefinitionId,
        inputFiles: source.inputFiles,
        inputCondition: source.inputCondition,
        parallelAgents: source.parallelAgents.map((node) => ({
          ...node,
          _id: nextParallelId(),
        })),
      };
      const nextSteps = [...prev.steps];
      nextSteps.splice(index + 1, 0, duplicated);
      return {
        ...prev,
        steps: nextSteps,
      };
    });
    setActiveStepId(duplicatedId);
  }, []);

  const toggleStepExpanded = useCallback((stepId: string) => {
    setActiveStepId((prev) => (prev === stepId ? '' : stepId));
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
    setActiveStepId(stepId);
    setExpandedParallelStepIds((prev) => (prev.includes(stepId) ? prev : [...prev, stepId]));
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

  const toggleParallelPanel = useCallback((stepId: string) => {
    setExpandedParallelStepIds((prev) => (
      prev.includes(stepId) ? prev.filter((id) => id !== stepId) : [...prev, stepId]
    ));
  }, []);

  const openStepPromptEditor = useCallback((stepId: string) => {
    const step = editor.steps.find((item) => item._id === stepId);
    if (!step) return;
    setPromptEditorTarget({ kind: 'step', stepId });
    setPromptEditorDraft(step.description);
    setSelectedPromptTemplateId('');
    setPromptEditorOpen(true);
  }, [editor.steps]);

  const openParallelPromptEditor = useCallback((stepId: string, parallelId: string) => {
    const step = editor.steps.find((item) => item._id === stepId);
    if (!step) return;
    const node = step.parallelAgents.find((item) => item._id === parallelId);
    if (!node) return;
    setPromptEditorTarget({ kind: 'parallel', stepId, parallelId });
    setPromptEditorDraft(node.description);
    setSelectedPromptTemplateId('');
    setPromptEditorOpen(true);
  }, [editor.steps]);

  const closePromptEditor = useCallback(() => {
    setPromptEditorOpen(false);
    setPromptEditorTarget(null);
    setPromptEditorDraft('');
    setSelectedPromptTemplateId('');
  }, []);

  const applyPromptEditorDraft = useCallback(() => {
    if (!promptEditorTarget) return;
    if (promptEditorTarget.kind === 'step') {
      updateStep(promptEditorTarget.stepId, { description: promptEditorDraft });
      setActiveStepId(promptEditorTarget.stepId);
    } else {
      updateParallelAgent(promptEditorTarget.stepId, promptEditorTarget.parallelId, 'description', promptEditorDraft);
      setActiveStepId(promptEditorTarget.stepId);
      setExpandedParallelStepIds((prev) => (
        prev.includes(promptEditorTarget.stepId) ? prev : [...prev, promptEditorTarget.stepId]
      ));
    }
    closePromptEditor();
  }, [closePromptEditor, promptEditorDraft, promptEditorTarget, updateParallelAgent, updateStep]);

  const replacePromptWithTemplate = useCallback(() => {
    if (!selectedPromptTemplateId) return;
    const tpl = promptTemplates.find((item) => item.id === selectedPromptTemplateId);
    if (!tpl) return;
    setPromptEditorDraft(tpl.promptTemplate);
  }, [promptTemplates, selectedPromptTemplateId]);

  const appendPromptWithTemplate = useCallback(() => {
    if (!selectedPromptTemplateId) return;
    const tpl = promptTemplates.find((item) => item.id === selectedPromptTemplateId);
    if (!tpl) return;
    setPromptEditorDraft((prev) => {
      const current = prev.trim();
      if (!current) return tpl.promptTemplate;
      return `${current}\n\n${tpl.promptTemplate}`;
    });
  }, [promptTemplates, selectedPromptTemplateId]);

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

  const refreshTemplates = useCallback(async () => {
    if (!confirmDiscardChanges()) return;
    await load();
  }, [confirmDiscardChanges, load]);

  const saveTemplate = useCallback(async () => {
    const validationError = validateEditor();
    if (validationError) {
      setError(validationError);
      const firstInvalid = editor.steps.find((step) => (stepIssues[step._id]?.length ?? 0) > 0);
      if (firstInvalid) {
        setActiveStepId(firstInvalid._id);
      }
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
  }, [editor, load, stepIssues, validateEditor]);

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

  const exportPipeline = useCallback(() => {
    const exportSteps = editor.steps
      .map((step) => ({
        title: step.title.trim(),
        prompt: step.description.trim(),
        agentDefinitionId: step.agentDefinitionId.trim(),
        inputFiles: parseInputFiles(step.inputFiles),
        inputCondition: step.inputCondition.trim() || undefined,
        parallelAgents: step.parallelAgents
          .map((node) => ({
            title: node.title.trim() || undefined,
            prompt: node.description.trim(),
            agentDefinitionId: node.agentDefinitionId.trim() || undefined,
          }))
          .filter((node) => node.prompt.length > 0),
      }))
      .filter((step) => step.title.length > 0 && step.prompt.length > 0);

    if (exportSteps.length === 0) {
      setError('请至少填写 1 个完整步骤后再导出');
      return;
    }

    const data = buildExportDataFromForm({
      name: editor.name.trim() || '流水线模板',
      defaultAgent: editor.agentDefinitionId.trim(),
      repoUrl: editor.repoUrl,
      baseBranch: editor.baseBranch,
      workDir: editor.workDir,
      steps: exportSteps,
    });
    downloadPipelineJson(data);
    setError('');
  }, [editor]);

  const importPipeline = useCallback(async () => {
    if (!confirmDiscardChanges()) return;
    const fileResult = await openPipelineFile();
    if (!fileResult.ok) {
      if ('error' in fileResult) setError(fileResult.error);
      return;
    }

    const parsed = parsePipelineImport(fileResult.content);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    const knownAgentIds = await resolveKnownAgentIdsForImport(agents.map((agent) => agent.id));
    const sanitized = sanitizePipelineImportAgentIds(parsed.data, knownAgentIds);

    const importedSteps = sanitized.data.steps.map((step) => ({
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

    // 编辑器要求至少保留两个节点卡片，避免导入单步骤后界面行为不一致
    if (importedSteps.length === 1) {
      importedSteps.push(createEmptyStep());
    }

    setSelectedTemplateId('');
    setEditor({
      id: null,
      name: sanitized.data.name || '',
      agentDefinitionId: sanitized.data.agentDefinitionId || agents[0]?.id || '',
      repoUrl: sanitized.data.repoUrl || '',
      baseBranch: sanitized.data.baseBranch || '',
      workDir: sanitized.data.workDir || '',
      maxRetries: sanitized.data.maxRetries ?? 2,
      steps: importedSteps.length > 0 ? importedSteps : [createEmptyStep(), createEmptyStep()],
    });
    setActiveStepId(importedSteps[0]?._id || '');
    setExpandedParallelStepIds([]);

    if (sanitized.missingAgentIds.length > 0) {
      setError(`导入成功，但以下智能体不存在，已回退为默认/空：${sanitized.missingAgentIds.join(', ')}`);
      return;
    }
    setError('');
  }, [agents, confirmDiscardChanges]);

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
              onClick={() => void importPipeline()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-border-light hover:text-foreground"
            >
              <Upload size={14} />
              导入 JSON
            </button>
            <button
              type="button"
              onClick={exportPipeline}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-border-light hover:text-foreground"
            >
              <Download size={14} />
              导出 JSON
            </button>
            <button
              type="button"
              onClick={() => void refreshTemplates()}
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
          <aside className="rounded-xl border border-border bg-card/70 p-3 lg:flex lg:max-h-[calc(100vh-230px)] lg:flex-col">
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
              <div className="space-y-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
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

          <section className="rounded-xl border border-border bg-card/70 p-4 lg:flex lg:max-h-[calc(100vh-230px)] lg:flex-col">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
                  <Layers size={16} />
                  {editor.id ? '编辑流水线模板' : '新建流水线模板'}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  每个步骤可配置默认 Agent、输入约束和并行子任务（节点级 Agent/提示词）。
                </p>
                {hasUnsavedChanges && (
                  <p className="mt-2 inline-flex items-center gap-1 rounded-md border border-warning/35 bg-warning/10 px-2 py-1 text-[11px] text-warning">
                    <AlertTriangle size={12} />
                    有未保存修改
                  </p>
                )}
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

            <div className="space-y-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">可视化节点编排</h3>
                    <span className="rounded border border-border bg-card/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                      {editor.steps.length} 步骤
                    </span>
                    {invalidStepCount > 0 && (
                      <span className="rounded border border-destructive/35 bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                        {invalidStepCount} 个步骤待修复
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-md border border-border bg-background/45 p-0.5">
                      <button
                        type="button"
                        onClick={() => setViewMode('edit')}
                        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                          viewMode === 'edit'
                            ? 'bg-primary/15 text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Pencil size={12} />
                        编辑视角
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode('preview')}
                        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                          viewMode === 'preview'
                            ? 'bg-primary/15 text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Eye size={12} />
                        执行预览
                      </button>
                    </div>
                    {viewMode === 'edit' && (
                      <button
                        type="button"
                        onClick={addStep}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-border-light hover:text-foreground"
                      >
                        <Plus size={12} />
                        添加步骤
                      </button>
                    )}
                  </div>
                </div>

                {viewMode === 'edit' ? (
                <div className="space-y-3">
                  {editor.steps.map((step, stepIndex) => {
                    const stepIssueItems = stepIssues[step._id] ?? [];
                    const issueCount = stepIssueItems.length;
                    const isExpanded = activeStepId === step._id;
                    const isParallelExpanded = expandedParallelStepIds.includes(step._id);
                    const stepTitle = step.title.trim() || '未命名步骤';
                    const stepAgentLabel = step.agentDefinitionId || editor.agentDefinitionId || '默认 Agent';

                    return (
                      <div key={step._id} className="relative rounded-lg border border-border bg-card/70 p-3">
                        {stepIndex > 0 && (
                          <span className="pointer-events-none absolute -top-3 left-6 h-3 border-l border-primary/35" />
                        )}

                        <div className="mb-2 flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => toggleStepExpanded(step._id)}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-background/30"
                          >
                            {isExpanded ? (
                              <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                            )}
                            <span className="shrink-0 text-xs font-medium text-primary">步骤 {stepIndex + 1}</span>
                            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{stepTitle}</span>
                            <span className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
                              {stepAgentLabel}
                            </span>
                            {step.parallelAgents.length > 0 && (
                              <span className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground md:inline">
                                {step.parallelAgents.length} 并行
                              </span>
                            )}
                            {issueCount > 0 && (
                              <span className="shrink-0 rounded border border-destructive/35 bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
                                {issueCount} 问题
                              </span>
                            )}
                          </button>

                          <div className="mt-0.5 flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => moveStep(step._id, -1)}
                              disabled={stepIndex === 0}
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                              title="上移步骤"
                            >
                              <ArrowUp size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveStep(step._id, 1)}
                              disabled={stepIndex === editor.steps.length - 1}
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                              title="下移步骤"
                            >
                              <ArrowDown size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => duplicateStep(step._id)}
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground"
                              title="复制步骤"
                            >
                              <Copy size={12} />
                            </button>
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
                        </div>

                        {isExpanded && (
                          <>
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
                              <div className="space-y-1 sm:col-span-2">
                                <div className="flex items-center justify-between gap-2">
                                  <label className="text-[11px] text-muted-foreground">步骤提示词</label>
                                  <button
                                    type="button"
                                    onClick={() => openStepPromptEditor(step._id)}
                                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-border-light hover:text-foreground"
                                  >
                                    <Pencil size={11} />
                                    编辑提示词
                                  </button>
                                </div>
                                <div className="rounded-md border border-border bg-background/30 px-2 py-1.5 text-xs text-muted-foreground">
                                  {summarizePrompt(step.description, 220)}
                                </div>
                              </div>
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
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => toggleParallelPanel(step._id)}
                                  className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                                >
                                  {isParallelExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                  并行子任务节点（可选）
                                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px]">
                                    {step.parallelAgents.length} 个
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => addParallelAgent(step._id)}
                                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-border-light hover:text-foreground"
                                >
                                  <Plus size={11} />
                                  添加节点
                                </button>
                              </div>

                              {isParallelExpanded ? (
                                step.parallelAgents.length === 0 ? (
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
                                          <div className="space-y-1 sm:col-span-2">
                                            <div className="flex items-center justify-between gap-2">
                                              <label className="text-[11px] text-muted-foreground">节点提示词</label>
                                              <button
                                                type="button"
                                                onClick={() => openParallelPromptEditor(step._id, node._id)}
                                                className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-border-light hover:text-foreground"
                                              >
                                                <Pencil size={11} />
                                                编辑提示词
                                              </button>
                                            </div>
                                            <div className="rounded-md border border-border bg-background/30 px-2 py-1.5 text-xs text-muted-foreground">
                                              {summarizePrompt(node.description, 180)}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )
                              ) : (
                                <p className="text-[11px] text-muted-foreground/80">
                                  已折叠并行节点区域，点击标题展开编辑。
                                </p>
                              )}
                            </div>

                            {issueCount > 0 && (
                              <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                                {stepIssueItems.join('；')}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                ) : (
                  <div className="space-y-3">
                    {previewSteps.length === 0 ? (
                      <div className="rounded-lg border border-border bg-background/30 px-3 py-4 text-sm text-muted-foreground">
                        当前没有可预览的步骤。
                      </div>
                    ) : (
                      previewSteps.map((step, previewIndex) => {
                        const issueCount = stepIssues[step.id]?.length ?? 0;
                        return (
                          <div key={step.id} className="space-y-2">
                            <div className="rounded-lg border border-border bg-card/70 p-3">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                                      Step {step.index}
                                    </span>
                                    {step.parallelNodes.length > 0 ? (
                                      <span className="rounded border border-cyan/35 bg-cyan/10 px-1.5 py-0.5 text-[11px] text-cyan">
                                        并行分发 {step.parallelNodes.length}
                                      </span>
                                    ) : (
                                      <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                        单节点执行
                                      </span>
                                    )}
                                    {issueCount > 0 && (
                                      <span className="rounded border border-destructive/35 bg-destructive/10 px-1.5 py-0.5 text-[11px] text-destructive">
                                        {issueCount} 个待修复
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-sm font-medium text-foreground">{step.title}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setViewMode('edit');
                                    setActiveStepId(step.id);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-border-light hover:text-foreground"
                                >
                                  <Pencil size={12} />
                                  编辑此步骤
                                </button>
                              </div>

                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                <div className="rounded border border-border bg-background/35 px-2 py-1.5 text-[11px] text-muted-foreground">
                                  执行 Agent：{step.agentId ? (agentLabelMap.get(step.agentId) || step.agentId) : '未指定'}
                                </div>
                                <div className="rounded border border-border bg-background/35 px-2 py-1.5 text-[11px] text-muted-foreground">
                                  输入文件：{step.inputFiles.length > 0 ? step.inputFiles.join(', ') : '无'}
                                </div>
                                <div className="rounded border border-border bg-background/35 px-2 py-1.5 text-[11px] text-muted-foreground sm:col-span-2">
                                  输入条件：{step.inputCondition || '无'}
                                </div>
                              </div>

                              <div className="mt-2 rounded border border-border bg-background/25 px-2 py-1.5 text-[11px] text-muted-foreground">
                                步骤提示词预览：{step.promptPreview}
                              </div>

                              {step.parallelNodes.length > 0 && (
                                <div className="mt-2 space-y-2 rounded border border-border bg-background/25 p-2">
                                  <div className="text-[11px] text-muted-foreground">并行节点执行预览</div>
                                  {step.parallelNodes.map((node) => (
                                    <div key={node.id} className="rounded border border-border bg-card/60 px-2 py-1.5">
                                      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                                        <span className="font-medium text-foreground">{node.title}</span>
                                        <span className="text-muted-foreground">
                                          Agent：{node.agentId ? (agentLabelMap.get(node.agentId) || node.agentId) : '未指定'}
                                        </span>
                                      </div>
                                      <div className="mt-1 text-[11px] text-muted-foreground">
                                        节点提示词预览：{node.promptPreview}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            {previewIndex < previewSteps.length - 1 && (
                              <div className="flex items-center justify-center py-1 text-muted-foreground/70">
                                <ArrowDown size={14} />
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-card/70 p-2 text-xs text-muted-foreground">
                <Layers size={14} className="mt-0.5 shrink-0" />
                <div>
                  当前页面只负责流水线模板编辑。运行流水线请点击右上角“运行流水线”，进入终端面板后可查看每个 Agent 的实时会话输出。
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      <Modal
        open={promptEditorOpen}
        onClose={closePromptEditor}
        title={promptEditorInfo?.title || '编辑提示词'}
        description={promptEditorInfo?.description || '在弹窗中编辑完整提示词'}
        size="lg"
        footer={(
          <>
            <button
              type="button"
              onClick={closePromptEditor}
              className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-border-light hover:text-foreground"
            >
              取消
            </button>
            <button
              type="button"
              onClick={applyPromptEditorDraft}
              className="inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              保存提示词
            </button>
          </>
        )}
      >
        <div className="space-y-2">
          <div className="rounded-lg border border-border bg-background/30 p-2">
            <div className="mb-2 text-xs text-muted-foreground">
              导入提示词模板（可选）
            </div>
            {promptTemplates.length === 0 ? (
              <div className="text-xs text-muted-foreground/80">
                暂无可用提示词模板，请先在“提示词管理”页面创建模板。
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={selectedPromptTemplateId}
                    onChange={(e) => setSelectedPromptTemplateId(e.target.value)}
                    className={`min-w-[280px] flex-1 ${selectCls}`}
                  >
                    <option value="">选择提示词模板...</option>
                    {promptTemplates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={replacePromptWithTemplate}
                    disabled={!selectedPromptTemplateId}
                    className="inline-flex items-center rounded-md border border-border px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:border-border-light hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    替换为模板
                  </button>
                  <button
                    type="button"
                    onClick={appendPromptWithTemplate}
                    disabled={!selectedPromptTemplateId}
                    className="inline-flex items-center rounded-md border border-border px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:border-border-light hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    追加模板
                  </button>
                </div>
                {selectedPromptTemplate && (
                  <div className="rounded border border-border bg-background/25 px-2 py-1.5 text-xs text-muted-foreground">
                    模板预览：{summarizePrompt(selectedPromptTemplate.promptTemplate, 280)}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            当前字符数：{promptEditorDraft.length}
          </div>
          <textarea
            value={promptEditorDraft}
            onChange={(e) => setPromptEditorDraft(e.target.value)}
            rows={18}
            placeholder="请输入提示词"
            className={`${inputCls} min-h-[360px] resize-y font-mono text-[13px] leading-relaxed`}
          />
        </div>
      </Modal>
    </div>
  );
}
