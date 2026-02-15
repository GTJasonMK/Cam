// ============================================================
// 调度判定纯函数
// 将调度核心决策抽离为可测试逻辑
// ============================================================

type DependencyTaskStatus = {
  id: string;
  status: string;
};

type RecoveryDecisionInput = {
  workerAlive: boolean;
  retryCount: number;
  maxRetries: number;
};

type StaleTaskDecisionInput = {
  status: string;
  retryCount: number;
  maxRetries: number;
} | null;

export function areDependenciesSatisfied(
  dependsOn: string[],
  depTasks: DependencyTaskStatus[]
): boolean {
  if (dependsOn.length === 0) return true;
  if (depTasks.length !== dependsOn.length) return false;

  const statusMap = new Map(depTasks.map((dep) => [dep.id, dep.status]));
  return dependsOn.every((depId) => statusMap.get(depId) === 'completed');
}

export function decideRecoveryAction(input: RecoveryDecisionInput): 'keep_running' | 'retry' | 'fail' {
  if (input.workerAlive) return 'keep_running';
  return input.retryCount < input.maxRetries ? 'retry' : 'fail';
}

export function decideStaleTaskAction(input: StaleTaskDecisionInput): 'skip' | 'retry' | 'fail' {
  if (!input) return 'skip';
  if (input.status !== 'running') return 'skip';
  return input.retryCount < input.maxRetries ? 'retry' : 'fail';
}

export function isWorkerAliveForTask(params: {
  worker:
    | {
        status: string;
        currentTaskId: string | null;
        lastHeartbeatAt: string | null;
      }
    | null
    | undefined;
  taskId: string;
  staleBeforeMs: number;
}): boolean {
  const { worker, taskId, staleBeforeMs } = params;
  if (!worker) return false;
  if (worker.status !== 'busy') return false;
  if (worker.currentTaskId !== taskId) return false;

  const heartbeatTs = Date.parse(worker.lastHeartbeatAt || '');
  if (!Number.isFinite(heartbeatTs)) return false;
  return heartbeatTs >= staleBeforeMs;
}
