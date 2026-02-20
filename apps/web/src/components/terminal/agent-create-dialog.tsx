// ============================================================
// Agent 会话对话框
// 直接操作模式：选目录 → 发现会话 → 点击即打开 / 一键新建
// ============================================================

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, FolderOpen, ChevronRight, ChevronUp, Clock,
  Database, Check, GitBranch, Sparkles, Play, RotateCcw, Plus, Loader2, FileText,
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

interface AgentDef { id: string; displayName: string; description?: string }
interface ClaudeSession { sessionId: string; lastModified: string; sizeBytes: number }
interface DirEntry { name: string; path: string; isDirectory: boolean; isGitRepo: boolean; hasClaude: boolean }
interface BrowseResult {
  currentPath: string; parentPath: string | null;
  isGitRepo: boolean; hasClaude: boolean;
  entries: DirEntry[]; claudeSessions: ClaudeSession[];
}
interface RepoPreset { id: string; name: string; repoUrl: string; defaultWorkDir: string | null }
interface TemplateItem {
  id: string; name: string; promptTemplate: string;
  agentDefinitionId: string | null; repoUrl: string | null;
  baseBranch: string | null; workDir: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  send: (msg: ClientMessage) => boolean;
  prefill?: {
    agentDefinitionId?: string;
    repoUrl?: string;
    baseBranch?: string;
    workDir?: string;
    prompt?: string;
  };
}

// ---- localStorage 最近目录 ----

const RECENT_DIRS_KEY = 'cam:recent-agent-dirs';
const MAX_RECENT = 5;

function getRecentDirs(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_DIRS_KEY) || '[]'); } catch { return []; }
}
function addRecentDir(dir: string): void {
  try {
    const dirs = getRecentDirs().filter((d) => d !== dir);
    dirs.unshift(dir);
    localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(dirs.slice(0, MAX_RECENT)));
  } catch {}
}

// ---- 工具 ----

const isClaudeCode = (id: string) => id === 'claude-code';

function fmtSize(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}

function pathToBreadcrumbs(p: string): Array<{ label: string; path: string }> {
  if (!p) return [];
  const parts = p.split(/[\\/]/).filter(Boolean);
  const crumbs: Array<{ label: string; path: string }> = [];
  for (let i = 0; i < parts.length; i++) {
    const isWinDrive = i === 0 && parts[0].endsWith(':');
    const accumulated = isWinDrive
      ? parts.slice(0, i + 1).join('\\') + '\\'
      : (p.startsWith('/') ? '/' : '') + parts.slice(0, i + 1).join('/');
    crumbs.push({ label: parts[i], path: accumulated });
  }
  return crumbs;
}

// ---- 样式 ----
const inputCls = 'w-full rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/30';
const actionBtnCls = 'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors';

// ============================================================
// 组件
// ============================================================

