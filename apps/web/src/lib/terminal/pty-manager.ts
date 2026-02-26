// ============================================================
// PTY 会话池管理器
// 参考 SSEManager（src/lib/sse/manager.ts）的 Map 连接池模式
// 管理 node-pty 进程生命周期、空闲超时、输出缓冲
// ============================================================

import * as pty from 'node-pty';
import crypto from 'crypto';
import fs from 'fs';
import type { SessionInfo } from './protocol';
import { toWSLPath, buildWSLEnvArgs } from './wsl';

/** 单个参数的 POSIX shell 引用（用于 bash -lc 拼接） */
function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-=/.,:@+]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** 单个 PTY 会话 */
interface PtySession {
  id: string;
  userId: string;
  shell: string;
  process: pty.IPty;
  createdAt: string;
  lastActivityAt: string;
  /** 滚动缓冲（最近 64KB 输出，attach 时回放） */
  scrollback: string;
  /** 空闲超时计时器 */
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** 空闲超时毫秒数（默认 30 分钟） */
  idleTimeoutMs: number;
  /** 输出监听器（WebSocket 推送回调） */
  onData: ((data: string) => void) | null;
  /** 附加输出监听器（用于日志持久化等非 WS 场景） */
  dataTaps: Map<string, (data: string) => void>;
  /** 退出监听器 */
  onExit: ((exitCode: number) => void) | null;
}

const SCROLLBACK_LIMIT = 64 * 1024; // 64KB
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟
export const MAX_SESSIONS_PER_USER = 5;

