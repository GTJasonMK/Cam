export interface DependencyGraphNode {
  id: string;
  dependsOn: string[];
}

export function buildDependentsMap(rows: DependencyGraphNode[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    for (const dep of row.dependsOn || []) {
      const list = map.get(dep) || [];
      list.push(row.id);
      map.set(dep, list);
    }
  }
  return map;
}

export function computeDependencyClosure(
  fromTaskId: string,
  dependents: Map<string, string[]>,
  canVisit?: (taskId: string) => boolean,
): Set<string> {
  const visited = new Set<string>([fromTaskId]);
  const queue: string[] = [fromTaskId];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const next = dependents.get(current) || [];
    for (const taskId of next) {
      if (visited.has(taskId)) continue;
      if (canVisit && !canVisit(taskId)) continue;
      visited.add(taskId);
      queue.push(taskId);
    }
  }

  return visited;
}
