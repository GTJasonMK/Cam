// ============================================================
// Agent 命令解析
// 返回结构化的 { file, args }，由 PTY 直接 spawn
// 不再拼 shell 字符串、不再需要 cd / shell 转义
// ============================================================

import {
  getTerminalAutoExitArgs,
  getTerminalInteractiveArgs,
  isCodexCliAgent,
} from '../agents/cli-profiles.ts';

/** 结构化命令（直接传给 pty.spawn） */
export interface AgentCommandSpec {
  /** 可执行文件名（如 claude, codex, aider） */
  file: string;
  /** 命令参数数组（无需 shell 转义） */
  args: string[];
}

export interface ResolveCommandOpts {
  /** Agent 定义 ID（如 claude-code, codex, aider） */
  agentDefinitionId: string;
  /** Agent 可执行命令（如 claude, codex, aider） */
  command: string;
  /** 用户输入的 Prompt（可为空） */
  prompt: string;
  /** 会话模式 */
  mode: 'create' | 'resume' | 'continue';
  /** mode='resume' 时：要恢复的 Claude Code 会话 ID */
  resumeSessionId?: string;
  /** 流水线步骤：使用非交互模式，执行完自动退出 */
  autoExit?: boolean;
}

/**
 * 解析 Agent 启动命令（结构化，直接用于 pty.spawn）
 *
 * Claude Code:
 *   create:       claude ["prompt"]
 *   create+auto:  claude -p "prompt"  （非交互，执行完退出）
 *   resume:       claude --resume {sessionId} ["prompt"]
 *   continue:     claude --continue ["prompt"]
 *
 * Codex:
 *   create:       codex --full-auto ["prompt"]
 *   create+auto:  codex exec --full-auto "prompt"  （非交互，执行完退出）
 *   resume:       codex resume {sessionId} [--full-auto] ["prompt"] | codex resume --last [--full-auto] ["prompt"]
 */
export function resolveAgentCommand(opts: ResolveCommandOpts): AgentCommandSpec {
  const { agentDefinitionId, command, prompt, mode, resumeSessionId, autoExit } = opts;

  // ---- Codex 特殊处理 ----
  // Codex CLI 的 resume 是子命令：codex resume <sessionId> 或 codex resume --last
  if (isCodexCliAgent(agentDefinitionId)) {
    if (mode === 'resume' || mode === 'continue') {
      const args = ['resume', resumeSessionId || '--last'];
      // 流水线场景下优先自动执行，避免进入交互等待
      if (autoExit) {
        args.push('--full-auto');
      }
      if (prompt) {
        args.push(prompt);
      }
      return { file: command, args };
    }
    if (!prompt) {
      return { file: command, args: ['--full-auto'] };
    }
    // autoExit 模式：使用 exec 子命令
    if (autoExit) {
      const args = getTerminalAutoExitArgs(agentDefinitionId, prompt);
      return { file: command, args: args || ['exec', '--full-auto', prompt] };
    }
    return { file: command, args: getTerminalInteractiveArgs(agentDefinitionId, prompt) };
  }

  // ---- Claude Code / Aider / 其他 Agent ----

  // resume 模式
  if (mode === 'resume' && resumeSessionId) {
    const args = ['--resume', resumeSessionId];
    if (prompt) args.push(prompt);
    return { file: command, args };
  }

  // continue 模式
  if (mode === 'continue') {
    const args = ['--continue'];
    if (prompt) args.push(prompt);
    return { file: command, args };
  }

  // create 模式
  if (!prompt) {
    return { file: command, args: [] };
  }

  // autoExit 模式：使用非交互参数
  if (autoExit) {
    const args = getTerminalAutoExitArgs(agentDefinitionId, prompt);
    if (args) {
      return { file: command, args };
    }
  }

  return { file: command, args: getTerminalInteractiveArgs(agentDefinitionId, prompt) };
}

/**
 * 生成工作分支名
 * 格式：cam/vibe-{sessionId前8位}
 */
export function generateWorkBranch(sessionId: string): string {
  return `cam/vibe-${sessionId.slice(0, 8)}`;
}
