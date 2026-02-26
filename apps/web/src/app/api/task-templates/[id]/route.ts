// ============================================================
// API: Task Template Detail
// PUT    /api/task-templates/[id]  - 更新任务模板
// DELETE /api/task-templates/[id]  - 删除任务模板
// ============================================================

import { db } from '@/lib/db';
import { repositories, taskTemplates } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { AGENT_MESSAGES, API_COMMON_MESSAGES, REPO_MESSAGES, TASK_TEMPLATE_MESSAGES } from '@/lib/i18n/messages';
import { parsePatchTaskTemplatePayload } from '@/lib/validation/task-template-input';
import { resolveAuditActor } from '@/lib/audit/actor';
import { writeSystemEvent } from '@/lib/audit/system-event';
import { sseManager } from '@/lib/sse/manager';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { collectReferencedAgentIds, findMissingAgentIds } from '../_agent-validation';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { hasOwnKey } from '@/lib/validation/objects';
import { apiBadRequest, apiInternalError, apiNotFound, apiSuccess } from '@/lib/http/api-response';

async function handlePut(request: AuthenticatedRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = resolveAuditActor(request);
    const { id } = await context.params;
    const body = await readJsonBodyAsRecord(request);
    const parsed = parsePatchTaskTemplatePayload(body);
    if (!parsed.success) {
      return apiBadRequest(parsed.errorMessage);
    }

    const existing = await db
      .select({ id: taskTemplates.id })
      .from(taskTemplates)
      .where(eq(taskTemplates.id, id))
      .limit(1);
    if (existing.length === 0) {
      return apiNotFound(TASK_TEMPLATE_MESSAGES.notFound(id));
    }

    const patch = parsed.data;
    if (hasOwnKey(patch, 'repositoryId') && patch.repositoryId) {
      const repo = await db
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.id, patch.repositoryId))
        .limit(1);
      if (repo.length === 0) {
        return apiNotFound(REPO_MESSAGES.notFound(patch.repositoryId));
      }
    }

    const referencedAgentIds = collectReferencedAgentIds(patch);
    const missingAgentIds = await findMissingAgentIds(referencedAgentIds);
    if (missingAgentIds.length > 0) {
      return apiNotFound(AGENT_MESSAGES.notFound(missingAgentIds[0]));
    }

    const now = new Date().toISOString();
    const result = await db
      .update(taskTemplates)
      .set({
        ...patch,
        updatedAt: now,
      })
      .where(eq(taskTemplates.id, id))
      .returning();

    const changedFields = Object.keys(patch);
    await writeSystemEvent({
      type: 'task_template.updated',
      actor,
      payload: { templateId: id, changedFields },
    });
    sseManager.broadcast('task_template.updated', { templateId: id, changedFields });

    return apiSuccess(result[0]);
  } catch (err) {
    console.error('[API] 更新任务模板失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.updateFailed);
  }
}

async function handleDelete(request: AuthenticatedRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = resolveAuditActor(request);
    const { id } = await context.params;

    const existing = await db
      .select({ id: taskTemplates.id, name: taskTemplates.name })
      .from(taskTemplates)
      .where(eq(taskTemplates.id, id))
      .limit(1);
    if (existing.length === 0) {
      return apiNotFound(TASK_TEMPLATE_MESSAGES.notFound(id));
    }

    await db.delete(taskTemplates).where(eq(taskTemplates.id, id));
    await writeSystemEvent({
      type: 'task_template.deleted',
      actor,
      payload: { templateId: id, name: existing[0].name },
    });
    sseManager.broadcast('task_template.deleted', { templateId: id, name: existing[0].name });

    return apiSuccess({ id });
  } catch (err) {
    console.error('[API] 删除任务模板失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.deleteFailed);
  }
}

export const PUT = withAuth(handlePut, 'template:update');
export const DELETE = withAuth(handleDelete, 'template:delete');
