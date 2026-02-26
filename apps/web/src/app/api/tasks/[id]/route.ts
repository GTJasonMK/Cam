// ============================================================
// API: 单个 Task 操作
// GET    /api/tasks/[id]            - 获取任务详情
// PATCH  /api/tasks/[id]            - 更新任务
// DELETE /api/tasks/[id]            - 删除任务
// ============================================================

import { db } from '@/lib/db';
import { tasks, taskLogs, systemEvents } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import { createOrFindPullRequest, parseGitRepository } from '@/lib/integrations/provider';
import { resolveGitProviderToken } from '@/lib/integrations/provider-token';
import { parseTaskPatchPayload } from '@/lib/validation/task-input';
import { API_COMMON_MESSAGES, TASK_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { agentSessionManager } from '@/lib/terminal/agent-session-manager';
import { sleep } from '@/lib/async/sleep';
import { isSqliteForeignKeyConstraintError } from '@/lib/db/sqlite-errors';
import { emitTaskPrCreated, emitTaskPrFailed, emitTaskPrSkipped, emitTaskProgress } from '@/lib/tasks/task-events';
import { buildTaskPullRequestDraft } from '@/lib/tasks/pull-request';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { apiBadRequest, apiConflict, apiInternalError, apiNotFound, apiSuccess } from '@/lib/http/api-response';

async function handleGet(_request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);

    if (result.length === 0) {
      return apiNotFound(TASK_MESSAGES.notFound(id));
    }

    return apiSuccess(result[0]);
  } catch (err) {
    console.error(`[API] 获取任务 ${id} 失败:`, err);
    return apiInternalError(API_COMMON_MESSAGES.queryFailed);
  }
}

async function handlePatch(request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (existing.length === 0) {
      return apiNotFound(TASK_MESSAGES.notFound(id));
    }

    // 取消态视为终态：忽略后续状态回写，避免 worker 在取消后覆盖状态
    if (existing[0].status === 'cancelled') {
      return apiSuccess(existing[0]);
    }

    const body = await readJsonBodyAsRecord(request);
    const parsed = parseTaskPatchPayload(body);
    if (!parsed.success) {
      return apiBadRequest(parsed.errorMessage);
    }

    const updateData: Record<string, unknown> = { ...parsed.data };
    const status = parsed.data.status;

    // 状态相关的时间戳自动更新
    if (status === 'running') updateData.startedAt = new Date().toISOString();
    if (status === 'completed' || status === 'failed') updateData.completedAt = new Date().toISOString();
    if (status === 'queued') updateData.queuedAt = new Date().toISOString();

    const result = await db
      .update(tasks)
      .set(updateData)
      // CAS：仅当任务仍处于读取时状态才回写，避免并发下迟到写覆盖最新终态。
      .where(and(eq(tasks.id, id), eq(tasks.status, existing[0].status)))
      .returning();

    if (result.length === 0) {
      const latest = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
      if (latest.length === 0) {
        return apiNotFound(TASK_MESSAGES.notFound(id));
      }
      return apiSuccess(latest[0]);
    }

    // 写入系统事件 + SSE 广播（用于前端实时刷新 + 日志页）
    if (status !== undefined) {
      await emitTaskProgress({
        taskId: id,
        status,
        eventPayload: {
          summary: parsed.data.summary,
          assignedWorkerId: parsed.data.assignedWorkerId,
        },
      });
    }

    // 自动创建 PR/MR：当任务进入 awaiting_review 且尚未写入 prUrl
    if (status === 'awaiting_review' && !result[0].prUrl) {
      const repository = parseGitRepository(result[0].repoUrl);
      const scope = {
        repositoryId: (result[0] as typeof result[0] & { repositoryId?: string | null }).repositoryId || null,
        repoUrl: result[0].repoUrl,
        agentDefinitionId: result[0].agentDefinitionId,
      };

      const token = repository
        ? await resolveGitProviderToken(repository.provider, scope)
        : '';

      if (!repository) {
        await emitTaskPrSkipped({
          taskId: id,
          eventPayload: {
            reason: 'repo_provider_unsupported',
            repoUrl: result[0].repoUrl,
          },
        });
      } else if (!token) {
        await emitTaskPrSkipped({
          taskId: id,
          eventPayload: {
            reason: 'missing_provider_token',
            provider: repository.provider,
          },
        });
      } else {
        try {
          const prDraft = buildTaskPullRequestDraft({
            id: result[0].id,
            title: result[0].title,
            agentDefinitionId: result[0].agentDefinitionId,
            workBranch: result[0].workBranch,
            description: result[0].description,
          });

          const pr = await createOrFindPullRequest({
            token,
            repository,
            headBranch: result[0].workBranch,
            baseBranch: result[0].baseBranch,
            title: prDraft.title,
            body: prDraft.body,
          });

          const prBound = await db
            .update(tasks)
            .set({ prUrl: pr.htmlUrl })
            .where(and(eq(tasks.id, id), eq(tasks.status, 'awaiting_review')))
            .returning({ id: tasks.id });
          if (prBound.length === 0) {
            return apiSuccess(result[0]);
          }

          // 更新返回值，减少前端下一次刷新等待
          (result[0] as typeof result[0] & { prUrl?: string }).prUrl = pr.htmlUrl;

          await emitTaskPrCreated({
            taskId: id,
            eventPayload: {
              prUrl: pr.htmlUrl,
              prNumber: pr.number,
              provider: repository.provider,
              owner: repository.owner,
              repo: repository.repo,
            },
            broadcastPayload: {
              prUrl: pr.htmlUrl,
              prNumber: pr.number,
            },
          });
        } catch (err) {
          await emitTaskPrFailed({
            taskId: id,
            eventPayload: { error: (err as Error).message },
          });
        }
      }
    }

    return apiSuccess(result[0]);
  } catch (err) {
    console.error(`[API] 更新任务 ${id} 失败:`, err);
    return apiInternalError(API_COMMON_MESSAGES.updateFailed);
  }
}

