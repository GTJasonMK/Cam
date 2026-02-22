// ============================================================
// Dashboard 数据查询
// 服务端共享查询函数，被 API route 和 Server Component 复用
// ============================================================

import { db } from '@/lib/db';
import { tasks, workers, systemEvents, agentDefinitions } from '@/lib/db/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { buildAgentStats, type AgentStatItem } from '@/lib/metrics/agent-stats';
import { getTaskDurationMs } from '@/lib/time/duration';
import { agentSessionManager } from '@/lib/terminal/agent-session-manager';
import type { AgentSessionStatus } from '@/lib/terminal/protocol';

export interface DashboardKpi {
  totalTasks: number;
  runningTasks: number;
  awaitingReview: number;
  completedTasks: number;
  failedTasks: number;
  queuedTasks: number;
}

export interface WorkerSummary {
  total: number;
  idle: number;
  busy: number;
  offline: number;
  draining: number;
}

export interface DurationSummary {
  completedAvgDurationMs: number | null;
  completedMaxDurationMs: number | null;
  activeAvgDurationMs: number | null;
  completedSampleCount: number;
  activeSampleCount: number;
}

export interface AgentSessionSummary {
  activeCount: number;
  totalToday: number;
  sessions: Array<{
    sessionId: string;
    agentDisplayName: string;
    status: AgentSessionStatus;
    elapsedMs: number;
    repoPath?: string;
  }>;
}

export interface DashboardData {
  kpi: DashboardKpi;
  workerSummary: WorkerSummary;
  workers: Array<Record<string, unknown>>;
  recentEvents: Array<Record<string, unknown>>;
  agentStats: AgentStatItem[];
  durationSummary: DurationSummary;
  taskStatuses: Record<string, string>;
  agentSessionSummary: AgentSessionSummary;
}

/** 耗时统计样本上限（取最近 N 条，避免全表计算） */
const DURATION_SAMPLE_LIMIT = 500;
/** 仪表盘任务统计口径：与任务页保持一致，仅统计调度任务 */
const DASHBOARD_TASK_SOURCE = 'scheduler' as const;

