// ============================================================
// API: 单个 Task 操作
// GET    /api/tasks/[id]            - 获取任务详情
// PATCH  /api/tasks/[id]            - 更新任务
// DELETE /api/tasks/[id]            - 删除任务
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, taskLogs, systemEvents } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import { createOrFindPullRequest, parseGitRepository, type GitProvider } from '@/lib/integrations/provider';
import { resolveEnvVarValue } from '@/lib/secrets/resolve';
import { parseTaskPatchPayload } from '@/lib/validation/task-input';
import { API_COMMON_MESSAGES, TASK_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { agentSessionManager } from '@/lib/terminal/agent-session-manager';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isForeignKeyConstraintError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: string }).code;
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return true;
    }
  }
  return (err as Error).message.includes('FOREIGN KEY constraint failed');
}

async function resolveProviderToken(
  provider: GitProvider,
  scope: { repositoryId?: string | null; repoUrl?: string | null; agentDefinitionId?: string | null }
): Promise<string> {
  const candidates: Record<GitProvider, string[]> = {
    github: ['GITHUB_TOKEN', 'GITHUB_PAT', 'GITHUB_API_TOKEN', 'GIT_HTTP_TOKEN', 'CAM_GIT_HTTP_TOKEN'],
    gitlab: ['GITLAB_TOKEN', 'GITLAB_PRIVATE_TOKEN', 'GITLAB_API_TOKEN', 'GIT_HTTP_TOKEN', 'CAM_GIT_HTTP_TOKEN'],
    gitea: ['GITEA_TOKEN', 'GITEA_API_TOKEN', 'GIT_HTTP_TOKEN', 'CAM_GIT_HTTP_TOKEN'],
  };

  for (const envName of candidates[provider]) {
    const scoped = await resolveEnvVarValue(envName, scope);
    if (scoped) return scoped;
    const raw = process.env[envName];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return '';
}

async function handleGet(_request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: TASK_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: result[0] });
  } catch (err) {
    console.error(`[API] 获取任务 ${id} 失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.queryFailed } },
      { status: 500 }
    );
  }
}

async function handlePatch(request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: TASK_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    // 取消态视为终态：忽略后续状态回写，避免 worker 在取消后覆盖状态
    if (existing[0].status === 'cancelled') {
      return NextResponse.json({ success: true, data: existing[0] });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = parseTaskPatchPayload(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: parsed.errorMessage } },
        { status: 400 }
      );
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
      .where(eq(tasks.id, id))
      .returning();

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: TASK_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    // 写入系统事件 + SSE 广播（用于前端实时刷新 + 日志页）
    if (status !== undefined) {
      sseManager.broadcast('task.progress', { taskId: id, status });
      await db.insert(systemEvents).values({
        type: 'task.progress',
        payload: {
          taskId: id,
          status,
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
        ? await resolveProviderToken(repository.provider, scope)
        : '';

      if (!repository) {
        await db.insert(systemEvents).values({
          type: 'task.pr_skipped',
          payload: { taskId: id, reason: 'repo_provider_unsupported', repoUrl: result[0].repoUrl },
        });
      } else if (!token) {
        await db.insert(systemEvents).values({
          type: 'task.pr_skipped',
          payload: { taskId: id, reason: 'missing_provider_token', provider: repository.provider },
        });
      } else {
        try {
          const prTitle = `[CAM] ${result[0].title}`;
          const prBody = [
            `Task ID: ${result[0].id}`,
            `Agent: ${result[0].agentDefinitionId}`,
            `Branch: ${result[0].workBranch}`,
            '',
            result[0].description,
          ].join('\n');

          const pr = await createOrFindPullRequest({
            token,
            repository,
            headBranch: result[0].workBranch,
            baseBranch: result[0].baseBranch,
            title: prTitle,
            body: prBody,
          });

          await db
            .update(tasks)
            .set({ prUrl: pr.htmlUrl })
            .where(eq(tasks.id, id));

          // 更新返回值，减少前端下一次刷新等待
          (result[0] as typeof result[0] & { prUrl?: string }).prUrl = pr.htmlUrl;

          await db.insert(systemEvents).values({
            type: 'task.pr_created',
            payload: {
              taskId: id,
              prUrl: pr.htmlUrl,
              prNumber: pr.number,
              provider: repository.provider,
              owner: repository.owner,
              repo: repository.repo,
            },
          });
          sseManager.broadcast('task.pr_created', { taskId: id, prUrl: pr.htmlUrl, prNumber: pr.number });
        } catch (err) {
          await db.insert(systemEvents).values({
            type: 'task.pr_failed',
            payload: { taskId: id, error: (err as Error).message },
          });
          sseManager.broadcast('task.pr_failed', { taskId: id });
        }
      }
    }

    return NextResponse.json({ success: true, data: result[0] });
  } catch (err) {
    console.error(`[API] 更新任务 ${id} 失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.updateFailed } },
      { status: 500 }
    );
  }
}

async function handleDelete(_request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    // 删除前先尝试停止 terminal 会话并等待日志刷盘收尾，降低 FK 并发冲突概率
    const stopResult = await agentSessionManager.stopAndDrainTaskSessionByTaskId(id, { timeoutMs: 5000 });
    if (stopResult.sessionId && (!stopResult.stopped || !stopResult.drained)) {
      console.warn(
        `[API] 删除任务 ${id} 前会话收尾未完全完成(session=${stopResult.sessionId}, stopped=${stopResult.stopped}, drained=${stopResult.drained})`
      );
    }

    const deleteTaskTx = () => db.transaction(async (tx) => {
      // 先清理子表，避免 task_logs 外键约束阻止任务删除
      await tx.delete(taskLogs).where(eq(taskLogs.taskId, id));
      // 级联清理该任务关联的系统事件（taskId / fromTaskId / taskIds[]）
      await tx.delete(systemEvents).where(sql`
        (${systemEvents.type} LIKE 'task.%' OR ${systemEvents.type} LIKE 'task_group.%')
        AND (
          json_extract(${systemEvents.payload}, '$.taskId') = ${id}
          OR json_extract(${systemEvents.payload}, '$.fromTaskId') = ${id}
          OR EXISTS (
            SELECT 1
            FROM json_each(${systemEvents.payload}, '$.taskIds')
            WHERE value = ${id}
          )
        )
      `);
      const deletedTasks = await tx.delete(tasks).where(eq(tasks.id, id)).returning();
      return deletedTasks;
    });

    let result: Awaited<ReturnType<typeof deleteTaskTx>> = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await deleteTaskTx();
        break;
      } catch (err) {
        const isRetryableFkError = isForeignKeyConstraintError(err);
        if (!isRetryableFkError || attempt === 2) {
          throw err;
        }
        // 极端并发下给日志异步收尾一个短暂窗口，再重试删除
        await sleep(120 * (attempt + 1));
      }
    }

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: TASK_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    sseManager.broadcast('task.deleted', { taskId: id });

    return NextResponse.json({ success: true, data: null });
  } catch (err) {
    console.error(`[API] 删除任务 ${id} 失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.deleteFailed } },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handleGet, 'task:read');
export const PATCH = withAuth(handlePatch, 'task:update');
export const DELETE = withAuth(handleDelete, 'task:delete');
