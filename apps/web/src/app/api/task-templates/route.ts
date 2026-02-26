// ============================================================
// API: Task Templates
// GET  /api/task-templates  - 获取任务模板列表
// POST /api/task-templates  - 创建任务模板
// ============================================================

import { db } from '@/lib/db';
import { repositories, taskTemplates } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { API_COMMON_MESSAGES, REPO_MESSAGES, AGENT_MESSAGES } from '@/lib/i18n/messages';
import { parseCreateTaskTemplatePayload } from '@/lib/validation/task-template-input';
import { resolveAuditActor } from '@/lib/audit/actor';
import { writeSystemEvent } from '@/lib/audit/system-event';
import { sseManager } from '@/lib/sse/manager';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { collectReferencedAgentIds, findMissingAgentIds } from './_agent-validation';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { apiBadRequest, apiCreated, apiInternalError, apiNotFound, apiSuccess } from '@/lib/http/api-response';
import { normalizeOptionalString } from '@/lib/validation/strings';

async function handleGet(request: AuthenticatedRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (normalizeOptionalString(searchParams.get('q')) ?? '').toLowerCase();
    const rows = await db.select().from(taskTemplates).orderBy(taskTemplates.updatedAt);
    const data = q
      ? rows.filter((row) => {
          const text = [row.name, row.titleTemplate, row.promptTemplate, row.repoUrl || '', row.baseBranch || '']
            .join(' ')
            .toLowerCase();
          return text.includes(q);
        })
      : rows;
    return apiSuccess(data);
  } catch (err) {
    console.error('[API] 获取任务模板列表失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.listFailed);
  }
}

async function handlePost(request: AuthenticatedRequest) {
  try {
    const actor = resolveAuditActor(request);
    const body = await readJsonBodyAsRecord(request);
    const parsed = parseCreateTaskTemplatePayload(body);
    if (!parsed.success) {
      return apiBadRequest(parsed.errorMessage);
    }

    const payload = parsed.data;
    if (payload.repositoryId) {
      const repo = await db
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.id, payload.repositoryId))
        .limit(1);
      if (repo.length === 0) {
        return apiNotFound(REPO_MESSAGES.notFound(payload.repositoryId));
      }
    }

    const referencedAgentIds = collectReferencedAgentIds(payload);
    const missingAgentIds = await findMissingAgentIds(referencedAgentIds);
    if (missingAgentIds.length > 0) {
      return apiNotFound(AGENT_MESSAGES.notFound(missingAgentIds[0]));
    }

    const now = new Date().toISOString();
    const created = await db
      .insert(taskTemplates)
      .values({
        name: payload.name,
        titleTemplate: payload.titleTemplate,
        promptTemplate: payload.promptTemplate,
        agentDefinitionId: payload.agentDefinitionId,
        repositoryId: payload.repositoryId,
        repoUrl: payload.repoUrl,
        baseBranch: payload.baseBranch,
        workDir: payload.workDir,
        pipelineSteps: payload.pipelineSteps,
        maxRetries: payload.maxRetries,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await writeSystemEvent({
      type: 'task_template.created',
      actor,
      payload: {
        templateId: created[0].id,
        name: created[0].name,
      },
    });
    sseManager.broadcast('task_template.created', { templateId: created[0].id, name: created[0].name });

    return apiCreated(created[0]);
  } catch (err) {
    console.error('[API] 创建任务模板失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.createFailed);
  }
}

export const GET = withAuth(handleGet, 'template:read');
export const POST = withAuth(handlePost, 'template:create');