export async function fetchDashboardData(): Promise<DashboardData> {
  // 并行执行所有数据库查询
  const [taskStats, workerStats, recentEvents, allWorkers, taskSummaries, durationTasks, agentDefs] = await Promise.all([
    // 任务状态聚合（SQL 层 GROUP BY，极快）
    db
      .select({ status: tasks.status, count: sql<number>`cast(count(*) as integer)` })
      .from(tasks)
      .where(eq(tasks.source, DASHBOARD_TASK_SOURCE))
      .groupBy(tasks.status),
    // Worker 状态聚合
    db
      .select({ status: workers.status, count: sql<number>`cast(count(*) as integer)` })
      .from(workers)
      .groupBy(workers.status),
    // 最近事件（已有 LIMIT）
    db
      .select()
      .from(systemEvents)
      .orderBy(desc(systemEvents.timestamp))
      .limit(20),
    // Worker 列表：仅选择 Dashboard 需要的列（排除 logTail、reportedEnvVars 等大字段）
    db
      .select({
        id: workers.id,
        name: workers.name,
        supportedAgentIds: workers.supportedAgentIds,
        status: workers.status,
        currentTaskId: workers.currentTaskId,
        lastHeartbeatAt: workers.lastHeartbeatAt,
        cpuUsage: workers.cpuUsage,
        memoryUsageMb: workers.memoryUsageMb,
        diskUsageMb: workers.diskUsageMb,
        totalTasksCompleted: workers.totalTasksCompleted,
        totalTasksFailed: workers.totalTasksFailed,
        uptimeSince: workers.uptimeSince,
      })
      .from(workers),
    // 任务汇总：仅 id + status + agentDefinitionId（用于 taskStatuses 映射 + agentStats）
    db
      .select({
        id: tasks.id,
        status: tasks.status,
        agentDefinitionId: tasks.agentDefinitionId,
        startedAt: tasks.startedAt,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .where(eq(tasks.source, DASHBOARD_TASK_SOURCE)),
    // 耗时统计样本：仅取最近 N 条有时间戳的任务
    db
      .select({
        status: tasks.status,
        startedAt: tasks.startedAt,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .where(and(
        eq(tasks.source, DASHBOARD_TASK_SOURCE),
        inArray(tasks.status, ['completed', 'running', 'awaiting_review']),
      ))
      .orderBy(desc(tasks.startedAt))
      .limit(DURATION_SAMPLE_LIMIT),
    // Agent 定义
    db
      .select({ id: agentDefinitions.id, displayName: agentDefinitions.displayName })
      .from(agentDefinitions),
  ]);

  // 汇总任务计数
  const taskCountMap: Record<string, number> = {};
  for (const row of taskStats) {
    taskCountMap[row.status] = row.count;
  }

  // 汇总 Worker 计数
  const workerCountMap: Record<string, number> = {};
  for (const row of workerStats) {
    workerCountMap[row.status] = row.count;
  }

  // 任务状态映射
  const taskStatuses: Record<string, string> = {};
  for (const task of taskSummaries) {
    taskStatuses[task.id] = task.status;
  }

  // Agent 统计
  const agentStats = buildAgentStats(taskSummaries, agentDefs);

  // 耗时统计（仅对采样子集计算）
  let completedDurationCount = 0;
  let completedDurationSumMs = 0;
  let completedMaxDurationMs = 0;
  let activeDurationCount = 0;
  let activeDurationSumMs = 0;
  const nowMs = Date.now();

  for (const task of durationTasks) {
    if (task.status === 'completed') {
      const durationMs = getTaskDurationMs(task, { requireCompleted: true });
      if (durationMs === null) continue;
      completedDurationCount += 1;
      completedDurationSumMs += durationMs;
      if (durationMs > completedMaxDurationMs) {
        completedMaxDurationMs = durationMs;
      }
      continue;
    }

    if (task.status === 'running' || task.status === 'awaiting_review') {
      const durationMs = getTaskDurationMs(task, { nowMs });
      if (durationMs === null) continue;
      activeDurationCount += 1;
      activeDurationSumMs += durationMs;
    }
  }

  // Agent 会话摘要（从内存读取，无 DB 查询）
  const allAgentSessions = agentSessionManager.getSessionSummaries();
  const activeAgentSessions = allAgentSessions.filter((s) => s.status === 'running');

  return {
    kpi: {
      totalTasks: Object.values(taskCountMap).reduce((a, b) => a + b, 0),
      runningTasks: taskCountMap['running'] || 0,
      awaitingReview: taskCountMap['awaiting_review'] || 0,
      completedTasks: taskCountMap['completed'] || 0,
      failedTasks: taskCountMap['failed'] || 0,
      queuedTasks: taskCountMap['queued'] || 0,
    },
    workerSummary: {
      total: Object.values(workerCountMap).reduce((a, b) => a + b, 0),
      idle: workerCountMap['idle'] || 0,
      busy: workerCountMap['busy'] || 0,
      offline: workerCountMap['offline'] || 0,
      draining: workerCountMap['draining'] || 0,
    },
    workers: allWorkers as Array<Record<string, unknown>>,
    recentEvents: recentEvents as Array<Record<string, unknown>>,
    agentStats,
    durationSummary: {
      completedAvgDurationMs:
        completedDurationCount > 0 ? Math.round(completedDurationSumMs / completedDurationCount) : null,
      completedMaxDurationMs: completedDurationCount > 0 ? completedMaxDurationMs : null,
      activeAvgDurationMs: activeDurationCount > 0 ? Math.round(activeDurationSumMs / activeDurationCount) : null,
      completedSampleCount: completedDurationCount,
      activeSampleCount: activeDurationCount,
    },
    taskStatuses,
    agentSessionSummary: {
      activeCount: activeAgentSessions.length,
      totalToday: allAgentSessions.length,
      sessions: activeAgentSessions.slice(0, 5),
    },
  };
}
