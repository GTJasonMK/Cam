// ============================================================
// API: 单个 Secret 操作
// GET    /api/secrets/[id]   - 获取元信息（不返回明文）
// PUT    /api/secrets/[id]   - 更新（可更新 value / 作用域）
// DELETE /api/secrets/[id]   - 删除
// ============================================================

import { db } from '@/lib/db';
import { secrets, repositories, agentDefinitions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { encryptSecretValue, isMasterKeyPresent } from '@/lib/secrets/crypto';
import { AGENT_MESSAGES, API_COMMON_MESSAGES, REPO_MESSAGES, SECRET_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { normalizeOptionalString, normalizeTrimmedString } from '@/lib/validation/strings';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { apiBadRequest, apiError, apiInternalError, apiNotFound, apiSuccess } from '@/lib/http/api-response';
import { writeSystemEvent } from '@/lib/audit/system-event';

async function handleGet(_request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const row = await db.select().from(secrets).where(eq(secrets.id, id)).limit(1);
    if (row.length === 0) {
      return apiNotFound(SECRET_MESSAGES.notFound(id));
    }

    const r = row[0];
    return apiSuccess({
      id: r.id,
      name: r.name,
      repositoryId: r.repositoryId,
      agentDefinitionId: r.agentDefinitionId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  } catch (err) {
    console.error(`[API] 获取 secret ${id} 失败:`, err);
    return apiInternalError(API_COMMON_MESSAGES.queryFailed);
  }
}

async function handlePut(request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const existing = await db.select().from(secrets).where(eq(secrets.id, id)).limit(1);
    if (existing.length === 0) {
      return apiNotFound(SECRET_MESSAGES.notFound(id));
    }

    const body = await readJsonBodyAsRecord(request);
    const updateData: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = normalizeTrimmedString(body.name);
      if (!name) {
        return apiBadRequest(SECRET_MESSAGES.nameRequired);
      }
      updateData.name = name;
    }

    if (body.repositoryId !== undefined) {
      const repositoryId = normalizeOptionalString(body.repositoryId);
      if (repositoryId) {
        const repo = await db.select({ id: repositories.id }).from(repositories).where(eq(repositories.id, repositoryId)).limit(1);
        if (repo.length === 0) {
          return apiNotFound(REPO_MESSAGES.notFound(repositoryId));
        }
      }
      updateData.repositoryId = repositoryId;
    }

    if (body.agentDefinitionId !== undefined) {
      const agentDefinitionId = normalizeOptionalString(body.agentDefinitionId);
      if (agentDefinitionId) {
        const agent = await db.select({ id: agentDefinitions.id }).from(agentDefinitions).where(eq(agentDefinitions.id, agentDefinitionId)).limit(1);
        if (agent.length === 0) {
          return apiNotFound(AGENT_MESSAGES.notFoundDefinition(agentDefinitionId));
        }
      }
      updateData.agentDefinitionId = agentDefinitionId;
    }

    if (body.value !== undefined) {
      const value = normalizeOptionalString(body.value);
      if (!value) {
        return apiBadRequest(SECRET_MESSAGES.valueRequired);
      }
      if (!isMasterKeyPresent()) {
        return apiError('MISSING_MASTER_KEY', SECRET_MESSAGES.missingMasterKeyOnUpdate, { status: 400 });
      }
      updateData.valueEncrypted = encryptSecretValue(value);
    }

    updateData.updatedAt = new Date().toISOString();

    let updated: typeof secrets.$inferSelect;
    try {
      const result = await db.update(secrets).set(updateData).where(eq(secrets.id, id)).returning();
      updated = result[0];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('unique') || message.toLowerCase().includes('constraint')) {
        return apiError('CONFLICT', SECRET_MESSAGES.duplicateOnUpdate, { status: 409 });
      }
      throw err;
    }

    await writeSystemEvent({
      type: 'secret.updated',
      payload: {
        secretId: updated.id,
        name: updated.name,
        repositoryId: updated.repositoryId,
        agentDefinitionId: updated.agentDefinitionId,
      },
    });

    return apiSuccess({
      id: updated.id,
      name: updated.name,
      repositoryId: updated.repositoryId,
      agentDefinitionId: updated.agentDefinitionId,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  } catch (err) {
    console.error(`[API] 更新 secret ${id} 失败:`, err);
    return apiInternalError(API_COMMON_MESSAGES.updateFailed);
  }
}

async function handleDelete(_request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const existing = await db.select().from(secrets).where(eq(secrets.id, id)).limit(1);
    if (existing.length === 0) {
      return apiNotFound(SECRET_MESSAGES.notFound(id));
    }

    await db.delete(secrets).where(eq(secrets.id, id));

    await writeSystemEvent({
      type: 'secret.deleted',
      payload: {
        secretId: id,
        name: existing[0].name,
        repositoryId: existing[0].repositoryId,
        agentDefinitionId: existing[0].agentDefinitionId,
      },
    });

    return apiSuccess(null);
  } catch (err) {
    console.error(`[API] 删除 secret ${id} 失败:`, err);
    return apiInternalError(API_COMMON_MESSAGES.deleteFailed);
  }
}

export const GET = withAuth(handleGet, 'secret:read');
export const PUT = withAuth(handlePut, 'secret:update');
export const DELETE = withAuth(handleDelete, 'secret:delete');
