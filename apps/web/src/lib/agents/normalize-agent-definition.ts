import { resolveWorkerCliTemplate } from './cli-profiles.ts';

type AgentDefinitionExecutionShape = {
  id: string;
  command: string;
  args: unknown;
};

export function normalizeAgentDefinitionForExecution<T extends AgentDefinitionExecutionShape>(agent: T): T {
  const normalized = resolveWorkerCliTemplate(agent.id, {
    command: agent.command,
    args: Array.isArray(agent.args) ? agent.args : [],
  });

  return {
    ...agent,
    command: normalized.command,
    args: normalized.args,
  };
}
