export interface DependencyTaskStatus {
  id: string;
  status: string;
}

export interface DependencyInspectionResult {
  allCompleted: boolean;
  missingDepIds: string[];
  terminalDeps: Array<{ id: string; status: string }>;
}

export type DependencyReadiness = 'ready' | 'blocked' | 'pending';

export function inspectTaskDependencies(
  dependsOn: string[],
  depTasks: DependencyTaskStatus[],
): DependencyInspectionResult {
  if (dependsOn.length === 0) {
    return { allCompleted: true, missingDepIds: [], terminalDeps: [] };
  }

  const statusMap = new Map(depTasks.map((dep) => [dep.id, dep.status]));
  const missingDepIds = dependsOn.filter((depId) => !statusMap.has(depId));
  const terminalDeps = dependsOn
    .map((depId) => ({ id: depId, status: statusMap.get(depId) }))
    .filter(
      (item): item is { id: string; status: string } =>
        item.status === 'failed' || item.status === 'cancelled',
    );
  const allCompleted =
    missingDepIds.length === 0
    && dependsOn.every((depId) => statusMap.get(depId) === 'completed');

  return { allCompleted, missingDepIds, terminalDeps };
}

export function deriveDependencyReadiness(depState: DependencyInspectionResult): DependencyReadiness {
  if (depState.missingDepIds.length > 0 || depState.terminalDeps.length > 0) {
    return 'blocked';
  }
  if (depState.allCompleted) {
    return 'ready';
  }
  return 'pending';
}

export function buildDependencyBlockedSummary(depState: DependencyInspectionResult): string {
  const blockedReasonParts: string[] = [];
  if (depState.missingDepIds.length > 0) {
    blockedReasonParts.push(`missing=[${depState.missingDepIds.join(', ')}]`);
  }
  if (depState.terminalDeps.length > 0) {
    blockedReasonParts.push(
      `terminal=[${depState.terminalDeps.map((item) => `${item.id}:${item.status}`).join(', ')}]`,
    );
  }
  return `Blocked by unsatisfied dependencies: ${blockedReasonParts.join('; ')}`;
}
