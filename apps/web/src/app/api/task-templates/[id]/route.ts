// ============================================================
// API: Task Template Detail
// PUT    /api/task-templates/[id]  - 更新任务模板
// DELETE /api/task-templates/[id]  - 删除任务模板
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { repositories, systemEvents, taskTemplates } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { AGENT_MESSAGES, API_COMMON_MESSAGES, REPO_MESSAGES, TASK_TEMPLATE_MESSAGES } from '@/lib/i18n/messages';
import { parsePatchTaskTemplatePayload } from '@/lib/validation/task-template-input';
import { resolveAuditActor } from '@/lib/audit/actor';
import { sseManager } from '@/lib/sse/manager';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { collectReferencedAgentIds, findMissingAgentIds } from '../_agent-validation';

function hasOwn<T extends object>(input: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

async function handlePut(request: AuthenticatedRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = resolveAuditActor(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const parsed = parsePatchTaskTemplatePayload(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: parsed.errorMessage } },
        { status: 400 }
      );
    }

    const existing = await db
      .select({ id: taskTemplates.id })
      .from(taskTemplates)
      .where(eq(taskTemplates.id, id))
      .limit(1);
    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: TASK_TEMPLATE_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    const patch = parsed.data;
    if (hasOwn(patch, 'repositoryId') && patch.repositoryId) {
      const repo = await db
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.id, patch.repositoryId))
        .limit(1);
      if (repo.length === 0) {
        return NextResponse.json(
          { success: false, error: { code: 'NOT_FOUND', message: REPO_MESSAGES.notFound(patch.repositoryId) } },
          { status: 404 }
        );
      }
    }

    const referencedAgentIds = collectReferencedAgentIds(patch);
    const missingAgentIds = await findMissingAgentIds(referencedAgentIds);
    if (missingAgentIds.length > 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: AGENT_MESSAGES.notFound(missingAgentIds[0]) } },
        { status: 404 }
      );
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
    await db.insert(systemEvents).values({
      type: 'task_template.updated',
      actor,
      payload: { templateId: id, changedFields },
    });
    sseManager.broadcast('task_template.updated', { templateId: id, changedFields });

    return NextResponse.json({ success: true, data: result[0] });
  } catch (err) {
    console.error('[API] 更新任务模板失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.updateFailed } },
      { status: 500 }
    );
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
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: TASK_TEMPLATE_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    await db.delete(taskTemplates).where(eq(taskTemplates.id, id));
    await db.insert(systemEvents).values({
      type: 'task_template.deleted',
      actor,
      payload: { templateId: id, name: existing[0].name },
    });
    sseManager.broadcast('task_template.deleted', { templateId: id, name: existing[0].name });

    return NextResponse.json({ success: true, data: { id } });
  } catch (err) {
    console.error('[API] 删除任务模板失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.deleteFailed } },
      { status: 500 }
    );
  }
}

export const PUT = withAuth(handlePut, 'template:update');
export const DELETE = withAuth(handleDelete, 'template:delete');