function detectDefaultShell(): string {
  if (process.platform === 'win32') {
    return 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

class PtyManager {
  private sessions: Map<string, PtySession> = new Map();

  /** 创建新 PTY 会话 */
  create(opts: {
    cols: number;
    rows: number;
    shell?: string;
    /** 直接执行的命令（如 claude, codex）— 不经过 shell，优先于 shell */
    command?: string;
    /** command 的参数数组 */
    args?: string[];
    userId: string;
    /** 额外环境变量（合并到 process.env，用于注入 API Key 等） */
    env?: Record<string, string>;
    /** 工作目录（默认用户主目录） */
    cwd?: string;
    /** 空闲超时毫秒数（覆盖默认 30 分钟，Agent 会话可设 4 小时） */
    idleTimeoutMs?: number;
    /** 运行时环境：native = 直接执行，wsl = Windows 上通过 wsl.exe 代理执行 */
    runtime?: 'native' | 'wsl';
  }): { sessionId: string; shell: string } {
    // 用户会话数限制
    const userSessionCount = this.listByUser(opts.userId).length;
    if (userSessionCount >= MAX_SESSIONS_PER_USER) {
      throw new Error(`超过单用户最大会话数限制 (${MAX_SESSIONS_PER_USER})`);
    }

    const sessionId = crypto.randomUUID();
    const cwdCandidates = [opts.cwd, process.env.HOME, process.env.USERPROFILE, process.cwd()];
    let cwd = '/tmp';
    for (const candidate of cwdCandidates) {
      if (candidate) {
        try {
          if (fs.existsSync(candidate)) {
            cwd = candidate;
            break;
          }
        } catch {
          // 忽略检测错误，尝试下一个候选目录
        }
      }
    }

    // command 模式：直接 spawn 命令；否则 spawn shell
    let file: string;
    let args: string[];
    let skipEnvMerge = false;
    if (opts.command) {
      const runtime = opts.runtime ?? 'native';
      const useWSL = runtime === 'wsl' && process.platform === 'win32';

      if (useWSL) {
        // WSL 模式：通过 bash -lic 以登录交互 shell 方式执行
        // 需要 source ~/.bashrc 因为 nvm/fnm 等工具的 PATH 通常写在 .bashrc 中，
        // 而 `bash -lc`（login non-interactive）在多数 Ubuntu 配置下不会加载 .bashrc
        const wslCwd = toWSLPath(cwd);
        const envArgs = buildWSLEnvArgs(opts.env ?? {});
        const cmdParts = [...envArgs, opts.command, ...(opts.args ?? [])];
        const cmdStr = cmdParts.map(shellQuote).join(' ');
        file = 'wsl.exe';
        args = ['--cd', wslCwd, '--', 'bash', '-lic', cmdStr];
        // WSL 模式下 env 通过 `env KEY=VAL` 前缀注入，不合并到 node-pty env
        skipEnvMerge = true;
      } else if (process.platform === 'win32') {
        // Windows native：.cmd/.bat 文件无法被 CreateProcess 直接执行，需 cmd.exe /c 中转
        file = 'cmd.exe';
        args = ['/c', opts.command, ...(opts.args ?? [])];
      } else {
        // Linux / macOS：直接执行
        file = opts.command;
        args = opts.args ?? [];
      }
    } else {
      file = opts.shell || detectDefaultShell();
      args = [];
    }
    const shell = opts.command || opts.shell || detectDefaultShell();
    const now = new Date().toISOString();

    const mergedEnv: Record<string, string> = skipEnvMerge
      ? { ...(process.env as Record<string, string>) }
      : { ...(process.env as Record<string, string>), ...opts.env };
    // 清除嵌套检测变量，允许 PTY 中启动 Claude Code CLI
    delete mergedEnv.CLAUDECODE;

    const proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd,
      env: mergedEnv,
    });

    const session: PtySession = {
      id: sessionId,
      userId: opts.userId,
      shell,
      process: proc,
      createdAt: now,
      lastActivityAt: now,
      scrollback: '',
      idleTimer: null,
      idleTimeoutMs: opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS,
      onData: null,
      dataTaps: new Map(),
      onExit: null,
    };

    // 监听 PTY 输出
    proc.onData((data: string) => {
      session.lastActivityAt = new Date().toISOString();
      this.resetIdleTimer(sessionId);

      // 追加到滚动缓冲
      session.scrollback += data;
      if (session.scrollback.length > SCROLLBACK_LIMIT) {
        session.scrollback = session.scrollback.slice(-SCROLLBACK_LIMIT);
      }

      // 推送到 WebSocket
      session.onData?.(data);
      for (const listener of session.dataTaps.values()) {
        try {
          listener(data);
        } catch (err) {
          console.warn(`[Terminal] 输出监听器执行失败: ${(err as Error).message}`);
        }
      }
    });

    // 监听 PTY 退出
    proc.onExit(({ exitCode }) => {
      session.onExit?.(exitCode);
      this.cleanupSession(sessionId);
    });

    this.sessions.set(sessionId, session);
    this.resetIdleTimer(sessionId);

    console.log(`[Terminal] 会话创建: ${sessionId} (shell=${shell}, user=${opts.userId}), 当前会话数: ${this.sessions.size}`);

    return { sessionId, shell };
  }

  /** 附加输出/退出监听器（WebSocket 连接时调用） */
  attach(
    sessionId: string,
    callbacks: {
      onData: (data: string) => void;
      onExit: (exitCode: number) => void;
    },
  ): string | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    session.onData = callbacks.onData;
    session.onExit = callbacks.onExit;

    // 回放滚动缓冲
    return session.scrollback;
  }

  /** 添加额外输出监听器（与 WebSocket attach 解耦） */
  addDataTap(sessionId: string, listener: (data: string) => void): string | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const tapId = crypto.randomUUID();
    session.dataTaps.set(tapId, listener);
    return tapId;
  }

  /** 移除额外输出监听器 */
  removeDataTap(sessionId: string, tapId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.dataTaps.delete(tapId);
  }

  /** 分离监听器（WebSocket 断开时调用，但不销毁 PTY） */
  detach(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.onData = null;
    session.onExit = null;
  }

  /** 向 PTY 写入输入 */
  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.lastActivityAt = new Date().toISOString();
    this.resetIdleTimer(sessionId);
    session.process.write(data);
  }

  /** 调整终端尺寸 */
  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.process.resize(cols, rows);
    } catch {
      // PTY 进程可能已退出，忽略 resize 错误
    }
  }

  /** 销毁 PTY 会话 */
  destroy(sessionId: string, opts?: { emitExit?: boolean; exitCode?: number }): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const emitExit = opts?.emitExit ?? true;
    const exitCode = opts?.exitCode ?? -1;

    console.log(`[Terminal] 会话销毁: ${sessionId}`);

    if (emitExit) {
      try {
        session.onExit?.(exitCode);
      } catch (err) {
        console.warn(`[Terminal] 会话退出回调执行失败: ${(err as Error).message}`);
      }
    }

    this.cleanupSession(sessionId);
    try {
      session.process.kill();
    } catch {
      // 进程可能已退出
    }
  }

  /** 列出指定用户的所有会话 */
  listByUser(userId: string): SessionInfo[] {
    const result: SessionInfo[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        result.push({
          sessionId: session.id,
          shell: session.shell,
          createdAt: session.createdAt,
          lastActivityAt: session.lastActivityAt,
        });
      }
    }
    return result;
  }

  /** 验证会话归属 */
  isOwnedBy(sessionId: string, userId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.userId === userId;
  }

  /** 获取会话是否存在 */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** 获取总会话数 */
  get size(): number {
    return this.sessions.size;
  }

  /** 销毁所有会话（服务器关闭时调用） */
  destroyAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.destroy(sessionId);
    }
  }

  private resetIdleTimer(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }

    session.idleTimer = setTimeout(() => {
      console.log(`[Terminal] 会话空闲超时: ${sessionId}`);
      this.destroy(sessionId, { emitExit: true, exitCode: -1 });
    }, session.idleTimeoutMs);
  }

  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
    session.onData = null;
    session.dataTaps.clear();
    session.onExit = null;
    this.sessions.delete(sessionId);
  }
}

// 全局单例
export const ptyManager = new PtyManager();