export function AgentCreateDialog({ open, onOpenChange, send, prefill }: Props) {
  // ---- 状态 ----
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [error, setError] = useState('');

  // 快速选择
  const [repos, setRepos] = useState<RepoPreset[]>([]);
  const [recentDirs, setRecentDirs] = useState<string[]>([]);

  // 模板选择
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null);
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});

  // 目录浏览
  const [browsing, setBrowsing] = useState(false);
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);

  // 当前目录状态
  const [dirInfo, setDirInfo] = useState<{ isGitRepo: boolean; hasClaude: boolean } | null>(null);

  // 已发现的 Claude 会话
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);

  const discoverRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 发现请求序号，防止竞态：仅最新请求的响应生效 */
  const discoverSeqRef = useRef(0);

  // ---- 数据加载 ----
  useEffect(() => {
    if (!open) return;
    fetch('/api/agents').then((r) => r.json()).then((d) => {
      if (d.success && Array.isArray(d.data)) {
        const list = d.data.map((a: AgentDef) => ({ id: a.id, displayName: a.displayName, description: a.description }));
        setAgents(list);
        if (list.length > 0 && !selectedAgent) setSelectedAgent(list[0].id);
      }
    }).catch(() => {});
    fetch('/api/repos').then((r) => r.json()).then((d) => {
      if (d.success && Array.isArray(d.data)) setRepos(d.data.filter((r: RepoPreset) => r.defaultWorkDir));
    }).catch(() => {});
    fetch('/api/task-templates').then((r) => r.json()).then((d) => {
      if (d.success && Array.isArray(d.data)) setTemplates(d.data);
    }).catch(() => {});
    setRecentDirs(getRecentDirs());
  }, [open, selectedAgent]);

  // ---- 预填充（从任务详情页跳转时） ----
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (!open || !prefill || prefillAppliedRef.current) return;
    prefillAppliedRef.current = true;
    if (prefill.agentDefinitionId) setSelectedAgent(prefill.agentDefinitionId);
    if (prefill.workDir) setWorkDir(prefill.workDir);
    if (prefill.repoUrl) setRepoUrl(prefill.repoUrl);
    if (prefill.baseBranch) setBaseBranch(prefill.baseBranch);
    if (prefill.prompt) setNewPrompt(prefill.prompt);
  }, [open, prefill]);

  // ---- 模板变量提取 ----
  const templateVarNames = useMemo(() => {
    if (!selectedTemplate) return [];
    return extractTemplateVars(selectedTemplate.promptTemplate);
  }, [selectedTemplate]);

  const renderedPrompt = useMemo(() => {
    if (!selectedTemplate) return '';
    return renderTemplate(selectedTemplate.promptTemplate, templateVars);
  }, [selectedTemplate, templateVars]);

  const handleSelectTemplate = useCallback((tpl: TemplateItem | null) => {
    setSelectedTemplate(tpl);
    setTemplateVars({});
    if (tpl) {
      if (tpl.agentDefinitionId) setSelectedAgent(tpl.agentDefinitionId);
      if (tpl.repoUrl) setRepoUrl(tpl.repoUrl);
      if (tpl.baseBranch) setBaseBranch(tpl.baseBranch);
      if (tpl.workDir) setWorkDir(tpl.workDir);
    }
  }, []);

  const handleTemplateVarChange = useCallback((key: string, value: string) => {
    setTemplateVars((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ---- 目录变更 → 自动发现会话 ----
  useEffect(() => {
    if (!open || !workDir.trim() || !isClaudeCode(selectedAgent)) {
      setSessions([]);
      setDirInfo(null);
      return;
    }
    if (discoverRef.current) clearTimeout(discoverRef.current);
    discoverRef.current = setTimeout(() => discover(workDir.trim()), 400);
    return () => { if (discoverRef.current) clearTimeout(discoverRef.current); };
  }, [workDir, selectedAgent, open]);

  // ---- API ----

  const discover = useCallback(async (path: string) => {
    const seq = ++discoverSeqRef.current;
    setDiscoverLoading(true);
    try {
      const res = await fetch(`/api/terminal/browse?path=${encodeURIComponent(path)}&discover=true`);
      const d = await res.json();
      // 丢弃过期响应（用户已切换到其他目录）
      if (seq !== discoverSeqRef.current) return;
      if (!d.success) return;
      const r = d.data as BrowseResult;
      setSessions(r.claudeSessions);
      setDirInfo({ isGitRepo: r.isGitRepo, hasClaude: r.hasClaude });
    } catch {
      if (seq === discoverSeqRef.current) {
        setSessions([]);
        setDirInfo(null);
      }
    } finally {
      if (seq === discoverSeqRef.current) {
        setDiscoverLoading(false);
      }
    }
  }, []);

  const browse = useCallback(async (path?: string) => {
    setBrowseLoading(true);
    try {
      const url = path ? `/api/terminal/browse?path=${encodeURIComponent(path)}` : '/api/terminal/browse';
      const res = await fetch(url);
      const d = await res.json();
      if (d.success) { setBrowseResult(d.data as BrowseResult); setBrowsing(true); }
    } catch {} finally { setBrowseLoading(false); }
  }, []);

  const selectDir = useCallback((path: string) => {
    setWorkDir(path);
    setBrowsing(false);
    setBrowseResult(null);
  }, []);

  // ---- 核心操作：启动会话 ----

  /** 发送 agent-create 并关闭对话框 */
  const launch = useCallback((mode: 'create' | 'resume', resumeSessionId?: string, prompt?: string) => {
    if (!selectedAgent) { setError(MSG.agentRequired); return; }
    const dir = workDir.trim();

    const ok = send({
      type: 'agent-create',
      agentDefinitionId: selectedAgent,
      prompt: prompt ?? '',
      repoUrl: repoUrl.trim() || undefined,
      workDir: dir || undefined,
      baseBranch: baseBranch.trim() || undefined,
      cols: 80,
      rows: 24,
      mode,
      resumeSessionId,
    });

    if (!ok) {
      setError('WebSocket 未连接，请刷新页面后重试');
      return;
    }

    // 发送成功 → 记住目录、重置、关闭
    if (dir) addRecentDir(dir);
    setNewPrompt('');
    setWorkDir('');
    setRepoUrl('');
    setBaseBranch('');
    setSessions([]);
    setDirInfo(null);
    setError('');
    onOpenChange(false);
  }, [selectedAgent, workDir, repoUrl, baseBranch, send, onOpenChange]);

  /** 从模板启动 */
  const launchFromTemplate = useCallback(() => {
    if (!selectedTemplate) return;
    const allFilled = templateVarNames.every((v) => templateVars[v]?.trim());
    if (!allFilled && templateVarNames.length > 0) {
      setError(MSG.template.fillAllVars);
      return;
    }
    launch('create', undefined, renderedPrompt);
  }, [selectedTemplate, templateVarNames, templateVars, renderedPrompt, launch]);

  /** 直接恢复某个会话 */
  const resumeSession = useCallback((sessionId: string) => {
    launch('resume', sessionId);
  }, [launch]);

  /** 新建会话（可选 prompt） */
  const createNew = useCallback(() => {
    launch('create', undefined, newPrompt.trim());
  }, [launch, newPrompt]);

  const close = useCallback(() => {
    setError('');
    setBrowsing(false);
    setBrowseResult(null);
    onOpenChange(false);
  }, [onOpenChange]);

  // ---- 派生 ----
  const hasQuickSelect = repos.length > 0 || recentDirs.length > 0;
  const breadcrumbs = browseResult ? pathToBreadcrumbs(browseResult.currentPath) : [];
  const showSessions = isClaudeCode(selectedAgent) && sessions.length > 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot size={20} />
            {MSG.createTitle}
          </DialogTitle>
          <DialogDescription>
            {MSG.browse?.createDescription ?? '选择项目目录，可发现并恢复已有会话，也可直接新建'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 px-6 py-3">

          {/* ---- Agent 类型 ---- */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">{MSG.agentLabel}</label>
            <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)} className={inputCls}>
              <option value="">{MSG.agentPlaceholder}</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
            </select>
          </div>

          {/* ---- 项目目录 ---- */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {MSG.browse?.directoryLabel ?? '项目目录'}
            </label>

            <div className="flex gap-2">
              <input
                type="text"
                value={workDir}
                onChange={(e) => setWorkDir(e.target.value)}
                placeholder={MSG.workDirPlaceholder}
                className={`flex-1 ${inputCls}`}
              />
              <button
                type="button"
                onClick={() => browse(workDir.trim() || undefined)}
                disabled={browseLoading}
                className="shrink-0 rounded-lg border border-white/12 bg-white/[0.06] px-3 py-2 text-sm text-foreground transition-colors hover:bg-white/[0.1] disabled:opacity-50"
                title="浏览目录"
              >
                <FolderOpen size={16} />
              </button>
            </div>

            {/* 状态标签 */}
            {workDir.trim() && isClaudeCode(selectedAgent) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {discoverLoading && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-muted-foreground">
                    <Loader2 size={10} className="animate-spin" /> 搜索会话...
                  </span>
                )}
                {!discoverLoading && dirInfo?.isGitRepo && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] text-green-400">
                    <GitBranch size={10} /> Git
                  </span>
                )}
                {!discoverLoading && dirInfo?.hasClaude && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-400">
                    <Sparkles size={10} /> Claude
                  </span>
                )}
                {!discoverLoading && sessions.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-400">
                    <Clock size={10} /> {sessions.length} 个会话
                  </span>
                )}
                {!discoverLoading && dirInfo && sessions.length === 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-muted-foreground">
                    无已有会话
                  </span>
                )}
              </div>
            )}

            {/* 快速选择 */}
            {hasQuickSelect && !browsing && !workDir.trim() && (
              <div className="space-y-1.5">
                {repos.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Database size={10} /> 已配置仓库
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {repos.map((r) => (
                        <button key={r.id} type="button" onClick={() => selectDir(r.defaultWorkDir!)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-white/[0.08] hover:border-primary/30">
                          <FolderOpen size={11} className="text-muted-foreground" />{r.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {recentDirs.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock size={10} /> 最近使用
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {recentDirs.map((d) => (
                        <button key={d} type="button" onClick={() => selectDir(d)} title={d}
                          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-white/[0.08] hover:border-primary/30">
                          <FolderOpen size={11} className="text-muted-foreground" />{d.split(/[\\/]/).pop() || d}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ---- 目录浏览面板 ---- */}
          {browsing && browseResult && (
            <div className="rounded-lg border border-white/12 bg-white/[0.02] flex flex-col" style={{ maxHeight: '280px' }}>
              <div className="sticky top-0 z-10 border-b border-white/8 bg-background/90 backdrop-blur px-3 py-2 space-y-1.5">
                <div className="flex items-center gap-0.5 overflow-x-auto text-xs">
                  <button type="button" onClick={() => browse(undefined)}
                    className="shrink-0 text-muted-foreground hover:text-primary transition-colors">
                    根
                  </button>
                  {breadcrumbs.map((crumb, i) => (
                    <span key={crumb.path} className="flex items-center gap-0.5">
                      <ChevronRight size={10} className="text-white/20" />
                      <button type="button" onClick={() => browse(crumb.path)}
                        className={`shrink-0 transition-colors ${i === breadcrumbs.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-primary'}`}>
                        {crumb.label}
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => selectDir(browseResult.currentPath)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 border border-primary/20 px-2.5 py-1 text-xs text-primary font-medium transition-colors hover:bg-primary/20">
                    <Check size={12} /> 选择此目录
                  </button>
                  {browseResult.isGitRepo && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-green-400"><GitBranch size={10} /> Git</span>
                  )}
                  {browseResult.hasClaude && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-blue-400"><Sparkles size={10} /> Claude</span>
                  )}
                  <span className="flex-1" />
                  {browseResult.parentPath && (
                    <button type="button" onClick={() => browse(browseResult.parentPath!)}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <ChevronUp size={12} /> 上级
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {browseResult.entries.length === 0 ? (
                  <div className="px-3 py-6 text-xs text-muted-foreground text-center">
                    {MSG.browse?.emptyDirectory ?? '空目录'}
                  </div>
                ) : (
                  <div className="divide-y divide-white/4">
                    {browseResult.entries.map((entry) => (
                      <button key={entry.path} type="button" onClick={() => browse(entry.path)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/[0.04] transition-colors group">
                        <FolderOpen size={14} className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                        <span className="flex-1 truncate">{entry.name}</span>
                        {entry.isGitRepo && <span className="shrink-0 rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-400">git</span>}
                        {entry.hasClaude && <span className="shrink-0 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">claude</span>}
                        <ChevronRight size={12} className="shrink-0 text-white/15 group-hover:text-white/30 transition-colors" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---- 模板选择（可折叠） ---- */}
          {templates.length > 0 && (
            <details className="group rounded-lg border border-white/12 bg-white/[0.02]">
              <summary className="cursor-pointer flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-foreground hover:bg-white/[0.04] transition-colors">
                <FileText size={14} className="text-primary/70" />
                {MSG.template.sectionLabel}
                <span className="ml-auto text-xs text-muted-foreground">{templates.length} 个模板</span>
              </summary>
              <div className="border-t border-white/8 px-3 py-3 space-y-3">
                {/* 模板下拉 */}
                <select
                  value={selectedTemplate?.id ?? ''}
                  onChange={(e) => {
                    const tpl = templates.find((t) => t.id === e.target.value) || null;
                    handleSelectTemplate(tpl);
                  }}
                  className={inputCls}
                >
                  <option value="">{MSG.template.selectPlaceholder}</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>

                {/* 变量表单 */}
                {selectedTemplate && templateVarNames.length > 0 && (
                  <div className="space-y-2">
                    {templateVarNames.map((varName) => (
                      <div key={varName} className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">
                          {MSG.template.varLabel(varName)}
                        </label>
                        <input
                          type="text"
                          value={templateVars[varName] ?? ''}
                          onChange={(e) => handleTemplateVarChange(varName, e.target.value)}
                          placeholder={`{{${varName}}}`}
                          className={inputCls}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* 渲染预览 */}
                {selectedTemplate && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      {MSG.template.preview}
                    </label>
                    <textarea
                      readOnly
                      value={renderedPrompt}
                      rows={3}
                      className={`resize-none ${inputCls} bg-white/[0.02] text-muted-foreground`}
                    />
                  </div>
                )}

                {/* 从模板启动按钮 */}
                {selectedTemplate && (
                  <button
                    type="button"
                    onClick={launchFromTemplate}
                    disabled={!selectedAgent}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Play size={14} />
                    {MSG.template.launchFromTemplate}
                  </button>
                )}
              </div>
            </details>
          )}

          {/* ---- 已有会话列表（点击即恢复） ---- */}
          {showSessions && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {MSG.browse?.sessionListLabel ?? '已有 Claude Code 会话'}
              </label>
              <div className="rounded-lg border border-white/12 bg-white/[0.02] divide-y divide-white/4">
                {sessions.map((s, idx) => (
                  <div
                    key={s.sessionId}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.04] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-foreground">{s.sessionId.slice(0, 8)}</span>
                        {idx === 0 && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                            {MSG.browse?.mostRecent ?? '最近'}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {fmtRelative(s.lastModified)} · {fmtTime(s.lastModified)} · {fmtSize(s.sizeBytes)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => resumeSession(s.sessionId)}
                      className={`${actionBtnCls} bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20`}
                    >
                      <RotateCcw size={12} /> 打开
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ---- 新建会话区域 ---- */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <Plus size={14} />
              {MSG.browse?.newSession ?? '新建会话'}
            </label>
            <textarea
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder="输入提示词，或留空直接进入交互式对话..."
              rows={2}
              className={`resize-none ${inputCls}`}
            />
            <button
              type="button"
              onClick={createNew}
              disabled={!selectedAgent}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Play size={14} />
              {newPrompt.trim() ? '启动新会话' : '启动交互式会话'}
            </button>
          </div>

          {/* ---- 高级选项 ---- */}
          <details className="group">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
              {MSG.browse?.advancedOptions ?? '高级选项（仓库地址 / 基线分支）'}
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

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
