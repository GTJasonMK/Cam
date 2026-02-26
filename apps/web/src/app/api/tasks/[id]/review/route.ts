// ============================================================
// API: Task 审批
// POST /api/tasks/[id]/review   - 审批通过或拒绝
// ============================================================

import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  createOrFindPullRequest,
  createPullRequestComment,
  mergePullRequest,
  parseGitRepository,
  parsePullRequestUrl,
  type GitRepositoryRef,
} from '@/lib/integrations/provider';
import { resolveGitProviderToken } from '@/lib/integrations/provider-token';
import { parseReviewPayload } from '@/lib/validation/task-input';
import { API_COMMON_MESSAGES, TASK_MESSAGES } from '@/lib/i18n/messages';
import { resolveAuditActor } from '@/lib/audit/actor';
import { writeSystemEvent } from '@/lib/audit/system-event';
import { emitTaskPrCreated, emitTaskPrMerged } from '@/lib/tasks/task-events';
import { buildTaskPullRequestDraft } from '@/lib/tasks/pull-request';
import { emitTaskReviewOutcome, updateTaskWhenAwaitingReview } from '@/lib/tasks/review-lifecycle';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import {
  apiBadRequest,
  apiConflict,
  apiError,
  apiInternalError,
  apiNotFound,
  apiSuccess,
} from '@/lib/http/api-response';

async function commentPullRequestBestEffort(input: {
  token: string;
  repository: GitRepositoryRef;
  prUrl: string;
  taskId: string;
  kind: string;
  body: string;
  actor: string;
}): Promise<void> {
  const prInfo = parsePullRequestUrl(input.prUrl);
  if (!prInfo) return;
  if (prInfo.provider !== input.repository.provider || prInfo.projectPath !== input.repository.projectPath) return;

  try {
    const commentRes = await createPullRequestComment({
      token: input.token,
      repository: input.repository,
      pullNumber: prInfo.number,
      body: input.body,
    });

    await writeSystemEvent({
      type: 'task.pr_commented',
      actor: input.actor,
      payload: { taskId: input.taskId, prUrl: input.prUrl, commentUrl: commentRes.htmlUrl, kind: input.kind },
    });
  } catch (err) {
    await writeSystemEvent({
      type: 'task.pr_comment_failed',
      actor: input.actor,
      payload: { taskId: input.taskId, prUrl: input.prUrl, error: (err as Error).message, kind: input.kind },
    });
  }
}

