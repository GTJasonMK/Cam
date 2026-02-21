// ============================================================
// 终端工具栏（视图切换 + 新建终端/Agent + 连接状态）
// ============================================================

'use client';

import { Plus, Wifi, WifiOff, Bot, TerminalSquare, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AGENT_SESSION_UI_MESSAGES as MSG } from '@/lib/i18n/ui-messages';
import type { TerminalViewMode } from '@/stores/terminal';

interface TerminalToolbarProps {
  connected: boolean;
  sessionCount: number;
  viewMode: TerminalViewMode;
  onViewModeChange: (mode: TerminalViewMode) => void;
  onNewTerminal: () => void;
  onNewAgent: () => void;
  onNewPipeline: () => void;
}

export function TerminalToolbar({
  connected,
  sessionCount,
  viewMode,
  onViewModeChange,
  onNewTerminal,
  onNewAgent,
  onNewPipeline,
}: TerminalToolbarProps) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-card/70 px-3 py-1.5">
      <div className="flex items-center gap-3">
        {/* 视图切换 */}
        <div className="flex rounded-lg border border-border bg-input-bg/80 p-0.5">
          <button
            type="button"
            onClick={() => onViewModeChange('terminal')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
              viewMode === 'terminal'
                ? 'bg-card-elevated text-foreground shadow-[0_1px_0_rgba(255,255,255,0.05)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <TerminalSquare size={13} />
            {MSG.viewTerminal}
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('agent')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
              viewMode === 'agent'
                ? 'bg-card-elevated text-foreground shadow-[0_1px_0_rgba(255,255,255,0.05)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Bot size={13} />
            {MSG.viewAgent}
          </button>
        </div>

        <span className="text-xs text-muted-foreground">{sessionCount} 个会话</span>
      </div>

      <div className="flex items-center gap-2">
        {/* 连接状态 */}
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs',
            connected ? 'text-success' : 'text-destructive',
          )}
        >
          {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
          <span>{connected ? '已连接' : '未连接'}</span>
        </div>

        {/* 流水线 */}
        <button
          type="button"
          onClick={onNewPipeline}
          disabled={!connected}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:border-border-light hover:bg-card-elevated disabled:cursor-not-allowed disabled:opacity-40"
        >
          <GitBranch size={14} />
          {MSG.pipeline.newPipeline}
        </button>

        {/* 新建 Agent */}
        <button
          type="button"
          onClick={onNewAgent}
          disabled={!connected}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-all hover:border-primary/50 hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Bot size={14} />
          {MSG.newAgent}
        </button>

        {/* 新建终端 */}
        <button
          type="button"
          onClick={onNewTerminal}
          disabled={!connected}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:border-border-light hover:bg-card-elevated disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={14} />
          {MSG.newTerminal}
        </button>
      </div>
    </div>
  );
}
