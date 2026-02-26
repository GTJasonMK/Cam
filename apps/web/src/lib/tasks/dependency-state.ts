import { inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import {
  deriveDependencyReadiness,
  inspectTaskDependencies,
  type DependencyInspectionResult,
  type DependencyReadiness,
} from './dependency-inspection';

export async function loadTaskDependencyState(dependsOn: string[]): Promise<{
  depState: DependencyInspectionResult;
  readiness: DependencyReadiness;
}> {
  if (dependsOn.length === 0) {
    const depState = inspectTaskDependencies([], []);
    return {
      depState,
      readiness: deriveDependencyReadiness(depState),
    };
  }

  const depTasks = await db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(inArray(tasks.id, dependsOn));

  const depState = inspectTaskDependencies(dependsOn, depTasks);
  return {
    depState,
    readiness: deriveDependencyReadiness(depState),
  };
}
