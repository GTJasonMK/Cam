// ============================================================
// Worker 能力解析（不包含任何密钥值，仅用于判断“是否存在”）
// ============================================================

export type WorkerCapabilitySnapshot = {
  id: string;
  status: string;
  mode: string;
  lastHeartbeatAt: string | null;
  supportedAgentIds: string[] | null;
  reportedEnvVars: string[] | null;
};

function parseIsoMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function isEligibleCapabilityWorker(
  worker: WorkerCapabilitySnapshot,
  input: {
    nowMs: number;
    staleTimeoutMs: number;
    allowedStatuses?: string[];
    requiredMode?: string;
  }
): boolean {
  const allowedStatuses = input.allowedStatuses ?? ['idle', 'busy'];
  if (!allowedStatuses.includes(worker.status)) return false;

  const requiredMode = input.requiredMode ?? 'daemon';
  if (worker.mode !== requiredMode) return false;

  const hbMs = parseIsoMs(worker.lastHeartbeatAt);
  if (hbMs === null) return false;
  return hbMs >= input.nowMs - input.staleTimeoutMs;
}

export function workerSupportsAgent(worker: WorkerCapabilitySnapshot, agentDefinitionId: string): boolean {
  const supported = Array.isArray(worker.supportedAgentIds) ? worker.supportedAgentIds : [];
  // 空数组表示“支持全部”（与 /api/workers/[id]/next-task 的逻辑一致）
  if (supported.length === 0) return true;
  return supported.includes(agentDefinitionId);
}

export function collectWorkerEnvVarsForAgent(
  workers: WorkerCapabilitySnapshot[],
  input: { agentDefinitionId: string; nowMs: number; staleTimeoutMs: number }
): Set<string> {
  const out = new Set<string>();

  for (const worker of workers) {
    if (
      !isEligibleCapabilityWorker(worker, {
        nowMs: input.nowMs,
        staleTimeoutMs: input.staleTimeoutMs,
      })
    ) {
      continue;
    }
    if (!workerSupportsAgent(worker, input.agentDefinitionId)) continue;

    const vars = Array.isArray(worker.reportedEnvVars) ? worker.reportedEnvVars : [];
    for (const name of vars) {
      if (typeof name === 'string' && name.trim()) out.add(name.trim());
    }
  }

  return out;
}

