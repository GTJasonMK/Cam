// ============================================================
// Task: 任务模型
// ============================================================

export const TASK_STATUSES = [
  'draft',
  'queued',
  'waiting',
  'running',
  'awaiting_review',
  'approved',
  'completed',
  'rejected',
  'failed',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
  id: string;
  title: string;
  description: string;

  agentDefinitionId: string;
  repoUrl: string;
  baseBranch: string;
  workBranch: string;
  workDir?: string | null;

  status: TaskStatus;
  retryCount: number;
  maxRetries: number;

  dependsOn: string[];
  groupId?: string | null;

  assignedWorkerId?: string | null;
  prUrl?: string | null;
  summary?: string | null;
  logFileUrl?: string | null;

  reviewComment?: string | null;
  reviewedAt?: string | null;

  createdAt: string;
  queuedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;

  feedback?: string | null;
}

/** 创建任务的请求体 */
export interface TaskCreateInput {
  title: string;
  description: string;
  agentDefinitionId: string;
  repoUrl: string;
  baseBranch?: string;
  workDir?: string;
  maxRetries?: number;
  dependsOn?: string[];
  groupId?: string;
}

/** 审批操作的请求体 */
export interface TaskReviewInput {
  action: 'approve' | 'reject';
  comment?: string;
  feedback?: string;
}
