// ============================================================
// xterm.js 终端渲染面板
// 使用 dynamic import 避免 SSR（xterm 依赖 DOM API）
// ============================================================

'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { ClientMessage } from '@/lib/terminal/protocol';

interface TerminalPanelProps {
  sessionId: string;
  /** 是否为当前激活标签（隐藏时不需要 fit） */
  active: boolean;
  /** 发送消息到 WebSocket */
  send: (msg: ClientMessage) => void;
  /** 注册输出监听 */
  registerOutput: (sessionId: string, handler: (data: string) => void) => void;
  /** 注销输出监听 */
  unregisterOutput: (sessionId: string) => void;
}

// CAM 暗色主题
const CAM_THEME = {
  background: '#0d1520',
  foreground: '#edecef',
  cursor: '#2f6fed',
  cursorAccent: '#0d1520',
  selectionBackground: 'rgba(47, 111, 237, 0.32)',
  selectionForeground: '#ffffff',
  black: '#1a1b26',
  red: '#ef5a7a',
  green: '#26c281',
  yellow: '#f4b35f',
  blue: '#2f6fed',
  magenta: '#9aa7ff',
  cyan: '#2aa8d8',
  white: '#edecef',
  brightBlack: '#6e7483',
  brightRed: '#f7768e',
  brightGreen: '#73daca',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#ffffff',
};

export default function TerminalPanel({
  sessionId,
  active,
  send,
  registerOutput,
  unregisterOutput,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);

  // 初始化 xterm
  useEffect(() => {
    if (initializedRef.current || !containerRef.current) return;
    initializedRef.current = true;

    let terminal: Terminal;
    let fitAddon: FitAddon;

    void (async () => {
      const [{ Terminal: XTerm }, { FitAddon: Fit }, { WebLinksAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
      ]);

      // xterm CSS 已在 globals.css 中全局导入

      terminal = new XTerm({
        theme: CAM_THEME,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Menlo, Monaco, 'Courier New', monospace",
        fontSize: 14,
        lineHeight: 1.35,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 10000,
        allowProposedApi: true,
      });

      fitAddon = new Fit();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      terminal.open(containerRef.current!);

      // 键盘输入 → WebSocket
      terminal.onData((data) => {
        send({ type: 'input', sessionId, data });
      });

      // 尺寸变化 → WebSocket（必须在 fit() 之前注册，否则首次 resize 丢失）
      terminal.onResize(({ cols, rows }) => {
        send({ type: 'resize', sessionId, cols, rows });
      });

      // fit 到容器实际尺寸（触发 resize → 同步到服务端 PTY）
      fitAddon.fit();

      // 注册输出监听（触发缓冲输出回放）
      registerOutput(sessionId, (data) => {
        terminal.write(data);
      });
    })();

    return () => {
      unregisterOutput(sessionId);
      terminal?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 激活标签时重新 fit
  useEffect(() => {
    if (active && fitAddonRef.current) {
      // 延迟一帧让 DOM 布局完成
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
      });
    }
  }, [active]);

  // 监听容器 resize
  const handleResize = useCallback(() => {
    if (active && fitAddonRef.current) {
      fitAddonRef.current.fit();
    }
  }, [active]);

  useEffect(() => {
    const observer = new ResizeObserver(handleResize);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, [handleResize]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ display: active ? 'block' : 'none' }}
    />
  );
}