async function handleDelete(_request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const existing = await db
      .select({ id: tasks.id, status: tasks.status, source: tasks.source })
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    if (existing.length === 0) {
      return apiNotFound(TASK_MESSAGES.notFound(id));
    }

    // 防止删除被未终态任务依赖的上游任务：否则会导致下游永久 waiting。
    const blockingDependents = await db
      .select({ id: tasks.id, status: tasks.status })
      .from(tasks)
      .where(sql`
        ${tasks.id} <> ${id}
        AND ${tasks.source} = 'scheduler'
        AND ${tasks.status} NOT IN ('completed', 'failed', 'cancelled')
        AND EXISTS (
          SELECT 1
          FROM json_each(${tasks.dependsOn})
          WHERE value = ${id}
        )
      `)
      .limit(5);
    if (blockingDependents.length > 0) {
      return apiConflict(`该任务仍被 ${blockingDependents.length} 个未完成任务依赖，请先处理下游任务后再删除`, {
        extra: {
          dependentTaskIds: blockingDependents.map((item) => item.id),
        },
      });
    }

    // 删除前先尝试停止 terminal 会话并等待日志刷盘收尾，降低 FK 并发冲突概率
    const stopResult = await agentSessionManager.stopAndDrainTaskSessionByTaskId(id, { timeoutMs: 5000 });
    if (stopResult.sessionId && (!stopResult.stopped || !stopResult.drained)) {
      console.warn(
        `[API] 删除任务 ${id} 前会话收尾未完全完成(session=${stopResult.sessionId}, stopped=${stopResult.stopped}, drained=${stopResult.drained})`
      );
    }

    const deleteTaskTx = () => db.transaction((tx) => {
      // better-sqlite3 事务回调必须同步执行，不能返回 Promise
      // 先清理子表，避免 task_logs 外键约束阻止任务删除
      tx.delete(taskLogs).where(eq(taskLogs.taskId, id)).run();
      // 清理所有下游任务中的 dependsOn 引用，避免“删除上游后重跑下游永久 waiting”
      tx.update(tasks).set({
        dependsOn: sql`
          COALESCE(
            (
              SELECT json_group_array(value)
              FROM json_each(${tasks.dependsOn})
              WHERE value <> ${id}
            ),
            json('[]')
          )
        `,
      }).where(sql`
        ${tasks.id} <> ${id}
        AND ${tasks.source} = 'scheduler'
        AND EXISTS (
          SELECT 1
          FROM json_each(${tasks.dependsOn})
          WHERE value = ${id}
        )
      `).run();
      // 级联清理该任务关联的系统事件（taskId / fromTaskId / taskIds[]）
      tx.delete(systemEvents).where(sql`
        (
          ${systemEvents.type} LIKE 'task.%'
          OR ${systemEvents.type} LIKE 'task_group.%'
          OR ${systemEvents.type} LIKE 'pipeline.%'
        )
        AND (
          json_extract(${systemEvents.payload}, '$.taskId') = ${id}
          OR json_extract(${systemEvents.payload}, '$.fromTaskId') = ${id}
          OR EXISTS (
            SELECT 1
            FROM json_each(${systemEvents.payload}, '$.taskIds')
            WHERE value = ${id}
          )
        )
      `).run();
      const deletedTasks = tx.delete(tasks).where(eq(tasks.id, id)).returning().all();
      return deletedTasks;
    });

    let result: Awaited<ReturnType<typeof deleteTaskTx>> = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await deleteTaskTx();
        break;
      } catch (err) {
        const isRetryableFkError = isSqliteForeignKeyConstraintError(err);
        if (!isRetryableFkError || attempt === 2) {
          throw err;
        }
        // 极端并发下给日志异步收尾一个短暂窗口，再重试删除
        await sleep(120 * (attempt + 1));
      }
    }
    if (result.length === 0) {
      return apiNotFound(TASK_MESSAGES.notFound(id));
    }

    sseManager.broadcast('task.deleted', { taskId: id });

    return apiSuccess(null);
  } catch (err) {
    console.error(`[API] 删除任务 ${id} 失败:`, err);
    return apiInternalError(API_COMMON_MESSAGES.deleteFailed);
  }
}

export const GET = withAuth(handleGet, 'task:read');
export const PATCH = withAuth(handlePatch, 'task:update');
export const DELETE = withAuth(handleDelete, 'task:delete');
