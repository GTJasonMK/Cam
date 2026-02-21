// ============================================================
// 流水线创建对话框
// 定义多步 Agent 工作流，前一步完成后自动启动下一步
// 支持每步独立 Agent、流水线模板加载/保存
// ============================================================

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot, FolderOpen, Plus, Trash2, Play, Save, Layers, Download, Upload,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AGENT_SESSION_UI_MESSAGES as MSG } from '@/lib/i18n/ui-messages';
import type { ClientMessage } from '@/lib/terminal/protocol';
import {
  buildExportDataFromForm,
  downloadPipelineJson,
  findMissingPipelineAgentIds,
  openPipelineFile,
  parsePipelineImport,
} from '@/lib/pipeline-io';
import { resolveKnownAgentIdsForImport } from '@/lib/agents/known-agent-ids';

// ---- 类型 ----

interface AgentDef { id: string; displayName: string }

interface PipelineTemplateItem {
  id: string;
  name: string;
  agentDefinitionId: string | null;
  pipelineSteps: Array<{
    title: string;
    description: string;
    agentDefinitionId?: string;
    inputFiles?: string[];
    inputCondition?: string;
    parallelAgents?: Array<{ title?: string; description: string; agentDefinitionId?: string }>;
  }> | null;
  maxRetries: number | null;
  repoUrl: string | null;
  baseBranch: string | null;
  workDir: string | null;
}

/** 单任务模板（用于"从模板填充"某个步骤） */
interface SingleTemplateItem {
  id: string;
  name: string;
  promptTemplate: string;
  agentDefinitionId: string | null;
}

interface PipelineStep {
  title: string;
  prompt: string;
  agentDefinitionId: string;
  inputFiles: string;
  inputCondition: string;
  parallelAgents: Array<{
    _id: string;
    title: string;
    prompt: string;
    agentDefinitionId: string;
  }>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  send: (msg: ClientMessage) => boolean;
}

// ---- 样式 ----
const inputCls = 'w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/30';
const selectCls = 'rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/30';
let parallelIdCounter = 0;

