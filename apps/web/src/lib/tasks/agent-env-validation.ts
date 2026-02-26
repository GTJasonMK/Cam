import { inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentDefinitions, workers } from '@/lib/db/schema';
import { normalizeAgentIds } from '@/lib/agents/normalize-agent-ids';
import { hasUsableSecretValue } from '@/lib/secrets/resolve';
import { isEnvVarPresent, normalizeTrimmedString } from '@/lib/validation/strings';
import { collectWorkerEnvVarsForAgent, type WorkerCapabilitySnapshot } from '@/lib/workers/capabilities';
import { getWorkerStaleTimeoutMs } from '@/lib/workers/stale-timeout';

type RequiredEnvVarSpec = {
  name: string;
  description?: string;
  required?: boolean;
};

export interface AgentEnvRequirement {
  id: string;
  displayName: string;
  requiredEnvVars: RequiredEnvVarSpec[];
}

export interface LoadAgentRequirementsResult {
  orderedAgentRequirements: AgentEnvRequirement[];
  missingAgentIds: string[];
}

export interface ValidateAgentRequiredEnvVarsResult {
  missingByAgentId: Map<string, string[]>;
  missingEnvVars: string[];
  firstMissingAgentDisplayName: string | null;
}

export async function loadAgentRequirements(agentIds: Iterable<string>): Promise<LoadAgentRequirementsResult> {
  const orderedIds = normalizeAgentIds(agentIds);
  if (orderedIds.length === 0) {
    return { orderedAgentRequirements: [], missingAgentIds: [] };
  }

  const rows = await db
    .select({
      id: agentDefinitions.id,
      displayName: agentDefinitions.displayName,
      requiredEnvVars: agentDefinitions.requiredEnvVars,
    })
    .from(agentDefinitions)
    .where(inArray(agentDefinitions.id, orderedIds));

  const requirementMap = new Map<string, AgentEnvRequirement>();
  for (const row of rows) {
    requirementMap.set(row.id, {
      id: row.id,
      displayName: row.displayName,
      requiredEnvVars: (row.requiredEnvVars as RequiredEnvVarSpec[]) || [],
    });
  }

  const orderedAgentRequirements = orderedIds
    .map((id) => requirementMap.get(id))
    .filter((item): item is AgentEnvRequirement => Boolean(item));
  const missingAgentIds = orderedIds.filter((id) => !requirementMap.has(id));

  return { orderedAgentRequirements, missingAgentIds };
}

function toWorkerSnapshots(rows: Array<{
  id: string;
  status: string;
  mode: string;
  lastHeartbeatAt: string | null;
  supportedAgentIds: unknown;
  reportedEnvVars: unknown;
}>): WorkerCapabilitySnapshot[] {
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    mode: row.mode,
    lastHeartbeatAt: row.lastHeartbeatAt,
    supportedAgentIds: (row.supportedAgentIds as string[]) || [],
    reportedEnvVars: (row.reportedEnvVars as string[]) || [],
  }));
}

export async function validateAgentRequiredEnvVars(input: {
  agentRequirements: AgentEnvRequirement[];
  repositoryId?: string | null;
  repoUrl?: string | null;
  staleTimeoutMs?: number;
}): Promise<ValidateAgentRequiredEnvVarsResult> {
  const rawMissingByAgent = new Map<string, string[]>();

  for (const requirement of input.agentRequirements) {
    const missing: string[] = [];
    const dedupeSet = new Set<string>();

    for (const spec of requirement.requiredEnvVars) {
      if (!spec?.required) continue;
      const name = normalizeTrimmedString(spec.name);
      if (!name || dedupeSet.has(name)) continue;
      dedupeSet.add(name);

      if (isEnvVarPresent(name)) continue;
      const hasSecret = await hasUsableSecretValue(name, {
        agentDefinitionId: requirement.id,
        repositoryId: input.repositoryId,
        repoUrl: input.repoUrl,
      });
      if (!hasSecret) missing.push(name);
    }

    if (missing.length > 0) {
      rawMissingByAgent.set(requirement.id, missing);
    }
  }

  if (rawMissingByAgent.size === 0) {
    return {
      missingByAgentId: new Map(),
      missingEnvVars: [],
      firstMissingAgentDisplayName: null,
    };
  }

  const workerRows = await db
    .select({
      id: workers.id,
      status: workers.status,
      mode: workers.mode,
      lastHeartbeatAt: workers.lastHeartbeatAt,
      supportedAgentIds: workers.supportedAgentIds,
      reportedEnvVars: workers.reportedEnvVars,
    })
    .from(workers);
  const snapshots = toWorkerSnapshots(workerRows);
  const nowMs = Date.now();
  const staleTimeoutMs = input.staleTimeoutMs ?? getWorkerStaleTimeoutMs();

  const missingByAgentId = new Map<string, string[]>();
  for (const requirement of input.agentRequirements) {
    const missing = rawMissingByAgent.get(requirement.id);
    if (!missing || missing.length === 0) continue;

    const availableOnWorkers = collectWorkerEnvVarsForAgent(snapshots, {
      agentDefinitionId: requirement.id,
      nowMs,
      staleTimeoutMs,
    });
    const uncovered = missing.filter((name) => !availableOnWorkers.has(name));
    if (uncovered.length > 0) {
      missingByAgentId.set(requirement.id, uncovered);
    }
  }

  const missingEnvVars: string[] = [];
  const dedupeVars = new Set<string>();
  let firstMissingAgentDisplayName: string | null = null;

  for (const requirement of input.agentRequirements) {
    const vars = missingByAgentId.get(requirement.id);
    if (!vars || vars.length === 0) continue;
    if (!firstMissingAgentDisplayName) {
      firstMissingAgentDisplayName = requirement.displayName;
    }
    for (const name of vars) {
      if (dedupeVars.has(name)) continue;
      dedupeVars.add(name);
      missingEnvVars.push(name);
    }
  }

  return { missingByAgentId, missingEnvVars, firstMissingAgentDisplayName };
}
