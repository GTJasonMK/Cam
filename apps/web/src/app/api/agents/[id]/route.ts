// ============================================================
// API: 单个 AgentDefinition 操作
// ============================================================

import { db } from '@/lib/db';
import { agentDefinitions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { AGENT_MESSAGES, API_COMMON_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { apiError, apiInternalError, apiNotFound, apiSuccess } from '@/lib/http/api-response';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { normalizeAgentDefinitionForExecution } from '@/lib/agents/normalize-agent-definition';

async function handleGet(_request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, id)).limit(1);

    if (result.length === 0) {
      return apiNotFound(AGENT_MESSAGES.notFound(id));
    }

    return apiSuccess(normalizeAgentDefinitionForExecution(result[0]));
  } catch (err) {
    console.error(`[API] 获取 Agent 定义 ${id} 失败:`, err);
    return apiInternalError(API_COMMON_MESSAGES.queryFailed);
  }
}

async function handlePut(request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await readJsonBodyAsRecord(request);
    const payload = body as Partial<typeof agentDefinitions.$inferInsert>;

    const result = await db
      .update(agentDefinitions)
      .set({
        displayName: payload.displayName,
        description: payload.description,
        icon: payload.icon,
        dockerImage: payload.dockerImage,
        command: payload.command,
        args: payload.args,
        requiredEnvVars: payload.requiredEnvVars,
        capabilities: payload.capabilities,
        defaultResourceLimits: payload.defaultResourceLimits,
        runtime: payload.runtime,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(agentDefinitions.id, id))
      .returning();

    if (result.length === 0) {
      return apiNotFound(AGENT_MESSAGES.notFound(id));
    }

    return apiSuccess(result[0]);
  } catch (err) {
    console.error(`[API] 更新 Agent 定义 ${id} 失败:`, err);
    return apiInternalError(API_COMMON_MESSAGES.updateFailed);
  }
}

async function handleDelete(_request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    // 检查是否内置定义
    const existing = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, id)).limit(1);

    if (existing.length === 0) {
      return apiNotFound(AGENT_MESSAGES.notFound(id));
    }

    if (existing[0].builtIn) {
      return apiError('FORBIDDEN', AGENT_MESSAGES.builtInDeleteForbidden, { status: 403 });
    }

    await db.delete(agentDefinitions).where(eq(agentDefinitions.id, id));
    return apiSuccess(null);
  } catch (err) {
    console.error(`[API] 删除 Agent 定义 ${id} 失败:`, err);
    return apiInternalError(API_COMMON_MESSAGES.deleteFailed);
  }
}

export const GET = withAuth(handleGet, 'agent:read');
export const PUT = withAuth(handlePut, 'agent:update');
export const DELETE = withAuth(handleDelete, 'agent:delete');