function nextParallelId(): string {
  parallelIdCounter += 1;
  return `p-${parallelIdCounter}`;
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

// ============================================================
// 组件
// ============================================================

export function PipelineCreateDialog({ open, onOpenChange, send }: Props) {
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [defaultAgent, setDefaultAgent] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [error, setError] = useState('');

  // 流水线模板
  const [pipelineTemplates, setPipelineTemplates] = useState<PipelineTemplateItem[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // 单任务模板列表（用于"从模板填充"步骤）
  const [singleTemplates, setSingleTemplates] = useState<SingleTemplateItem[]>([]);

  // 步骤列表（每步含独立 agentDefinitionId）
  const [steps, setSteps] = useState<PipelineStep[]>([
    { title: '', prompt: '', agentDefinitionId: '', inputFiles: '', inputCondition: '', parallelAgents: [] },
    { title: '', prompt: '', agentDefinitionId: '', inputFiles: '', inputCondition: '', parallelAgents: [] },
  ]);

  // 保存模板弹窗
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);

  // ---- 数据加载 ----
  useEffect(() => {
    if (!open) return;

    fetch('/api/agents').then((r) => r.json()).then((d) => {
      if (d.success && Array.isArray(d.data)) {
        const list = d.data.map((a: AgentDef) => ({ id: a.id, displayName: a.displayName }));
        setAgents(list);
        if (list.length > 0 && !defaultAgent) setDefaultAgent(list[0].id);
      }
    }).catch(() => {});

    fetch('/api/task-templates').then((r) => r.json()).then((d) => {
      if (d.success && Array.isArray(d.data)) {
        // 分离流水线模板和单任务模板
        const pipelineTpls: PipelineTemplateItem[] = [];
        const singleTpls: SingleTemplateItem[] = [];
        for (const t of d.data) {
          if (t.pipelineSteps && Array.isArray(t.pipelineSteps) && t.pipelineSteps.length > 0) {
            pipelineTpls.push(t);
          } else {
            singleTpls.push({
              id: t.id,
              name: t.name,
              promptTemplate: t.promptTemplate,
              agentDefinitionId: t.agentDefinitionId,
            });
          }
        }
        setPipelineTemplates(pipelineTpls);
        setSingleTemplates(singleTpls);
      }
    }).catch(() => {});
  }, [open, defaultAgent]);

  // ---- 模板加载 ----
  const applyTemplate = useCallback((templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) return;

    const tpl = pipelineTemplates.find((t) => t.id === templateId);
    if (!tpl || !tpl.pipelineSteps) return;

    // 填充全局配置
    if (tpl.agentDefinitionId) setDefaultAgent(tpl.agentDefinitionId);
    if (tpl.repoUrl) setRepoUrl(tpl.repoUrl);
    if (tpl.baseBranch) setBaseBranch(tpl.baseBranch);
    if (tpl.workDir) setWorkDir(tpl.workDir);

    // 填充步骤
    setSteps(tpl.pipelineSteps.map((s) => ({
      title: s.title,
      prompt: s.description,
      agentDefinitionId: s.agentDefinitionId || '',
      inputFiles: formatInputFiles(s.inputFiles),
      inputCondition: s.inputCondition || '',
      parallelAgents: (s.parallelAgents ?? []).map((node) => ({
        _id: nextParallelId(),
        title: node.title || '',
        prompt: node.description,
        agentDefinitionId: node.agentDefinitionId || '',
      })),
    })));
  }, [pipelineTemplates]);

  // ---- 步骤操作 ----
  const updateStep = useCallback((index: number, field: keyof PipelineStep, value: string) => {
    setSteps((prev) => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  }, []);

  const addStep = useCallback(() => {
    setSteps((prev) => [...prev, { title: '', prompt: '', agentDefinitionId: '', inputFiles: '', inputCondition: '', parallelAgents: [] }]);
  }, []);

  const removeStep = useCallback((index: number) => {
    setSteps((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const fillFromSingleTemplate = useCallback((index: number, template: SingleTemplateItem) => {
    setSteps((prev) => prev.map((s, i) =>
      i === index ? {
        ...s,
        title: template.name,
        prompt: template.promptTemplate,
        agentDefinitionId: template.agentDefinitionId || s.agentDefinitionId,
      } : s,
    ));
  }, []);

  const addParallelAgent = useCallback((index: number) => {
    setSteps((prev) => prev.map((step, i) => (
      i === index
        ? {
            ...step,
            parallelAgents: [
              ...step.parallelAgents,
              { _id: nextParallelId(), title: '', prompt: '', agentDefinitionId: '' },
            ],
          }
        : step
    )));
  }, []);

  const removeParallelAgent = useCallback((stepIndex: number, parallelId: string) => {
    setSteps((prev) => prev.map((step, i) => (
      i === stepIndex
        ? { ...step, parallelAgents: step.parallelAgents.filter((node) => node._id !== parallelId) }
        : step
    )));
  }, []);

  const updateParallelAgent = useCallback((
    stepIndex: number,
    parallelId: string,
    field: 'title' | 'prompt' | 'agentDefinitionId',
    value: string,
  ) => {
    setSteps((prev) => prev.map((step, i) => {
      if (i !== stepIndex) return step;
      return {
        ...step,
        parallelAgents: step.parallelAgents.map((node) => (
          node._id === parallelId ? { ...node, [field]: value } : node
        )),
      };
    }));
  }, []);

  // ---- 保存为模板 ----
  const handleSaveAsTemplate = useCallback(async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const pipelineSteps = steps.map((s) => ({
        title: s.title.trim(),
        description: s.prompt.trim(),
        ...(s.agentDefinitionId ? { agentDefinitionId: s.agentDefinitionId } : {}),
        ...(parseInputFiles(s.inputFiles).length > 0 ? { inputFiles: parseInputFiles(s.inputFiles) } : {}),
        ...(s.inputCondition.trim() ? { inputCondition: s.inputCondition.trim() } : {}),
        ...(s.parallelAgents
          .map((node) => ({
            ...(node.title.trim() ? { title: node.title.trim() } : {}),
            description: node.prompt.trim(),
            ...(node.agentDefinitionId ? { agentDefinitionId: node.agentDefinitionId } : {}),
          }))
          .filter((node) => node.description.length > 0).length > 0
          ? {
              parallelAgents: s.parallelAgents
                .map((node) => ({
                  ...(node.title.trim() ? { title: node.title.trim() } : {}),
                  description: node.prompt.trim(),
                  ...(node.agentDefinitionId ? { agentDefinitionId: node.agentDefinitionId } : {}),
                }))
                .filter((node) => node.description.length > 0),
            }
          : {}),
      }));

      const res = await fetch('/api/task-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveName.trim(),
          titleTemplate: '(流水线模板)',
          promptTemplate: '(流水线模板)',
          agentDefinitionId: defaultAgent || null,
          repoUrl: repoUrl.trim() || null,
          baseBranch: baseBranch.trim() || null,
          workDir: workDir.trim() || null,
          pipelineSteps,
          maxRetries: 2,
        }),
      });

      if (res.ok) {
        setSaveDialogOpen(false);
        setSaveName('');
        // 刷新模板列表
        const d = await fetch('/api/task-templates').then((r) => r.json());
        if (d.success && Array.isArray(d.data)) {
          const pipelineTpls: PipelineTemplateItem[] = d.data.filter(
            (t: PipelineTemplateItem) => t.pipelineSteps && Array.isArray(t.pipelineSteps) && t.pipelineSteps.length > 0,
          );
          setPipelineTemplates(pipelineTpls);
        }
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d?.error?.message || MSG.pipeline.saveFailed);
      }
    } catch {
      setError(MSG.pipeline.saveFailed);
    } finally {
      setSaving(false);
    }
  }, [saveName, steps, defaultAgent, repoUrl, baseBranch, workDir]);

  // ---- 导出当前配置 ----
  const handleExportConfig = useCallback(() => {
    const data = buildExportDataFromForm({
      defaultAgent,
      repoUrl,
      baseBranch,
      workDir,
      steps: steps.map((step) => ({
        title: step.title,
        prompt: step.prompt,
        agentDefinitionId: step.agentDefinitionId,
        inputFiles: parseInputFiles(step.inputFiles),
        inputCondition: step.inputCondition.trim() || undefined,
        parallelAgents: step.parallelAgents
          .map((node) => ({
            title: node.title.trim() || undefined,
            prompt: node.prompt,
            agentDefinitionId: node.agentDefinitionId || undefined,
          }))
          .filter((node) => node.prompt.trim().length > 0),
      })),
    });
    downloadPipelineJson(data);
  }, [defaultAgent, repoUrl, baseBranch, workDir, steps]);

  // ---- 导入配置 ----
  const handleImportConfig = useCallback(async () => {
    const fileResult = await openPipelineFile();
    if (!fileResult.ok) {
      if ('error' in fileResult) setError(fileResult.error);
      return;
    }

    const result = parsePipelineImport(fileResult.content);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    const { data } = result;
    const knownAgentIds = await resolveKnownAgentIdsForImport(agents.map((a) => a.id));
    if (knownAgentIds.length > 0) {
      const missingAgentIds = findMissingPipelineAgentIds(data, knownAgentIds);
      if (missingAgentIds.length > 0) {
        setError(MSG.pipeline.importUnknownAgent(missingAgentIds[0]));
        return;
      }
    }

    // 填充表单
    if (data.agentDefinitionId) setDefaultAgent(data.agentDefinitionId);
    if (data.repoUrl) setRepoUrl(data.repoUrl);
    if (data.baseBranch) setBaseBranch(data.baseBranch);
    if (data.workDir) setWorkDir(data.workDir);
    setSteps(data.steps.map((s) => ({
      title: s.title,
      prompt: s.description,
      agentDefinitionId: s.agentDefinitionId || '',
      inputFiles: formatInputFiles(s.inputFiles),
      inputCondition: s.inputCondition || '',
      parallelAgents: (s.parallelAgents ?? []).map((node) => ({
        _id: nextParallelId(),
        title: node.title || '',
        prompt: node.description,
        agentDefinitionId: node.agentDefinitionId || '',
      })),
    })));
    setError('');
  }, [agents]);

  // ---- 启动流水线 ----
  const canLaunch = useMemo(() => {
    if (!defaultAgent) return false;
    if (steps.length < 2) return false;
    return steps.every((s) => s.title.trim() && s.prompt.trim());
  }, [defaultAgent, steps]);

  const launchPipeline = useCallback(() => {
    if (!canLaunch) {
      setError(MSG.pipeline.minSteps);
      return;
    }

    const ok = send({
      type: 'pipeline-create',
      agentDefinitionId: defaultAgent,
      workDir: workDir.trim() || undefined,
      repoUrl: repoUrl.trim() || undefined,
      baseBranch: baseBranch.trim() || undefined,
      cols: 80,
      rows: 24,
      steps: steps.map((s) => ({
        title: s.title.trim(),
        prompt: s.prompt.trim(),
        ...(s.agentDefinitionId ? { agentDefinitionId: s.agentDefinitionId } : {}),
        ...(parseInputFiles(s.inputFiles).length > 0 ? { inputFiles: parseInputFiles(s.inputFiles) } : {}),
        ...(s.inputCondition.trim() ? { inputCondition: s.inputCondition.trim() } : {}),
        ...(s.parallelAgents
          .map((node) => ({
            ...(node.title.trim() ? { title: node.title.trim() } : {}),
            prompt: node.prompt.trim(),
            ...(node.agentDefinitionId ? { agentDefinitionId: node.agentDefinitionId } : {}),
          }))
          .filter((node) => node.prompt.length > 0).length > 0
          ? {
              parallelAgents: s.parallelAgents
                .map((node) => ({
                  ...(node.title.trim() ? { title: node.title.trim() } : {}),
                  prompt: node.prompt.trim(),
                  ...(node.agentDefinitionId ? { agentDefinitionId: node.agentDefinitionId } : {}),
                }))
                .filter((node) => node.prompt.length > 0),
            }
          : {}),
      })),
    });

    if (!ok) {
      setError('WebSocket 未连接，请刷新页面后重试');
      return;
    }

    // 重置并关闭
    setSteps([
      { title: '', prompt: '', agentDefinitionId: '', inputFiles: '', inputCondition: '', parallelAgents: [] },
      { title: '', prompt: '', agentDefinitionId: '', inputFiles: '', inputCondition: '', parallelAgents: [] },
    ]);
    setSelectedTemplateId('');
    setError('');
    onOpenChange(false);
  }, [canLaunch, defaultAgent, workDir, repoUrl, baseBranch, steps, send, onOpenChange]);

  const close = useCallback(() => {
    setError('');
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot size={20} />
            {MSG.pipeline.createTitle}
          </DialogTitle>
          <DialogDescription>
            {MSG.pipeline.createDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 px-6 py-3">

          {/* 流水线模板选择 */}
          {pipelineTemplates.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Layers size={13} />
                {MSG.pipeline.templateLabel}
              </label>
              <select
                value={selectedTemplateId}
                onChange={(e) => applyTemplate(e.target.value)}
                className={`w-full ${selectCls}`}
              >
                <option value="">{MSG.pipeline.templateNone}</option>
                {pipelineTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.pipelineSteps?.length ?? 0} 步骤)
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">{MSG.pipeline.templateHint}</p>
            </div>
          )}

          {/* 默认 Agent 类型 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">{MSG.pipeline.defaultAgent}</label>
            <select value={defaultAgent} onChange={(e) => setDefaultAgent(e.target.value)} className={`w-full ${selectCls}`}>
              <option value="">{MSG.agentPlaceholder}</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
            </select>
            <p className="text-[11px] text-muted-foreground">{MSG.pipeline.defaultAgentHint}</p>
          </div>

          {/* 项目目录 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              <FolderOpen size={13} className="inline mr-1" />
              {MSG.workDirLabel}
            </label>
            <input
              type="text"
              value={workDir}
              onChange={(e) => setWorkDir(e.target.value)}
              placeholder={MSG.workDirPlaceholder}
              className={inputCls}
            />
          </div>

          {/* 步骤列表 */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground">步骤定义</label>
            {steps.map((step, idx) => (
              <div key={idx} className="rounded-lg border border-border bg-card/70 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-primary">步骤 {idx + 1}</span>
                  <div className="flex items-center gap-2">
                    {/* 从单任务模板填充 */}
                    {singleTemplates.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => {
                          const tpl = singleTemplates.find((t) => t.id === e.target.value);
                          if (tpl) fillFromSingleTemplate(idx, tpl);
                        }}
                        className="rounded border border-border bg-input-bg px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        <option value="">{MSG.pipeline.fillFromTemplate}</option>
                        {singleTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    )}
                    {steps.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeStep(idx)}
                        className="rounded p-1 text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title={MSG.pipeline.removeStep}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* 步骤级 Agent 选择器 */}
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-muted-foreground whitespace-nowrap">{MSG.pipeline.stepAgent}:</label>
                  <select
                    value={step.agentDefinitionId}
                    onChange={(e) => updateStep(idx, 'agentDefinitionId', e.target.value)}
                    className="flex-1 rounded border border-border bg-input-bg px-2 py-1 text-xs text-foreground"
                  >
                    <option value="">{MSG.pipeline.stepAgentDefault}</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
                  </select>
                </div>

                <input
                  type="text"
                  value={step.title}
                  onChange={(e) => updateStep(idx, 'title', e.target.value)}
                  placeholder={MSG.pipeline.stepTitle}
                  className={inputCls}
                />
                <textarea
                  value={step.prompt}
                  onChange={(e) => updateStep(idx, 'prompt', e.target.value)}
                  placeholder={MSG.pipeline.stepPrompt}
                  rows={2}
                  className={`resize-none ${inputCls}`}
                />

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">输入文件（逗号/换行分隔，可选）</label>
                    <input
                      type="text"
                      value={step.inputFiles}
                      onChange={(e) => updateStep(idx, 'inputFiles', e.target.value)}
                      placeholder="summary.md, module-a.md"
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">输入条件（可选）</label>
                    <input
                      type="text"
                      value={step.inputCondition}
                      onChange={(e) => updateStep(idx, 'inputCondition', e.target.value)}
                      placeholder="例如：当 summary.md 存在时"
                      className={inputCls}
                    />
                  </div>
                </div>

                <div className="rounded-md border border-border bg-card/70 p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-muted-foreground">步骤内并行 Agent（可选）</span>
                    <button
                      type="button"
                      onClick={() => addParallelAgent(idx)}
                      className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-border-light transition-colors"
                    >
                      <Plus size={11} />
                      添加并行子任务
                    </button>
                  </div>

                  {step.parallelAgents.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/80">
                      不配置并行子任务时，将由当前步骤主提示词驱动单个 Agent 执行。
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {step.parallelAgents.map((node, nodeIdx) => (
                        <div key={node._id} className="rounded border border-border bg-card/60 p-2 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-primary">并行子任务 {nodeIdx + 1}</span>
                            <button
                              type="button"
                              onClick={() => removeParallelAgent(idx, node._id)}
                              className="rounded p-1 text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title="移除此并行子任务"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                          <input
                            type="text"
                            value={node.title}
                            onChange={(e) => updateParallelAgent(idx, node._id, 'title', e.target.value)}
                            placeholder="子任务标题（可选）"
                            className={inputCls}
                          />
                          <div className="flex items-center gap-2">
                            <label className="text-[11px] text-muted-foreground whitespace-nowrap">Agent:</label>
                            <select
                              value={node.agentDefinitionId}
                              onChange={(e) => updateParallelAgent(idx, node._id, 'agentDefinitionId', e.target.value)}
                              className="flex-1 rounded border border-border bg-input-bg px-2 py-1 text-xs text-foreground"
                            >
                              <option value="">{MSG.pipeline.stepAgentDefault}</option>
                              {agents.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
                            </select>
                          </div>
                          <textarea
                            value={node.prompt}
                            onChange={(e) => updateParallelAgent(idx, node._id, 'prompt', e.target.value)}
                            rows={2}
                            placeholder="该并行 Agent 的独立提示词"
                            className={`resize-none ${inputCls}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={addStep}
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border-light transition-colors"
            >
              <Plus size={12} />
              {MSG.pipeline.addStep}
            </button>
          </div>

          {/* 高级选项 */}
          <details className="group">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
              高级选项（仓库地址 / 基线分支）
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">{MSG.repoUrlLabel}</label>
                <input type="text" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder={MSG.repoUrlPlaceholder} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">{MSG.baseBranchLabel}</label>
                <input type="text" value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)} placeholder={MSG.baseBranchPlaceholder} className={inputCls} />
              </div>
            </div>
          </details>

          {/* 操作按钮 */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={launchPipeline}
              disabled={!canLaunch}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Play size={14} />
              {MSG.pipeline.launch}
            </button>

            {/* 保存为模板 */}
            <button
              type="button"
              onClick={() => {
                setSaveName('');
                setSaveDialogOpen(true);
              }}
              disabled={steps.length < 2 || !steps.every((s) => s.title.trim() && s.prompt.trim())}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-border-light transition-colors disabled:opacity-50"
            >
              <Save size={14} />
              {MSG.pipeline.saveAsTemplate}
            </button>

            {/* 导出配置 */}
            <button
              type="button"
              onClick={handleExportConfig}
              disabled={steps.length < 2 || !steps.every((s) => s.title.trim() && s.prompt.trim())}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-border-light transition-colors disabled:opacity-50"
            >
              <Download size={14} />
              {MSG.pipeline.exportConfig}
            </button>

            {/* 导入配置 */}
            <button
              type="button"
              onClick={handleImportConfig}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-border-light transition-colors"
            >
              <Upload size={14} />
              {MSG.pipeline.importConfig}
            </button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        {/* 保存模板弹窗 */}
        {saveDialogOpen && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg z-10">
            <div className="bg-card border border-border rounded-lg p-5 w-80 space-y-3">
              <h3 className="text-sm font-semibold">{MSG.pipeline.saveDialogTitle}</h3>
              <p className="text-xs text-muted-foreground">{MSG.pipeline.saveDialogDesc}</p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">{MSG.pipeline.saveNameLabel}</label>
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder={MSG.pipeline.saveNamePlaceholder}
                  className={inputCls}
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setSaveDialogOpen(false)}
                  className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {MSG.cancel}
                </button>
                <button
                  type="button"
                  onClick={handleSaveAsTemplate}
                  disabled={!saveName.trim() || saving}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {saving ? '...' : MSG.pipeline.saveConfirm}
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
