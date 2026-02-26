import { db } from '@/lib/db';
import { agentDefinitions } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { normalizeOptionalString } from '@/lib/validation/strings';

type AgentReferenceSource = {
  agentDefinitionId?: string | null;
  pipelineSteps?: Array<{
    agentDefinitionId?: string;
    parallelAgents?: Array<{ agentDefinitionId?: string }>;
  }> | null;
};

/** 收集模板/流水线里引用到的全部 Agent ID（去重 + 去空白） */
export function collectReferencedAgentIds(source: AgentReferenceSource): string[] {
  const ids = new Set<string>();
  const rootAgentId = normalizeOptionalString(source.agentDefinitionId);
  if (rootAgentId) ids.add(rootAgentId);

  for (const step of source.pipelineSteps ?? []) {
    const stepAgentId = normalizeOptionalString(step.agentDefinitionId);
    if (stepAgentId) ids.add(stepAgentId);
    for (const node of step.parallelAgents ?? []) {
      const nodeAgentId = normalizeOptionalString(node.agentDefinitionId);
      if (nodeAgentId) ids.add(nodeAgentId);
    }
  }

  return Array.from(ids);
}

/** 返回不存在于数据库中的 Agent ID */
export async function findMissingAgentIds(agentIds: string[]): Promise<string[]> {
  if (agentIds.length === 0) return [];

  const rows = await db
    .select({ id: agentDefinitions.id })
    .from(agentDefinitions)
    .where(inArray(agentDefinitions.id, agentIds));
  const existingIds = new Set(rows.map((row) => row.id));
  return agentIds.filter((id) => !existingIds.has(id));
}
