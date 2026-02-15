// ============================================================
// Worker: 执行节点模型
// ============================================================

export const WORKER_STATUSES = [
  'idle',
  'busy',
  'offline',
  'draining',
] as const;

export type WorkerStatus = (typeof WORKER_STATUSES)[number];

export interface Worker {
  id: string;
  name: string;

  supportedAgentIds: string[];
  maxConcurrent: number;

  status: WorkerStatus;
  currentTaskId?: string | null;

  lastHeartbeatAt: string;

  cpuUsage?: number | null;
  memoryUsageMb?: number | null;
  diskUsageMb?: number | null;

  totalTasksCompleted: number;
  totalTasksFailed: number;
  uptimeSince: string;

  createdAt: string;
}

/** Worker 心跳上报的请求体 */
export interface WorkerHeartbeatInput {
  status: WorkerStatus;
  currentTaskId?: string | null;
  cpuUsage?: number;
  memoryUsageMb?: number;
  diskUsageMb?: number;
  /** 最近的日志片段（最多 50 行） */
  logTail?: string;
}

/** Worker 注册的请求体 */
export interface WorkerRegisterInput {
  name: string;
  supportedAgentIds: string[];
  maxConcurrent?: number;
}