async function handler(request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const actor = resolveAuditActor(request);
    const body = await readJsonBodyAsRecord(request);
    const parsed = parseReviewPayload(body);
    if (!parsed.success) {
      return apiBadRequest(parsed.errorMessage);
    }
    const { action, reviewComment, feedback, mergeRequested } = parsed.data;

    // 检查任务是否存在且处于 awaiting_review 状态
    const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (existing.length === 0) {
      return apiNotFound(TASK_MESSAGES.notFound(id));
    }

    // 审批流仅针对调度任务；terminal 任务不进入 awaiting_review 生命周期。
    if (existing[0].source !== 'scheduler') {
      return apiConflict('仅调度任务支持审批流程');
    }

    if (existing[0].status !== 'awaiting_review') {
      return apiConflict(TASK_MESSAGES.reviewStateConflict(existing[0].status));
    }

    const repository = parseGitRepository(existing[0].repoUrl);
    const token = repository
      ? await resolveGitProviderToken(repository.provider, {
          repositoryId: (existing[0] as typeof existing[0] & { repositoryId?: string | null }).repositoryId || null,
          repoUrl: existing[0].repoUrl,
          agentDefinitionId: existing[0].agentDefinitionId,
        })
      : '';
    const prUrl = (existing[0].prUrl as string | null | undefined) || null;

    // approve: 可选 merge PR（显式请求才尝试）
    if (action === 'approve') {
      let mergedPr = false;
      let ensuredPrUrl = prUrl;
      let ensuredPrNumber: number | null = null;
      const activeRepo = repository;

      if (mergeRequested) {
        if (!token) {
          return apiError('MISSING_GIT_TOKEN', TASK_MESSAGES.missingGitProviderToken, { status: 400 });
        }
        if (!activeRepo) {
          return apiError('REPO_PROVIDER_UNSUPPORTED', TASK_MESSAGES.unsupportedRepoProvider, { status: 400 });
        }

        // 1) 如果任务尚未写入 prUrl，尝试此处创建（避免卡死在合并阶段）
        if (!ensuredPrUrl) {
          const prDraft = buildTaskPullRequestDraft({
            id: existing[0].id,
            title: existing[0].title,
            agentDefinitionId: existing[0].agentDefinitionId,
            workBranch: existing[0].workBranch,
            description: existing[0].description,
          });

          const pr = await createOrFindPullRequest({
            token,
            repository: activeRepo,
            headBranch: existing[0].workBranch,
            baseBranch: existing[0].baseBranch,
            title: prDraft.title,
            body: prDraft.body,
          });

          ensuredPrUrl = pr.htmlUrl;
          ensuredPrNumber = pr.number;

          const boundPr = await db
            .update(tasks)
            .set({ prUrl: ensuredPrUrl })
            .where(and(eq(tasks.id, id), eq(tasks.status, 'awaiting_review')))
            .returning({ id: tasks.id });
          if (boundPr.length === 0) {
            return apiConflict('任务状态已变化，已中止合并操作');
          }
          await emitTaskPrCreated({
            taskId: id,
            actor,
            eventPayload: {
              prUrl: ensuredPrUrl,
              prNumber: pr.number,
              provider: activeRepo.provider,
              owner: activeRepo.owner,
              repo: activeRepo.repo,
            },
            broadcastPayload: {
              prUrl: ensuredPrUrl,
              prNumber: pr.number,
            },
          });
        }

        // 2) 解析 PR 信息并合并
        const prInfo = ensuredPrUrl ? parsePullRequestUrl(ensuredPrUrl) : null;
        if (prInfo && activeRepo && prInfo.provider === activeRepo.provider && prInfo.projectPath === activeRepo.projectPath) {
          ensuredPrNumber = prInfo.number;
        }

        if (!ensuredPrNumber) {
          return apiError('INVALID_PR_URL', TASK_MESSAGES.invalidPrUrlForMerge, { status: 400 });
        }

        // 合并前再做一次状态守卫，降低并发下“状态已变化仍触发外部 merge”的风险窗口。
        const stillAwaitingReview = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.id, id), eq(tasks.status, 'awaiting_review')))
          .limit(1);
        if (stillAwaitingReview.length === 0) {
          return apiConflict('任务状态已变化，已中止合并操作');
        }

        try {
          const merge = await mergePullRequest({
            token,
            repository: activeRepo,
            pullNumber: ensuredPrNumber,
            mergeMethod: 'squash',
            commitTitle: `[CAM] ${existing[0].title}`,
            commitMessage: reviewComment || undefined,
          });
          mergedPr = Boolean(merge.merged);

          await emitTaskPrMerged({
            taskId: id,
            actor,
            eventPayload: {
              prUrl: ensuredPrUrl,
              prNumber: ensuredPrNumber,
              provider: activeRepo.provider,
              merged: merge.merged,
              sha: merge.sha,
            },
            broadcastPayload: {
              prUrl: ensuredPrUrl,
              prNumber: ensuredPrNumber,
            },
          });
        } catch (err) {
          return apiError('GIT_MERGE_FAILED', (err as Error).message, { status: 502 });
        }
      }

      const approvedTask = await updateTaskWhenAwaitingReview(id, {
        status: 'completed',
        reviewComment: reviewComment || null,
        reviewedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      if (!approvedTask) {
        return apiConflict('任务状态已变化，请刷新后重试审批');
      }

      await emitTaskReviewOutcome({
        taskId: id,
        actor,
        status: 'completed',
        eventType: 'task.review_approved',
        eventPayload: {
          comment: reviewComment,
          mergeRequested,
          merged: mergedPr,
          provider: activeRepo?.provider || null,
        },
      });

      // best-effort：写一条 PR/MR comment，便于在代码平台追踪审批结果
      if (token && activeRepo && (ensuredPrUrl || prUrl)) {
        const lines = [
          mergeRequested ? '✅ Approved & merged by CAM' : '✅ Approved by CAM',
          `Task ID: ${id}`,
          reviewComment ? `Comment: ${reviewComment}` : null,
        ].filter(Boolean) as string[];
        await commentPullRequestBestEffort({
          token,
          repository: activeRepo,
          prUrl: ensuredPrUrl || prUrl || '',
          taskId: id,
          kind: 'approve',
          body: lines.join('\n'),
          actor,
        });
      }

      return apiSuccess(approvedTask);
    }

    // reject: 带反馈重新入队
    const nextRetryCount = existing[0].retryCount + 1;
    const maxRetries = existing[0].maxRetries;

    // 超过重试上限：不再入队，直接失败收敛
    if (nextRetryCount > maxRetries) {
      const rejectedFinalTask = await updateTaskWhenAwaitingReview(id, {
        status: 'failed',
        feedback: feedback,
        reviewComment: reviewComment || null,
        reviewedAt: new Date().toISOString(),
        retryCount: nextRetryCount,
        assignedWorkerId: null,
        completedAt: new Date().toISOString(),
      });
      if (!rejectedFinalTask) {
        return apiConflict('任务状态已变化，请刷新后重试审批');
      }

      await emitTaskReviewOutcome({
        taskId: id,
        actor,
        status: 'failed',
        eventType: 'task.review_rejected_max_retries',
        eventPayload: {
          feedback,
          comment: reviewComment,
          retryCount: nextRetryCount,
          maxRetries,
        },
        reviewRejectedFinal: true,
      });

      // best-effort：向 PR/MR 留痕（最终失败收敛）
      if (token && repository && prUrl) {
        await commentPullRequestBestEffort({
          token,
          repository,
          prUrl,
          taskId: id,
          kind: 'reject_final',
          body: [`❌ Rejected (max retries reached)`, `Task ID: ${id}`, `Feedback: ${feedback}`].join('\n'),
          actor,
        });
      }

      return apiSuccess(rejectedFinalTask);
    }

    const requeuedTask = await updateTaskWhenAwaitingReview(id, {
      status: 'queued',
      feedback: feedback,
      reviewComment: reviewComment || null,
      reviewedAt: new Date().toISOString(),
      retryCount: nextRetryCount,
      assignedWorkerId: null,
      queuedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    });
    if (!requeuedTask) {
      return apiConflict('任务状态已变化，请刷新后重试审批');
    }

    await emitTaskReviewOutcome({
      taskId: id,
      actor,
      status: 'queued',
      eventType: 'task.review_rejected',
      eventPayload: { feedback, comment: reviewComment },
    });

    // best-effort：向 PR/MR 留痕（拒绝后重跑）
    if (token && repository && prUrl) {
      await commentPullRequestBestEffort({
        token,
        repository,
        prUrl,
        taskId: id,
        kind: 'reject',
        body: [`❌ Rejected & re-queued by CAM`, `Task ID: ${id}`, `Feedback: ${feedback}`].join('\n'),
        actor,
      });
    }

    return apiSuccess(requeuedTask);
  } catch (err) {
    console.error(`[API] 审批任务 ${id} 失败:`, err);
    return apiInternalError(API_COMMON_MESSAGES.reviewFailed);
  }
}

export const POST = withAuth(handler, 'task:review');
