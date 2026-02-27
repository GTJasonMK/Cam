// ============================================================
// 内置 Agent 定义（用于初始化/种子数据）
// ============================================================

import { resolveWorkerCliTemplate } from '../agents/cli-profiles';

const claudeWorkerTemplate = resolveWorkerCliTemplate('claude-code', {
  command: 'claude',
  args: ['--print', '--prompt', '{{prompt}}'],
});

const codexWorkerTemplate = resolveWorkerCliTemplate('codex', {
  command: 'codex',
  args: ['--quiet', '--full-auto', '{{prompt}}'],
});

export const BUILTIN_AGENTS = [
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    description: 'Anthropic CLI coding agent, supports --print non-interactive mode',
    dockerImage: 'cam-worker:claude-code',
    command: claudeWorkerTemplate.command,
    args: claudeWorkerTemplate.args,
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
    runtime: 'native',
  },
  {
    id: 'codex',
    displayName: 'Codex CLI',
    description: 'OpenAI Codex CLI agent, supports --full-auto and --quiet modes',
    dockerImage: 'cam-worker:codex',
    command: codexWorkerTemplate.command,
    args: codexWorkerTemplate.args,
    requiredEnvVars: [
      { name: 'CODEX_API_KEY', description: 'Codex API Key（优先）', required: false, sensitive: true },
      { name: 'OPENAI_API_KEY', description: 'OpenAI API Key（备选）', required: false, sensitive: true },
    ],
    capabilities: {
      nonInteractive: true,
      autoGitCommit: true,
      outputSummary: false,
      promptFromFile: false,
    },
    defaultResourceLimits: { memoryLimitMb: 4096, timeoutMinutes: 120 },
    builtIn: true,
    runtime: 'native',
  },
];
