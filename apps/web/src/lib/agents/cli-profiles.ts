// ============================================================
// Agent CLI 参数档案（跨执行上下文复用）
// - worker: 使用模板参数（含 {{prompt}} 占位符）
// - terminal: 使用真实 prompt 构建交互/自动退出参数
// - settings: 使用统一 CLI 元信息（命令与包名）
// ============================================================

export type KnownCliAgentId = 'claude-code' | 'codex' | 'aider';
export type DeployableCliAgentId = 'claude-code' | 'codex';
export type PromptArgBuilder = (prompt: string) => string[];

export interface AgentCliProfile {
  label: string;
  command: string;
  workerArgsTemplate: string[];
  terminalInteractiveArgs: PromptArgBuilder;
  terminalAutoExitArgs: PromptArgBuilder;
}

export interface DeployableCliConfig {
  id: DeployableCliAgentId;
  label: string;
  command: string;
  packageName: string;
}

const AGENT_CLI_PROFILES: Record<KnownCliAgentId, AgentCliProfile> = {
  'claude-code': {
    label: 'Claude Code',
    command: 'claude',
    workerArgsTemplate: ['--print', '--prompt', '{{prompt}}'],
    terminalInteractiveArgs: (prompt) => [prompt],
    terminalAutoExitArgs: (prompt) => ['-p', prompt],
  },
  codex: {
    label: 'Codex CLI',
    command: 'codex',
    workerArgsTemplate: ['--quiet', '--full-auto', '{{prompt}}'],
    terminalInteractiveArgs: (prompt) => ['--full-auto', prompt],
    terminalAutoExitArgs: (prompt) => ['exec', '--full-auto', prompt],
  },
  aider: {
    label: 'Aider',
    command: 'aider',
    workerArgsTemplate: ['--yes-always', '--message', '{{prompt}}'],
    terminalInteractiveArgs: (prompt) => ['--message', prompt],
    terminalAutoExitArgs: (prompt) => ['--yes-always', '--message', prompt],
  },
};

export const DEPLOYABLE_CLI_CONFIGS: DeployableCliConfig[] = [
  {
    id: 'claude-code',
    label: AGENT_CLI_PROFILES['claude-code'].label,
    command: AGENT_CLI_PROFILES['claude-code'].command,
    packageName: '@anthropic-ai/claude-code',
  },
  {
    id: 'codex',
    label: AGENT_CLI_PROFILES.codex.label,
    command: AGENT_CLI_PROFILES.codex.command,
    packageName: '@openai/codex',
  },
];

export function resolveKnownAgentId(agentDefinitionId: string): KnownCliAgentId | null {
  return agentDefinitionId in AGENT_CLI_PROFILES
    ? (agentDefinitionId as KnownCliAgentId)
    : null;
}

function cloneArgs(args: string[]): string[] {
  return [...args];
}

export function isCodexCliAgent(agentDefinitionId: string): boolean {
  return agentDefinitionId === 'codex';
}

export function resolveWorkerCliTemplate(
  agentDefinitionId: string,
  fallback: { command: string; args: string[] },
): { command: string; args: string[] } {
  const known = resolveKnownAgentId(agentDefinitionId);
  if (!known) {
    return { command: fallback.command, args: cloneArgs(fallback.args) };
  }
  const profile = AGENT_CLI_PROFILES[known];
  return {
    command: profile.command,
    args: cloneArgs(profile.workerArgsTemplate),
  };
}

export function getTerminalInteractiveArgs(
  agentDefinitionId: string,
  prompt: string,
): string[] {
  const known = resolveKnownAgentId(agentDefinitionId);
  if (!known) {
    return [prompt];
  }
  return AGENT_CLI_PROFILES[known].terminalInteractiveArgs(prompt);
}

export function getTerminalAutoExitArgs(
  agentDefinitionId: string,
  prompt: string,
): string[] | null {
  const known = resolveKnownAgentId(agentDefinitionId);
  if (!known) {
    return null;
  }
  return AGENT_CLI_PROFILES[known].terminalAutoExitArgs(prompt);
}
