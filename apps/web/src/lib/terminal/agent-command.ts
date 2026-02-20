// ============================================================
// Agent 命令解析
// 返回结构化的 { file, args }，由 PTY 直接 spawn
// 不再拼 shell 字符串、不再需要 cd / shell 转义
// ============================================================

/**
 * 交互模式参数映射
 * claude CLI：位置参数 `claude "query"`
 * codex CLI：`codex "query"`
 * aider CLI：`aider --message "query"`
 */
const INTERACTIVE_ARGS: Record<string, (prompt: string) => string[]> = {
  'claude-code': (prompt) => [prompt],
  'codex': (prompt) => [prompt],
  'aider': (prompt) => ['--message', prompt],
};

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
}

/**
 * 解析 Agent 启动命令（结构化，直接用于 pty.spawn）
 *
 * mode='create':   {command} ["prompt"]
 * mode='resume':   {command} --resume {sessionId} ["prompt"]
 * mode='continue': {command} --continue ["prompt"]
 */
export function resolveAgentCommand(opts: ResolveCommandOpts): AgentCommandSpec {
  const { agentDefinitionId, command, prompt, mode, resumeSessionId } = opts;

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

  const builder = INTERACTIVE_ARGS[agentDefinitionId];
  const args = builder ? builder(prompt) : [prompt];
  return { file: command, args };
}

/**
 * 生成工作分支名
 * 格式：cam/vibe-{sessionId前8位}
 */
export function generateWorkBranch(sessionId: string): string {
  return `cam/vibe-${sessionId.slice(0, 8)}`;
}
