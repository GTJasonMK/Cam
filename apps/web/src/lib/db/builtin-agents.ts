// ============================================================
// 内置 Agent 定义（用于初始化/种子数据）
// ============================================================

export const BUILTIN_AGENTS = [
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    description: 'Anthropic CLI coding agent, supports --print non-interactive mode',
    dockerImage: 'cam-worker:claude-code',
    command: 'claude',
    args: ['--print', '--prompt', '{{prompt}}'],
    requiredEnvVars: [
      { name: 'ANTHROPIC_API_KEY', description: 'Anthropic API Key', required: true, sensitive: true },
    ],
    capabilities: {
      nonInteractive: true,
      autoGitCommit: false,
      outputSummary: false,
      promptFromFile: false,
    },
    defaultResourceLimits: { memoryLimitMb: 4096, timeoutMinutes: 120 },
    builtIn: true,
  },
  {
    id: 'codex',
    displayName: 'Codex CLI',
    description: 'OpenAI Codex CLI agent, full-auto approval mode',
    dockerImage: 'cam-worker:codex',
    command: 'codex',
    args: ['--approval-mode', 'full-auto', '{{prompt}}'],
    requiredEnvVars: [
      { name: 'OPENAI_API_KEY', description: 'OpenAI API Key', required: true, sensitive: true },
    ],
    capabilities: {
      nonInteractive: true,
      autoGitCommit: true,
      outputSummary: false,
      promptFromFile: false,
    },
    defaultResourceLimits: { memoryLimitMb: 4096, timeoutMinutes: 120 },
    builtIn: true,
  },
  {
    id: 'aider',
    displayName: 'Aider',
    description: 'AI pair programming in terminal, supports multiple LLM providers',
    dockerImage: 'cam-worker:aider',
    command: 'aider',
    args: ['--yes-always', '--no-auto-lint', '--message', '{{prompt}}'],
    requiredEnvVars: [
      { name: 'ANTHROPIC_API_KEY', description: 'Anthropic API Key', required: false, sensitive: true },
      { name: 'OPENAI_API_KEY', description: 'OpenAI API Key', required: false, sensitive: true },
    ],
    capabilities: {
      nonInteractive: true,
      autoGitCommit: true,
      outputSummary: false,
      promptFromFile: true,
    },
    defaultResourceLimits: { memoryLimitMb: 2048, timeoutMinutes: 60 },
    builtIn: true,
  },
];
