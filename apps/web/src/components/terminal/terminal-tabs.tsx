// ============================================================
// 终端多标签管理栏
// ============================================================

'use client';

import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TerminalSession } from '@/stores/terminal';
import type { ClientMessage } from '@/lib/terminal/protocol';

interface TerminalTabsProps {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  send: (msg: ClientMessage) => void;
}

export function TerminalTabs({
  sessions,
  activeSessionId,
  onSelect,
  onClose,
  send,
}: TerminalTabsProps) {
  const handleClose = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    send({ type: 'destroy', sessionId });
    onClose(sessionId);
  };

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto px-1">
      {sessions.map((session) => {
        const isActive = session.sessionId === activeSessionId;
        return (
          <button
            key={session.sessionId}
            type="button"
            onClick={() => onSelect(session.sessionId)}
            className={cn(
              'group flex shrink-0 items-center gap-2 rounded-t-lg border-x border-t px-3.5 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-white/12 bg-[#0a0c12] text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground',
            )}
          >
            <span className="max-w-[120px] truncate">{session.title}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => handleClose(e, session.sessionId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleClose(e as unknown as React.MouseEvent, session.sessionId);
              }}
              className={cn(
                'inline-flex h-5 w-5 items-center justify-center rounded transition-colors',
                isActive
                  ? 'text-muted-foreground hover:bg-white/10 hover:text-foreground'
                  : 'text-transparent group-hover:text-muted-foreground group-hover:hover:bg-white/10 group-hover:hover:text-foreground',
              )}
            >
              <X size={13} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
