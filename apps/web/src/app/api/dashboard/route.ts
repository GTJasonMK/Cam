// ============================================================
// API: Dashboard 数据
// GET /api/dashboard  - 获取仪表盘汇总数据
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, workers, systemEvents, agentDefinitions } from '@/lib/db/schema';
import { desc, sql } from 'drizzle-orm';
import { buildAgentStats } from '@/lib/metrics/agent-stats';
import { getTaskDurationMs } from '@/lib/time/duration';
import { API_COMMON_MESSAGES } from '@/lib/i18n/messages';

import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';

export async function GET() {
  ensureSchedulerStarted();
  try {
    // 任务统计
    const taskStats = await db
      .select({
        status: tasks.status,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(tasks)
      .groupBy(tasks.status);

    // Worker 统计
    const workerStats = await db
      .select({
        status: workers.status,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(workers)
      .groupBy(workers.status);

    // 最近事件
    const recentEvents = await db
      .select()
      .from(systemEvents)
      .orderBy(desc(systemEvents.timestamp))
      .limit(20);

    // 所有 Worker 列表
    const allWorkers = await db.select().from(workers);
    const allTaskStatuses = await db
      .select({
        id: tasks.id,
        status: tasks.status,
        agentDefinitionId: tasks.agentDefinitionId,
        startedAt: tasks.startedAt,
        completedAt: tasks.completedAt,
      })
      .from(tasks);
    const agentDefs = await db
      .select({ id: agentDefinitions.id, displayName: agentDefinitions.displayName })
      .from(agentDefinitions);

    // 汇总
    const taskCountMap: Record<string, number> = {};
    for (const row of taskStats) {
      taskCountMap[row.status] = row.count;
    }

    const workerCountMap: Record<string, number> = {};
    for (const row of workerStats) {
      workerCountMap[row.status] = row.count;
    }
    const taskStatuses: Record<string, string> = {};
    for (const task of allTaskStatuses) {
      taskStatuses[task.id] = task.status;
    }
    const agentStats = buildAgentStats(allTaskStatuses, agentDefs);

    let completedDurationCount = 0;
    let completedDurationSumMs = 0;
    let completedMaxDurationMs = 0;
    let activeDurationCount = 0;
    let activeDurationSumMs = 0;
    const nowMs = Date.now();

    for (const task of allTaskStatuses) {
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

    const durationSummary = {
      completedAvgDurationMs:
        completedDurationCount > 0 ? Math.round(completedDurationSumMs / completedDurationCount) : null,
      completedMaxDurationMs: completedDurationCount > 0 ? completedMaxDurationMs : null,
      activeAvgDurationMs: activeDurationCount > 0 ? Math.round(activeDurationSumMs / activeDurationCount) : null,
      completedSampleCount: completedDurationCount,
      activeSampleCount: activeDurationCount,
    };

    return NextResponse.json({
      success: true,
      data: {
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
        workers: allWorkers,
        recentEvents,
        agentStats,
        durationSummary,
        taskStatuses,
      },
    });
  } catch (err) {
    console.error('[API] Dashboard 数据获取失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.dataFetchFailed } },
      { status: 500 }
    );
  }
}
