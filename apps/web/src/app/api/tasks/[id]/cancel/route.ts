// ============================================================
// API: Task 取消/停止
// POST /api/tasks/[id]/cancel  - 取消 queued 任务或停止 running 任务
// ============================================================

import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { API_COMMON_MESSAGES, TASK_MESSAGES } from '@/lib/i18n/messages';
import { resolveAuditActor } from '@/lib/audit/actor';
import { writeSystemEvent } from '@/lib/audit/system-event';
import { emitTaskCancelled } from '@/lib/tasks/task-events';
import { cancelTaskBySnapshot, cancelTasksByIds, isTaskTerminalStatus } from '@/lib/tasks/lifecycle';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { agentSessionManager } from '@/lib/terminal/agent-session-manager';
import { stopTaskContainers } from '@/lib/docker/task-containers';
import { buildDependentsMap, computeDependencyClosure } from '@/lib/tasks/dependency-graph';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { apiConflict, apiInternalError, apiNotFound, apiSuccess } from '@/lib/http/api-response';

type TaskDependencyRow = {
  id: string;
  status: string;
  dependsOn: string[];
};

function computeCancellableDependencyClosure(
  rootTaskId: string,
  rows: TaskDependencyRow[],
): string[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const dependents = buildDependentsMap(rows);

  const closure = computeDependencyClosure(
    rootTaskId,
    dependents,
    (dependentTaskId) => {
      const dependentTask = byId.get(dependentTaskId);
      if (!dependentTask) return false;
      // 仅对“尚未执行”的下游任务级联取消，避免误伤正在执行/已完成结果。
      return dependentTask.status === 'queued' || dependentTask.status === 'waiting';
    },
  );

  return Array.from(closure).filter((taskId) => taskId !== rootTaskId);
}

async function handler(request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const actor = resolveAuditActor(request);
    const body = await readJsonBodyAsRecord(request);
    const reason = typeof body.reason === 'string' ? body.reason : null;

    const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (existing.length === 0) {
      return apiNotFound(TASK_MESSAGES.notFound(id));
    }

    const currentTask = existing[0];
    let pipelineCancelRequested = false;
    let cancelledPipelineId: string | null = null;
    let terminalCancelRequested = false;
    let cascadedCancelledTaskIds: string[] = [];

    // 终态任务：直接返回成功（幂等）
    if (isTaskTerminalStatus(currentTask.status)) {
      return apiSuccess(currentTask);
    }

    const previousStatus = currentTask.status;
    const now = new Date().toISOString();

    const cancelledTask = await cancelTaskBySnapshot({
      taskId: id,
      expectedStatus: previousStatus,
      cancelledAt: now,
    });
    if (!cancelledTask) {
      const latest = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
      if (latest.length === 0) {
        return apiNotFound(TASK_MESSAGES.notFound(id));
      }

      const latestTask = latest[0];
      // 若已进入终态，视为取消请求幂等成功，避免前端重复点击出现误报。
      if (isTaskTerminalStatus(latestTask.status)) {
        return apiSuccess(latestTask);
      }

      return apiConflict(`任务状态已从 ${previousStatus} 变为 ${latestTask.status}，请刷新后重试`);
    }

    if (currentTask.source === 'terminal') {
      const maybePipelineId = typeof currentTask.groupId === 'string' ? currentTask.groupId : '';
      if (maybePipelineId.startsWith('pipeline/')) {
        const pipeline = agentSessionManager.getPipeline(maybePipelineId);
        if (pipeline && (pipeline.status === 'running' || pipeline.status === 'paused')) {
          agentSessionManager.cancelPipeline(maybePipelineId);
          pipelineCancelRequested = true;
          cancelledPipelineId = maybePipelineId;
        }
      }

      if (!pipelineCancelRequested) {
        terminalCancelRequested = agentSessionManager.cancelAgentSessionByTaskId(id);
      }
    }

    // 调度任务取消后：级联取消依赖闭包中的 waiting/queued 下游任务，
    // 避免它们因依赖永远无法 completed 而长期卡死。
    if (currentTask.source === 'scheduler') {
      const dependencyRows = await db
        .select({
          id: tasks.id,
          status: tasks.status,
          dependsOn: tasks.dependsOn,
        })
        .from(tasks)
        .where(eq(tasks.source, 'scheduler')) as unknown as TaskDependencyRow[];

      const closureIds = computeCancellableDependencyClosure(id, dependencyRows);
      if (closureIds.length > 0) {
        cascadedCancelledTaskIds = await cancelTasksByIds({
          taskIds: closureIds,
          cancellableStatuses: ['queued', 'waiting'],
          cancelledAt: now,
        });

        for (const cascadedTaskId of cascadedCancelledTaskIds) {
          await emitTaskCancelled({
            taskId: cascadedTaskId,
            actor,
            eventPayload: {
              previousStatus: 'waiting_or_queued',
              reason: 'dependency_upstream_cancelled',
              cascadeFromTaskId: id,
            },
            cancelledBroadcastPayload: {
              cascadeFromTaskId: id,
            },
          });
        }
      }
    }

    // 记录系统事件 + SSE
    await emitTaskCancelled({
      taskId: id,
      actor,
      eventPayload: {
        previousStatus,
        reason,
        terminalCancelRequested,
        pipelineCancelRequested,
        cancelledPipelineId,
        cascadedCancelledTaskIds,
      },
    });

    // best-effort：尝试停止与该任务相关的容器（容器模式下会立刻中止执行）
    try {
      const stopped = await stopTaskContainers(id);
      if (stopped > 0) {
        await writeSystemEvent({
          type: 'task.stop_requested',
          actor,
          payload: { taskId: id, stoppedContainers: stopped },
        });
      }
    } catch (err) {
      await writeSystemEvent({
        type: 'task.stop_failed',
        actor,
        payload: { taskId: id, error: (err as Error).message },
      });
    }

    return apiSuccess({
      ...cancelledTask,
      cascadedCancelledTaskIds,
    });
  } catch (err) {
    console.error(`[API] 取消任务 ${id} 失败:`, err);
    return apiInternalError(API_COMMON_MESSAGES.cancelFailed);
  }
}

export const POST = withAuth(handler, 'task:update');
