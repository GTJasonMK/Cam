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
import { readApiEnvelope, resolveApiErrorMessage } from '@/lib/http/client-response';
import type { ClientMessage } from '@/lib/terminal/protocol';
import {
  buildExportDataFromForm,
  downloadPipelineJson,
  openPipelineFile,
  parsePipelineImport,
  sanitizePipelineImportAgentIds,
} from '@/lib/pipeline-io';
import { formatInputFiles, parseInputFiles } from '@/lib/pipeline/form-helpers';
import { formatDateTimeZhCn, toSafeTimestamp } from '@/lib/time/format';
import { truncateText } from '@/lib/terminal/display';
import { normalizeOptionalString } from '@/lib/validation/strings';
import { resolveKnownAgentIdsForImport } from '@/lib/agents/known-agent-ids';

// ---- 类型 ----

interface AgentDef {
  id: string;
  displayName: string;
  runtime?: string;
}

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

interface DiscoveredSessionItem {
  sessionId: string;
  lastModified: string;
  sizeBytes: number;
}

interface ManagedSessionItem {
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
}

// ---- 样式 ----
const inputCls = 'w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/30';
const selectCls = 'rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/30';
let parallelIdCounter = 0;
const SESSION_GOVERNED_AGENTS = new Set(['claude-code', 'codex']);

function isSessionGovernedAgent(agentDefinitionId: string): boolean {
  return SESSION_GOVERNED_AGENTS.has(agentDefinitionId);
}

function nextParallelId(): string {
  parallelIdCounter += 1;
  return `p-${parallelIdCounter}`;
}

function toOptionalString(value: string): string | undefined {
  return normalizeOptionalString(value) ?? undefined;
}

function parseAllowCreateStepIndexes(raw: string, totalSteps: number): { indexes: number[]; invalidTokens: string[] } {
  const tokens = raw.split(/[,\s，]+/g).map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return { indexes: [], invalidTokens: [] };
  }

  const indexes = new Set<number>();
  const invalidTokens: string[] = [];

  for (const token of tokens) {
    const value = Number(token);
    if (!Number.isInteger(value) || value < 1 || value > totalSteps) {
      invalidTokens.push(token);
      continue;
    }
    indexes.add(value - 1); // 前端使用 1-based 输入，发送 0-based 索引
  }

  return {
    indexes: Array.from(indexes).sort((a, b) => a - b),
    invalidTokens,
  };
}

function getStepResolvedAgentIds(step: PipelineStep, defaultAgent: string): string[] {
  if (step.parallelAgents.length > 0) {
    return step.parallelAgents.map((node) => node.agentDefinitionId || step.agentDefinitionId || defaultAgent).filter(Boolean);
  }
  const fallback = step.agentDefinitionId || defaultAgent;
  return fallback ? [fallback] : [];
}

function collectSessionGovernedAgents(steps: PipelineStep[], defaultAgent: string): string[] {
  const ids = new Set<string>();
  for (const step of steps) {
    for (const agentId of getStepResolvedAgentIds(step, defaultAgent)) {
      if (isSessionGovernedAgent(agentId)) {
        ids.add(agentId);
      }
    }
  }
  return Array.from(ids);
}

