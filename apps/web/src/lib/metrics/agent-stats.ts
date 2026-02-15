// ============================================================
// Agent 统计聚合
// 为 Dashboard 计算每个 Agent 的执行规模、成功率、平均耗时
// ============================================================

type AgentDefinitionLite = {
  id: string;
  displayName: string;
};

type TaskLite = {
  agentDefinitionId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type AgentStatItem = {
  agentDefinitionId: string;
  displayName: string;
  total: number;
  completed: number;
  failed: number;
  successRate: number | null;
  avgDurationMs: number | null;
};

function parseTimeMs(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function toOneDecimal(input: number): number {
  return Math.round(input * 10) / 10;
}

export function buildAgentStats(
  tasks: TaskLite[],
  agents: AgentDefinitionLite[]
): AgentStatItem[] {
  type Acc = {
    agentDefinitionId: string;
    displayName: string;
    total: number;
    completed: number;
    failed: number;
    durationSumMs: number;
    durationCount: number;
  };

  const displayNameById = new Map(agents.map((agent) => [agent.id, agent.displayName]));
  const accMap = new Map<string, Acc>();

  for (const task of tasks) {
    const agentId = task.agentDefinitionId;
    if (!agentId) continue;

    const existing = accMap.get(agentId) || {
      agentDefinitionId: agentId,
      displayName: displayNameById.get(agentId) || agentId,
      total: 0,
      completed: 0,
      failed: 0,
      durationSumMs: 0,
      durationCount: 0,
    };

    existing.total += 1;
    if (task.status === 'completed') {
      existing.completed += 1;
    } else if (task.status === 'failed') {
      existing.failed += 1;
    }

    if (task.status === 'completed') {
      const startMs = parseTimeMs(task.startedAt);
      const endMs = parseTimeMs(task.completedAt);
      if (startMs !== null && endMs !== null && endMs >= startMs) {
        existing.durationSumMs += endMs - startMs;
        existing.durationCount += 1;
      }
    }

    accMap.set(agentId, existing);
  }

  const rows: AgentStatItem[] = [];
  for (const acc of accMap.values()) {
    const doneBase = acc.completed + acc.failed;
    rows.push({
      agentDefinitionId: acc.agentDefinitionId,
      displayName: acc.displayName,
      total: acc.total,
      completed: acc.completed,
      failed: acc.failed,
      successRate: doneBase > 0 ? toOneDecimal((acc.completed / doneBase) * 100) : null,
      avgDurationMs: acc.durationCount > 0 ? Math.round(acc.durationSumMs / acc.durationCount) : null,
    });
  }

  return rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.displayName.localeCompare(b.displayName);
  });
}
