// ============================================================
// 流水线创建对话框
// 定义多步 Agent 工作流，前一步完成后自动启动下一步
// ============================================================

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot, FolderOpen, Plus, Trash2, Play, Loader2, FileText,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AGENT_SESSION_UI_MESSAGES as MSG } from '@/lib/i18n/ui-messages';
import { extractTemplateVars, renderTemplate } from '@/lib/terminal/template-render';
import type { ClientMessage } from '@/lib/terminal/protocol';

// ---- 类型 ----

interface AgentDef { id: string; displayName: string }
interface TemplateItem {
  id: string; name: string; promptTemplate: string;
  agentDefinitionId: string | null;
}

interface PipelineStep {
  title: string;
  prompt: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  send: (msg: ClientMessage) => boolean;
}

// ---- 样式 ----
const inputCls = 'w-full rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/30';

// ============================================================
// 组件
// ============================================================

export function PipelineCreateDialog({ open, onOpenChange, send }: Props) {
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  // 模板列表（用于"从模板填充"步骤）
  const [templates, setTemplates] = useState<TemplateItem[]>([]);

  // 步骤列表
  const [steps, setSteps] = useState<PipelineStep[]>([
    { title: '', prompt: '' },
    { title: '', prompt: '' },
  ]);

  // ---- 数据加载 ----
  useEffect(() => {
    if (!open) return;
    fetch('/api/agents').then((r) => r.json()).then((d) => {
      if (d.success && Array.isArray(d.data)) {
        const list = d.data.map((a: AgentDef) => ({ id: a.id, displayName: a.displayName }));
        setAgents(list);
        if (list.length > 0 && !selectedAgent) setSelectedAgent(list[0].id);
      }
    }).catch(() => {});
    fetch('/api/task-templates').then((r) => r.json()).then((d) => {
      if (d.success && Array.isArray(d.data)) setTemplates(d.data);
    }).catch(() => {});
  }, [open, selectedAgent]);

  // ---- 步骤操作 ----
  const updateStep = useCallback((index: number, field: keyof PipelineStep, value: string) => {
    setSteps((prev) => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  }, []);

  const addStep = useCallback(() => {
    setSteps((prev) => [...prev, { title: '', prompt: '' }]);
  }, []);

  const removeStep = useCallback((index: number) => {
    setSteps((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const fillFromTemplate = useCallback((index: number, template: TemplateItem) => {
    // 提取变量并直接使用模板内容（变量保持 {{}} 格式让用户修改）
    setSteps((prev) => prev.map((s, i) =>
      i === index ? { ...s, title: template.name, prompt: template.promptTemplate } : s,
    ));
  }, []);

  // ---- 启动流水线 ----
  const canLaunch = useMemo(() => {
    if (!selectedAgent) return false;
    if (steps.length < 2) return false;
    return steps.every((s) => s.title.trim() && s.prompt.trim());
  }, [selectedAgent, steps]);

  const launchPipeline = useCallback(() => {
    if (!canLaunch) {
      setError(MSG.pipeline.minSteps);
      return;
    }

    const ok = send({
      type: 'pipeline-create',
      agentDefinitionId: selectedAgent,
      workDir: workDir.trim() || undefined,
      repoUrl: repoUrl.trim() || undefined,
      baseBranch: baseBranch.trim() || undefined,
      cols: 80,
      rows: 24,
      steps: steps.map((s) => ({ title: s.title.trim(), prompt: s.prompt.trim() })),
    });

    if (!ok) {
      setError('WebSocket 未连接，请刷新页面后重试');
      return;
    }

    // 重置并关闭
    setSteps([{ title: '', prompt: '' }, { title: '', prompt: '' }]);
    setError('');
    onOpenChange(false);
  }, [canLaunch, selectedAgent, workDir, repoUrl, baseBranch, steps, send, onOpenChange]);

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

          {/* Agent 类型 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">{MSG.agentLabel}</label>
            <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)} className={inputCls}>
              <option value="">{MSG.agentPlaceholder}</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
            </select>
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
              <div key={idx} className="rounded-lg border border-white/12 bg-white/[0.02] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-primary">步骤 {idx + 1}</span>
                  <div className="flex items-center gap-2">
                    {/* 从模板填充 */}
                    {templates.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => {
                          const tpl = templates.find((t) => t.id === e.target.value);
                          if (tpl) fillFromTemplate(idx, tpl);
                        }}
                        className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        <option value="">{MSG.pipeline.fillFromTemplate}</option>
                        {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
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
              </div>
            ))}

            <button
              type="button"
              onClick={addStep}
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-white/15 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-white/25 transition-colors"
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

          {/* 启动按钮 */}
          <button
            type="button"
            onClick={launchPipeline}
            disabled={!canLaunch || creating}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <Play size={14} />
            {MSG.pipeline.launch}
          </button>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
