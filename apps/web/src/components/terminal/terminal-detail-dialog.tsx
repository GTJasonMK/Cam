// ============================================================
// 终端详情弹窗
// 点击终端记录的"终端详情"按钮后弹出，内嵌 xterm.js 终端面板
// ============================================================

'use client';

import dynamic from 'next/dynamic';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { ClientMessage } from '@/lib/terminal/protocol';

// xterm.js 依赖 DOM，必须关闭 SSR
const TerminalPanel = dynamic(
  () => import('@/components/terminal/terminal-panel'),
  { ssr: false },
);

interface TerminalDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  title: string;
  send: (msg: ClientMessage) => void;
  /** 注册输出回调（由页面层管理 WebSocket 输出路由） */
  registerOutput: (sessionId: string, handler: (data: string) => void) => void;
  unregisterOutput: (sessionId: string) => void;
}

export function TerminalDetailDialog({
  open,
  onOpenChange,
  sessionId,
  title,
  send,
  registerOutput,
  unregisterOutput,
}: TerminalDetailDialogProps) {
  // 弹窗打开时阻止背景滚动（Radix Dialog 默认处理）
  // 弹窗关闭时自动 unregister（由 TerminalPanel unmount 处理）

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-w-[100vw] flex-col rounded-none p-0 sm:h-[80vh] sm:max-w-5xl sm:rounded-2xl">
        <DialogHeader
          className="shrink-0 border-b border-border px-3 py-2 sm:px-5 sm:py-3"
          onTouchStart={() => {
            // 移动端：触摸标题栏收起虚拟键盘
            if (document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            }
          }}
        >
          <DialogTitle className="truncate text-sm sm:text-base">{title}</DialogTitle>
          <DialogDescription className="truncate text-xs">
            会话 ID: {sessionId}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 bg-[#0d1520]">
          {open && (
            <TerminalPanel
              sessionId={sessionId}
              active={true}
              send={send}
              registerOutput={registerOutput}
              unregisterOutput={unregisterOutput}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