function collectRequiredSessionCountByAgent(steps: PipelineStep[], defaultAgent: string): Record<string, number> {
  const required: Record<string, number> = {};
  for (const step of steps) {
    const stepCount: Record<string, number> = {};
    for (const agentId of getStepResolvedAgentIds(step, defaultAgent)) {
      if (!isSessionGovernedAgent(agentId)) continue;
      stepCount[agentId] = (stepCount[agentId] ?? 0) + 1;
    }
    for (const [agentId, count] of Object.entries(stepCount)) {
      required[agentId] = Math.max(required[agentId] ?? 0, count);
    }
  }
  return required;
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

  // 会话治理：默认仅复用已准备会话（禁止隐式新建）
  const [sessionPolicy, setSessionPolicy] = useState<'reuse-only' | 'allow-create'>('reuse-only');
  const [allowCreateStepsInput, setAllowCreateStepsInput] = useState('');
  const [sessionDiscovering, setSessionDiscovering] = useState(false);
  const [managedSessionsLoading, setManagedSessionsLoading] = useState(false);
  const [discoveredSessionsByAgent, setDiscoveredSessionsByAgent] = useState<Record<string, DiscoveredSessionItem[]>>({});
  const [selectedSessionIdsByAgent, setSelectedSessionIdsByAgent] = useState<Record<string, string[]>>({});
  const [managedSessionsByAgent, setManagedSessionsByAgent] = useState<Record<string, ManagedSessionItem[]>>({});
  const [selectedManagedSessionKeysByAgent, setSelectedManagedSessionKeysByAgent] = useState<Record<string, string[]>>({});
  const [managedPoolOnly, setManagedPoolOnly] = useState(true);

  // ---- 数据加载 ----
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const loadInitialData = async () => {
      try {
        const [agentRes, templateRes] = await Promise.all([
          fetch('/api/agents'),
          fetch('/api/task-templates'),
        ]);
        const [agentJson, templateJson] = await Promise.all([
          readApiEnvelope<AgentDef[]>(agentRes),
          readApiEnvelope<Array<PipelineTemplateItem & { promptTemplate?: string | null }>>(templateRes),
        ]);

        if (cancelled) return;

        if (agentRes.ok && agentJson?.success && Array.isArray(agentJson.data)) {
          const list = agentJson.data.map((a) => ({
            id: a.id,
            displayName: a.displayName,
            runtime: a.runtime,
          }));
          setAgents(list);
          setDefaultAgent((prev) => prev || list[0]?.id || '');
        }

        if (templateRes.ok && templateJson?.success && Array.isArray(templateJson.data)) {
          const pipelineTpls: PipelineTemplateItem[] = [];
          const singleTpls: SingleTemplateItem[] = [];
          for (const t of templateJson.data) {
            if (t.pipelineSteps && Array.isArray(t.pipelineSteps) && t.pipelineSteps.length > 0) {
              pipelineTpls.push(t);
            } else {
              singleTpls.push({
                id: t.id,
                name: t.name,
                promptTemplate: t.promptTemplate || '',
                agentDefinitionId: t.agentDefinitionId,
              });
            }
          }
          setPipelineTemplates(pipelineTpls);
          setSingleTemplates(singleTpls);
        }
      } catch {
        // ignore
      }
    };

    void loadInitialData();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const sessionGovernedAgentIds = useMemo(
    () => collectSessionGovernedAgents(steps, defaultAgent),
    [steps, defaultAgent],
  );

  const requiredSessionCountByAgent = useMemo(
    () => collectRequiredSessionCountByAgent(steps, defaultAgent),
    [steps, defaultAgent],
  );

  const agentNameMap = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.displayName])),
    [agents],
  );

  // 按步骤涉及的 CLI Agent 自动发现会话，作为流水线会话池候选
  useEffect(() => {
    if (!open) return;

    const dir = workDir.trim();
    if (!dir || sessionGovernedAgentIds.length === 0) {
      setDiscoveredSessionsByAgent({});
      setSelectedSessionIdsByAgent({});
      setSessionDiscovering(false);
      return;
    }

    let cancelled = false;

    const discover = async () => {
      setSessionDiscovering(true);
      const nextDiscovered: Record<string, DiscoveredSessionItem[]> = {};

      await Promise.all(sessionGovernedAgentIds.map(async (agentId) => {
        try {
          const runtime = agents.find((item) => item.id === agentId)?.runtime;
          const runtimeParam = runtime && runtime !== 'native'
            ? `&runtime=${encodeURIComponent(runtime)}`
            : '';
          const res = await fetch(
            `/api/terminal/browse?path=${encodeURIComponent(dir)}&agent=${encodeURIComponent(agentId)}${runtimeParam}`,
          );
          const json = await readApiEnvelope<{ agentSessions?: DiscoveredSessionItem[] }>(res);
          if (!res.ok || !json?.success || !json?.data) {
            nextDiscovered[agentId] = [];
            return;
          }
          const sessionsRaw: DiscoveredSessionItem[] = Array.isArray(json.data.agentSessions)
            ? json.data.agentSessions as DiscoveredSessionItem[]
            : [];
          nextDiscovered[agentId] = sessionsRaw
            .map((item) => ({
              sessionId: item.sessionId,
              lastModified: item.lastModified,
              sizeBytes: item.sizeBytes,
            }))
            .filter((item: DiscoveredSessionItem) => Boolean(item.sessionId))
            .sort((a: DiscoveredSessionItem, b: DiscoveredSessionItem) => (
              toSafeTimestamp(b.lastModified) - toSafeTimestamp(a.lastModified)
            ));
        } catch {
          nextDiscovered[agentId] = [];
        }
      }));

      if (cancelled) return;

      setDiscoveredSessionsByAgent(nextDiscovered);
      setSelectedSessionIdsByAgent((prev) => {
        const next: Record<string, string[]> = {};
        for (const agentId of sessionGovernedAgentIds) {
          const discoveredIds = new Set((nextDiscovered[agentId] ?? []).map((session) => session.sessionId));
          const preserved = (prev[agentId] ?? []).filter((sessionId) => discoveredIds.has(sessionId));
          if (preserved.length > 0) {
            next[agentId] = preserved;
            continue;
          }
          // 无历史选择时，默认选中满足并发需求的最近会话
          const requiredCount = requiredSessionCountByAgent[agentId] ?? 0;
          next[agentId] = (nextDiscovered[agentId] ?? [])
            .slice(0, requiredCount)
            .map((session) => session.sessionId);
        }
        return next;
      });
      setSessionDiscovering(false);
    };

    void discover();

    return () => {
      cancelled = true;
    };
  }, [open, workDir, sessionGovernedAgentIds, agents, requiredSessionCountByAgent]);

  const refreshManagedSessions = useCallback(async () => {
    const dir = workDir.trim();
    if (!open || !dir || sessionGovernedAgentIds.length === 0) {
      setManagedSessionsByAgent({});
      setSelectedManagedSessionKeysByAgent({});
      setManagedSessionsLoading(false);
      return;
    }

    setManagedSessionsLoading(true);
    const nextManaged: Record<string, ManagedSessionItem[]> = {};

    await Promise.all(sessionGovernedAgentIds.map(async (agentId) => {
      try {
        const query = new URLSearchParams({
          workDir: dir,
          agentDefinitionId: agentId,
        });
        const res = await fetch(`/api/terminal/session-pool?${query.toString()}`);
        const json = await readApiEnvelope<ManagedSessionItem[]>(res);
        if (!res.ok || !json?.success || !Array.isArray(json?.data)) {
          nextManaged[agentId] = [];
          return;
        }
        nextManaged[agentId] = (json.data as ManagedSessionItem[]).filter((item) => item.agentDefinitionId === agentId);
      } catch {
        nextManaged[agentId] = [];
      }
    }));

    setManagedSessionsByAgent(nextManaged);
    setSelectedManagedSessionKeysByAgent((prev) => {
      const next: Record<string, string[]> = {};
      for (const agentId of sessionGovernedAgentIds) {
        const managed = nextManaged[agentId] ?? [];
        const managedKeySet = new Set(managed.map((item) => item.sessionKey));
        const preserved = (prev[agentId] ?? []).filter((key) => managedKeySet.has(key));
        if (preserved.length > 0) {
          next[agentId] = preserved;
          continue;
        }
        const requiredCount = requiredSessionCountByAgent[agentId] ?? 0;
        next[agentId] = managed.slice(0, requiredCount).map((item) => item.sessionKey);
      }
      return next;
    });
    setManagedSessionsLoading(false);
  }, [open, workDir, sessionGovernedAgentIds, requiredSessionCountByAgent]);

  useEffect(() => {
    void refreshManagedSessions();
  }, [refreshManagedSessions]);

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

  const togglePreparedSession = useCallback((agentId: string, sessionId: string) => {
    setSelectedSessionIdsByAgent((prev) => {
      const current = prev[agentId] ?? [];
      const exists = current.includes(sessionId);
      return {
        ...prev,
        [agentId]: exists
          ? current.filter((id) => id !== sessionId)
          : [...current, sessionId],
      };
    });
  }, []);

  const toggleManagedSession = useCallback((agentId: string, sessionKey: string) => {
    setSelectedManagedSessionKeysByAgent((prev) => {
      const current = prev[agentId] ?? [];
      const exists = current.includes(sessionKey);
      return {
        ...prev,
        [agentId]: exists
          ? current.filter((key) => key !== sessionKey)
          : [...current, sessionKey],
      };
    });
  }, []);

  const importSelectedDiscoveredSessions = useCallback(async (agentId: string) => {
    const dir = workDir.trim();
    if (!dir) {
      setError('请先填写项目目录');
      return;
    }

    const selectedSessionIds = selectedSessionIdsByAgent[agentId] ?? [];
    if (selectedSessionIds.length === 0) {
      setError(`请先选择要导入会话池的 ${agentId} 会话`);
      return;
    }

    try {
      const sessionsPayload = selectedSessionIds.map((sessionId) => ({
        agentDefinitionId: agentId,
        mode: 'resume' as const,
        resumeSessionId: sessionId,
        source: 'external' as const,
        title: `${agentId}#${truncateText(sessionId, 8)}`,
      }));
      const res = await fetch('/api/terminal/session-pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workDir: dir,
          sessions: sessionsPayload,
        }),
      });
      const json = await readApiEnvelope<unknown>(res);
      if (!res.ok || !json?.success) {
        setError(resolveApiErrorMessage(res, json, '导入会话池失败'));
        return;
      }
      await refreshManagedSessions();
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  }, [workDir, selectedSessionIdsByAgent, refreshManagedSessions]);

  const preparedSessionsPayload = useMemo(
    () => {
      const managedPayload: Array<{
        sessionKey: string;
        agentDefinitionId: string;
        mode: 'resume' | 'continue';
        resumeSessionId?: string;
        source: 'managed' | 'external';
        title: string;
      }> = [];

      for (const [agentId, sessionKeys] of Object.entries(selectedManagedSessionKeysByAgent)) {
        const managedList = managedSessionsByAgent[agentId] ?? [];
        for (const sessionKey of sessionKeys) {
          const item = managedList.find((session) => session.sessionKey === sessionKey);
          if (!item) continue;
          managedPayload.push({
            sessionKey: item.sessionKey,
            agentDefinitionId: item.agentDefinitionId,
            mode: item.mode,
            ...(item.resumeSessionId ? { resumeSessionId: item.resumeSessionId } : {}),
            source: 'managed',
            title: item.title || `${item.agentDefinitionId}#${truncateText(item.resumeSessionId || item.sessionKey, 8)}`,
          });
        }
      }

      if (managedPoolOnly) {
        return managedPayload;
      }

      const tempPayload = Object.entries(selectedSessionIdsByAgent).flatMap(([agentId, sessionIds]) => (
        sessionIds.map((sessionId) => ({
          sessionKey: `temp:${agentId}:${sessionId}`,
          agentDefinitionId: agentId,
          mode: 'resume' as const,
          resumeSessionId: sessionId,
          source: 'external' as const,
          title: `${agentId}#${truncateText(sessionId, 8)}`,
        }))
      ));

      // 优先托管池，临时会话按 key 去重补充
      const usedKeys = new Set(managedPayload.map((item) => item.sessionKey));
      for (const item of tempPayload) {
        if (usedKeys.has(item.sessionKey)) continue;
        managedPayload.push(item);
      }
      return managedPayload;
    },
    [selectedManagedSessionKeysByAgent, managedSessionsByAgent, managedPoolOnly, selectedSessionIdsByAgent],
  );

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
          repoUrl: normalizeOptionalString(repoUrl),
          baseBranch: normalizeOptionalString(baseBranch),
          workDir: normalizeOptionalString(workDir),
          pipelineSteps,
          maxRetries: 2,
        }),
      });

      if (res.ok) {
        setSaveDialogOpen(false);
        setSaveName('');
        // 刷新模板列表
        const listRes = await fetch('/api/task-templates');
        const listJson = await readApiEnvelope<PipelineTemplateItem[]>(listRes);
        if (listRes.ok && listJson?.success && Array.isArray(listJson.data)) {
          const pipelineTpls: PipelineTemplateItem[] = listJson.data.filter(
            (t: PipelineTemplateItem) => t.pipelineSteps && Array.isArray(t.pipelineSteps) && t.pipelineSteps.length > 0,
          );
          setPipelineTemplates(pipelineTpls);
        }
      } else {
        const json = await readApiEnvelope<unknown>(res);
        setError(resolveApiErrorMessage(res, json, MSG.pipeline.saveFailed));
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
        inputCondition: toOptionalString(step.inputCondition),
        parallelAgents: step.parallelAgents
          .map((node) => ({
            title: toOptionalString(node.title),
            prompt: node.prompt,
            agentDefinitionId: toOptionalString(node.agentDefinitionId),
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
    const sanitized = sanitizePipelineImportAgentIds(data, knownAgentIds);
    const imported = sanitized.data;

    // 填充表单
    if (imported.agentDefinitionId) setDefaultAgent(imported.agentDefinitionId);
    if (imported.repoUrl) setRepoUrl(imported.repoUrl);
    if (imported.baseBranch) setBaseBranch(imported.baseBranch);
    if (imported.workDir) setWorkDir(imported.workDir);
    setSteps(imported.steps.map((s) => ({
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
    if (sanitized.missingAgentIds.length > 0) {
      setError(`已导入配置，但以下智能体不存在，已回退为默认/空：${sanitized.missingAgentIds.join(', ')}`);
      return;
    }
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

    const allowCreateResult = parseAllowCreateStepIndexes(allowCreateStepsInput, steps.length);
    if (allowCreateResult.invalidTokens.length > 0) {
      setError(`允许自动新建步骤填写有误：${allowCreateResult.invalidTokens.join(', ')}`);
      return;
    }

    const preparedCountByAgent = preparedSessionsPayload.reduce<Record<string, number>>((acc, item) => {
      acc[item.agentDefinitionId] = (acc[item.agentDefinitionId] ?? 0) + 1;
      return acc;
    }, {});

    if (managedPoolOnly && sessionGovernedAgentIds.length > 0 && preparedSessionsPayload.length === 0) {
      setError('当前启用了“仅使用托管会话池”，请先选择托管会话或导入会话池');
      return;
    }

    // 前端快速校验：严格复用模式下，步骤并发需求不能超过已准备会话数
    if (sessionPolicy === 'reuse-only') {
      const allowCreateStepsSet = new Set(allowCreateResult.indexes);
      for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
        if (allowCreateStepsSet.has(stepIndex)) {
          continue;
        }
        const step = steps[stepIndex];
        const stepCount: Record<string, number> = {};
        for (const agentId of getStepResolvedAgentIds(step, defaultAgent)) {
          if (!isSessionGovernedAgent(agentId)) continue;
          stepCount[agentId] = (stepCount[agentId] ?? 0) + 1;
        }
        for (const [agentId, required] of Object.entries(stepCount)) {
          const prepared = preparedCountByAgent[agentId] ?? 0;
          if (prepared < required) {
            setError(`步骤 ${stepIndex + 1} 需要 ${required} 个 ${agentId} 会话，但当前仅准备 ${prepared} 个`);
            return;
          }
        }
      }
    }

    const ok = send({
      type: 'pipeline-create',
      agentDefinitionId: defaultAgent,
      workDir: toOptionalString(workDir),
      repoUrl: toOptionalString(repoUrl),
      baseBranch: toOptionalString(baseBranch),
      cols: 80,
      rows: 24,
      sessionPolicy,
      preparedSessions: preparedSessionsPayload,
      allowCreateSteps: allowCreateResult.indexes,
      steps: steps.map((s) => ({
        title: s.title.trim(),
        prompt: s.prompt.trim(),
        ...(toOptionalString(s.agentDefinitionId) ? { agentDefinitionId: toOptionalString(s.agentDefinitionId) } : {}),
        ...(parseInputFiles(s.inputFiles).length > 0 ? { inputFiles: parseInputFiles(s.inputFiles) } : {}),
        ...(toOptionalString(s.inputCondition) ? { inputCondition: toOptionalString(s.inputCondition) } : {}),
        ...(s.parallelAgents
          .map((node) => ({
            ...(toOptionalString(node.title) ? { title: toOptionalString(node.title) } : {}),
            prompt: node.prompt.trim(),
            ...(toOptionalString(node.agentDefinitionId) ? { agentDefinitionId: toOptionalString(node.agentDefinitionId) } : {}),
          }))
          .filter((node) => node.prompt.length > 0).length > 0
          ? {
              parallelAgents: s.parallelAgents
                .map((node) => ({
                  ...(toOptionalString(node.title) ? { title: toOptionalString(node.title) } : {}),
                  prompt: node.prompt.trim(),
                  ...(toOptionalString(node.agentDefinitionId) ? { agentDefinitionId: toOptionalString(node.agentDefinitionId) } : {}),
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
    setSessionPolicy('reuse-only');
    setAllowCreateStepsInput('');
    setDiscoveredSessionsByAgent({});
    setSelectedSessionIdsByAgent({});
    setManagedSessionsByAgent({});
    setSelectedManagedSessionKeysByAgent({});
    setManagedPoolOnly(true);
    setSelectedTemplateId('');
    setError('');
    onOpenChange(false);
  }, [
    canLaunch,
    allowCreateStepsInput,
    steps,
    sessionPolicy,
    defaultAgent,
    managedPoolOnly,
    sessionGovernedAgentIds,
    workDir,
    repoUrl,
    baseBranch,
    preparedSessionsPayload,
    send,
    onOpenChange,
  ]);

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

          {/* 会话准备（Claude/Codex 治理） */}
          <div className="rounded-lg border border-border bg-card/70 p-3 space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">会话准备</label>
              <p className="text-[11px] text-muted-foreground">
                流水线默认只复用这里准备的会话，不再隐式新建 Claude/Codex 会话。
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">会话策略</label>
                <select
                  value={sessionPolicy}
                  onChange={(e) => setSessionPolicy(e.target.value as 'reuse-only' | 'allow-create')}
                  className={`w-full ${selectCls}`}
                >
                  <option value="reuse-only">仅复用已准备会话（推荐）</option>
                  <option value="allow-create">会话不足时允许自动新建</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">允许自动新建步骤（可选，1-based）</label>
                <input
                  type="text"
                  value={allowCreateStepsInput}
                  onChange={(e) => setAllowCreateStepsInput(e.target.value)}
                  placeholder="例如：2,4"
                  className={inputCls}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={managedPoolOnly}
                onChange={(e) => setManagedPoolOnly(e.target.checked)}
              />
              仅使用托管会话池（不直接使用本次扫描到的临时会话）
            </label>

            {!workDir.trim() ? (
              <p className="text-[11px] text-muted-foreground">
                先填写项目目录，再自动发现可复用会话。
              </p>
            ) : sessionGovernedAgentIds.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                当前步骤未使用 Claude/Codex，不需要准备会话池。
              </p>
            ) : (
              <div className="space-y-2">
                {sessionDiscovering && (
                  <p className="text-[11px] text-muted-foreground">正在扫描目录中的可复用会话...</p>
                )}
                {managedSessionsLoading && (
                  <p className="text-[11px] text-muted-foreground">正在加载项目托管会话池...</p>
                )}

                {sessionGovernedAgentIds.map((agentId) => {
                  const sessions = discoveredSessionsByAgent[agentId] ?? [];
                  const selectedDiscovered = new Set(selectedSessionIdsByAgent[agentId] ?? []);
                  const managedSessions = managedSessionsByAgent[agentId] ?? [];
                  const selectedManaged = new Set(selectedManagedSessionKeysByAgent[agentId] ?? []);
                  const required = requiredSessionCountByAgent[agentId] ?? 0;
                  return (
                    <div key={agentId} className="rounded-md border border-border bg-card/60 p-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-foreground">
                          {agentNameMap.get(agentId) || agentId}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          托管已选 {selectedManaged.size}/{managedSessions.length}，建议至少 {required}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <p className="text-[11px] text-muted-foreground">项目托管会话池</p>
                        {managedSessions.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">暂无托管会话</p>
                        ) : (
                          <div className="max-h-28 overflow-y-auto space-y-1">
                            {managedSessions.map((session) => (
                              <label
                                key={session.sessionKey}
                                className="flex cursor-pointer items-center gap-2 rounded border border-border-subtle px-2 py-1 text-[11px] hover:bg-input-bg/70"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedManaged.has(session.sessionKey)}
                                  onChange={() => toggleManagedSession(agentId, session.sessionKey)}
                                />
                                <span className="font-mono text-foreground">
                                  {(session.resumeSessionId || session.sessionKey).slice(0, 12)}
                                </span>
                                <span className="text-muted-foreground">
                                  {session.leased ? '已租用' : '空闲'}
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] text-muted-foreground">本地发现（可导入托管池）</p>
                          <button
                            type="button"
                            onClick={() => void importSelectedDiscoveredSessions(agentId)}
                            disabled={selectedDiscovered.size === 0}
                            className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                          >
                            导入已选
                          </button>
                        </div>
                        {sessions.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">未发现可复用会话</p>
                        ) : (
                          <div className="max-h-28 overflow-y-auto space-y-1">
                            {sessions.map((session) => (
                              <label
                                key={`${agentId}:${session.sessionId}`}
                                className="flex cursor-pointer items-center gap-2 rounded border border-border-subtle px-2 py-1 text-[11px] hover:bg-input-bg/70"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedDiscovered.has(session.sessionId)}
                                  onChange={() => togglePreparedSession(agentId, session.sessionId)}
                                />
                                <span className="font-mono text-foreground">{session.sessionId.slice(0, 12)}</span>
                                <span className="text-muted-foreground">
                                  {formatDateTimeZhCn(session.lastModified)}
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
