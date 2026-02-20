// ============================================================
// API: Task Templates
// GET  /api/task-templates  - 获取任务模板列表
// POST /api/task-templates  - 创建任务模板
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agentDefinitions, repositories, systemEvents, taskTemplates } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { API_COMMON_MESSAGES, REPO_MESSAGES, AGENT_MESSAGES } from '@/lib/i18n/messages';
import { parseCreateTaskTemplatePayload } from '@/lib/validation/task-template-input';
import { resolveAuditActor } from '@/lib/audit/actor';
import { sseManager } from '@/lib/sse/manager';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';

async function handleGet(request: AuthenticatedRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    const rows = await db.select().from(taskTemplates).orderBy(taskTemplates.updatedAt);
    const data = q
      ? rows.filter((row) => {
          const text = [row.name, row.titleTemplate, row.promptTemplate, row.repoUrl || '', row.baseBranch || '']
            .join(' ')
            .toLowerCase();
          return text.includes(q);
        })
      : rows;
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('[API] 获取任务模板列表失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.listFailed } },
      { status: 500 }
    );
  }
}

async function handlePost(request: AuthenticatedRequest) {
  try {
    const actor = resolveAuditActor(request);
    const body = await request.json().catch(() => ({}));
    const parsed = parseCreateTaskTemplatePayload(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: parsed.errorMessage } },
        { status: 400 }
      );
    }

    const payload = parsed.data;
    if (payload.repositoryId) {
      const repo = await db
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.id, payload.repositoryId))
        .limit(1);
      if (repo.length === 0) {
        return NextResponse.json(
          { success: false, error: { code: 'NOT_FOUND', message: REPO_MESSAGES.notFound(payload.repositoryId) } },
          { status: 404 }
        );
      }
    }

    if (payload.agentDefinitionId) {
      const agent = await db
        .select({ id: agentDefinitions.id })
        .from(agentDefinitions)
        .where(eq(agentDefinitions.id, payload.agentDefinitionId))
        .limit(1);
      if (agent.length === 0) {
        return NextResponse.json(
          { success: false, error: { code: 'NOT_FOUND', message: AGENT_MESSAGES.notFound(payload.agentDefinitionId) } },
          { status: 404 }
        );
      }
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

    await db.insert(systemEvents).values({
      type: 'task_template.created',
      actor,
      payload: {
        templateId: created[0].id,
        name: created[0].name,
      },
    });
    sseManager.broadcast('task_template.created', { templateId: created[0].id, name: created[0].name });

    return NextResponse.json({ success: true, data: created[0] }, { status: 201 });
  } catch (err) {
    console.error('[API] 创建任务模板失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.createFailed } },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handleGet, 'template:read');
export const POST = withAuth(handlePost, 'template:create');
