// ============================================================
// API: Task Group 从某一步开始重启（重置下游为 waiting）
// POST /api/task-groups/restart-from  - fromTaskId + dependents(closure) 重新入队
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, systemEvents } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';
import { API_COMMON_MESSAGES, TASK_GROUP_MESSAGES } from '@/lib/i18n/messages';
import { resolveAuditActor } from '@/lib/audit/actor';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

type TaskRow = {
  id: string;
  status: string;
  dependsOn: string[];
  retryCount: number;
  maxRetries: number;
  feedback: string | null;
};

function buildDependentsMap(rows: Array<Pick<TaskRow, 'id' | 'dependsOn'>>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const t of rows) {
    for (const dep of t.dependsOn || []) {
      const list = map.get(dep) || [];
      list.push(t.id);
      map.set(dep, list);
    }
  }
  return map;
}

function computeClosure(fromTaskId: string, dependents: Map<string, string[]>): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [fromTaskId];
  visited.add(fromTaskId);

  while (queue.length > 0) {
    const cur = queue.shift() as string;
    const next = dependents.get(cur) || [];
    for (const n of next) {
      if (visited.has(n)) continue;
      visited.add(n);
      queue.push(n);
    }
  }

  return visited;
}

async function handler(request: AuthenticatedRequest) {
  try {
    ensureSchedulerStarted();
    const actor = resolveAuditActor(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const groupId = normalizeString(body.groupId);
    const fromTaskId = normalizeString(body.fromTaskId);
    const feedbackInput = normalizeString(body.feedback);

    if (!groupId || !fromTaskId) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: TASK_GROUP_MESSAGES.groupIdAndFromTaskIdRequired } },
        { status: 400 }
      );
    }

    const groupRows = (await db
      .select({
        id: tasks.id,
        status: tasks.status,
        dependsOn: tasks.dependsOn,
        retryCount: tasks.retryCount,
        maxRetries: tasks.maxRetries,
        feedback: tasks.feedback,
      })
      .from(tasks)
      .where(eq(tasks.groupId, groupId))
      .limit(2000)) as unknown as TaskRow[];

    if (groupRows.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: TASK_GROUP_MESSAGES.groupNotFound(groupId) } },
        { status: 404 }
      );
    }

    const byId = new Map(groupRows.map((t) => [t.id, t]));
    const from = byId.get(fromTaskId);
    if (!from) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: TASK_GROUP_MESSAGES.fromTaskNotInGroup(fromTaskId) } },
        { status: 404 }
      );
    }

    const dependentsMap = buildDependentsMap(groupRows);
    const closure = computeClosure(fromTaskId, dependentsMap);
    const closureIds = Array.from(closure);

    const runningInClosure = groupRows.filter((t) => closure.has(t.id) && t.status === 'running').map((t) => t.id);
    if (runningInClosure.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'STATE_CONFLICT',
            message: TASK_GROUP_MESSAGES.closureRunningConflict(runningInClosure),
            runningTaskIds: runningInClosure,
          },
        },
        { status: 409 }
      );
    }

    // fromTask 的依赖必须完成才可 queued，否则保持 waiting（避免错误抢跑）
    const deps = (from.dependsOn as string[]) || [];
    let depsCompleted = true;
    if (deps.length > 0) {
      const depRows = await db.select({ id: tasks.id, status: tasks.status }).from(tasks).where(inArray(tasks.id, deps));
      depsCompleted = depRows.length === deps.length && depRows.every((d) => d.status === 'completed');
    }

    const now = new Date().toISOString();
    const updated: Array<{ id: string; status: string; previousStatus: string }> = [];

    for (const id of closureIds) {
      const t = byId.get(id);
      if (!t) continue;

      const previousStatus = t.status;
      const shouldBumpRetry = ['completed', 'failed', 'cancelled', 'awaiting_review'].includes(previousStatus);
      const nextRetryCount = shouldBumpRetry ? t.retryCount + 1 : t.retryCount;
      const nextMaxRetries = shouldBumpRetry ? Math.max(t.maxRetries, nextRetryCount) : t.maxRetries;

      const nextStatus = id === fromTaskId ? (depsCompleted ? 'queued' : 'waiting') : 'waiting';
      const nextFeedback = id === fromTaskId ? (feedbackInput ?? t.feedback ?? null) : t.feedback ?? null;

      await db
        .update(tasks)
        .set({
          status: nextStatus,
          feedback: nextFeedback,
          retryCount: nextRetryCount,
          maxRetries: nextMaxRetries,
          assignedWorkerId: null,
          queuedAt: id === fromTaskId && nextStatus === 'queued' ? now : null,
          startedAt: null,
          completedAt: null,
          reviewedAt: null,
          reviewComment: null,
          summary: null,
          logFileUrl: null,
        })
        .where(eq(tasks.id, id));

      updated.push({ id, status: nextStatus, previousStatus });

      await db.insert(systemEvents).values({
        type: 'task.restart_from',
        actor,
        payload: {
          taskId: id,
          groupId,
          fromTaskId,
          previousStatus,
          nextStatus,
          retryCount: nextRetryCount,
          maxRetries: nextMaxRetries,
        },
      });

      sseManager.broadcast('task.progress', { taskId: id, status: nextStatus });
    }

    await db.insert(systemEvents).values({
      type: 'task_group.restart_from',
      actor,
      payload: { groupId, fromTaskId, taskIds: closureIds, feedback: feedbackInput || undefined },
    });
    sseManager.broadcast('task_group.restart_from', { groupId, fromTaskId, taskIds: closureIds });

    return NextResponse.json({
      success: true,
      data: {
        groupId,
        fromTaskId,
        resetTasks: updated.length,
        taskIds: closureIds,
        queuedTaskId: depsCompleted ? fromTaskId : null,
        waitingBecauseDeps: depsCompleted ? [] : deps,
      },
    });
  } catch (err) {
    console.error('[API] Task Group restart-from 失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.restartFailed } },
      { status: 500 }
    );
  }
}

export const POST = withAuth(handler, 'task:update');
