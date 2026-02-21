// ============================================================
// Agent 会话状态卡片
// 展示单个 Agent 会话的实时状态、Prompt 摘要、操作按钮
// ============================================================

'use client';

import { Bot, Circle, CheckCircle, XCircle, Ban, Eye, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AGENT_SESSION_UI_MESSAGES as MSG } from '@/lib/i18n/ui-messages';
import type { AgentSessionStatus } from '@/lib/terminal/protocol';

interface AgentSessionCardProps {
  sessionId: string;
  agentDisplayName: string;
  prompt: string;
  workBranch: string;
  status: AgentSessionStatus;
  elapsedMs: number;
  isActive: boolean;
  onView: (sessionId: string) => void;
  onCancel: (sessionId: string) => void;
}

const STATUS_CONFIG: Record<AgentSessionStatus, {
  icon: typeof Circle;
  color: string;
  bgColor: string;
}> = {
  running: { icon: Circle, color: 'text-blue-400', bgColor: 'bg-blue-400/10' },
  completed: { icon: CheckCircle, color: 'text-emerald-400', bgColor: 'bg-emerald-400/10' },
  failed: { icon: XCircle, color: 'text-red-400', bgColor: 'bg-red-400/10' },
  cancelled: { icon: Ban, color: 'text-amber-400', bgColor: 'bg-amber-400/10' },
};

export function AgentSessionCard({
  sessionId,
  agentDisplayName,
  prompt,
  workBranch,
  status,
  elapsedMs,
  isActive,
  onView,
  onCancel,
}: AgentSessionCardProps) {
  const config = STATUS_CONFIG[status];
  const StatusIcon = config.icon;

  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-all',
        isActive
          ? 'border-primary/40 bg-primary/5'
          : 'border-border bg-card/65 hover:border-border-light hover:bg-card-elevated/70',
      )}
    >
      {/* 头部：Agent 名 + 状态 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{agentDisplayName}</span>
        </div>
        <div className={cn('flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs', config.bgColor, config.color)}>
          <StatusIcon size={12} className={status === 'running' ? 'animate-pulse' : ''} />
          <span>{MSG.status[status]}</span>
        </div>
      </div>

      {/* Prompt 摘要 */}
      <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
        {prompt || workBranch}
      </p>

      {/* 底部：时间 + 操作 */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground/60">
          {MSG.elapsed(elapsedMs)}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onView(sessionId)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground"
          >
            <Eye size={12} />
            {MSG.statusPanel.view}
          </button>
          {status === 'running' && (
            <button
              type="button"
              onClick={() => onCancel(sessionId)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
            >
              <Square size={12} />
              {MSG.statusPanel.cancelAgent}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
