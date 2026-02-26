// ============================================================
// xterm.js 终端渲染面板
// 使用 dynamic import 避免 SSR（xterm 依赖 DOM API）
// 支持：复制粘贴（桌面快捷键 + 移动端工具栏）、OSC 52、vim 辅助键、移动端输入预览
// ============================================================

'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
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

// 移动端检测（粗略，用于决定是否显示辅助工具栏）
function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export default function TerminalPanel({
  sessionId,
  active,
  send,
  registerOutput,
  unregisterOutput,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);

  // 移动端工具栏状态
  const [showToolbar, setShowToolbar] = useState(false);
  const [ctrlActive, setCtrlActive] = useState(false);
  // 用于显示短暂的复制/粘贴反馈
  const [toastText, setToastText] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 移动端输入预览状态
  const [composingText, setComposingText] = useState('');
  const [inputEcho, setInputEcho] = useState('');
  const inputEchoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComposingRef = useRef(false);

  function showToast(text: string) {
    setToastText(text);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastText(null), 1200);
  }

  // 更新输入回显（追加可见字符，超时自动清除）
  function appendEcho(text: string) {
    setInputEcho((prev) => (prev + text).slice(-40));
    if (inputEchoTimerRef.current) clearTimeout(inputEchoTimerRef.current);
    inputEchoTimerRef.current = setTimeout(() => setInputEcho(''), 2000);
  }

  // ---- 复制选中文本 ----
  const handleCopy = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    if (terminal.hasSelection()) {
      try {
        await navigator.clipboard.writeText(terminal.getSelection());
        terminal.clearSelection();
        showToast('已复制');
      } catch {
        showToast('复制失败');
      }
    } else {
      showToast('无选中文本');
    }
  }, []);

  // ---- 粘贴到终端 ----
  const handlePaste = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        terminal.paste(text);
        showToast('已粘贴');
      }
    } catch {
      showToast('粘贴失败（需授权）');
    }
  }, []);

  // ---- 全选 ----
  const handleSelectAll = useCallback(() => {
    terminalRef.current?.selectAll();
  }, []);

  // ---- 发送特殊按键到终端 ----
  const sendKey = useCallback((data: string) => {
    send({ type: 'input', sessionId, data });
  }, [send, sessionId]);

  // Ctrl 组合键：先按 Ctrl，再按字母
  const sendCtrlKey = useCallback((key: string) => {
    // Ctrl+字母 = 字母的 ASCII 码 - 64（大写）或 - 96（小写）
    const code = key.toUpperCase().charCodeAt(0) - 64;
    if (code >= 1 && code <= 26) {
      sendKey(String.fromCharCode(code));
    }
    setCtrlActive(false);
  }, [sendKey]);

  // 工具栏按键发送（带 Ctrl 修饰符处理）
  const handleToolbarKey = useCallback((key: string, rawData?: string) => {
    if (ctrlActive && !rawData) {
      sendCtrlKey(key);
    } else {
      sendKey(rawData ?? key);
    }
  }, [ctrlActive, sendCtrlKey, sendKey]);

  // 收起虚拟键盘（移动端）
  const dismissKeyboard = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, []);

  // 初始化 xterm
  useEffect(() => {
    if (initializedRef.current || !xtermContainerRef.current) return;
    initializedRef.current = true;

    let terminal: Terminal;
    let fitAddon: FitAddon;

    void (async () => {
      const [
        { Terminal: XTerm },
        { FitAddon: Fit },
        { WebLinksAddon },
        { ClipboardAddon },
      ] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
        import('@xterm/addon-clipboard'),
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
        rightClickSelectsWord: true,
      });

      fitAddon = new Fit();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());
      // OSC 52 剪贴板支持（让 vim/tmux 等后端程序能操作系统剪贴板）
      terminal.loadAddon(new ClipboardAddon());

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      terminal.open(xtermContainerRef.current!);

      // ---- 移动端输入预览：监听 xterm 隐藏 textarea 的 IME 事件 ----
      const helperTextarea = xtermContainerRef.current!.querySelector<HTMLTextAreaElement>(
        '.xterm-helper-textarea',
      );
      if (helperTextarea) {
        helperTextarea.addEventListener('compositionstart', () => {
          isComposingRef.current = true;
          setComposingText('');
        });
        helperTextarea.addEventListener('compositionupdate', (e) => {
          setComposingText((e as CompositionEvent).data || '');
        });
        helperTextarea.addEventListener('compositionend', () => {
          isComposingRef.current = false;
          setComposingText('');
          // 不在此回显最终文本 —— onData 会收到并处理
        });
      }

      // ---- 桌面端快捷键复制粘贴 ----
      terminal.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') return true;

        // Ctrl+Shift+C → 复制选中文本
        if (event.ctrlKey && event.shiftKey && event.key === 'C') {
          if (terminal.hasSelection()) {
            void navigator.clipboard.writeText(terminal.getSelection());
          }
          return false;
        }

        // Ctrl+Shift+V → 粘贴
        if (event.ctrlKey && event.shiftKey && event.key === 'V') {
          void navigator.clipboard.readText().then((text) => {
            if (text) terminal.paste(text);
          });
          return false;
        }

        // Ctrl+C：有选中内容时复制（不发送 SIGINT）
        if (event.ctrlKey && !event.shiftKey && event.key === 'c') {
          if (terminal.hasSelection()) {
            void navigator.clipboard.writeText(terminal.getSelection());
            terminal.clearSelection();
            return false;
          }
          // 无选中 → 正常发送 Ctrl+C (SIGINT)
          return true;
        }

        // Ctrl+V → 粘贴（直接拦截浏览器默认行为）
        if (event.ctrlKey && !event.shiftKey && event.key === 'v') {
          void navigator.clipboard.readText().then((text) => {
            if (text) terminal.paste(text);
          });
          return false;
        }

        return true;
      });

      // 键盘输入 → WebSocket + 移动端输入回显
      terminal.onData((data) => {
        send({ type: 'input', sessionId, data });
        // IME 输入期间不回显（由 composingText 实时显示）
        if (isComposingRef.current) return;
        if (data.length === 1) {
          const code = data.charCodeAt(0);
          if (code === 13) {
            // Enter → 显示换行符号并短暂延迟后清空
            appendEcho(' ↵');
            setTimeout(() => setInputEcho(''), 500);
          } else if (code >= 32) {
            appendEcho(data);
          }
        } else if (data.length > 1 && !data.startsWith('\x1b')) {
          // 多字符输入（IME 确认文本或粘贴内容）
          appendEcho(data);
        }
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

      // 初始化后检测是否为触摸设备
      setShowToolbar(isTouchDevice());
    })();

    return () => {
      unregisterOutput(sessionId);
      terminal?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      if (inputEchoTimerRef.current) clearTimeout(inputEchoTimerRef.current);
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
    if (xtermContainerRef.current) {
      observer.observe(xtermContainerRef.current);
    }
    return () => observer.disconnect();
  }, [handleResize]);

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full flex-col"
      style={{ display: active ? 'flex' : 'none' }}
    >
      {/* xterm 终端区域 */}
      <div ref={xtermContainerRef} className="min-h-0 flex-1" />

      {/* 复制/粘贴反馈提示 */}
      {toastText && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg bg-card/95 px-4 py-2 text-xs font-medium text-foreground shadow-lg backdrop-blur">
          {toastText}
        </div>
      )}

      {/* 移动端底部区域（输入预览 + 辅助工具栏） */}
      {showToolbar && (
        <div className="relative shrink-0">
          {/* 输入预览浮层 — 悬浮在工具栏上方，避免布局跳动 */}
          {(composingText || inputEcho) && (
            <div className="absolute bottom-full left-0 right-0 z-10 border-t border-primary/20 bg-[#0f1923]/95 px-3 py-1.5 backdrop-blur-sm">
              <div
                className="flex items-center overflow-hidden text-sm"
                style={{ fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace" }}
              >
                {inputEcho && (
                  <span className="whitespace-pre text-foreground/70">{inputEcho}</span>
                )}
                {composingText && (
                  <span className="border-b border-primary text-primary">{composingText}</span>
                )}
                <span className="ml-px animate-pulse text-primary/70">|</span>
              </div>
            </div>
          )}
          {/* 辅助工具栏 */}
          <div className="border-t border-border bg-[#111b27] px-1 py-1">
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
              {/* 收起键盘 */}
              <ToolbarBtn label="收起" onClick={dismissKeyboard} title="收起虚拟键盘" />

              <ToolbarSep />

              {/* 复制/粘贴/全选 */}
              <ToolbarBtn label="复制" onClick={handleCopy} />
              <ToolbarBtn label="粘贴" onClick={handlePaste} />
              <ToolbarBtn label="全选" onClick={handleSelectAll} />

              <ToolbarSep />

              {/* vim 必备：Esc */}
              <ToolbarBtn label="Esc" onClick={() => sendKey('\x1b')} wide />

              {/* Ctrl 修饰符（切换态） */}
              <ToolbarBtn
                label="Ctrl"
                onClick={() => setCtrlActive((prev) => !prev)}
                active={ctrlActive}
                wide
              />

              {/* Tab */}
              <ToolbarBtn label="Tab" onClick={() => handleToolbarKey('I', ctrlActive ? undefined : '\t')} />

              <ToolbarSep />

              {/* 方向键 */}
              <ToolbarBtn label="↑" onClick={() => sendKey('\x1b[A')} />
              <ToolbarBtn label="↓" onClick={() => sendKey('\x1b[B')} />
              <ToolbarBtn label="←" onClick={() => sendKey('\x1b[D')} />
              <ToolbarBtn label="→" onClick={() => sendKey('\x1b[C')} />

              <ToolbarSep />

              {/* vim 常用 Ctrl 组合 */}
              <ToolbarBtn label="C-c" onClick={() => sendKey('\x03')} title="Ctrl+C (SIGINT)" />
              <ToolbarBtn label="C-d" onClick={() => sendKey('\x04')} title="Ctrl+D (EOF)" />
              <ToolbarBtn label="C-z" onClick={() => sendKey('\x1a')} title="Ctrl+Z (SIGTSTP)" />
              <ToolbarBtn label="C-l" onClick={() => sendKey('\x0c')} title="Ctrl+L (清屏)" />
              <ToolbarBtn label="C-r" onClick={() => sendKey('\x12')} title="Ctrl+R (反向搜索)" />
              <ToolbarBtn label="C-w" onClick={() => sendKey('\x17')} title="Ctrl+W (删词)" />
              <ToolbarBtn label="C-u" onClick={() => sendKey('\x15')} title="Ctrl+U (删行)" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- 工具栏子组件 ----

function ToolbarBtn({
  label,
  onClick,
  active,
  wide,
  title,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  wide?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        'shrink-0 rounded px-2 py-1.5 text-[11px] font-medium transition-colors',
        'select-none touch-manipulation active:scale-95',
        wide ? 'min-w-[40px]' : 'min-w-[28px]',
        active
          ? 'bg-primary/25 text-primary border border-primary/40'
          : 'bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground border border-transparent',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function ToolbarSep() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-border" />;
}
