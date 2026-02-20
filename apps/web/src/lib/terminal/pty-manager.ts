// ============================================================
// PTY 会话池管理器
// 参考 SSEManager（src/lib/sse/manager.ts）的 Map 连接池模式
// 管理 node-pty 进程生命周期、空闲超时、输出缓冲
// ============================================================

import * as pty from 'node-pty';
import crypto from 'crypto';
import type { SessionInfo } from './protocol';

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
  /** 退出监听器 */
  onExit: ((exitCode: number) => void) | null;
}

const SCROLLBACK_LIMIT = 64 * 1024; // 64KB
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟
const MAX_SESSIONS_PER_USER = 5;

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
  }): { sessionId: string; shell: string } {
    // 用户会话数限制
    const userSessionCount = this.listByUser(opts.userId).length;
    if (userSessionCount >= MAX_SESSIONS_PER_USER) {
      throw new Error(`超过单用户最大会话数限制 (${MAX_SESSIONS_PER_USER})`);
    }

    const sessionId = crypto.randomUUID();

    // command 模式：直接 spawn 命令；否则 spawn shell
    // Windows 上 .cmd/.bat 文件无法被 CreateProcess 直接执行，需 cmd.exe /c 中转
    let file: string;
    let args: string[];
    if (opts.command) {
      if (process.platform === 'win32') {
        file = 'cmd.exe';
        args = ['/c', opts.command, ...(opts.args ?? [])];
      } else {
        file = opts.command;
        args = opts.args ?? [];
      }
    } else {
      file = opts.shell || detectDefaultShell();
      args = [];
    }
    const shell = opts.command || opts.shell || detectDefaultShell();
    const now = new Date().toISOString();

    const mergedEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...opts.env,
    };
    // 清除嵌套检测变量，允许 PTY 中启动 Claude Code CLI
    delete mergedEnv.CLAUDECODE;

    const cwd = opts.cwd || process.env.HOME || process.env.USERPROFILE || process.cwd();

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
    session.process.resize(cols, rows);
  }

  /** 销毁 PTY 会话 */
  destroy(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    console.log(`[Terminal] 会话销毁: ${sessionId}`);
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
      session.onExit?.(-1);
      this.destroy(sessionId);
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
    session.onExit = null;
    this.sessions.delete(sessionId);
  }
}

// 全局单例
export const ptyManager = new PtyManager();
