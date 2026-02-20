// ============================================================
// API: Task 审批
// POST /api/tasks/[id]/review   - 审批通过或拒绝
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, systemEvents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { sseManager } from '@/lib/sse/manager';
import {
  createOrFindPullRequest,
  createPullRequestComment,
  mergePullRequest,
  parseGitRepository,
  parsePullRequestUrl,
  type GitProvider,
  type GitRepositoryRef,
} from '@/lib/integrations/provider';
import { resolveEnvVarValue } from '@/lib/secrets/resolve';
import { parseReviewPayload } from '@/lib/validation/task-input';
import { API_COMMON_MESSAGES, TASK_MESSAGES } from '@/lib/i18n/messages';
import { resolveAuditActor } from '@/lib/audit/actor';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';

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

    await db.insert(systemEvents).values({
      type: 'task.pr_commented',
      actor: input.actor,
      payload: { taskId: input.taskId, prUrl: input.prUrl, commentUrl: commentRes.htmlUrl, kind: input.kind },
    });
  } catch (err) {
    await db.insert(systemEvents).values({
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
    const body = await request.json().catch(() => ({}));
    const parsed = parseReviewPayload(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: parsed.errorMessage } },
        { status: 400 }
      );
    }
    const { action, reviewComment, feedback, mergeRequested } = parsed.data;

    // 检查任务是否存在且处于 awaiting_review 状态
    const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: TASK_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    if (existing[0].status !== 'awaiting_review') {
      return NextResponse.json(
        { success: false, error: { code: 'STATE_CONFLICT', message: TASK_MESSAGES.reviewStateConflict(existing[0].status) } },
        { status: 409 }
      );
    }

    const repository = parseGitRepository(existing[0].repoUrl);
    const token = repository
      ? await resolveProviderToken(repository.provider, {
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
          return NextResponse.json(
            { success: false, error: { code: 'MISSING_GIT_TOKEN', message: TASK_MESSAGES.missingGitProviderToken } },
            { status: 400 }
          );
        }
        if (!activeRepo) {
          return NextResponse.json(
            { success: false, error: { code: 'REPO_PROVIDER_UNSUPPORTED', message: TASK_MESSAGES.unsupportedRepoProvider } },
            { status: 400 }
          );
        }

        // 1) 如果任务尚未写入 prUrl，尝试此处创建（避免卡死在合并阶段）
        if (!ensuredPrUrl) {
          const prTitle = `[CAM] ${existing[0].title}`;
          const prBody = [
            `Task ID: ${existing[0].id}`,
            `Agent: ${existing[0].agentDefinitionId}`,
            `Branch: ${existing[0].workBranch}`,
            '',
            existing[0].description,
          ].join('\n');

          const pr = await createOrFindPullRequest({
            token,
            repository: activeRepo,
            headBranch: existing[0].workBranch,
            baseBranch: existing[0].baseBranch,
            title: prTitle,
            body: prBody,
          });

          ensuredPrUrl = pr.htmlUrl;
          ensuredPrNumber = pr.number;

          await db.update(tasks).set({ prUrl: ensuredPrUrl }).where(eq(tasks.id, id));
          await db.insert(systemEvents).values({
            type: 'task.pr_created',
            actor,
            payload: {
              taskId: id,
              prUrl: ensuredPrUrl,
              prNumber: pr.number,
              provider: activeRepo.provider,
              owner: activeRepo.owner,
              repo: activeRepo.repo,
            },
          });
        }

        // 2) 解析 PR 信息并合并
        const prInfo = ensuredPrUrl ? parsePullRequestUrl(ensuredPrUrl) : null;
        if (prInfo && activeRepo && prInfo.provider === activeRepo.provider && prInfo.projectPath === activeRepo.projectPath) {
          ensuredPrNumber = prInfo.number;
        }

        if (!ensuredPrNumber) {
          return NextResponse.json(
            { success: false, error: { code: 'INVALID_PR_URL', message: TASK_MESSAGES.invalidPrUrlForMerge } },
            { status: 400 }
          );
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

          await db.insert(systemEvents).values({
            type: 'task.pr_merged',
            actor,
            payload: {
              taskId: id,
              prUrl: ensuredPrUrl,
              prNumber: ensuredPrNumber,
              provider: activeRepo.provider,
              merged: merge.merged,
              sha: merge.sha,
            },
          });
          sseManager.broadcast('task.pr_merged', { taskId: id, prUrl: ensuredPrUrl, prNumber: ensuredPrNumber });
        } catch (err) {
          return NextResponse.json(
            { success: false, error: { code: 'GIT_MERGE_FAILED', message: (err as Error).message } },
            { status: 502 }
          );
        }
      }

      const result = await db
        .update(tasks)
        .set({
          status: 'completed',
          reviewComment: reviewComment || null,
          reviewedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        })
        .where(eq(tasks.id, id))
        .returning();

      await db.insert(systemEvents).values({
        type: 'task.review_approved',
        actor,
        payload: { taskId: id, comment: reviewComment, mergeRequested, merged: mergedPr, provider: activeRepo?.provider || null },
      });
      sseManager.broadcast('task.review_approved', { taskId: id });
      sseManager.broadcast('task.progress', { taskId: id, status: 'completed' });

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

      return NextResponse.json({ success: true, data: result[0] });
    }

    // reject: 带反馈重新入队
    const nextRetryCount = existing[0].retryCount + 1;
    const maxRetries = existing[0].maxRetries;

    // 超过重试上限：不再入队，直接失败收敛
    if (nextRetryCount > maxRetries) {
      const result = await db
        .update(tasks)
        .set({
          status: 'failed',
          feedback: feedback,
          reviewComment: reviewComment || null,
          reviewedAt: new Date().toISOString(),
          retryCount: nextRetryCount,
          assignedWorkerId: null,
          completedAt: new Date().toISOString(),
        })
        .where(eq(tasks.id, id))
        .returning();

      await db.insert(systemEvents).values({
        type: 'task.review_rejected_max_retries',
        actor,
        payload: {
          taskId: id,
          feedback,
          comment: reviewComment,
          retryCount: nextRetryCount,
          maxRetries,
        },
      });
      sseManager.broadcast('task.review_rejected', { taskId: id, final: true });
      sseManager.broadcast('task.progress', { taskId: id, status: 'failed' });

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

      return NextResponse.json({ success: true, data: result[0] });
    }

    const result = await db
      .update(tasks)
      .set({
        status: 'queued',
        feedback: feedback,
        reviewComment: reviewComment || null,
        reviewedAt: new Date().toISOString(),
        retryCount: nextRetryCount,
        assignedWorkerId: null,
        queuedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      })
      .where(eq(tasks.id, id))
      .returning();

    await db.insert(systemEvents).values({
      type: 'task.review_rejected',
      actor,
      payload: { taskId: id, feedback, comment: reviewComment },
    });
    sseManager.broadcast('task.review_rejected', { taskId: id });
    sseManager.broadcast('task.progress', { taskId: id, status: 'queued' });

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

    return NextResponse.json({ success: true, data: result[0] });
  } catch (err) {
    console.error(`[API] 审批任务 ${id} 失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.reviewFailed } },
      { status: 500 }
    );
  }
}

export const POST = withAuth(handler, 'task:review');
